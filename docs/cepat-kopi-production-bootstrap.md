# Bootstrap master data produksi Cepat Kopi

Dokumen ini menjelaskan command bootstrap tenant Cepat Kopi dari CSV lokal. Command tidak mengundang Employee atau Supervisor dan tidak membuat jadwal atau data kehadiran.

## Input CSV

CSV harus memiliki tepat empat header. Urutan kolom bebas:

```csv
name,email,role,outlet
Nama Owner,owner@example.test,owner,
Nama Employee,employee@example.test,employee,Kaliceret
Nama Supervisor,supervisor@example.test,supervisor,Kaliceret|Karangawen
```

Baris contoh di atas hanya format sintetis. Gunakan CSV lokal yang sudah ditinjau Owner untuk eksekusi sebenarnya. Jangan menyalin isinya ke terminal, laporan, atau log.

- Harus ada satu baris `owner` dan setidaknya satu baris `employee`.
- `employee` harus memiliki satu Outlet, yaitu `Kaliceret` atau `Karangawen`. Nama Outlet lengkap `Cepat Kopi Kaliceret` dan `Cepat Kopi Karangawen` juga diterima.
- `supervisor` boleh tidak memiliki Outlet. Jika kolomnya terisi, satu baris dapat mencantumkan satu atau kedua Outlet dengan pemisah `|`. Data Supervisor hanya dibaca untuk validasi dan hitungan laporan, bukan disimpan.
- Email dinormalisasi menjadi huruf kecil. Email yang sama boleh muncul sebagai Employee dan Supervisor dengan nama yang sama. Profil Employee dibuat satu kali untuk identitas tersebut. Owner tidak boleh memiliki role lain.
- CSV, nama, dan email tidak dicetak oleh command. Kesalahan validasi hanya menunjuk nomor baris, bukan nilainya.

## Perilaku dan batas data

Secara default command melakukan dry-run. Dry-run membaca CSV dan memeriksa target, tetapi tidak menulis data.

```bash
HADIRINAJA_RUNTIME="$HADIRINAJA_RUNTIME" php artisan organization:bootstrap-cepat-kopi --dry-run
```

Jika file tidak berada di `$HADIRINAJA_RUNTIME/cepat-kopi-people.csv`, berikan path melalui `--csv=/path/yang/disetujui.csv`. Command tidak menyimpan salinan CSV.

Untuk write, Owner harus memberi otorisasi terpisah. Gunakan environment tempat tenant akan dibuat, tinjau dry-run terlebih dahulu, lalu jalankan:

```bash
php artisan organization:bootstrap-cepat-kopi \
  --execute \
  --owner-authorized \
  --confirmation=BOOTSTRAP-CEPAT-KOPI
```

Kata sandi Owner berasal dari prompt tersembunyi yang meminta konfirmasi dua kali, atau dari `CEPAT_KOPI_OWNER_PASSWORD` yang dipasang melalui mekanisme rahasia environment. Kata sandi tidak diterima sebagai argumen command dan tidak ditampilkan. Syaratnya 12 sampai 72 byte, mengandung huruf dan angka.

Command hanya menerima `APP_ENV=testing`, `staging`, atau `production` dan koneksi MySQL. Dalam `testing`, koneksi harus cocok dengan identitas MySQL disposable dari `backend/tests/run-isolated-mysql.sh`. Mode write selalu memerlukan `--execute`, `--owner-authorized`, dan frasa konfirmasi yang tepat. Jangan menganggap flag `--owner-authorized` sebagai pengganti persetujuan Owner.

Bootstrap membuat:

- Satu Tenant `Cepat Kopi`, satu Business Unit, dua Outlet, serta satu akun dan membership Owner dari CSV.
- Satu profil Employee dan satu assignment primary ke Outlet untuk setiap identitas ber-role Employee. Akun Employee dan Supervisor tidak dibuat.
- Policy tenant efektif mulai tanggal hari ini di `Asia/Jakarta`: mode personal, toleransi keterlambatan 15 menit, foto personal wajib, planner profile `cepat_kopi`, dan akhir pekan mulai Jumat.
- Policy geofence untuk setiap Outlet, wajib, radius dan batas akurasi 25 meter, menggunakan koordinat Cepat Kopi yang telah ditetapkan.
- Kalender Outlet `Asia/Jakarta`, buka Senin sampai Minggu, serta lima shift template dengan versi efektif hari ini:
  - Senin sampai Kamis: 08:00–16:00, 11:00–18:00, dan 16:00–22:00.
  - Jumat sampai Minggu: 08:00–16:00 dan 16:00–23:00.

Database kalender saat ini hanya menyimpan zona waktu dan hari operasional, bukan rentang jam buka/tutup Outlet. Rentang di atas tersedia sebagai shift template untuk digunakan Owner saat menyusun jadwal. Command sengaja tidak membuat jadwal mingguan atau entri roster.

Command tidak membuat schedule weeks, schedule entries, schedule exceptions, holiday references, temporary workers/assignments, attendance sessions, atau attendance events. `weekly_planner_start_on` tetap `null`; aktivasi cutover adalah keputusan Owner yang terpisah. Kehadiran di luar jadwal tetap mengikuti perilaku aplikasi yang ada dan dapat ditandai untuk review sebagai `unscheduled_work`.

## Idempotensi dan konflik

Command memakai lock database dan satu transaksi. Jika bootstrap yang sudah ada cocok dengan input, eksekusi berikutnya no-op. Jika tenant bernama Cepat Kopi ada tetapi data intinya tidak cocok, command berhenti tanpa mengubah data. Command tidak menghapus atau memperbaiki data yang konflik. Periksa perbedaan secara terpisah sebelum mengambil keputusan.

## Laporan verifikasi

Output hanya berisi hitungan dan pengaturan, tanpa nama atau email dari CSV. Laporan memuat:

- Tanggal efektif dan zona waktu.
- Jumlah tenant, Business Unit, Outlet, akun Owner, profil Employee, dan kontak Supervisor; akun Employee/Supervisor yang dibuat harus nol.
- Hitungan schedule weeks, schedule entries, schedule exceptions, holiday references, temporary assignments, dan attendance sessions/events.
- Policy efektif per Outlet, termasuk mode, grace period, kewajiban foto, geofence, dan nilai cutover.
- Konfigurasi planner serta ID versi shift yang cocok.
- Pengaturan environment staging yang harus disiapkan:

```text
ATTENDANCE_EVIDENCE_REQUIRE_PERSONAL_PHOTO=true
```

Nilai tersebut adalah persyaratan konfigurasi staging, bukan bukti bahwa environment staging saat ini sudah menggunakannya. Policy tenant tetap mengatur kewajiban foto pada tingkat aplikasi.

## Langkah Owner setelah bootstrap

1. Tinjau hitungan dry-run dan pastikan CSV sumber benar tanpa menyalin data personal ke log atau tiket.
2. Setelah bootstrap disetujui dan dijalankan pada environment yang tepat, cocokkan semua policy, versi shift, dan status cutover pada laporan. Pastikan environment staging memakai flag foto di atas.
3. Dari pengelolaan akses, undang setiap Supervisor dengan kedua Outlet pada `outlet_ids`. Undangan Supervisor tidak otomatis dikirim melalui email oleh API.
4. Undang setiap Employee dengan memilih profil Employee yang sudah dibuat. Profil tidak memperoleh akun sampai undangan diterima.
5. Jika Supervisor juga merupakan Employee dan alamatnya tercatat pada kedua role di CSV, undang akses Supervisor terlebih dahulu. Setelah undangan diterima, tautkan membership Supervisor ke profil Employee melalui pengelolaan akses agar hak akses Employee ditambahkan secara eksplisit.
6. Jangan aktifkan planner cutover atau masukkan roster, hari libur, pekerja sementara, maupun attendance sebagai bagian dari bootstrap ini. Kelola semuanya melalui alur Owner yang sesuai dan persetujuan terpisah.
