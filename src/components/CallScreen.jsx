import React, { useEffect, useRef } from "react";
import { UserAvatar } from "../lib/ui";
import CallControls from "./CallControls";

function fmtDur(s) {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

// iOS için playsInline + autoplay; play() hatalarını yut.
function VideoView({ stream, muted, className, mirror, style }) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (el.srcObject !== stream) el.srcObject = stream || null;
    if (stream) el.play?.().catch(() => {});
  }, [stream]);
  return (
    <video
      ref={ref}
      autoPlay
      playsInline
      muted={muted}
      className={className}
      style={{
        ...(mirror ? { transform: "scaleX(-1)" } : null),
        ...style,
      }}
    />
  );
}

// Sesli aramada uzak sesi çalmak için gizli audio elemanı.
function AudioSink({ stream }) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (el.srcObject !== stream) el.srcObject = stream || null;
    if (stream) el.play?.().catch(() => {});
  }, [stream]);
  return <audio ref={ref} autoPlay playsInline style={{ display: "none" }} />;
}

const STATUS_LABEL = {
  outgoing: "Aranıyor…",
  connecting: "Bağlanıyor…",
  active: null,
};

export default function CallScreen({
  call, callStatus, localStream, remoteStream, durationSec,
  micOn, camOn, onToggleMic, onToggleCam, onSwitchCamera, onHangup,
}) {
  const isVideo = call?.callType === "video";
  const statusLabel = STATUS_LABEL[callStatus] ?? null;
  const hasRemoteVideo = isVideo && !!remoteStream;
  const showLocalFullscreen = isVideo && !!localStream && !hasRemoteVideo;

  return (
    <div
      className="fixed inset-0 z-[60] flex flex-col"
      style={{
        background: "radial-gradient(120% 90% at 50% 0%, #10141B, #05070A 70%)",
        paddingTop: "env(safe-area-inset-top)",
        paddingBottom: "calc(env(safe-area-inset-bottom) + 20px)",
      }}
    >
      {/* Görüntülü: uzak video tam alan */}
      {hasRemoteVideo && (
        <VideoView
          stream={remoteStream}
          muted={false}
          className="absolute inset-0 w-full h-full object-cover"
        />
      )}

      {/* Görüntülü: karşı taraf henüz yokken yerel kamera önizlemesi */}
      {showLocalFullscreen && (
        <VideoView
          stream={localStream}
          muted
          mirror
          className="absolute inset-0 w-full h-full object-cover"
        />
      )}

      {/* Sesli aramada uzak ses (görüntülide remote <video> sesi taşır) */}
      {!isVideo && <AudioSink stream={remoteStream} />}

      {/* Üst bilgi */}
      <div className="relative z-10 flex flex-col items-center text-center pt-6 px-6 pointer-events-none">
        {!isVideo && (
          <div className="mb-4">
            <UserAvatar url={call?.peerAvatar} name={call?.peerName} id={call?.peerId} size={104} />
          </div>
        )}
        {isVideo && !hasRemoteVideo && (
          <div className="mb-3 mt-2">
            <UserAvatar url={call?.peerAvatar} name={call?.peerName} id={call?.peerId} size={72} />
          </div>
        )}
        <h1 className="nx-display text-[22px] font-bold drop-shadow" style={{ color: "#fff" }}>
          {call?.peerName || "Arama"}
        </h1>
        <p className="text-[13px] mt-1 drop-shadow" style={{ color: "rgba(255,255,255,0.85)" }}>
          {statusLabel || (callStatus === "active" ? fmtDur(durationSec) : (isVideo ? "Görüntülü arama" : "Sesli arama"))}
        </p>
        {statusLabel && (
          <p className="nx-mono text-[9px] tracking-[0.24em] mt-2" style={{ color: "rgba(255,255,255,0.55)" }}>
            {isVideo ? "GÖRÜNTÜLÜ" : "SESLİ"} ARAMA
          </p>
        )}
      </div>

      {/* Yerel PiP (uzak video varken) */}
      {isVideo && localStream && hasRemoteVideo && (
        <div
          className="absolute z-20 rounded-[18px] overflow-hidden shadow-xl"
          style={{
            width: "min(112px, 28vw)",
            height: "min(160px, 40vw)",
            right: 12,
            bottom: "calc(env(safe-area-inset-bottom) + 108px)",
            border: "1px solid rgba(255,255,255,0.22)",
            background: "#0a0c10",
          }}
        >
          <VideoView stream={localStream} muted mirror className="w-full h-full object-cover" />
          {!camOn && (
            <div className="absolute inset-0 flex items-center justify-center" style={{ background: "rgba(5,7,10,0.85)" }}>
              <span className="text-[11px]" style={{ color: "rgba(255,255,255,0.7)" }}>Kamera kapalı</span>
            </div>
          )}
        </div>
      )}

      {/* Yerel full-screen iken kamera kapalı overlay */}
      {showLocalFullscreen && !camOn && (
        <div className="absolute inset-0 z-[5] flex items-center justify-center" style={{ background: "rgba(5,7,10,0.88)" }}>
          <span className="text-[14px]" style={{ color: "rgba(255,255,255,0.75)" }}>Kamera kapalı</span>
        </div>
      )}

      {/* Kontroller */}
      <div className="mt-auto relative z-10 px-4 sm:px-6">
        <CallControls
          callType={call?.callType}
          micOn={micOn}
          camOn={camOn}
          onToggleMic={onToggleMic}
          onToggleCam={onToggleCam}
          onSwitchCamera={onSwitchCamera}
          onHangup={onHangup}
        />
      </div>
    </div>
  );
}
