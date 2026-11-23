import React, { useRef, useState } from "react";
import { Paperclip, Loader2 } from "lucide-react";
import { validateFile, uploadChatMedia } from "../services/media";

// Dosya seçme + doğrulama + chat-media'ya yükleme.
// File input focus/tab sırasına GİRMEZ (iOS form accessory prev/next azaltmak için).
export default function MediaUploader({ conversationId, onUploaded, onError, disabled }) {
  const inputRef = useRef(null);
  const [busy, setBusy] = useState(false);

  const pick = () => {
    if (disabled || busy) return;
    inputRef.current?.click();
  };

  const onChange = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const v = validateFile(file, "chat");
    if (!v.ok) {
      onError?.(v.error);
      return;
    }
    setBusy(true);
    try {
      const meta = await uploadChatMedia(conversationId, file);
      onUploaded?.(meta);
    } catch (ex) {
      onError?.(ex?.message || "Yükleme başarısız.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        type="button"
        tabIndex={-1}
        onClick={pick}
        disabled={disabled || busy}
        className="p-2.5 rounded-full min-w-[44px] min-h-[44px] flex items-center justify-center disabled:opacity-50"
        style={{ color: "var(--txt3)" }}
        aria-label="Dosya ekle"
      >
        {busy ? <Loader2 size={17} className="animate-spin" /> : <Paperclip size={17} strokeWidth={1.8} />}
      </button>
      <input
        ref={inputRef}
        type="file"
        tabIndex={-1}
        aria-hidden="true"
        className="hidden"
        accept="image/*,video/*,audio/*,application/pdf,text/plain"
        onChange={onChange}
      />
    </>
  );
}
