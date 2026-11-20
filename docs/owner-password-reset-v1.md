# Reset password melalui tautan Owner

Status: implementasi lokal, belum deployment dan belum reset akun pilot. Permintaan hapus total/anonymization dibatalkan; tidak ada implementasi purge atau penghapusan data operasional dalam task ini.

## Perilaku

Owner aktif membuka Pengelolaan akses → Lihat akses anggota → Reset password. Owner mengisi password miliknya dan mengonfirmasi penerbitan tautan. Akun target harus existing, bukan akun Owner yang sedang login, dan tidak mempunyai keanggotaan di organisasi lain. Pembatasan multi-organisasi mencegah Owner satu tenant mengganti kredensial global pengguna lintas organisasi. Pemulihan akun lintas organisasi di luar V1 ini.

Link HTTPS `/reset-password#TOKEN` ditampilkan sekali dalam sesi halaman dan bisa disalin manual. Token tidak diletakkan pada query URL, localStorage, sessionStorage, atau audit. Halaman penerima menghapus fragment dari URL setelah mengambil token ke memori. Owner dapat menyembunyikan link, menerbitkan pengganti (mencabut semua link lama untuk User), atau mencabut link yang baru diterbitkan dengan konfirmasi password Owner lagi. Setelah halaman ditutup, terbitkan pengganti jika link perlu dipulihkan. Tidak memakai SMTP atau WhatsApp API.

Penerima memakai link untuk mengisi password sendiri beserta konfirmasi tanpa mengetahui password lama. Link tidak mengautentikasi penerima secara otomatis; setelah sukses, penerima masuk melalui halaman login. Penerbit harus tetap Owner aktif saat link diperiksa/digunakan. Email akun harus sama dengan ketika diterbitkan. Perubahan password lain membatalkan link melalui fingerprint HMAC password hash. Masa berlaku default 30 menit, konfigurasi `ACCESS_PASSWORD_RESET_EXPIRATION_MINUTES`, dibatasi 5–120 menit. Batas expiry bersifat inklusif: pada waktu expiry, link sudah tidak berlaku.

Token random 32 byte / 64 hex; database hanya menyimpan digest SHA256. Password menggunakan cast hashed User existing. Remember token diganti, seluruh sesi database User dicabut, token broker password lama dibersihkan, dan reset lain dicabut setelah password diganti. Jika penerima sudah login saat mengirim form, sesi permintaannya sendiri juga diinvalidasi. Reset tidak mengubah email, role, status aktif/revoked, profil, penempatan, undangan, roster, presensi, APP_KEY, atau data tenant lain.

Untuk Arya yang aksesnya dicabut, reset password **tidak** membuat login organisasi aktif kembali. Pengaktifan role Karyawan tetap tindakan Owner yang terpisah pada form perubahan role yang sudah dideploy. Tidak ada pengaktifan akses secara terselubung.

## Keamanan dan konsistensi

- API issue/revoke: auth:sanctum, active-tenant, Owner, password Owner, no-store, throttle enam permintaan per menit.
- API inspect/complete: no-store dan limiter token/IP existing access-invitation. Token tidak dikenal, used, revoked, atau expired ditolak dengan 410; password/konfirmasi divalidasi server.
- Password baru minimum mengikuti `Password::defaults()`, maksimal 255 karakter, menolak null byte dan lebih dari 72 byte untuk bcrypt agar tidak terpotong diam-diam.
- Issue, consume, revoke memakai transaksi dan kunci tenant; issue/consume juga mengunci User. Penggunaan token diulang di bawah row lock sebelum password disimpan.
- Gagal menulis audit membatalkan password, sesi, token, dan seluruh transaksi. Audit minimal mencatat penerbit/tenant, ID reset, aksi issue/complete/revoke; tidak berisi password atau token/digest/fingerprint.
- Hanya session driver `database`, tabel `sessions`, koneksi default yang didukung. Penyimpanan sesi lain ditolak sampai mekanisme pencabutannya diimplementasikan. Middleware AuthenticateSession Sanctum existing tetap digunakan; tidak menambah middleware autentikasi baru.
- Stres dua proses paralel belum diuji terpisah; replay berurutan, regenerasi, revokasi, dan kegagalan transaksi diuji otomatis.

## Schema dan endpoint

Migrasi additive `2026_11_04_000002_create_owner_password_resets`: tabel baru dengan tenant_id, user_id, target_membership_id, issued_by_membership_id, email, token_digest unik, password_fingerprint HMAC, expires_at, used_at, revoked_at dan timestamps. FK target/penerbit terikat tenant yang sama. Tidak mengubah audit lama atau tabel users. Down migration hanya diizinkan pada testing database lokal `hadirinaja_test`.

- POST `/api/v1/management/access/members/{id}/password-reset`: password Owner. Respons sukses sekali berisi token, reset_id, email, expiry.
- POST `/api/v1/management/access/password-resets/{id}/revoke`: password Owner.
- POST `/api/v1/password-resets/inspect`: token.
- POST `/api/v1/password-resets/complete`: token, password, password_confirmation.

Frontend menggunakan komponen shadcn existing di file route; tidak ada komponen baru di `src/components` sehingga katalog UI kit tidak berubah.

## Verifikasi dan rilis

Hasil dan inventory checksum: `output/owner-password-reset-v1-20261104/REPORT.md` dan `manifest.json`. TestCase membatasi database ke MySQL lokal `hadirinaja_test`. Build dilakukan di workspace sementara terpisah dan dibersihkan; tidak menjadi kandidat deployment pilot.

Sebelum fitur tersedia pada pilot: freeze kandidat dari baseline live yang disetujui dan overlay file fitur saja, rehearsal migrasi pada resource disposable yang diverifikasi, backup baru, maintenance pilot, migrasi additive khusus ini, deploy backend/SPA bersesuaian, rebuild route cache, dan smoke read-only sebelum reopen. Rollback kode boleh mempertahankan tabel tambahan. Jangan menghapus reset/audit baru atau mengembalikan password lama melalui rollback otomatis.

Belum ada deployment, migration hosting, perubahan password pilot, penerbitan link reset pilot, penghapusan/anonymization, cutover, commit, atau merge dalam task ini. Untuk benar-benar mengganti password, pemilik akun harus menggunakan link privat sesudah fitur tersedia; jangan kirim password lewat chat.
