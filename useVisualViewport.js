import { useState, useEffect } from "react";

// TEK viewport/klavye sistemi. İkinci keyboard hook eklenmemeli.
//
// iOS Safari klavye açılınca bazen layout viewport (innerHeight) da küçülür.
// Eski kontrol `innerHeight - vv.height > 120` o durumda FALSE kalır →
// data-keyboard-open set edilmez → composer safe-area padding (~34px) kalır →
// composer ile sistem aksesuar çubuğu arasında siyah boşluk.
//
// Çözüm: dinlenme (klavye kapalı) yüksekliğini tut; ondan düşüşü ölç.
// CSS: --visual-viewport-height, --visual-viewport-top

let restingVvHeight = 0;
let rafId = 0;
let focusTimers = [];

function isEditableFocus() {
  const el = document.activeElement;
  if (!el) return false;
  const tag = el.tagName;
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  if (tag === "INPUT") {
    const type = (el.getAttribute("type") || "text").toLowerCase();
    return !["button", "checkbox", "radio", "file", "submit", "reset", "range", "color", "hidden"].includes(type);
  }
  return el.isContentEditable;
}

function readViewport() {
  const vv = window.visualViewport;
  const height = vv ? vv.height : window.innerHeight;
  const top = vv ? vv.offsetTop : 0;
  return { height, top };
}

/** Hemen uygula (rAF dışında). focus sonrası gecikmeli sync için de kullanılır. */
export function syncVisualViewport() {
  if (typeof window === "undefined") return { height: 0, keyboardOpen: false };
  const root = document.documentElement;
  const { height, top } = readViewport();
  const focused = isEditableFocus();

  // Klavye kapalıyken (odak yok veya yükseklik büyüdü) resting güncelle.
  if (!focused || height >= restingVvHeight - 24) {
    restingVvHeight = Math.max(restingVvHeight, height);
  }
  // İlk ölçüm
  if (restingVvHeight <= 0) restingVvHeight = height;

  const dropped = restingVvHeight - height;
  // innerHeight kıyasını yedek tut (klasik Safari: layout sabit, vv küçülür).
  const classicDrop = window.innerHeight - height;
  const keyboardOpen = dropped > 80 || classicDrop > 80 || (focused && (top > 0 || dropped > 40));

  const hPx = `${Math.round(height)}px`;
  const tPx = `${Math.round(top)}px`;

  root.style.setProperty("--visual-viewport-height", hPx);
  root.style.setProperty("--visual-viewport-top", tPx);
  // Eski alias’lar (geriye dönük)
  root.style.setProperty("--visual-viewport-offset-top", tPx);
  root.style.setProperty("--app-height", hPx);
  root.style.setProperty("--vv-offset-top", tPx);

  root.dataset.keyboardOpen = keyboardOpen ? "true" : "false";
  if (keyboardOpen) {
    root.style.setProperty("--bottom-nav-height", "0px");
  } else {
    root.style.removeProperty("--bottom-nav-height");
  }

  return { height, keyboardOpen };
}

function scheduleSync(onDone) {
  if (rafId) cancelAnimationFrame(rafId);
  rafId = requestAnimationFrame(() => {
    rafId = 0;
    const state = syncVisualViewport();
    onDone?.(state);
  });
}

function scheduleFocusResync(onDone) {
  focusTimers.forEach(clearTimeout);
  focusTimers = [0, 100, 200].map((ms) =>
    setTimeout(() => {
      const state = syncVisualViewport();
      onDone?.(state);
    }, ms)
  );
}

export function useVisualViewport() {
  const [state, setState] = useState(() => ({
    height: typeof window !== "undefined" ? (window.visualViewport?.height ?? window.innerHeight) : 0,
    keyboardOpen: false,
  }));

  useEffect(() => {
    if (typeof window === "undefined") return;
    const vv = window.visualViewport;
    const root = document.documentElement;

    const publish = (next) => setState(next || syncVisualViewport());

    // Orientation değişince resting’i sıfırla.
    const onOrientation = () => {
      restingVvHeight = 0;
      scheduleSync(publish);
    };

    const onVv = () => scheduleSync(publish);
    const onFocusIn = (e) => {
      const t = e.target;
      if (!t) return;
      const tag = t.tagName;
      if (tag !== "INPUT" && tag !== "TEXTAREA" && !t.isContentEditable) return;
      // iOS: focus sonrası 100–200ms içinde vv değişir.
      scheduleFocusResync(publish);
    };
    const onFocusOut = () => {
      scheduleFocusResync(publish);
    };

    restingVvHeight = 0;
    publish(syncVisualViewport());

    if (vv) {
      vv.addEventListener("resize", onVv);
      vv.addEventListener("scroll", onVv);
    }
    window.addEventListener("resize", onVv);
    window.addEventListener("orientationchange", onOrientation);
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", onFocusOut);

    return () => {
      if (rafId) cancelAnimationFrame(rafId);
      rafId = 0;
      focusTimers.forEach(clearTimeout);
      focusTimers = [];
      if (vv) {
        vv.removeEventListener("resize", onVv);
        vv.removeEventListener("scroll", onVv);
      }
      window.removeEventListener("resize", onVv);
      window.removeEventListener("orientationchange", onOrientation);
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", onFocusOut);
      root.style.removeProperty("--visual-viewport-height");
      root.style.removeProperty("--visual-viewport-top");
      root.style.removeProperty("--visual-viewport-offset-top");
      root.style.removeProperty("--app-height");
      root.style.removeProperty("--vv-offset-top");
      root.style.removeProperty("--bottom-nav-height");
      delete root.dataset.keyboardOpen;
    };
  }, []);

  return state;
}
