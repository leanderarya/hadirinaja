# Employee Invitation & Self Activation V1

Owner mengelola email **sebelum aktivasi** dari Pengaturan → Akses pengguna.
Tidak ada SMTP, pengiriman email otomatis, atau integrasi WhatsApp API.

## Alur

1. Pilih profil karyawan existing dan masukkan email login penerima yang benar.
2. Buat undangan. Salin tautan sekali tampil, lalu bagikan sendiri melalui kanal tepercaya.
3. Penerima membuka halaman aktivasi, memeriksa organisasi/profil/email, lalu membuat password sendiri. Bila email sudah mempunyai akun global, penerima harus login memakai akun itu dan menerima undangan; aplikasi tidak membuat akun duplikat atau mengganti password existing.
4. Setelah aktivasi, penerima login ke akun karyawan yang terikat ke profil dan tenant undangan.

Email undangan adalah identitas login yang dituju, bukan atribut baru pada profil atau penempatan karyawan. Owner tidak mengubah email akun yang sudah aktif melalui alur ini. Kepemilikan tautan dibuktikan oleh bearer token; tidak ada verifikasi mailbox/OTP terpisah. Owner harus membagikannya kepada penerima yang benar.

## Koreksi, regenerasi, pencabutan

- Detail undangan karyawan pending/expired menyediakan **Email login karyawan** dan **Simpan email & buat tautan baru**.
- Email sama: rotasi token pada row existing dan perpanjang expiry; token lama tidak berlaku. Audit `reissued` mencatat regenerasi.
- Email berbeda: cabut row lama, catat `recipient_replaced`, lalu buat undangan pengganti terikat ke employee/tenant yang sama. Alamat lama tetap dalam histori. Transaksi gagal sepenuhnya bila alamat baru tidak valid/berkonflik; tautan lama tetap berlaku.
- Undangan pending dapat dibatalkan. Undangan accepted/revoked tidak dapat diregenerasi atau dipakai kembali. Undangan expired tidak dapat diaktifkan, termasuk tepat pada timestamp expiry.
- Supervisor tetap hanya dapat diregenerasi tanpa mengganti recipient melalui endpoint ini; perubahan identitas Supervisor bukan bagian koreksi email karyawan.

## Keamanan dan kontrak

- API existing: `POST /api/v1/management/access/invitations`; `POST .../{id}/reissue` kini menerima `email` opsional; cancel/inspect/activate/login/accept tetap.
- Owner aktif dan tenant scope diperiksa server-side. Satu employee atau email hanya boleh mempunyai satu undangan pending dalam tenant, termasuk lintas role. Existing user lintas tenant tetap boleh menerima membership terpisah setelah autentikasi yang benar; tidak ada pengambilalihan akun global.
- Lock tenant dan transaksi existing menserialisasi mutasi undangan dalam tenant. Unique constraints user email, membership, employee link, dan token digest existing dipertahankan.
- Token acak 64 karakter disimpan hanya sebagai SHA-256 digest. Token mentah hanya dikembalikan pada create/regenerate dan ditampilkan sekali. Audit tidak menyimpan token atau digest.
- Tautan produksi hanya HTTPS; token berada di fragment `/activate#...`, bukan query/path. HTTP loopback diizinkan untuk development lokal. Origin HTTP nonlokal tidak menawarkan tautan berbagi.
- Halaman aktivasi membuang fragment dari address bar, memakai no-referrer/no-store existing, dan membersihkan password/token dari state setelah sukses. Jangan memasukkan tautan mentah ke log, screenshot, issue, analytics, atau laporan.
- `ACCESS_INVITATION_EXPIRATION_HOURS` mengatur masa berlaku, default 24 jam, minimum 1 jam. Tidak ada perubahan konfigurasi hosting pada pekerjaan ini.

Tidak diperlukan migrasi baru. Gunakan tabel dan migration access management existing. Tidak ada perubahan APP_KEY, auth/RBAC, email akun aktif, data presensi, penempatan, atau cutover.

## Verifikasi lokal

Backend: `cd backend && php artisan test --compact tests/Feature/S2/EmployeeInvitationLifecycleTest.php tests/Feature/S2/AccessManagementTest.php tests/Feature/S2/AuthenticationAndTenantAccessTest.php`.
TestCase memaksa MySQL lokal `127.0.0.1:3306/hadirinaja_test` dan menolak target lain.

Frontend: `./node_modules/.bin/vitest run src/routes/-access.test.tsx src/routes/-activate.test.tsx src/lib/invitation-link.test.ts`.

Jalankan typecheck source dengan konfigurasi evidence yang mengecualikan arsip `output`. Typecheck repo default saat ini juga memindai source snapshot lama di `output`, sehingga kegagalannya harus dilaporkan terpisah.

Perubahan ini belum dideploy. Onboarding karyawan pilot nyata masih membutuhkan email resmi masing-masing orang, rilis yang ditinjau dan diotorisasi, serta aktivasi mandiri. Akses akun tidak otomatis mengubah kebijakan presensi kiosk menjadi personal/hybrid atau mengaktifkan Weekly Planner.
