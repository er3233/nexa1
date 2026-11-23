import React from "react";
import { Phone, PhoneOff, Video } from "lucide-react";
import { UserAvatar } from "../lib/ui";

// Uygulama içi tam ekran gelen arama bildirimi.
export default function IncomingCall({ incoming, onAccept, onReject }) {
  const isVideo = incoming?.call_type === "video";
  const name = incoming?.peer?.name || "Arayan";
  return (
    <div
      className="fixed inset-0 z-[70] flex flex-col items-center justify-between"
      style={{
        background: "radial-gradient(120% 90% at 50% 0%, #10141B, #05070A 70%)",
        paddingTop: "calc(env(safe-area-inset-top) + 48px)",
        paddingBottom: "calc(env(safe-area-inset-bottom) + 40px)",
      }}
    >
      <div className="flex flex-col items-center text-center px-8 mt-10">
        <div className="mb-5 nx-in">
          <UserAvatar url={incoming?.peer?.avatarUrl} name={name} id={incoming?.caller_id} size={116} />
        </div>
        <h1 className="nx-display text-[24px] font-bold" style={{ color: "#fff" }}>{name}</h1>
        {incoming?.peer?.username && (
          <p className="nx-mono text-[11px] mt-1" style={{ color: "rgba(255,255,255,0.6)" }}>@{incoming.peer.username}</p>
        )}
        <p className="text-[13.5px] mt-3 flex items-center gap-2" style={{ color: "rgba(255,255,255,0.8)" }}>
          {isVideo ? <Video size={15} /> : <Phone size={15} />}
          Gelen {isVideo ? "görüntülü" : "sesli"} arama…
        </p>
      </div>

      <div className="flex items-center justify-center gap-16">
        <div className="flex flex-col items-center gap-2">
          <button onClick={onReject} aria-label="Reddet"
            className="w-[68px] h-[68px] rounded-full flex items-center justify-center active:scale-95 transition-transform"
            style={{ background: "var(--red)", color: "#fff" }}>
            <PhoneOff size={26} />
          </button>
          <span className="text-[11px]" style={{ color: "rgba(255,255,255,0.6)" }}>Reddet</span>
        </div>
        <div className="flex flex-col items-center gap-2">
          <button onClick={onAccept} aria-label="Kabul et"
            className="w-[68px] h-[68px] rounded-full flex items-center justify-center active:scale-95 transition-transform"
            style={{ background: "var(--green)", color: "#04170E" }}>
            {isVideo ? <Video size={26} /> : <Phone size={26} />}
          </button>
          <span className="text-[11px]" style={{ color: "rgba(255,255,255,0.6)" }}>Kabul Et</span>
        </div>
      </div>
    </div>
  );
}
