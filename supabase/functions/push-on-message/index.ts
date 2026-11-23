// Supabase Edge Function: yeni mesaj → Web Push (badge count dahil)
// Secrets: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT
// Deploy: supabase functions deploy push-on-message
// Database Webhook: messages INSERT → bu fonksiyon

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.47.10";
import webpush from "npm:web-push@3.6.7";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const vapidPublic = Deno.env.get("VAPID_PUBLIC_KEY");
    const vapidPrivate = Deno.env.get("VAPID_PRIVATE_KEY");
    const vapidSubject = Deno.env.get("VAPID_SUBJECT") || "mailto:admin@nexa.local";
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!vapidPublic || !vapidPrivate || !supabaseUrl || !serviceKey) {
      return new Response(JSON.stringify({ error: "missing_secrets" }), { status: 500, headers: cors });
    }

    webpush.setVapidDetails(vapidSubject, vapidPublic, vapidPrivate);
    const admin = createClient(supabaseUrl, serviceKey);

    const body = await req.json();
    // Database Webhook payload: { type, table, record, ... }
    const record = body.record || body;
    const conversationId = record.conversation_id;
    const senderId = record.sender_id;
    if (!conversationId || !senderId) {
      return new Response(JSON.stringify({ ok: true, skipped: "no_record" }), { headers: cors });
    }

    const { data: members } = await admin
      .from("conversation_members")
      .select("user_id")
      .eq("conversation_id", conversationId);
    const recipientIds = (members || [])
      .map((m) => m.user_id)
      .filter((id) => id && id !== senderId);
    if (!recipientIds.length) {
      return new Response(JSON.stringify({ ok: true, skipped: "no_recipients" }), { headers: cors });
    }

    const { data: sender } = await admin
      .from("profiles")
      .select("display_name, username")
      .eq("id", senderId)
      .maybeSingle();
    const senderName = sender?.display_name || sender?.username || "Birisi";
    const preview = String(record.content || record.body || "Yeni mesaj").slice(0, 120);

    const { data: subs } = await admin
      .from("push_subscriptions")
      .select("endpoint, p256dh, auth, user_id")
      .in("user_id", recipientIds);

    let sent = 0;
    for (const sub of subs || []) {
      let unread = 1;
      try {
        const { data: total, error: totErr } = await admin.rpc("get_unread_total_for", { uid: sub.user_id });
        if (!totErr && total != null) unread = Math.max(1, Number(total) || 1);
      } catch (_) {
        unread = 1;
      }

      const payload = JSON.stringify({
        title: senderName,
        body: preview,
        unread,
        url: "/",
        tag: `nexa-conv-${conversationId}`,
      });

      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth },
          },
          payload
        );
        sent += 1;
      } catch (err) {
        // 404/410 → abonelik ölü, sil
        const status = err?.statusCode || err?.status;
        if (status === 404 || status === 410) {
          await admin.from("push_subscriptions").delete().eq("endpoint", sub.endpoint);
        }
      }
    }

    return new Response(JSON.stringify({ ok: true, sent }), {
      headers: { ...cors, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e?.message || e) }), {
      status: 500,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }
});
