# push-on-message Edge Function

Deploy:
  supabase functions deploy push-on-message

Secrets:
  supabase secrets set VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=... VAPID_SUBJECT=mailto:you@domain.com
  supabase secrets set PUSH_WEBHOOK_SECRET=<uzun-rastgele-gizli-deger>
  (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY genellikle otomatik)

Webhook (Dashboard → Database → Webhooks):
  Table: messages
  Events: INSERT
  Type: Supabase Edge Function
  Function: push-on-message
  Header: x-webhook-secret = PUSH_WEBHOOK_SECRET ile aynı değer

Webhook isteği için platformun gerektirdiği JWT doğrulamasını da yapılandırın.
Yalnızca geçerli bir kullanıcı JWT'si webhook yetkisi değildir; gizli başlık
zorunludur. Gizli değeri Git'e veya VITE_ değişkenlerine koymayın.

Frontend (.env):
  VITE_VAPID_PUBLIC_KEY=<same public key>

SQL:
  Run migrations/021_push_subscriptions.sql
