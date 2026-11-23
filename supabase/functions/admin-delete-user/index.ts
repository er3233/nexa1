// ============================================================
// admin-delete-user — Kalıcı Auth kullanıcı silme (Edge Function)
//
// NEDEN EDGE FUNCTION?
//   auth.users tablosundan bir kullanıcıyı KALICI silmek yalnızca
//   service_role yetkisiyle mümkündür. service_role anahtarı ASLA
//   tarayıcıya (frontend) konmamalıdır. Bu yüzden silme işlemi,
//   anahtarın güvenli ortam değişkeninde tutulduğu bu sunucu tarafı
//   fonksiyonda yapılır.
//
// AKIŞ:
//   1) Çağıranın JWT'si doğrulanır (anon client + Authorization header).
//   2) Çağıranın gerçekten admin olduğu is_admin RPC ile teyit edilir.
//   3) Admin kendini veya son aktif admini silemez (active_admin_count).
//   4) service_role client ile auth.admin.deleteUser çağrılır.
//
// DEPLOY:
//   supabase functions deploy admin-delete-user
//   supabase secrets set SUPABASE_SERVICE_ROLE_KEY=... (service_role)
//   (SUPABASE_URL ve SUPABASE_ANON_KEY genelde otomatik sağlanır.)
//
// NOT: Bu fonksiyon deploy EDİLMEDİĞİ sürece Admin Paneli "Kalıcı Sil"
//      butonunu göstermez; yalnızca "Devre dışı bırak" çalışır.
// ============================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Yalnızca POST" }, 405);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");
  const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!SUPABASE_URL || !ANON_KEY || !SERVICE_ROLE_KEY) {
    return json({ error: "Fonksiyon yapılandırması eksik (secrets)." }, 500);
  }

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) {
    return json({ error: "Yetkisiz istek (token yok)." }, 401);
  }

  let targetUserId: string | null = null;
  try {
    const body = await req.json();
    targetUserId = body?.target_user_id ?? null;
  } catch {
    return json({ error: "Geçersiz istek gövdesi." }, 400);
  }
  if (!targetUserId) return json({ error: "target_user_id gerekli." }, 400);

  // 1) Çağıranı doğrula (kullanıcının kendi JWT'siyle)
  const callerClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: userData, error: userErr } = await callerClient.auth.getUser();
  if (userErr || !userData?.user) {
    return json({ error: "Oturum doğrulanamadı." }, 401);
  }
  const callerId = userData.user.id;

  // 2) Çağıran admin mi? (backend doğrulaması, sadece frontend'e güvenilmez)
  const { data: isAdmin, error: adminErr } = await callerClient.rpc("is_admin");
  if (adminErr || isAdmin !== true) {
    return json({ error: "Bu işlem için admin yetkisi gerekli." }, 403);
  }

  // 3) Kendini silemez
  if (callerId === targetUserId) {
    return json({ error: "Kendi hesabınızı kalıcı silemezsiniz." }, 400);
  }

  // service_role client (yalnızca sunucu tarafı)
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // 3b) Son aktif admin koruması
  const { data: targetProfile } = await admin
    .from("profiles")
    .select("role")
    .eq("id", targetUserId)
    .maybeSingle();

  if (targetProfile?.role === "admin") {
    const { count } = await admin
      .from("profiles")
      .select("id", { count: "exact", head: true })
      .eq("role", "admin")
      .is("banned_at", null)
      .is("deactivated_at", null);
    if ((count ?? 0) <= 1) {
      return json({ error: "Son aktif admini silemezsiniz." }, 400);
    }
  }

  // 4) Kalıcı sil (ilişkili public veriler FK on delete cascade/set null ile yönetilir).
  //    Not: Mesaj bütünlüğü için anonimleştirme stratejisi SECURITY_NOTES.md'de.
  const { error: delErr } = await admin.auth.admin.deleteUser(targetUserId);
  if (delErr) {
    return json({ error: `Silme başarısız: ${delErr.message}` }, 500);
  }

  // Denetim kaydı (service_role ile doğrudan insert)
  await admin.from("admin_audit_logs").insert({
    admin_id: callerId,
    action: "delete_user_permanent",
    target_type: "auth_user",
    target_id: targetUserId,
    metadata: {},
  });

  return json({ ok: true });
});
