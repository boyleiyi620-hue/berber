# Berber Studio

Müşteri randevu sayfası ve yönetici paneli ayrı bağlantılarda çalışır. Statik site GitHub Pages, ortak veriler Supabase kullanır.

- Randevu sayfası: `https://boyleiyi620-hue.github.io/berber/`
- Yönetici paneli: `https://boyleiyi620-hue.github.io/berber/admin.html`

## Ana ekrana uygulama olarak ekleme

Müşteri randevu sayfası ve yönetim paneli ayrı uygulamalar olarak yüklenebilir. Android/Chrome'da ilgili sayfayı açıp tarayıcı menüsünden **Uygulamayı yükle** veya **Ana ekrana ekle** seçeneğini kullanın. iPhone/iPad'de Safari'de sayfayı açıp **Paylaş > Ana Ekrana Ekle** yolunu izleyin. Masaüstü Chrome ve Edge'de adres çubuğundaki yükleme simgesi kullanılabilir.

Uygulama kabuğu ve statik dosyalar çevrimdışı açılış için önbelleğe alınır. Randevu oluşturma, müsaitlik sorgulama, yönetici girişi ve randevu verilerini yenileme Supabase bağlantısı gerektirir; çevrimdışı çalıştığı varsayılmamalıdır.

## Supabase güvenliği

Tarayıcıdaki `config.js` yalnızca proje URL'sini ve Supabase **publishable** anahtarını içerir. Gizli `service_role` anahtarı kullanılmaz. RLS kuralları müşteri iletişim bilgilerini anonim kullanıcılara kapatır; randevu oluşturma, çakışma kontrolü yapan veritabanı fonksiyonundan geçer. Yönetici verileri yalnızca `app_metadata.role = admin` olan oturumlara açılır.

## İlk yönetici hesabını açma

1. Supabase Dashboard > Authentication > Users bölümünde işletme sahibine ait bir kullanıcı oluşturun (e-posta/şifre). Hesabı e-posta doğrulaması yapılmış/confirmed olarak açın.
2. Supabase SQL Editor'da aşağıdaki sorguyu, `owner@example.com` yerine hesap e-postasını koyarak çalıştırın:

   ```sql
   update auth.users
   set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || '{"role":"admin"}'::jsonb
   where email = 'owner@example.com';
   ```

3. `https://boyleiyi620-hue.github.io/berber/admin.html` adresinde bu kullanıcıyla giriş yapın.

`app_metadata` yalnızca Supabase tarafında yetkili işlemle değiştirilebilir; role değerini kullanıcı profil metaverisine yazmayın. Daha sonra yönetici eklemek için aynı adımları uygulayın. E-posta/şifreyle giriş için herkese açık kayıt formu bu uygulamada bulunmaz.

## Yerel önizleme

Bu klasörde bir statik dosya sunucusu çalıştırın (ör. `python3 -m http.server 8080`) ve `http://localhost:8080/` adresini açın. Supabase Auth kullanıcıları yerel önizlemede de giriş yapabilir.
