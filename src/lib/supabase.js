import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const isSupabaseConfigured = Boolean(url && anonKey);

if (!isSupabaseConfigured) {
  console.error(
    "[Nexa] Supabase ayarları eksik. Proje kökünde .env dosyası oluşturup " +
      "VITE_SUPABASE_URL ve VITE_SUPABASE_ANON_KEY değerlerini girin, ardından dev sunucusunu yeniden başlatın."
  );
}

// Yalnızca anon key kullanılır. Service role key ASLA frontend'e konmaz.
export const supabase = createClient(url || "http://127.0.0.1:54321", anonKey || "missing-anon-key", {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});
