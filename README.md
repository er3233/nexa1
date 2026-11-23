# Nexa Chat

Güvenlik temalı mesajlaşma arayüzü (React + Vite + Supabase).
Kimlik doğrulama, konuşmalar ve mesajlaşma **gerçek** Supabase işlemleridir.
Güvenlik Merkezi ekranı gerçek veriye bağlanana kadar "Yakında" olarak gösterilir.
Uygulama uçtan uca (E2E) şifreleme **iddia etmez**; mesajlar sunucuda saklanır.

## Özellikler
- E-posta + parola ile **kayıt / giriş / çıkış**, oturum kalıcılığı
- Kayıtlı kullanıcılarla doğrudan konuşma başlatma (Kişiler sekmesi)
- Konuşmaları ve mesajları Supabase'den getirme
- **Supabase Realtime** ile yeni mesajların anında görünmesi (id ile dedupe)
- Row Level Security: kullanıcı yalnızca üyesi olduğu konuşmaları görür/yazar

## Kurulum

```bash
npm install
```

`.env.example` dosyasını `.env` olarak kopyala ve Supabase değerlerini gir:

```
VITE_SUPABASE_URL=https://<proje-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon-public-key>
```

> Not: **service_role** anahtarını ASLA buraya koyma. Yalnızca anon key kullanılır.

Ardından:

```bash
npm run dev
```

## Supabase şeması
`supabase/schema.sql` dosyasını Supabase panelinde **SQL Editor**'e yapıştırıp
çalıştır. Tablolar (`profiles`, `conversations`, `conversation_members`, `messages`),
trigger, RLS politikaları ve Realtime yayını bu dosyada tanımlıdır.

## Production build

```bash
npm install
npm run build     # dist/ üretir
npm run preview   # üretim derlemesini yerelde önizle
```

## Vercel'e deploy

1. Projeyi bir Git deposuna (GitHub/GitLab) gönderin.
2. [vercel.com](https://vercel.com) → **Add New → Project** → depoyu içe aktarın.
3. Framework otomatik **Vite** algılanır (repoda `vercel.json` var; SPA route fallback dahil).
   - Build Command: `npm run build`
   - Output Directory: `dist`
4. **Environment Variables** ekleyin (Production + Preview):
   - `VITE_SUPABASE_URL = https://<proje-ref>.supabase.co`
   - `VITE_SUPABASE_ANON_KEY = <anon-public-key>`
   - > `service_role` veya başka bir gizli anahtar **eklemeyin**.
5. **Deploy**. Yayın adresiniz: `https://<proje>.vercel.app`
6. Her yeni environment değişkeninden sonra **Redeploy** gerekir.

## Supabase — Production URL ayarları

Supabase panelinde **Authentication → URL Configuration**:
- **Site URL**: `https://<proje>.vercel.app`
- **Redirect URLs** listesine ekleyin:
  - `https://<proje>.vercel.app`
  - `https://<proje>.vercel.app/**`
  - (yerel geliştirme için) `http://localhost:5173`

Bu ayarlar e-posta doğrulama ve **şifre sıfırlama** bağlantılarının uygulamaya doğru
dönmesi için gereklidir. Production'da **Confirm email**'i açık bırakın.

## Klasör yapısı
```
src/
  lib/supabase.js          Supabase istemcisi
  services/auth.js         signUp / signIn / signOut / session + TR hata çevirisi
  services/chat.js         konuşma & mesaj sorguları, realtime abonelik
  hooks/useAuth.js         oturum durumu
  hooks/useMessages.js     mesaj yükleme + realtime + gönderme
  components/Login.jsx     gerçek kayıt/giriş ekranı
  App.jsx                  ekranlar ve orkestrasyon
supabase/schema.sql        veritabanı şeması + RLS + realtime
```
