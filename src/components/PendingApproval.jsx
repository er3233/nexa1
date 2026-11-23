import React from "react";
import { Clock, Loader2, LogOut, RefreshCw } from "lucide-react";

export default function PendingApproval({ onRefresh, onLogout, refreshing, logoutBusy }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center px-8 text-center relative z-10 nx-in">
      <div
        className="w-14 h-14 rounded-[22px] flex items-center justify-center mb-5"
        style={{ background: "rgba(77,158,255,0.1)", border: "1px solid rgba(77,158,255,0.3)" }}
      >
        <Clock size={24} style={{ color: "var(--blue)" }} />
      </div>
      <h1 className="nx-display text-[19px] font-bold mb-2">Hesabınız onay bekliyor</h1>
      <p className="text-[13px] leading-relaxed" style={{ color: "var(--txt2)" }}>
        Kaydınız alındı. Bir yönetici hesabınızı onayladıktan sonra uygulamayı
        kullanmaya başlayabilirsiniz. Onaylandığında durumu kontrol edin.
      </p>

      <div className="mt-7 flex flex-col gap-2.5 w-full max-w-[280px]">
        <button
          onClick={onRefresh}
          disabled={refreshing}
          className="h-[48px] px-6 rounded-[18px] nx-btn-primary text-[13.5px] font-semibold flex items-center justify-center gap-2"
        >
          {refreshing ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}
          Durumu kontrol et
        </button>
        <button
          onClick={onLogout}
          disabled={logoutBusy}
          className="h-[48px] px-6 rounded-[18px] nx-surface text-[13.5px] font-semibold flex items-center justify-center gap-2"
          style={{ color: "var(--txt2)" }}
        >
          {logoutBusy ? <Loader2 size={14} className="animate-spin" /> : <LogOut size={14} />}
          Çıkış yap
        </button>
      </div>
    </div>
  );
}
