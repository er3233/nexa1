# push-on-message Edge Function

Deploy:
  supabase functions deploy push-on-message

Secrets:
  supabase secrets set VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=... VAPID_SUBJECT=mailto:you@domain.com
  (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY genellikle otomatik)

Webhook (Dashboard → Database → Webhooks):
  Table: messages
  Events: INSERT
  Type: Supabase Edge Function
  Function: push-on-message

Frontend (.env):
  VITE_VAPID_PUBLIC_KEY=<same public key>

SQL:
  Run migrations/021_push_subscriptions.sql
