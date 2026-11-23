import { useState, useEffect, useRef, useCallback } from "react";
import { supabase } from "../lib/supabase";
import {
  getIceServers, mediaConstraints, RING_TIMEOUT_MS,
  startCall as apiStartCall, acceptCall as apiAcceptCall, rejectCall as apiRejectCall,
  cancelCall as apiCancelCall, endCall as apiEndCall, markMissedCall as apiMarkMissed,
  clearMyActiveCallSessions,
  sendSignal, getSignals, getProfileBrief, getCallSession, getRingingIncoming,
  subscribeUserCalls, subscribeCallChannel, removeCallChannel,
} from "../services/calls";

const CALL_POLL_MS = 1500;

async function getLocalMedia(callType) {
  if (!navigator.mediaDevices?.getUserMedia) {
    const err = new Error("insecure");
    err.name = "InsecureContextError";
    throw err;
  }
  return navigator.mediaDevices.getUserMedia(mediaConstraints(callType));
}

// getUserMedia hatalarını kullanıcı dostu mesaja çevir.
function mediaErrorMessage(e) {
  if (e?.name === "InsecureContextError")
    return "Kamera/mikrofon yalnızca HTTPS veya localhost üzerinde kullanılabilir.";
  const n = e?.name || "";
  if (n === "NotAllowedError" || n === "SecurityError")
    return "Kamera/mikrofon izni reddedildi. Tarayıcı/istemci ayarlarından izin verin.";
  if (n === "NotFoundError" || n === "DevicesNotFoundError")
    return "Kamera veya mikrofon bulunamadı.";
  if (n === "NotReadableError")
    return "Kamera/mikrofon başka bir uygulama tarafından kullanılıyor.";
  return "Medya cihazına erişilemedi.";
}

export function useCall(meId) {
  const [incoming, setIncoming] = useState(null); // {id, caller_id, call_type, peer:{...}}
  const [active, setActive] = useState(null);      // {id, callType, isCaller, peerId, peerName, peerAvatar}
  const [callStatus, setCallStatus] = useState("idle"); // idle|outgoing|incoming|connecting|active|ended
  const [localStream, setLocalStream] = useState(null);
  const [remoteStream, setRemoteStream] = useState(null);
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [durationSec, setDurationSec] = useState(0);
  const [error, setError] = useState(null);

  const pcRef = useRef(null);
  const localStreamRef = useRef(null);
  const remoteStreamRef = useRef(null);
  const callChannelRef = useRef(null);
  const userChannelRef = useRef(null);
  const processedRef = useRef(new Set());
  const pendingCandRef = useRef([]);
  const remoteSetRef = useRef(false);
  const ringTimerRef = useRef(null);
  const durTimerRef = useRef(null);
  const facingRef = useRef("user");
  const activeRef = useRef(null);
  const incomingRef = useRef(null);
  const callStatusRef = useRef(callStatus);
  activeRef.current = active;
  incomingRef.current = incoming;
  callStatusRef.current = callStatus;

  const clearTimers = useCallback(() => {
    if (ringTimerRef.current) { clearTimeout(ringTimerRef.current); ringTimerRef.current = null; }
    if (durTimerRef.current) { clearInterval(durTimerRef.current); durTimerRef.current = null; }
  }, []);

  const teardown = useCallback((errObj = null) => {
    clearTimers();
    try { localStreamRef.current?.getTracks().forEach((t) => t.stop()); } catch (_) {}
    localStreamRef.current = null;
    try { pcRef.current?.getSenders?.().forEach((s) => { try { s.track && s.track.stop(); } catch (_) {} }); } catch (_) {}
    try { if (pcRef.current) { pcRef.current.ontrack = null; pcRef.current.onicecandidate = null; pcRef.current.close(); } } catch (_) {}
    pcRef.current = null;
    removeCallChannel(callChannelRef.current);
    callChannelRef.current = null;
    processedRef.current = new Set();
    pendingCandRef.current = [];
    remoteSetRef.current = false;
    remoteStreamRef.current = null;
    setLocalStream(null);
    setRemoteStream(null);
    setActive(null);
    setDurationSec(0);
    setMicOn(true);
    setCamOn(true);
    setCallStatus("idle");
    if (errObj) setError(errObj);
  }, [clearTimers]);

  const startDurationTimer = useCallback(() => {
    if (durTimerRef.current) return;
    const t0 = Date.now();
    durTimerRef.current = setInterval(() => setDurationSec(Math.floor((Date.now() - t0) / 1000)), 1000);
  }, []);

  const flushCandidates = useCallback(async () => {
    const pc = pcRef.current;
    if (!pc) return;
    const list = pendingCandRef.current;
    pendingCandRef.current = [];
    for (const c of list) {
      try { await pc.addIceCandidate(c); } catch (_) {}
    }
  }, []);

  // Peer connection kur + yerel medyayı ekle.
  const setupPeer = useCallback((callId, stream) => {
    const pc = new RTCPeerConnection({ iceServers: getIceServers() });
    pc.onicecandidate = (e) => {
      if (e.candidate) sendSignal(callId, meId, "ice_candidate", e.candidate.toJSON()).catch(() => {});
    };
    pc.ontrack = (e) => {
      // Bazı tarayıcılarda audio/video ayrı track olarak gelir; tek MediaStream'te birleştir.
      let remote = remoteStreamRef.current;
      if (e.streams && e.streams[0]) {
        remote = e.streams[0];
      } else {
        if (!remote) remote = new MediaStream();
        if (!remote.getTracks().some((t) => t.id === e.track.id)) remote.addTrack(e.track);
      }
      remoteStreamRef.current = remote;
      setRemoteStream(remote);
      setCallStatus("active");
      startDurationTimer();
    };
    pc.onconnectionstatechange = () => {
      const st = pc.connectionState;
      if (st === "connected") { setCallStatus("active"); startDurationTimer(); }
      if (st === "failed") teardown({ code: "ice", message: "Bağlantı kurulamadı (ağ/TURN gerekebilir)." });
    };
    pc.oniceconnectionstatechange = () => {
      if (pc.iceConnectionState === "failed") {
        try { pc.restartIce?.(); } catch (_) {}
      }
    };
    stream.getTracks().forEach((t) => pc.addTrack(t, stream));
    pcRef.current = pc;
    return pc;
  }, [meId, startDurationTimer, teardown]);

  const processSignal = useCallback(async (sig) => {
    if (!sig || sig.sender_id === meId) return;          // kendi sinyalini işleme
    if (processedRef.current.has(sig.id)) return;        // dedupe
    processedRef.current.add(sig.id);
    const pc = pcRef.current;
    if (!pc) return;
    try {
      if (sig.signal_type === "offer") {
        if (remoteSetRef.current) return;
        await pc.setRemoteDescription(new RTCSessionDescription(sig.payload));
        remoteSetRef.current = true;
        await flushCandidates();
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        await sendSignal(sig.call_id, meId, "answer", { type: answer.type, sdp: answer.sdp });
      } else if (sig.signal_type === "answer") {
        if (remoteSetRef.current) return;
        await pc.setRemoteDescription(new RTCSessionDescription(sig.payload));
        remoteSetRef.current = true;
        await flushCandidates();
      } else if (sig.signal_type === "ice_candidate") {
        const cand = new RTCIceCandidate(sig.payload);
        if (remoteSetRef.current) { try { await pc.addIceCandidate(cand); } catch (_) {} }
        else pendingCandRef.current.push(cand);
      }
    } catch (_) { /* bozuk sinyal yoksay */ }
  }, [meId, flushCandidates]);

  // Aktif çağrının oturum durumu değişince.
  const onActiveSessionChange = useCallback((row) => {
    const cur = activeRef.current;
    if (!cur || row.id !== cur.id) return;
    if (row.status === "rejected") teardown({ code: "rejected", message: "Çağrı reddedildi." });
    else if (row.status === "cancelled") teardown();
    else if (row.status === "ended") teardown();
    else if (row.status === "missed") teardown({ code: "missed", message: "Cevapsız çağrı." });
    else if (row.status === "accepted") { if (cur.isCaller) setCallStatus("connecting"); }
  }, [teardown]);

  const attachCallChannel = useCallback((callId) => {
    removeCallChannel(callChannelRef.current);
    callChannelRef.current = subscribeCallChannel(callId, {
      onSignal: processSignal,
      onSessionChange: onActiveSessionChange,
    });
  }, [processSignal, onActiveSessionChange]);

  // ---------------- dışa açık aksiyonlar ----------------
  const startCall = useCallback(async (peer, conversationId, callType) => {
    if (activeRef.current) return;
    setError(null);
    facingRef.current = "user";
    let stream;
    try {
      stream = await getLocalMedia(callType);
    } catch (e) {
      setError({ code: "media", message: mediaErrorMessage(e) });
      return;
    }
    let callId;
    try {
      callId = await apiStartCall(peer.id, conversationId, callType);
    } catch (e) {
      const msg = e?.message || "";
      // Stuck ringing/accepted: mevcut RPC'lerle temizle + bir kez daha dene
      if (/aktif bir (çağrı|arama)/i.test(msg)) {
        try {
          await clearMyActiveCallSessions(meId);
          callId = await apiStartCall(peer.id, conversationId, callType);
        } catch (e2) {
          stream.getTracks().forEach((t) => t.stop());
          setError({ code: "start", message: e2?.message || msg || "Arama başlatılamadı." });
          return;
        }
      } else {
        stream.getTracks().forEach((t) => t.stop());
        setError({ code: "start", message: msg || "Arama başlatılamadı." });
        return;
      }
    }
    localStreamRef.current = stream;
    setLocalStream(stream);
    setCamOn(callType === "video");
    setActive({ id: callId, callType, isCaller: true, peerId: peer.id, peerName: peer.name, peerAvatar: peer.avatarUrl });
    setCallStatus("outgoing");
    const pc = setupPeer(callId, stream);
    attachCallChannel(callId);
    try {
      const offer = await pc.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: callType === "video" });
      await pc.setLocalDescription(offer);
      await sendSignal(callId, meId, "offer", { type: offer.type, sdp: offer.sdp });
    } catch (e) {
      teardown({ code: "offer", message: "Çağrı kurulamadı." });
      apiCancelCall(callId).catch(() => {});
      return;
    }
    // 45 sn cevap yoksa: cevapsız.
    ringTimerRef.current = setTimeout(() => {
      if (activeRef.current?.id === callId && callStatusRef.current !== "active") {
        apiMarkMissed(callId).catch(() => {});
        teardown({ code: "missed", message: "Cevap yok." });
      }
    }, RING_TIMEOUT_MS);
  }, [meId, attachCallChannel, setupPeer, teardown]);

  const acceptIncoming = useCallback(async () => {
    const inc = incomingRef.current;
    if (!inc) return;
    setError(null);
    facingRef.current = "user";
    let stream;
    try {
      stream = await getLocalMedia(inc.call_type);
    } catch (e) {
      apiRejectCall(inc.id).catch(() => {});
      setIncoming(null);
      setError({ code: "media", message: mediaErrorMessage(e) });
      return;
    }
    try {
      await apiAcceptCall(inc.id);
    } catch (e) {
      stream.getTracks().forEach((t) => t.stop());
      setIncoming(null);
      setError({ code: "accept", message: e?.message || "Çağrı kabul edilemedi." });
      return;
    }
    localStreamRef.current = stream;
    setLocalStream(stream);
    setCamOn(inc.call_type === "video");
    setActive({ id: inc.id, callType: inc.call_type, isCaller: false, peerId: inc.caller_id, peerName: inc.peer?.name, peerAvatar: inc.peer?.avatarUrl });
    setCallStatus("connecting");
    setIncoming(null);
    // Sıra önemli: önce pc, sonra realtime abonelik, en son mevcut sinyalleri çek
    // (böylece hiçbir offer/ICE kaçmaz; dedupe çakışmayı önler).
    setupPeer(inc.id, stream);
    attachCallChannel(inc.id);
    try {
      const sigs = await getSignals(inc.id);
      for (const s of sigs) await processSignal(s);
    } catch (_) {}
  }, [attachCallChannel, setupPeer, processSignal]);

  const rejectIncoming = useCallback(async () => {
    const inc = incomingRef.current;
    if (!inc) return;
    setIncoming(null);
    try { await apiRejectCall(inc.id); } catch (_) {}
  }, []);

  const hangupServer = useCallback(async (cur, status) => {
    if (!cur?.id) return;
    try {
      if (cur.isCaller && status === "outgoing") await apiCancelCall(cur.id);
      else await apiEndCall(cur.id);
    } catch (_) {}
  }, []);

  const hangup = useCallback(async () => {
    const cur = activeRef.current;
    if (!cur) { teardown(); return; }
    const id = cur.id;
    const wasRingingOutgoing = cur.isCaller && callStatusRef.current === "outgoing";
    teardown();
    try {
      if (wasRingingOutgoing) await apiCancelCall(id);
      else await apiEndCall(id);
    } catch (_) {}
  }, [teardown]);

  const toggleMic = useCallback(() => {
    const s = localStreamRef.current;
    if (!s) return;
    const next = !micOn;
    s.getAudioTracks().forEach((t) => { t.enabled = next; });
    setMicOn(next);
  }, [micOn]);

  const toggleCam = useCallback(() => {
    const s = localStreamRef.current;
    if (!s) return;
    const next = !camOn;
    s.getVideoTracks().forEach((t) => { t.enabled = next; });
    setCamOn(next);
  }, [camOn]);

  const switchCamera = useCallback(async () => {
    const pc = pcRef.current;
    if (!pc || active?.callType !== "video") return;
    const nextFacing = facingRef.current === "user" ? "environment" : "user";
    try {
      const newStream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: nextFacing } },
      });
      const newTrack = newStream.getVideoTracks()[0];
      const sender = pc.getSenders().find((s) => s.track && s.track.kind === "video");
      if (sender && newTrack) {
        const old = sender.track;
        await sender.replaceTrack(newTrack);
        const ls = localStreamRef.current;
        if (ls) { if (old) { ls.removeTrack(old); old.stop(); } ls.addTrack(newTrack); setLocalStream(new MediaStream(ls.getTracks())); }
        facingRef.current = nextFacing;
      } else {
        newStream.getTracks().forEach((t) => t.stop());
      }
    } catch (_) { /* çoklu kamera yok/başarısız → yoksay */ }
  }, [active]);

  const dismissError = useCallback(() => setError(null), []);

  // Kalıcı: Realtime + kısa poll yedeği (yeni projede publication eksik/gecikmeli olsa da çalma/sinyal kaçmasın).
  useEffect(() => {
    if (!meId) return;

    const presentIncoming = async (row) => {
      if (!row || row.status !== "ringing") return;
      if (activeRef.current || incomingRef.current) return;
      let peer = null;
      try {
        const p = await getProfileBrief(row.caller_id);
        peer = { name: p?.display_name || p?.username || "Arayan", avatarUrl: p?.avatar_url, username: p?.username };
      } catch (_) {}
      setIncoming({ id: row.id, caller_id: row.caller_id, call_type: row.call_type, peer });
    };

    userChannelRef.current = subscribeUserCalls(meId, {
      onIncoming: (row) => { presentIncoming(row); },
      onSessionChange: (row) => {
        if (incomingRef.current && row.id === incomingRef.current.id && row.status !== "ringing") {
          setIncoming(null);
        }
        onActiveSessionChange(row);
      },
    });

    const poll = setInterval(async () => {
      try {
        if (!activeRef.current && !incomingRef.current) {
          const row = await getRingingIncoming(meId);
          if (row) await presentIncoming(row);
        }
        const cur = activeRef.current;
        if (cur?.id) {
          const sess = await getCallSession(cur.id);
          if (sess) onActiveSessionChange(sess);
          const sigs = await getSignals(cur.id);
          for (const s of sigs) await processSignal(s);
        } else if (incomingRef.current?.id) {
          const sess = await getCallSession(incomingRef.current.id);
          if (sess && sess.status !== "ringing") setIncoming(null);
        }
      } catch (_) { /* poll hatası UI'ı bozmasın */ }
    }, CALL_POLL_MS);

    return () => {
      clearInterval(poll);
      removeCallChannel(userChannelRef.current);
      userChannelRef.current = null;
    };
  }, [meId, onActiveSessionChange, processSignal]);

  // Unmount / sekme kapanışı → DB oturumunu da kapat (stuck ringing/accepted önlemi).
  useEffect(() => {
    const endActiveOnServer = async () => {
      const cur = activeRef.current;
      if (!cur?.id) return;
      await hangupServer(cur, callStatusRef.current);
    };

    const onPageHide = () => {
      const cur = activeRef.current;
      if (!cur?.id) return;
      const status = callStatusRef.current;
      const rpc = (cur.isCaller && status === "outgoing") ? "cancel_call" : "end_call";
      void supabase.auth.getSession().then(({ data }) => {
        const token = data.session?.access_token;
        if (!token) return;
        fetch(`${import.meta.env.VITE_SUPABASE_URL}/rest/v1/rpc/${rpc}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ call_id: cur.id }),
          keepalive: true,
        }).catch(() => {});
      });
    };

    window.addEventListener("pagehide", onPageHide);
    return () => {
      window.removeEventListener("pagehide", onPageHide);
      void endActiveOnServer();
      teardown();
    };
  }, [teardown, hangupServer]);

  return {
    incoming, active, callStatus, localStream, remoteStream,
    micOn, camOn, durationSec, error,
    startCall, acceptIncoming, rejectIncoming, hangup,
    toggleMic, toggleCam, switchCamera, dismissError,
  };
}
