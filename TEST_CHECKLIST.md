# Nexa Chat — Test Kontrol Listesi

## 0. Kurulum
- [ ] `npm install` sorunsuz tamamlandı
- [ ] `.env` içinde `VITE_SUPABASE_URL` ve `VITE_SUPABASE_ANON_KEY` var
- [ ] Migration 001→006 SQL Editor'de sırayla çalıştı, hata yok
- [ ] `npm run build` hatasız
- [ ] `npm run dev` açılıyor

## 1. Kimlik doğrulama
- [ ] Kayıt (e-posta + parola) çalışıyor; profil otomatik oluşuyor
- [ ] Giriş çalışıyor, sayfa yenilenince oturum korunuyor
- [ ] Çıkış çalışıyor
- [ ] Hatalı parola → anlaşılır Türkçe hata
- [ ] Şifre sıfırlama e-postası gönderiliyor
- [ ] E-posta doğrulaması açıkken doğrulama bekleme ekranı görünüyor
- [ ] Yasaklı kullanıcı giriş yapınca yasak mesajı görünüyor ve içeri giremiyor

## 2. Mesajlaşma
- [ ] Kişiler'den kullanıcı seçince sohbet açılıyor
- [ ] Aynı iki kişi için ikinci kez sohbet açılınca AYNI konuşma kullanılıyor (kopya yok)
- [ ] Kendinle sohbet açılamıyor
- [ ] Mesaj gönderiliyor ve Supabase'e kaydediliyor
- [ ] Realtime: karşı tarafta mesaj anında görünüyor, çift görünmüyor
- [ ] Mesaj düzenleme çalışıyor, "düzenlendi" etiketi görünüyor
- [ ] Mesaj silme (soft delete) → "Bu mesaj silindi" görünüyor
- [ ] Yanıtlama (reply) çalışıyor, alıntı görünüyor
- [ ] Emoji reaksiyon ekleniyor/kaldırılıyor, realtime yansıyor
- [ ] Okunmamış sayısı doğru artıyor/sıfırlanıyor
- [ ] Yazıyor göstergesi karşı tarafta görünüyor
- [ ] Konuşmalar son mesaja göre sıralı
- [ ] Eski mesajlar sayfalı yükleniyor (hepsi tek seferde değil)

## 3. Medya (Storage)
- [ ] Avatar yükleme yalnızca kendi klasörüne
- [ ] Sohbet medyası yükleme yalnızca üye olunan konuşmaya
- [ ] Büyük dosya / yasak tür (exe, js, vb.) reddediliyor (frontend)
- [ ] Üye olmayan biri chat-media dosyasını indiremiyor

## 4. Sosyal
- [ ] Kullanıcı engelleme çalışıyor
- [ ] Engellenen kullanıcıyla yeni sohbet açılamıyor
- [ ] Şikâyet gönderme çalışıyor

## 5. Admin
- [ ] Normal kullanıcı admin panelini göremiyor
- [ ] SQL ile admin atanınca panel görünür oluyor
- [ ] Admin kullanıcı listeleyebiliyor
- [ ] Admin ban/unban yapabiliyor; denetim kaydı oluşuyor
- [ ] Admin rol atayabiliyor
- [ ] Moderatör/admin şikâyet durumunu güncelleyebiliyor

## 5b. Hesap onayı & kullanıcı yönetimi (007)
- [ ] Yeni kullanıcı kayıt olur ve "onay bekliyor" ekranında kalır
- [ ] Pending kullanıcı doğrudan API çağrısıyla (REST/RPC) mesaj/sohbet OKUYAMAZ
- [ ] Pending kullanıcı yalnızca kendi profil satırını görebilir, çıkış yapabilir
- [ ] Admin, başvuruyu "Başvurular" sekmesinde görür (kullanıcı adı, görünen ad, e-posta, tarih)
- [ ] Admin onaylar → kullanıcı "Durumu kontrol et" ile uygulamaya girer
- [ ] Admin reddeder (sebep) → red sebebi kullanıcıya görünür
- [ ] Reddedilen kullanıcı sonradan tekrar onaylanabilir
- [ ] Admin kullanıcıyı devre dışı bırakır → kullanıcı erişemez, mesaj gönderemez
- [ ] Devre dışı kullanıcının geçmiş mesajları KORUNUR (silinmez)
- [ ] Admin yeniden etkinleştirir → kullanıcı tekrar girer
- [ ] Admin kendini devre dışı/yasak/red yapamaz (hata döner)
- [ ] Son aktif admin devre dışı/yasak/kalıcı silme ile engellenir
- [ ] Normal kullanıcı `admin_*` RPC'lerini çalıştıramaz (yetki hatası)
- [ ] "Kalıcı Sil" butonu yalnızca `VITE_ADMIN_DELETE_ENABLED=true` iken görünür

## 5c. Kullanıcı arama (007)
- [ ] Onaylı kullanıcı, başka kullanıcıyı username ile bulur
- [ ] Onaylı kullanıcı, display_name ile bulur (büyük/küçük harf duyarsız)
- [ ] 2 karakterden kısa sorguda sonuç dönmez
- [ ] E-posta arama sonuçlarında GÖRÜNMEZ (RPC e-posta döndürmez)
- [ ] Engellenen (veya karşılıklı engelleme) kullanıcı sonuçlarda görünmez
- [ ] Pending/rejected/deactivated/banned kullanıcı sonuçlarda görünmez
- [ ] Kullanıcı kendini sonuçlarda görmez
- [ ] Sonuca dokununca sohbet açılır; aynı kişiyle tekrar arama ikinci sohbet OLUŞTURMAZ
- [ ] Pending/deactivated kullanıcı `search_approved_users` çağırınca boş döner

## 6. RLS güvenlik testleri
- [ ] Üye olmadığın konuşmanın mesajlarını SELECT edemiyorsun
- [ ] Başkasının profilini UPDATE edemiyorsun
- [ ] Kendi `role`/`banned_at` alanını UPDATE ile değiştiremiyorsun (trigger korur)
- [ ] `admin_audit_logs`'u normal kullanıcı SELECT edemiyor
- [ ] Başkasının mesajını düzenley/silemiyorsun
- [ ] Kendi `approval_status`/`deactivated_at` alanını UPDATE ile değiştiremiyorsun (trigger korur)
- [ ] Mevcut kullanıcılar migration (007) sonrası kilitlenmiyor (hepsi `approved`)
- [ ] RLS recursion hatası (infinite recursion) OLUŞMUYOR

## 6b. Mobil arayüz & klavye (008 – UI)
- [ ] Sayfa kaydırılırken alt menü (MobileNav) SABİT kalıyor, içerikle kaymıyor
- [ ] İçerik alt menünün altında kalmıyor (çift scrollbar yok)
- [ ] Android Chrome / iOS Safari'de mesaj kutusuna dokununca composer klavyenin üstünde görünür
- [ ] Klavye kapanınca altta boş siyah alan kalmıyor
- [ ] Mesaj input font-size ≥ 16px (focus'ta istenmeyen zoom yok)
- [ ] Uzun mesaj / reply preview / dosya önizlemesi composer'ı ekran dışına itmiyor
- [ ] Büyüyen textarea max yüksekliğe ulaşınca kendi içinde scroll ediyor
- [ ] Yeni mesajda kullanıcı alttaysa otomatik kayar; eski mesaj okurken zorla aşağı atmaz
- [ ] Sohbet açıkken alt menü gizleniyor; geri butonu sohbet listesini açıyor

## 6c. Profil fotoğrafı & hakkımda (008 – profil)
- [ ] Ayarlarda avatar/bio/görünen ad kaydedilince Hesabım ekranında ANINDA görünüyor
- [ ] Sayfa yenilenince avatar/bio korunuyor (kaynak: public.profiles)
- [ ] Avatar yüklenirken progress/loading görünüyor; upload bitmeden avatar_url güncellenmiyor
- [ ] Upload hatasında eski avatar kaybolmuyor
- [ ] Bio boşsa "Hakkımda bilgisi eklenmedi" yazıyor (sahte metin yok)
- [ ] Arama sonucu ve sohbet başlığında güncel avatar/display_name görünüyor; avatar yoksa baş harf fallback

## 6d. Mesajlaşma isteği sistemi (008)
- [ ] Kullanıcı A, B'yi arayıp mini karttan istek gönderiyor
- [ ] B'de istek rozeti (MobileNav → İstekler) realtime görünüyor
- [ ] B kabul etmeden A mesaj gönderemiyor (sohbet yok)
- [ ] B kabul edince TEK bir direct conversation oluşuyor ve sohbet açılıyor
- [ ] Reddedilen/iptal edilen istek doğru güncelleniyor (Giden sekmesinde durum)
- [ ] Aynı gönderici→alıcı için ikinci pending istek OLUŞMUYOR (unique index)
- [ ] Zaten sohbet varsa mini kart "Sohbete Git" gösteriyor (yeni istek yok)
- [ ] Engellenen kullanıcı istek gönderemiyor / gelen istekte listede görünmüyor
- [ ] Pending/deactivated kullanıcı istek RPC'lerini çağıramıyor
- [ ] Normal kullanıcı `message_requests`'e doğrudan INSERT/UPDATE yapamıyor (RLS yalnız SELECT)
- [ ] Reddedilen isteğin cooldown (1 saat) süresi dolmadan tekrar gönderilemiyor
- [ ] Realtime aboneliği unmount'ta temizleniyor; aynı istek iki kez görünmüyor

## 6e. WebRTC sesli/görüntülü arama (009)
- [ ] iPhone Safari'de mesaj kutusuna dokununca composer klavyenin hemen üstünde ve NORMAL boyutta (dev textarea yok)
- [ ] Klavye kapanınca altta siyah boşluk kalmıyor; --app-height/--vv-offset-top sıfırlanıyor
- [ ] Textarea en fazla 120px büyüyor, sonra kendi içinde scroll
- [ ] Android Chrome'da aynı davranış
- [ ] A, B'yi sesli arar → B'ye gelen arama TAM EKRAN düşer; kabul → çift yönlü ses
- [ ] Görüntülü arama: kamera/mikrofon izinleri istenir, uzak video tam alan + yerel önizleme
- [ ] Reddet / iptal / bitir / cevapsız (45 sn) durumları doğru çalışıyor
- [ ] Engelli / pending / deactivated kullanıcı arama başlatamıyor (RPC reddediyor)
- [ ] Üçüncü kullanıcı `call_signals`'ı SELECT/INSERT edemiyor (RLS)
- [ ] Arama kapanınca kamera/mikrofon göstergesi sönüyor (track.stop)
- [ ] Aynı gelen arama iki kez görünmüyor; eski ICE sinyali yeniden işlenmiyor (dedupe set)
- [ ] İzin reddedilince anlaşılır hata + ayardan açma yönlendirmesi
- [ ] TURN yoksa bazı mobil/simetrik NAT ağlarında bağlantı kurulamayabilir (beklenen)

## 6f. Admin başvuru bildirimleri (010)
- [ ] Yeni kullanıcı kayıt olunca (pending) admin hesabında zil rozeti realtime artıyor (sayfa yenilemeden)
- [ ] Zil ikonu yalnızca admin/moderatör hesabında görünüyor (normal kullanıcıda YOK)
- [ ] Bildirime basınca Admin Paneli → Başvurular sekmesi açılıyor
- [ ] Admin onaylayınca/reddedince ilgili bildirim okundu oluyor ve rozet azalıyor
- [ ] Aynı başvuru için aynı adminde ikinci bildirim OLUŞMUYOR (dedupe index)
- [ ] Normal kullanıcı `notifications` tablosunda admin bildirimlerini SELECT edemiyor (RLS)
- [ ] Migration sonrası mevcut pending başvurular için bildirim backfill edildi (duplicate yok)
- [ ] Panelde loading / boş / hata durumları çalışıyor; mobilde düzgün

## 6g. Canlı Yazım (013 — live_drafts)
- [ ] İki taraf canlı yazımı açınca A "Naber" yazarken B'de harf harf taslak balonu görünür (<1 sn)
- [ ] B yazarken A'da aynı şekilde görünür
- [ ] Gönderince / input silince / blur / sohbet kapanınca taslak silinir
- [ ] "Yazıyor" yalnızca taslak boşken görünür
- [ ] Üçüncü kullanıcı taslağı göremez; admin ↔ normal iki yönde çalışır
- [ ] RPC hatası ekranda Türkçe görünür (sessiz yutma yok)

## 6h. Sohbet Kilidi (013)
- [ ] PIN kurulumunda `gen_salt` hatası YOK; başarı mesajı görünür
- [ ] `conversation_locks` satırı oluşur; UI'da "Şimdi Kilitle" görünür
- [ ] "Şimdi Kilitle" sonrası PIN ekranı açılır
- [ ] 4 yanlışta 1 hak; 5. yanlışta 15 dk; doğru PIN sonrası mesajlar açılır
- [ ] RPC hataları Türkçe toast ile gösterilir; hash/salt frontend'e dönmez

## 7. Production öncesi
- [ ] "Confirm email" KAPALI; admin onayı backend/RLS ile zorunlu
- [ ] Redirect URL'ler production adresine ayarlı
- [ ] service_role anahtarı frontend'de YOK
- [ ] Rate limit / abuse politikaları gözden geçirildi
- [ ] Storage dosya boyutu limitleri bucket düzeyinde de ayarlandı
- [ ] `migrations/008_message_requests.sql` çalıştırıldı (mevcut DB için yalnızca 008)
- [ ] `migrations/009_calls.sql` çalıştırıldı (mevcut DB için yalnızca 009)
- [ ] `migrations/010_admin_notifications.sql` çalıştırıldı (mevcut DB için yalnızca 010)
- [ ] `migrations/011_live_typing_and_chat_locks.sql` çalıştırıldı (mevcut DB için yalnızca 011)
- [ ] `migrations/017_fix_chat_lock_keep_signature.sql` çalıştırıldı (chat_lock_ok conv/uid imzası)
- [ ] Production'da TURN sunucusu yapılandırıldı (STUN tek başına yetmez)
- [ ] `npm run build` başarılı
