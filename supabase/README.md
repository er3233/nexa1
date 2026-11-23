# Nexa Chat — Supabase Backend

Üretim seviyesine yakın Supabase şeması: kimlik doğrulama, profiller/ayarlar,
mesajlaşma (yanıt, reaksiyon, düzenle/sil, okundu, yazıyor), engelleme/şikâyet,
admin & denetim, Storage ve Realtime — hepsi RLS ile korunur.

## Migration sırası

SQL Editor'de **sırayla** çalıştırın:

| Sıra | Dosya | İçerik |
|-----|-------|--------|
| 1 | `migrations/001_core.sql` | profiles genişletme, `user_settings`, roller, `is_admin`, koruma trigger'ları |
| 2 | `migrations/002_messaging.sql` | konuşma/mesaj genişletme, `message_reactions`, `typing_indicators`, RPC'ler |
| 3 | `migrations/003_social.sql` | `blocked_users`, `reports`, engelleme kontrolü |
| 4 | `migrations/004_security_admin.sql` | `admin_audit_logs`, admin/moderasyon RPC'leri |
| 5 | `migrations/005_storage.sql` | `avatars` + `chat-media` bucket & RLS |
| 6 | `migrations/006_realtime.sql` | Realtime publication + replica identity |
| 7 | `migrations/007_account_approval_and_user_management.sql` | Admin onaylı kayıt, `is_approved_user`, hesap yönetimi RPC'leri, kullanıcı arama |
| 8 | `migrations/008_message_requests.sql` | `message_requests` tablosu, RLS, mesaj isteği RPC'leri, Realtime |
| 9 | `migrations/009_calls.sql` | `call_sessions` + `call_signals`, WebRTC sinyalleşme RLS + RPC'leri, Realtime |
| 10 | `migrations/010_admin_notifications.sql` | `notifications` tablosu, admin başvuru bildirimi trigger'ı, RLS, Realtime |
| 11 | `migrations/011_live_typing_and_chat_locks.sql` | Canlı Yazım (opt-in) + Sohbet Kilidi (4 haneli PIN), messages RLS kilit kontrolü |
| 12 | `migrations/012_fix_chat_lock_composer_live_typing.sql` | pgcrypto (`extensions.crypt/gen_salt`) düzeltmesi |
| 13 | `migrations/013_reliable_live_drafts_and_lock_diagnostics.sql` | `live_drafts` + Postgres Realtime; PIN RPC jsonb (DROP+CREATE) |
| 14 | `migrations/014_fix_pin_rpc_return_types.sql` | 013 yarıda kaldıysa: void→jsonb DROP+CREATE |
| 15 | `migrations/015_fix_ambiguous_conversation_id.sql` | `p_*` parametreler (chat_lock_ok DROP etme — 016 tercih) |
| 16 | `migrations/016_fix_chat_lock_without_dropping_policies.sql` | chat_lock_ok OR REPLACE (parametre adı değiştirmeyin — 017) |
| 17 | `migrations/017_fix_chat_lock_keep_signature.sql` | chat_lock_ok(conv,uid) korunur; alias ile ambiguity; diğer RPC p_* |
| 18 | `migrations/018_repair_live_typing_and_chat_lock.sql` | 011–017 onarım zinciri (tek idempotent dosya) |
| 19 | `migrations/019_disappearing_messages.sql` | Kaybolan mesajlar: expires_at, disappearing_seconds, RLS, RPC |
| 20 | `migrations/020_fix_user_search_at_prefix.sql` | Kullanıcı aramada `@` öneki düzeltmesi |

### Mevcut projede
Kullanıcı arama `@` öneki için **yalnızca `migrations/020_fix_user_search_at_prefix.sql`** çalıştırın.
(018/019 zaten uygulandıysa onları tekrar çalıştırmayın. CASCADE / DROP POLICY yok.)

### Yeni/boş projede
SQL Editor’de **sırayla**:
1. `schema.sql` (temel tablolar + 001–018 birleşik + 020 `@` arama düzeltmesi)
2. `migrations/019_disappearing_messages.sql` (schema.sql’de yok)

`migrations/001`…`020` tek başına boş projede **çalışmaz** — temel tablolar yalnızca `schema.sql` içindedir.
Ayrıntılı sıra: `APPLY_NEW_EMPTY_PROJECT.sql`.

## WebRTC arama (009) — STUN/TURN ve güvenlik notları

- Sinyalleşme Supabase Realtime üzerinden (`call_sessions` + `call_signals`).
  Sinyalleri yalnızca çağrının iki katılımcısı görebilir/ekleyebilir (RLS).
- ICE sunucuları `.env` ile: `VITE_STUN_URL`, `VITE_TURN_URL`,
  `VITE_TURN_USERNAME`, `VITE_TURN_CREDENTIAL`.
- **STUN tek başına yeterli değildir**: simetrik NAT / birçok mobil operatör
  ağında bağlantı kurulamaz. Güvenilir çağrı için **TURN sunucusu gerekir**
  (ör. coturn veya yönetilen bir TURN servisi).
- TURN credential'ları frontend'e gömülünce tam gizli sayılmaz; production'da
  **sunucudan kısa ömürlü (ephemeral) credential** üretmek daha güvenlidir.
- Kamera/mikrofon yalnızca **HTTPS** veya `localhost` üzerinde çalışır (Vercel HTTPS).
  Kullanıcı izni istenmeden `getUserMedia` çağrılmaz; izin arama butonuna
  basıldığında istenir.
- WebRTC medya akışı taşımada **DTLS-SRTP ile şifrelidir**; ancak bu uçtan uca
  (E2E) mesaj şifrelemesi anlamına GELMEZ. Uygulamada sahte "E2E" iddiası yoktur.

## İlk admin atama (güvenli)

Otomatik/güvensiz admin ataması YOKTUR. Admin yalnızca DB üzerinden verilir:

1. **Authentication → Users** ekranından kullanıcının **UUID**'sini kopyalayın.
2. **SQL Editor**'de çalıştırın:
   ```sql
   update public.profiles set role = 'admin'
    where id = 'BURAYA-KULLANICI-UUID';
   ```
Kullanıcı frontend üzerinden kendini admin yapamaz (`admin_set_role` yalnızca
çağıran zaten admin ise çalışır; ayrıca `role` alanı `protect_profile_privileged`
trigger'ı ile normal güncellemelerde korunur).

## E-posta doğrulama ayarları (admin onayı modeli)

Bu sürümde erişim kontrolü **admin onayı** ile yapılır; e-posta doğrulaması
zorunlu değildir.

- **Authentication → Providers → Email → "Confirm email"** seçeneğini **KAPATIN**.
  Böylece kayıt sonrası kullanıcı doğrudan giriş yapabilir ve "onay bekliyor"
  ekranına düşer.
- E-posta doğrulaması kapalı olsa bile **admin onayı backend/RLS ile zorunludur**
  (`is_approved_user`); onaysız kullanıcı sohbet/mesaj/arama yapamaz.
- **Şifre sıfırlama e-postası çalışmaya devam eder** (Providers → Email açık kalır,
  yalnızca "Confirm email" kapatılır).
- Şifre sıfırlama yönlendirmesi için **Authentication → URL Configuration →
  Redirect URLs** listesine uygulama adresinizi ekleyin (örn. `http://localhost:5173`
  ve production domaininiz).

## Kalıcı kullanıcı silme (Edge Function)

Kalıcı `auth.users` silme yalnızca **service_role** ile mümkündür ve bu anahtar
**asla tarayıcıya konmaz**. Bu yüzden silme, sunucu tarafındaki Edge Function
üzerinden yapılır:

```bash
# 1) Fonksiyonu deploy edin
supabase functions deploy admin-delete-user

# 2) service_role anahtarını GİZLİ ortam değişkeni olarak verin (repoya YAZMAYIN)
supabase secrets set SUPABASE_SERVICE_ROLE_KEY=<service_role_key>

# 3) Frontend'de butonu etkinleştirmek için .env:
#    VITE_ADMIN_DELETE_ENABLED=true
```

- Fonksiyon önce çağıranın **admin JWT**'sini doğrular, sonra `is_admin` RPC ile
  teyit eder; admin **kendini** ve **son aktif admini** silemez.
- `VITE_ADMIN_DELETE_ENABLED` `true` değilse Admin Panelinde **"Kalıcı Sil"**
  butonu görünmez; yalnızca **"Devre dışı bırak"** çalışır (veri korunur).

## Storage doğrulama

- **Storage** altında `avatars` (public) ve `chat-media` (private) bucket'ları görünmeli.
- Yol düzeni: `avatars/<user_id>/...`, `chat-media/<conversation_id>/...`
- Üye olmadığınız bir konuşmanın `chat-media` dosyasını indirememelisiniz.

## Realtime doğrulama

- **Database → Replication → `supabase_realtime`** yayınında
  `messages`, `message_reactions`, `typing_indicators`, `conversation_members`
  tabloları listelenmeli.

## RPC listesi (frontend'in kullandığı)

- `get_or_create_direct_conversation(other_id)` — güvenli, tekilleştirilmiş direkt sohbet
- `mark_conversation_read(conv, msg)` — okundu
- `get_unread_counts()` — okunmamış sayıları
- `set_conversation_muted / set_conversation_archived`
- `admin_ban_user / admin_unban_user / admin_set_role`
- `admin_soft_delete_message / admin_review_report`
- `admin_list_users(search_text, status_filter, page_size, page_offset) / admin_list_reports`
- `admin_list_pending_users() / admin_approve_user(target) / admin_reject_user(target, reason)`
- `admin_deactivate_user(target, reason) / admin_reactivate_user(target)`
- `is_approved_user(uid)` — onaylı + yasaksız + devre dışı değil
- `search_approved_users(search_text, result_limit)` — güvenli kullanıcı arama (e-posta dönmez)
- `send_message_request(receiver_user_id, preview)` — mesaj isteği gönder (jsonb: existing_conversation/already_pending/request_sent)
- `list_incoming_message_requests() / list_outgoing_message_requests()` — gelen/giden istekler
- `accept_message_request(request_id)` — kabul → tekil direct conversation id döner
- `reject_message_request(request_id) / cancel_message_request(request_id)` — reddet / iptal
- `get_message_request_count()` — bekleyen gelen istek sayısı (rozet)
- `start_call(receiver_user_id, conversation_id, call_type)` — arama başlat → call_id
- `accept_call / reject_call / cancel_call / end_call / mark_missed_call(call_id)` — durum yönetimi
- `expire_stale_calls()` — 45 sn'den uzun ringing çağrıları missed yapar

## QR cihaz eşleştirme — GELECEK PLANI (uygulanmadı)

Şu an **uygulanmadı** (güvensiz sahte QR girişi yok). Gelecekte önerilen model:

```
create table device_link_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  token_hash text not null,       -- ASLA açık token saklama; yalnızca hash
  created_at timestamptz default now(),
  expires_at timestamptz not null, -- kısa ömür (örn. 60 sn)
  consumed_at timestamptz
);
```
- QR'da tek kullanımlık, kısa ömürlü token gösterilir; DB'de yalnızca **hash** tutulur.
- Onay ve oturum devri sunucu tarafında (Edge Function) yapılır.
- Bu tamamen tasarlanıp güvenli biçimde uygulanana kadar QR girişi etkinleştirilmez.

## Moderasyon / Edge Function gereksinimleri

Ban/rol/rapor işlemleri şu an **SECURITY DEFINER RPC**'lerle yapılır ve yeterlidir.
İleride e-posta bildirimi, toplu işlem veya service_role gerektiren ağır işlemler
için Edge Function eklenebilir (service_role anahtarı yalnızca sunucu tarafında).
