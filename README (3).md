# Yeni proje migration adayı

Bu dizin geliştirme ve test içindir; üretime uygulamadan önce Supabase üzerinde
ayrı bir test projesinde Auth, Storage, Realtime ve tüm RLS akışları doğrulanmalıdır.
Eski projeye uygulamayın. Bu set e-postasız kullanıcı adı/parola kimlik doğrulamasını
henüz sağlamaz; şu an uygulama Supabase e-posta/parola akışını kullanır.

Boş test veritabanında yalnızca `supabase/migrations` altındaki dosyaları dosya
adına göre artan sırayla çalıştırın. Başka migration klasörleriyle birleştirmeyin.
Başlangıç dosyası mevcut konsolide şemadan türetilmiştir. Sonraki dosyalar
kaybolan mesajları, yardımcı fonksiyon yetkilerini, push aboneliklerini,
engelleme ve üyelik kurallarını, anonim fonksiyon erişimini ve mesaj kimliği
bütünlüğünü ekler.

`npm run test:backend`, PGlite içinde sahte Auth/Storage/Realtime şemalarıyla
temel SQL ve RLS denetimleri yapar. Bu test gerçek Supabase ürünlerinin,
yetki sınırlarının veya bütün uygulama akışlarının yerine geçmez.
