import { createClient } from "@supabase/supabase-js";

const requestedUrl = import.meta.env.VITE_SUPABASE_URL?.trim();
const requestedKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() || import.meta.env.VITE_SUPABASE_ANON_KEY?.trim();
let validUrl = false;
try {
  const parsed = new URL(requestedUrl);
  validUrl = parsed.protocol === "https:" || (parsed.protocol === "http:" && ["localhost", "127.0.0.1"].includes(parsed.hostname));
} catch (_) { /* Yapılandırma eksik veya geçersiz. */ }
export const supabaseUrl = validUrl ? requestedUrl.replace(/\/$/, "") : "";
// A service_role JWT is also a secret even though it does not use sb_secret_.
function isPublicKey(key) {
  if (!key || key.startsWith("sb_secret_")) return false;
  if (key.startsWith("sb_publishable_")) return true;
  try {
    const payload = JSON.parse(atob(key.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    return payload.role === "anon";
  } catch (_) { return false; }
}
export const supabasePublicKey = isPublicKey(requestedKey) ? requestedKey : "";

export const isSupabaseConfigured = Boolean(supabaseUrl && supabasePublicKey);

if (!isSupabaseConfigured) {
  console.error(
    "[Nexa] Supabase ayarları eksik. Proje kökünde .env dosyası oluşturup " +
      "VITE_SUPABASE_URL ve VITE_SUPABASE_PUBLISHABLE_KEY (veya VITE_SUPABASE_ANON_KEY) değerlerini girin, ardından dev sunucusunu yeniden başlatın."
  );
}

// Yalnızca anon key kullanılır. Service role key ASLA frontend'e konmaz.
export const supabase = createClient(supabaseUrl || "http://127.0.0.1:54321", supabasePublicKey || "missing-anon-key", {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});
