# Nexa Chat — Güvenlik Notları

## Anahtarlar
- Frontend YALNIZCA `VITE_SUPABASE_ANON_KEY` kullanır.
- `service_role` veya diğer secret anahtarlar frontend'e / repoya KONULMAZ.
- `.env` `.gitignore` içindedir; `.env.example` yalnızca boş şablondur.

## Kimlik & Yetki
- Tüm erişim Supabase Auth + RLS ile korunur.
- **Admin yükseltmesi frontend'den yapılamaz:**
  - `admin_set_role` yalnızca çağıran zaten admin ise çalışır.
  - `profiles.role`, `banned_at`, `ban_reason` alanları `protect_profile_privileged`
    trigger'ı ile normal kullanıcı güncellemelerinde OLD değere sabitlenir.
  - İlk admin yalnızca SQL/DB üzerinden atanır.
- `admin_audit_logs` yalnızca adminlerce okunur; yazma yalnızca SECURITY DEFINER
  fonksiyonlar üzerinden yapılır (doğrudan INSERT politikası yoktur).

## RLS Recursion
- Üyelik kontrolü `is_conversation_member()` **SECURITY DEFINER** fonksiyonuyla
  yapılır; politikalar `conversation_members` üzerinde kendini tetikleyip
  sonsuz recursion'a girmez.
- Reaksiyonlar için `message_conversation_id()`, storage için
  `can_access_chat_media()` aynı prensiple SECURITY DEFINER'dır.

## Direkt sohbet güvenliği
- `get_or_create_direct_conversation` SECURITY DEFINER RPC:
  - kendisiyle sohbeti engeller,
  - engelli çiftlerde sohbeti reddeder,
  - aynı iki kullanıcı için tekrar konuşma oluşmasını (tekilleştirme) önler.

## Storage
- `avatars`: public okuma; yazma/silme yalnızca `avatars/<user_id>/...` sahibinin.
- `chat-media`: private; okuma/yazma yalnızca ilgili konuşmanın üyeleri.
- Yol doğrulaması `can_access_chat_media` içinde regex + üyelik ile yapılır.
- Dosya türü/boyutu frontend'de (`services/media.js`) doğrulanır; yürütülebilir
  uzantılar reddedilir. **Not:** Frontend kontrolü tek başına yeterli değildir;
  production'da bucket düzeyi limit ve (gerekirse) sunucu tarafı tarama önerilir.

## Hesap onayı & erişim kontrolü (007)
- Yeni hesaplar `approval_status = 'pending'` başlar; mevcut hesaplar migration
  sırasında `approved` yapılır (kilitlenmez).
- `is_approved_user(uid)` **SECURITY DEFINER**: yalnızca `approved` + `banned_at is null`
  + `deactivated_at is null` ise `true` döner. Sohbet/mesaj/reaksiyon/typing/arama
  RLS politikaları bu kontrolü içerir → onaysız kullanıcı yalnızca **kendi profil
  satırını** görür ve çıkış yapabilir.
- Onay/red/devre-dışı alanları `protect_profile_privileged` trigger'ı ile normal
  kullanıcı güncellemelerinde OLD değere sabitlenir; yalnızca admin RPC'leri değiştirir.
- Admin RPC'leri backend'de `is_admin` doğrular; **admin kendini reddedemez/devre
  dışı bırakamaz**, **son aktif admin** devre dışı/yasak/silme işlemlerinden korunur.
- E-posta yalnızca doğrulanmış admin RPC'leri (`admin_list_pending_users`,
  `admin_list_users`) sonucunda döner; `search_approved_users` e-posta döndürmez.

## Kalıcı silme & anonimleştirme stratejisi
- Kalıcı `auth.users` silme yalnızca **service_role** ile mümkündür → sunucu tarafı
  `supabase/functions/admin-delete-user` Edge Function ile yapılır. service_role
  anahtarı repoda/hiçbir frontend dosyasında **tutulmaz** (`supabase secrets`).
- **Varsayılan yaklaşım — devre dışı bırakma (soft):** Kullanıcı silinmez;
  `deactivated_at` işaretlenir. Geçmiş mesajlar **veri bütünlüğü için korunur**,
  UI'da kullanıcı "devre dışı" görünür. Tercih edilen üretim davranışı budur.
- **Kalıcı silmede FK davranışı:**
  - `messages.sender_id`, `conversation_members.user_id`, `message_reactions.user_id`,
    `blocked_users.*` → `on delete cascade` (bu kullanıcının satırları silinir).
  - `reports.reported_user_id/resolved_by`, `conversations.created_by`,
    `admin_audit_logs.admin_id` → `on delete set null` (kayıt kalır, kişi anonimleşir).
- **Önerilen anonimleştirme (silmeden önce, opsiyonel):** grup mesajlarının
  bağlamını korumak isteniyorsa, kalıcı silmeden önce ilgili `messages.content`
  alanları maskelenebilir ve `profiles` görünen adı `"Silinmiş kullanıcı"` yapılabilir.
  Bu, chat geçmişinde boşluk bırakmadan kişisel veriyi kaldırır. (Şu an kod bunu
  otomatik yapmaz; tercih edilirse Edge Function içine eklenebilir.)

## Bilinen sınırlamalar / riskler
- **Uçtan uca şifreleme YOK.** Mesajlar sunucuda düz metin saklanır. UI'daki
  "şifreli kanal / gizli sohbet" ifadeleri görseldir; gerçek E2E iddiası YOKTUR.
- `profiles` tablosu **onaylı** kullanıcılarca okunabilir (kişi listesi/arama için).
  Bu, `role` ve `banned_at` gibi alanların da onaylı kullanıcılara görünür olması
  demektir. Hassas moderasyon alanlarını gizlemek gerekiyorsa ayrı tabloya taşınmalıdır.
  Onaysız kullanıcılar başkalarının profillerini **göremez**.
- Typing/presence bilgileri işlevsel; kötüye kullanım için rate limit önerilir.
- QR cihaz eşleştirme **uygulanmadı**; yalnızca gelecekte güvenli model planlandı
  (token yalnızca hash olarak saklanacak, kısa ömürlü, tek kullanımlık).

## Canlı Yazım (011)
- Varsayılan **kapalı**; her iki üye de ayrı ayrı açmadan çalışmaz
  (`conversation_members.live_typing_enabled` + `get_live_typing_status`).
- Yalnızca birebir (2 üyeli, grup değil), onaylı, engelsiz sohbetlerde etkinleşir.
- Taslak **kalıcı olarak saklanmaz**: `messages` veya başka tabloya yazılmaz;
  yalnızca Supabase **Realtime Broadcast** ile geçici gönderilir. Log/analytics'e
  gönderilmez.
- Kanal `live-drafts` Postgres Realtime ile (Broadcast değil); `live_drafts` tablosu
  geçici taslak tutar (max ~5 sn, kalıcı mesaj değil). İki taraf da
  `live_typing_enabled=true` olmalı.
- Karşı tarafın bağlantısı koparsa taslak istemcide en geç **5 sn** içinde silinir;
  gönderme/blur/kapanış/çıkışta taslak temizlenir. Throttle ~140ms.

## Sohbet Kilidi (011) — E2E DEĞİLDİR
- Adı bilinçli olarak "Sohbet Kilidi"dir; **uçtan uca şifreleme değildir.**
  Sunucu (service_role) mesaj içeriğine erişebilir; kilit yalnızca uygulama içi
  erişimi ve RLS düzeyinde okumayı kısıtlar.
- PIN **tam 4 rakam**. Düz metin **saklanmaz/loglanmaz**: `pgcrypto`
  `crypt(pin, gen_salt('bf'))` ile hash'lenir. Doğrulama yalnızca
  `verify_conversation_pin` (SECURITY DEFINER) içinde `crypt()` ile yapılır.
- `pin_hash`/`pin_salt` frontend'e **hiç dönmez**: kolon bazlı `GRANT` ile
  `authenticated` bu kolonları SELECT edemez; tüm yazma RPC ile yapılır.
- **5 yanlış** denemede **15 dk** kilit; sayaç server-side artar, sayfa
  yenilemek sıfırlamaz. Kilit/oturum süreleri **server `now()`** ile kontrol
  edilir (cihaz saatine güvenilmez).
- Kilitliyken `messages` SELECT/INSERT/UPDATE/DELETE **RLS** ile engellenir
  (`chat_lock_ok`); Realtime mesaj erişimi de kilide uyar. Sohbet listesi
  önizlemesi "Kilitli sohbet" gösterir, içerik sızmaz.
- Kilit **kullanıcı başına**dır; bir üyenin PIN'i diğerini etkilemez.
- Doğru PIN sonrası **10 dk** kayan açık pencere; uygulama arka plana alınınca
  (`visibilitychange`/`pagehide`) veya 10 dk boşta kalınca yeniden kilitlenir.
- PIN unutulursa: kilit ancak **hesap parolası yeniden doğrulanarak**
  (`signInWithPassword`) `force_remove_conversation_lock` ile kaldırılır.
- Admin normal kullanıcıların PIN'ini **göremez** (hash/salt kimseye dönmez).

## Production öncesi kontrol
- **"Confirm email" KAPALI**, admin onayı backend/RLS ile zorunlu; redirect URL'ler production adresinde.
- İlk admin SQL ile atandı; en az iki admin önerilir (son admin koruması tek adminde işlemi bloke eder).
- Auth rate limitleri ve şüpheli aktivite izleme gözden geçirildi.
- Storage bucket boyut limitleri ayarlandı.
- RLS testleri (bkz. TEST_CHECKLIST.md §6) geçildi.
