# HadirinAja — Kondisi Presensi Mandiri dan Kiosk

**Snapshot: 4 November 2026, 18:29–18:30 WIB.**

Dokumen ini memisahkan **kemampuan implementasi**, **konfigurasi pilot yang sedang aktif**, dan **bukti operasional**. Tujuannya menjadi bahan brainstorming, bukan instruksi untuk mengubah policy atau mengaktifkan cutover. Pemeriksaan hosting dilakukan read-only; tidak membuat presensi contoh atau mengubah akun, PIN, perangkat, jadwal, dan policy.

## 1. Kondisi utama saat ini

**Sistem memiliki dua jalur presensi, tetapi pilot Cepat Kopi saat diperiksa belum siap dipakai lewat keduanya:**

1. Presensi mandiri sudah ada di aplikasi, tetapi **policy kedua Outlet masih `kiosk`**, sehingga check-in/check-out mandiri tidak diizinkan.
2. Jalur kiosk diizinkan policy, tetapi **belum ada perangkat yang dipairing dan belum ada PIN karyawan**.
3. **Belum ada presensi operasional tersimpan**: nol sesi, nol event masuk/pulang, nol bukti foto.
4. Arya sudah aktif sebagai **Karyawan**, tertaut ke profil Arya. Delapan profil awal belum tertaut akun login.
5. Weekly Planner sudah terpasang, tetapi kedua roster masih draft dan `weekly_planner_start_on` masih null. Draft tersebut belum menjadi jadwal efektif untuk presensi.

Jadi keberhasilan login/reset password tidak otomatis berarti seseorang sudah bisa melakukan presensi.

## 2. Dua cara absen yang tersedia

| Aspek | Mandiri karyawan | Kiosk Outlet |
| --- | --- | --- |
| Perangkat | HP/browser pribadi karyawan | Browser pada perangkat bersama yang dipairing ke satu Outlet |
| Halaman | `/attendance` | `/kiosk` |
| Identitas | Akun login, keanggotaan aktif, role Karyawan, tautan profil karyawan | Identitas perangkat, pilihan profil karyawan, PIN |
| Wajib punya email/password pribadi? | Ya, untuk login akun | Tidak untuk alur presensi kiosk; profil dan PIN tetap wajib |
| Identitas Outlet | Berdasarkan penempatan aktif dan pilihan Outlet; checkout mengikuti sesi aktif | Terikat pada Outlet perangkat, tidak bebas memilih Outlet lain saat presensi |
| Bukti lokasi | Divalidasi server bila policy mewajibkan geofence | Tidak meminta GPS; perangkat dipercaya berada di Outlet |
| Foto pada UI | Alur kamera langsung untuk masuk dan pulang | Kamera langsung dan foto wajib untuk masuk dan pulang |
| Foto pada API | Bisa diwajibkan dengan konfigurasi; **di pilot enforcement foto personal masih false** | Wajib pada API dan service |
| Rahasia yang dipakai | Password akun; cookie sesi | PIN karyawan; cookie kredensial kiosk |
| Sesi kehadiran | Mesin presensi yang sama | Mesin presensi yang sama |
| Kesiapan pilot sekarang | Terhalang mode kiosk-only; sebagian besar profil belum punya akun | Terhalang belum ada pairing perangkat dan PIN |

### Mode policy

- `personal`: mengizinkan presensi mandiri.
- `kiosk`: mengizinkan presensi melalui kiosk.
- `hybrid`: mengizinkan kedua jalur.

Mode ini menentukan jalur yang boleh mengirim transaksi, bukan sekadar menu yang tampil. Mengganti mode adalah perubahan kebijakan operasional dan tidak dilakukan dalam pemeriksaan ini.

## 3. Alur mandiri karyawan

### Prasyarat

1. Akun login existing yang sudah diaktivasi.
2. Keanggotaan organisasi aktif.
3. Role **Karyawan** dan tautan ke profil karyawan dalam organisasi yang sama.
4. Penempatan Outlet yang efektif pada saat check-in.
5. Policy efektif mengizinkan `personal` atau `hybrid`.
6. HTTPS, izin kamera dan—jika diwajibkan policy—izin lokasi yang memadai.

Memiliki profil karyawan saja tidak cukup. Memiliki akun Owner/Supervisor saja juga tidak otomatis memenuhi syarat presensi personal.

### Urutan pengguna

1. Login dan memilih organisasi jika memiliki beberapa keanggotaan.
2. Membuka halaman presensi; aplikasi mengambil waktu server, penempatan, policy, jadwal efektif, riwayat, serta sesi aktif.
3. Memilih Outlet yang diizinkan bila diperlukan.
4. Memulai check-in atau check-out sesuai status yang diberikan server.
5. Jika lokasi wajib, browser meminta posisi terbaru: high accuracy, tanpa memakai hasil cache browser, timeout pengambilan 10 detik.
6. UI memeriksa kelayakan lokasi, kemudian membuka kamera untuk mengambil dan meninjau foto.
7. Mengirim transaksi dengan kunci operasi unik.
8. Menampilkan berhasil hanya ketika server mengonfirmasi hasil. Respons tidak pasti masuk alur pemeriksaan status, bukan langsung dianggap gagal atau sukses.

### Geofence yang diterapkan

Jika lokasi diwajibkan, server menolak transaksi ketika:

- Izin lokasi ditolak.
- Posisi tidak tersedia.
- Titik/radius Outlet belum valid.
- Akurasi GPS lebih buruk daripada radius yang ditentukan.
- Jarak posisi terhadap titik Outlet berada di luar radius.

Untuk radius **50 meter**, jarak harus maksimal 50 meter **dan** nilai akurasi harus maksimal 50 meter. Sistem tidak menambahkan nilai akurasi untuk memperbesar radius. Penolakan lokasi berlaku pada check-in dan check-out; checkout yang ditolak tidak menutup sesi aktif.

Koordinat berasal dari browser. Validasi jarak tidak membuktikan bahwa posisi tidak dipalsukan. Belum ada bukti GPS perangkat nyata di Karangawen/Kaliceret dalam pemeriksaan ini.

### Perbedaan penting antara UI dan server

UI mandiri menggunakan foto, tetapi konfigurasi pilot saat diperiksa adalah:

```text
attendance_evidence.require_personal_photo = false
```

Artinya kewajiban foto mandiri **belum menjadi aturan server yang seragam**. Permintaan API yang valid secara identitas/policy/lokasi dapat tidak membawa foto ketika flag tersebut false. Menampilkan kamera di UI tidak setara dengan mewajibkan foto pada server. Jalur ini tetap diblokir oleh policy kiosk-only saat ini.

## 4. Alur kiosk Outlet

### Persiapan perangkat oleh Owner

1. Owner menerbitkan kode pairing untuk tenant dan Outlet yang benar.
2. Kode dimasukkan pada browser perangkat Outlet di `/kiosk`.
3. Server membuat/mengenali identitas perangkat dan memasang cookie kredensial kiosk.
4. Kode pairing sekali pakai dan kedaluwarsa setelah lima menit.
5. Kredensial perangkat berlaku maksimal 30 hari; permintaan biasa tidak memperpanjang masa berlakunya.

Kredensial disimpan sebagai hash di server dan cookie HttpOnly pada browser, dengan path `/api/v1/kiosk`. Identitas ini melekat pada browser/cookie, bukan sertifikat perangkat keras.

Owner bisa mencabut perangkat atau menerbitkan kode pembaruan untuk device yang sama. Pembaruan merotasi kredensial; salinan token lama tidak berlaku. Perangkat yang sudah dicabut tidak dapat dihidupkan kembali hanya dengan kode pembaruan lama.

### Persiapan PIN karyawan

1. Profil karyawan dan penempatannya harus tersedia.
2. Owner menerbitkan kode aktivasi PIN yang terikat karyawan dan Outlet.
3. Kode aktivasi PIN berlaku 15 menit, sekali pakai.
4. Karyawan mengatur dan mengonfirmasi PIN **6–8 angka** melalui kiosk yang sesuai.
5. Server menyimpan hash PIN, bukan PIN mentah.

Password login mandiri dan PIN kiosk adalah dua kredensial yang berbeda. Reset password login tidak otomatis membuat atau mengganti PIN kiosk.

### Saat karyawan melakukan presensi

1. Karyawan memilih namanya dari daftar kiosk.
2. Memasukkan PIN.
3. Server menentukan operasi berikutnya: masuk bila belum ada sesi aktif, pulang bila ada sesi aktif pada Outlet tersebut.
4. Kiosk membuka kamera depan, karyawan mengambil foto dan meninjaunya.
5. Foto, identitas karyawan dan PIN dikirim dengan kunci operasi unik.
6. Setelah sukses, PIN/foto/pilihan karyawan dibersihkan; UI kembali ke pilihan karyawan setelah sekitar lima detik.

Daftar kiosk tidak menampilkan semua profil tanpa syarat: karyawan harus punya PIN serta penempatan aktif pada Outlet, atau sesi aktif di Outlet tersebut yang perlu ditutup. Karena itu profil yang sudah dibuat tetapi belum punya PIN bisa belum muncul pada daftar presensi kiosk.

### Aturan lokasi dan penempatan

- Kiosk **tidak melakukan validasi GPS**.
- Check-in tetap mensyaratkan penempatan karyawan yang sedang berlaku pada Outlet perangkat.
- Checkout mengikuti Outlet sesi asal; kiosk Outlet lain tidak dapat menutupnya.
- Karyawan dengan sesi aktif dapat tetap menyelesaikan checkout pada kiosk asal meskipun penempatan saat ini berubah; pemeriksaan checkout memang berbeda dari check-in.

Kepercayaan lokasinya berasal dari pengelolaan perangkat: perangkat harus benar-benar ditaruh dan dikelola di Outlet. Jika browser yang sudah dipairing dibawa ke lokasi lain, tidak ada geofence kiosk yang otomatis mendeteksinya.

### Batas keamanan

- PIN dibatasi lima percobaan per kombinasi perangkat/tenant/karyawan dalam jendela 15 menit; ada limiter endpoint tambahan.
- Foto baru diwajibkan, tetapi belum ada face recognition atau pemeriksaan liveness yang membuktikan orang di foto sama dengan nama yang dipilih.
- Cookie aktif yang disalin tetap berisiko dipakai sebagai perangkat logis yang sama sampai expired, dirotasi atau dicabut.
- Berbagi PIN, titip absen, foto layar, dan pemindahan perangkat tetap perlu dibahas sebagai risiko operasional; jangan menganggap foto + PIN sudah menutup semuanya.

## 5. Mesin presensi yang dipakai bersama

### Satu sesi aktif per karyawan

Kedua jalur memakai invariant yang sama: satu karyawan dalam satu tenant tidak boleh mempunyai dua sesi aktif sekaligus, termasuk ketika dua request atau dua jalur datang bersamaan.

- Check-in membuka sesi dan membuat event masuk.
- Check-out menutup sesi dan membuat event pulang.
- Sudah mempunyai sesi aktif → check-in lain ditolak.
- Belum mempunyai sesi aktif → checkout ditolak.
- Batasnya bukan otomatis satu pasangan masuk/pulang per hari: beberapa sesi berurutan dimungkinkan selama tidak bersamaan aktif.

Dalam mode hybrid, pergantian jalur tidak menciptakan mesin sesi terpisah. Pemeriksaan policy efektif dan Outlet asal tetap berlaku. Detail pengalaman berpindah jalur perlu masuk skenario UAT.

### Waktu dan histori

Waktu transaksi berasal dari server. Sistem menyimpan tanggal kerja, waktu masuk/pulang, asal transaksi, identitas akun/perangkat, snapshot penempatan, jadwal dan policy, indikator review, serta bukti jika disertakan. Shift melewati tengah malam mempunyai penanganan tanggal kerja; itu tidak berarti browser bebas mengirim jam masuk mundur.

Lupa checkout tidak otomatis berarti sistem menutup sesi pada jam pulang jadwal. Sesi dapat tetap aktif dan memerlukan penyelesaian/review.

### Jadwal bukan selalu penghalang mutlak

Di implementasi sekarang, sejumlah kondisi dicatat sebagai indikator review, bukan otomatis menolak presensi:

- Tidak memiliki jadwal: `unscheduled_work`.
- Bekerja pada hari istirahat: `rest_day_work`.
- Outlet tutup menurut kalender: `outlet_closed`.
- Jadwal bertentangan: `schedule_conflict`.
- Masuk di luar jendela: `check_in_outside_window`.
- Terlambat, pulang awal, atau checkout terlambat.

Sebaliknya, identitas/penempatan yang tidak sah, mode tidak sesuai, geofence wajib yang gagal, PIN salah, perangkat tidak sah, dan konflik sesi aktif merupakan penghalang transaksi.

Implikasinya: **draft roster belum diterbitkan bukan satu-satunya penentu apakah transaksi presensi bisa dicatat**. Setelah prasyarat kiosk terpenuhi, presensi tanpa jadwal efektif dapat masuk sebagai pekerjaan tanpa jadwal untuk review.

## 6. Foto, privasi, dan gangguan jaringan

### Bukti foto

- Kiosk mewajibkan foto pada setiap check-in/check-out.
- Input yang didukung JPEG/PNG/WebP; validasi ukuran dan dimensi dilakukan server.
- Batas input pada controller: 10 KB–5 MB dan dimensi 320×240 hingga 1920×1920 piksel.
- Foto dinormalisasi, termasuk orientasi JPEG, dan ditulis ulang. Format output pilot saat ini **JPEG**.
- Foto disimpan pada private storage; pengambilan lewat endpoint terotorisasi, bukan URL file publik.
- Karyawan hanya boleh mengambil bukti miliknya; Owner/Supervisor mengikuti kewenangan dan lingkup Outlet. Akses bukti dicatat dalam audit.

Server menolak hash foto hasil normalisasi yang sudah tersimpan untuk karyawan yang sama. Retry idempotent dengan kunci yang sama tetap mengembalikan hasil lama. Pemeriksaan ini bukan face recognition: crop/re-encode/perubahan piksel dapat menghasilkan hash berbeda. Hash yang sudah dibersihkan saat lifecycle expiry juga tidak menjadi arsip anti-replay permanen.

### Retensi

Implementasi mempunyai lifecycle evidence 90 hari dari waktu event, tombstone, retry penghapusan, serta legal hold. Namun konfigurasi pilot saat diperiksa:

```text
attendance_evidence.deletion_enabled = false
```

Jadi **jangan menyatakan foto pilot pasti otomatis terhapus setelah 90 hari**. Mekanismenya ada, tetapi penghapusan otomatis belum diaktifkan. Belum ada foto operasional di pilot pada snapshot ini.

### Jaringan putus atau respons tidak jelas

- Kedua jalur memakai kunci idempotensi dan endpoint pemeriksaan status untuk mencegah transaksi ganda karena retry.
- Mandiri mempunyai recovery foto sementara di IndexedDB, terikat identitas user/tenant/employee. Metadata pending disimpan terpisah; ada pembersihan saat ganti identitas dan pembersihan data sementara usang dengan ambang 24 jam.
- Kiosk menyimpan metadata operasi pending di sessionStorage; foto hanya di memori. Setelah reload, foto bisa hilang sehingga tidak selalu bisa langsung mengirim ulang payload yang sama.
- Browser memeriksa apakah server sudah menerima transaksi sebelum meminta tindakan berikutnya.

Ini **pemulihan transaksi yang hasilnya belum pasti**, bukan janji absen offline penuh atau pencatatan jam kerja tanpa koneksi. Jam kejadian resmi tetap waktu server.

## 7. Kondisi aktual Cepat Kopi

### Policy aktif

| Pengaturan | Karangawen | Kaliceret |
| --- | --- | --- |
| Mode presensi | kiosk | kiosk |
| Geofence personal | Wajib; radius 50 m | Wajib; radius 50 m |
| Titik latitude | -7.048339257601575 | -7.108091590922301 |
| Titik longitude | 110.59257932789423 | 110.65293944717297 |
| Toleransi terlambat | 5 menit | 5 menit |
| Jendela masuk | 60 menit sebelum/sesudah jadwal | 60 menit sebelum/sesudah jadwal |
| Batas pengajuan retroaktif | 7 hari | 7 hari |
| Weekly Planner cutover | null | null |
| Kiosk terdaftar | 0 | 0 |

Geofence sudah tersimpan, tetapi tidak membuat kiosk-only berubah menjadi personal/hybrid dan tidak diterapkan ke transaksi kiosk.

### Profil dan akses

| Profil | Penempatan pada waktu snapshot | Akun mandiri tertaut | PIN kiosk |
| --- | --- | --- | --- |
| Intan | Karangawen | Belum | Belum |
| Nejwa | Karangawen | Belum | Belum |
| Nejla | Karangawen | Belum | Belum |
| Salsa | Karangawen | Belum | Belum |
| Adam | Kaliceret | Belum | Belum |
| Vita | Kaliceret | Belum | Belum |
| Rizal | Kaliceret | Belum | Belum |
| Fariz | Kaliceret | Belum | Belum |
| Arya Ajisadda | Kaliceret; perubahan Karangawen sudah dijadwalkan | Sudah, aktif dengan role employee | Belum |

Pembaruan penting terhadap laporan sebelumnya: **Arya sekarang sudah aktif sebagai Karyawan**, bukan revoked lagi. Ini dibuktikan pembacaan state terbaru, bukan disimpulkan dari reset password.

Penempatan Arya berubah dari Kaliceret ke Karangawen pada `2026-11-05 00:00:00 UTC`, yaitu **5 November 2026 pukul 07:00 WIB**. Jadi jangan mengasumsikan efektif sejak pukul 00:00 WIB. Penempatan Intan/Nejwa masih bertanggal mulai 4 November; koreksi historis ke 1 November belum dilakukan dalam pekerjaan ini.

Untuk Arya, service presensi aktual mengembalikan:

```text
eligibility.status       = kiosk_only
selected_outlet_id       = 2 (Kaliceret)
allowed_next_operation   = null
schedule.status          = unscheduled
active_session           = null
```

Dengan demikian penghalang mandiri Arya saat ini **policy**, bukan password yang baru direset.

### Jadwal

- Tiga template shift sudah ada: 08:00–16:00, 11:00–19:00, dan 16:00–22:00 berdasarkan onboarding sebelumnya; jumlah template aktual terkonfirmasi tiga.
- Roster 9–15 November ada untuk kedua Outlet, masing-masing 23 assignment, versi 25, belum diterbitkan.
- `weekly_planner_start_on` kedua Outlet masih null, sehingga resolver belum memakai roster Weekly Planner sebagai sumber jadwal presensi aktif.
- Legacy `weekly_schedule_rules` dan `schedule_exceptions` masing-masing **nol** pada snapshot.
- Untuk Arya hari ini, hasil resolver benar-benar `unscheduled`.
- Keberadaan template shift sendiri tidak sama dengan karyawan telah mempunyai jadwal efektif.

Target operasional 08:00–22:00, dua pagi/dua sore pada weekend, serta klasifikasi permanen/pocokan adalah konteks kebutuhan bisnis. Jangan menganggap semuanya sudah menjadi aturan enforcement presensi. Profil dasar tidak menyimpan klasifikasi tersebut sebagai perbedaan aturan presensi pada mesin yang diperiksa.

### Data operasional

| Record | Jumlah aktual |
| --- | ---: |
| Sesi kehadiran | 0 |
| Event presensi | 0 |
| Evidence foto | 0 |
| Pengajuan persetujuan | 0 |
| Perangkat kiosk | 0 |
| Kode pairing kiosk | 0 |
| PIN karyawan | 0 |
| Kode aktivasi PIN | 0 |

Ini baseline sebelum uji operasional nyata, bukan bukti sistem sudah dipakai rutin oleh karyawan.

## 8. Koreksi dan pengecualian

Sudah ada alur pengajuan karyawan dan Approval Center untuk Owner/Supervisor, termasuk koreksi/review presensi dan finalisasi hasil. Kewenangan mengikuti tenant/Outlet; koreksi mempunyai alasan dan catatan keputusan. Data raw, koreksi, dan hasil efektif perlu dibedakan.

Kondisi tanpa jadwal atau potensi absen memerlukan interpretasi/review. Tidak ada dasar untuk menyamakan setiap flag dengan potongan gaji atau hasil payroll otomatis. Pengujian kebijakan tersebut belum dilakukan dengan data operasional Cepat Kopi.

## 9. Yang sudah dibuktikan dan yang belum

| Pemeriksaan | Status |
| --- | --- |
| Pembacaan policy, perangkat, PIN, profil, penempatan, roster, counts pilot | PASS read-only, 4 Nov 18:29 WIB |
| Lima file inti backend lokal cocok checksum runtime hosting | PASS |
| Source frontend attendance/kiosk/recovery cocok baseline SPA yang dideploy | PASS |
| Tes backend terfokus geofence, attendance engine, kiosk lifecycle, personal eligibility | PASS: 77 tes / 721 assertion, dijalankan pada MySQL lokal terisolasi |
| Tes UI attendance dan kiosk | PASS: 17 tes, setelah mengecualikan direktori arsip output |
| Check-in/check-out nyata delapan karyawan pada pilot | BELUM TERBUKTI |
| Kamera dan GPS nyata di dua lokasi Outlet | BELUM TERBUKTI dalam pemeriksaan ini |
| Kiosk fisik dipairing, PIN, kamera, dan penggunaan bersama | BELUM ADA setup pilot pada snapshot |
| Akurasi batas geofence di ruangan/lokasi nyata | BELUM TERBUKTI |
| Recovery pada HP/tablet dengan jaringan Outlet nyata | BELUM TERBUKTI |
| Cadence cron hPanel terbaru | BELUM DISAKSIKAN dalam pemeriksaan ini |
| Roster Weekly Planner menjadi sumber presensi aktif | BELUM: draft + cutover null |

Percobaan awal tes UI juga menemukan salinan tes pada arsip `output/.../build-workspace`, yang gagal karena dua instance React. Pengujian source yang dimaksud diulang dengan `--exclude 'output/**'` dan seluruh 17 tes lulus. Tidak mengubah aplikasi untuk menutupi hasil tersebut.

Tidak menjalankan seluruh suite. Untuk dokumen ini dilakukan inspeksi source, pembacaan pilot, pencocokan hash, dan tes terfokus; tidak membuat transaksi presensi pada pilot.

## 10. Agenda brainstorming berikutnya

Bagian berikut adalah **pertanyaan keputusan**, bukan perubahan yang sudah disetujui.

| Topik | Keputusan yang perlu diambil | Mengapa berpengaruh |
| --- | --- | --- |
| Jalur utama | Kiosk-only, personal-only, atau hybrid per Outlet? | Menentukan perangkat, onboarding akun, PIN, GPS, dan SOP cadangan |
| Bila kedua jalur tersedia | Bebas berpindah atau ada aturan per karyawan/kejadian? | Mesin sesi bersama; ekspektasi pengguna perlu jelas |
| Titip absen | Seberapa kuat pembuktian identitas yang dibutuhkan? | Foto/PIN/GPS sekarang belum memberi liveness/attestation |
| Lokasi mandiri | Tetap 50 m? Apa SOP jika akurasi GPS buruk? | Akurasi >50 m akan ditolak, termasuk saat checkout |
| Foto personal | Wajib di server juga atau memang opsional? | UI dan konfigurasi enforcement server saat ini berbeda |
| Perangkat kiosk | Siapa memegang tablet, pairing, renewal dan revoke? | Kiosk dipercaya berada di Outlet dan kredensialnya berlaku 30 hari |
| PIN | Siapa membagikan kode aktivasi dan menangani lupa/berbagi PIN? | PIN berbeda dari akun login dan belum disiapkan |
| Tanpa jadwal | Tetap boleh masuk untuk review atau harus ditolak? | Saat ini unscheduled work dapat dicatat jika prasyarat lain terpenuhi |
| Istirahat/double shift | Satu pasangan per hari, beberapa sesi, atau break khusus? | Saat ini satu sesi aktif sekaligus, bukan satu pasangan per hari |
| Lupa pulang | Pengingat, review Supervisor, atau aturan penutupan? | Sesi tidak otomatis selesai hanya karena jam shift berakhir |
| Jaringan bermasalah | SOP manual dan siapa yang boleh mengoreksi? | Recovery idempotensi tidak menggantikan absen offline penuh |
| Retensi dan akses foto | Kapan penghapusan 90 hari diaktifkan, siapa mengakses? | Flag deletion masih false; kebutuhan privasi dan operasional perlu selaras |
| Jadwal dan cutover | Kapan published roster boleh menjadi sumber efektif? | Penerbitan dan aktivasi cutover adalah tindakan terpisah; Gate B masih HOLD |
| Permanen/pocokan | Apakah aturan presensinya sama atau berbeda? | Klasifikasi bisnis belum menjadi pembeda pada mesin presensi ini |

Urutan diskusi yang bisa dipakai: tentukan masalah operasional paling nyata → pilih jalur utama → definisikan verifikasi identitas/lokasi → tentukan pengecualian dan review → baru susun uji perangkat nyata. Tidak ada policy yang diubah sebagai bagian penyusunan dokumen ini.

## 11. Bukti dan sumber

- [Snapshot pilot read-only](/Users/aryaajisadda/Development/hadirinaja/output/attendance-current-state-20261104/pilot-readonly.json).
- [Hasil eligibility Arya dari service hosting](/Users/aryaajisadda/Development/hadirinaja/output/attendance-current-state-20261104/arya-personal-readonly.json).
- [Pencocokan source frontend dengan baseline rilis](/Users/aryaajisadda/Development/hadirinaja/output/attendance-current-state-20261104/frontend-source-comparison.json).
- [Controller presensi](/Users/aryaajisadda/Development/hadirinaja/backend/app/Http/Controllers/Api/V1/AttendanceController.php).
- [Mesin presensi dan geofence](/Users/aryaajisadda/Development/hadirinaja/backend/app/Services/AttendanceService.php).
- [PIN karyawan](/Users/aryaajisadda/Development/hadirinaja/backend/app/Services/EmployeePinService.php).
- [Resolver jadwal](/Users/aryaajisadda/Development/hadirinaja/backend/app/Services/EffectiveScheduleResolver.php).
- [UI mandiri](/Users/aryaajisadda/Development/hadirinaja/src/routes/attendance.tsx) dan [UI kiosk](/Users/aryaajisadda/Development/hadirinaja/src/routes/kiosk.tsx).
- [Kontrak keamanan kiosk](/Users/aryaajisadda/Development/hadirinaja/docs/trusted-kiosk-security.md) dan [lifecycle bukti foto](/Users/aryaajisadda/Development/hadirinaja/docs/photo-evidence-expiration.md).

Dokumen lama merupakan konteks implementasi. Bila berbeda dengan snapshot pilot bertimestamp di atas, snapshot aktual menjadi acuan kondisi operasional pada saat pemeriksaan.
