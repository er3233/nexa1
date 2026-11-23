import React from "react";
import { Mic, MicOff, Video, VideoOff, PhoneOff, SwitchCamera } from "lucide-react";

function Btn({ onClick, active, danger, mutedLook, label, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="w-[56px] h-[56px] sm:w-[58px] sm:h-[58px] rounded-full flex items-center justify-center active:scale-95 transition-transform touch-manipulation"
      style={{
        background: danger
          ? "var(--red)"
          : mutedLook
            ? "rgba(229,72,77,0.28)"
            : active
              ? "rgba(255,255,255,0.16)"
              : "rgba(255,255,255,0.08)",
        border: "1px solid rgba(255,255,255,0.14)",
        color: danger ? "#fff" : mutedLook ? "#ffb4b6" : "var(--txt)",
      }}
    >
      {children}
    </button>
  );
}

// Not: Hoparlör (speaker) yönlendirmesi tarayıcıda güvenilir/standart desteklenmediği
// için sahte hoparlör butonu GÖSTERİLMEZ.
export default function CallControls({ callType, micOn, camOn, onToggleMic, onToggleCam, onSwitchCamera, onHangup }) {
  const isVideo = callType === "video";
  return (
    <div className="flex items-center justify-center gap-3 sm:gap-4 flex-wrap pb-1">
      <Btn onClick={onToggleMic} active={micOn} mutedLook={!micOn} label={micOn ? "Mikrofonu kapat" : "Mikrofonu aç"}>
        {micOn ? <Mic size={22} /> : <MicOff size={22} />}
      </Btn>

      {isVideo && (
        <Btn onClick={onToggleCam} active={camOn} mutedLook={!camOn} label={camOn ? "Kamerayı kapat" : "Kamerayı aç"}>
          {camOn ? <Video size={22} /> : <VideoOff size={22} />}
        </Btn>
      )}

      {isVideo && (
        <Btn onClick={onSwitchCamera} active={false} label="Kamera değiştir">
          <SwitchCamera size={22} />
        </Btn>
      )}

      <Btn onClick={onHangup} danger label="Aramayı bitir">
        <PhoneOff size={22} />
      </Btn>
    </div>
  );
}
