import { supabase } from "../lib/supabase";

export async function signUp({ email, password, username }) {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        username: username || email.split("@")[0],
        display_name: username || email.split("@")[0],
      },
    },
  });
  if (error) throw error;
  return data;
}

export async function signIn({ email, password }) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

export async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

// Şifre sıfırlama e-postası gönderir. Kullanıcı bağlantıya tıklayınca
// uygulamaya döner ve updatePassword ile yeni parola belirlenir.
export async function resetPassword(email) {
  const redirectTo = typeof window !== "undefined" ? window.location.origin : undefined;
  const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
  if (error) throw error;
}

export async function updatePassword(newPassword) {
  const { data, error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) throw error;
  return data;
}

export async function resendVerification(email) {
  const { error } = await supabase.auth.resend({ type: "signup", email });
  if (error) throw error;
}

export async function getSession() {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  return data.session;
}

export function onAuthChange(callback) {
  return supabase.auth.onAuthStateChange((event, session) => callback(session, event));
}

// Supabase hata mesajlarını anlaşılır Türkçeye çevirir.
export function toTurkishAuthError(error) {
  const raw = (error?.message || "").toLowerCase();
  if (!raw) return "Beklenmeyen bir hata oluştu. Lütfen tekrar deneyin.";
  if (raw.includes("invalid login credentials")) return "E-posta veya parola hatalı.";
  if (raw.includes("email not confirmed")) return "E-posta adresin doğrulanmamış. Gelen kutunu kontrol et.";
  if (raw.includes("already registered") || raw.includes("already been registered") || raw.includes("user already"))
    return "Bu e-posta zaten kayıtlı. Giriş yapmayı dene.";
  if (raw.includes("password should be at least")) return "Parola en az 6 karakter olmalı.";
  if (raw.includes("unable to validate email") || raw.includes("invalid email")) return "Geçersiz e-posta adresi.";
  if (raw.includes("rate limit") || raw.includes("too many")) return "Çok fazla deneme yapıldı. Biraz sonra tekrar dene.";
  if (raw.includes("network") || raw.includes("fetch")) return "Bağlantı hatası. İnternetini ve Supabase ayarlarını kontrol et.";
  return error.message;
}
