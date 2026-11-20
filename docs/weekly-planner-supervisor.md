# Weekly Planner Supervisor — Phase 3

## Perilaku

Semua publikasi planner baru memerlukan konfigurasi staffing. Klarifikasi Owner: aplikasi belum dipakai dan belum ada jadwal operasional existing; tidak ada pengecualian untuk melewati pemeriksaan staffing pada publikasi baru. Kode legacy dipertahankan untuk kompatibilitas dan regresi.

Di `/scheduling`, Owner dan Supervisor sesuai scope dapat:

1. Memilih Outlet dan minggu Senin–Minggu.
2. Memetakan versi shift organisasi: pagi 08.00–16.00, tengah 11.00–19.00, sore 16.00–22.00. UI menawarkan versi yang sudah berlaku pada awal minggu. Owner menyiapkan template melalui halaman existing; Supervisor tidak membuat template baru.
3. Menambah/mengubah/menghapus penugasan melalui modal, dengan alasan wajib. Mengubah satu entri mempertahankan identitas Employee; penugasan orang lain ditambahkan secara eksplisit.
4. Menyalin salah satu dari 12 minggu published sebelumnya pada Outlet yang sama. Konfigurasi ikut diwarisi, seluruh isi draf diganti, dan assignment target divalidasi ulang. Sumber published tetap tersimpan. Tidak ada baseline berstatus “disetujui” yang diasumsikan dari data legacy.
5. Memeriksa seluruh assignment dan konflik, lalu membaca daftar kekurangan staf sebelum publikasi manual. Kekurangan diperbolehkan setelah diakui; assignment invalid, konflik, shift tengah akhir pekan, serta versi stale tetap ditolak.

Target server bersifat tetap: Senin–Jumat masing-masing 1 pagi, 1 tengah, 1 sore; Sabtu–Minggu masing-masing 2 pagi dan 2 sore. Coverage dihitung dari Employee unik per hari pada versi shift yang dipetakan. Shift lain yang valid pada core tidak diberi kredit coverage target; validasi interval/assignment core tetap berlaku. Shift tengah 11.00–19.00 dilarang pada akhir pekan, termasuk versi yang tidak dipetakan.

Semua publikasi dari UI ini menghilangkan flag cutover. Publikasi menyiapkan revisi; aktivasi Outlet sebagai sumber absensi tetap merupakan langkah Owner terpisah. Tidak ada cutover pilot/staging dalam pekerjaan ini. Draft tidak mengubah jadwal efektif, Employee views, laporan operasional, atau snapshot absensi. Audit management tetap mencatat perubahan draf.

## API/schema tambahan

Migrasi additive `2026_11_02_000002_add_planner_staffing.php` menambah dua JSON nullable pada `schedule_revisions`: `staffing` dan `publication_warnings`. Tidak ada backfill jadwal atau perubahan snapshot published lama.

Prefix existing: `/api/v1/management/scheduling/planner/outlets/{outlet}/weeks/{weekStart}`.

- GET: tambahan metadata Outlet/cutover, Employee dengan assignment pada minggu tersebut, daftar minggu sumber published, konfigurasi staffing, serta report coverage/defisit.
- PUT `/draft`: field `staffing` memetakan `morning`, `middle`, `evening` ke ID versi shift tenant aktif. Draf boleh belum dikonfigurasi; validasi/publikasi tidak boleh. Field yang dihilangkan mewarisi konfigurasi existing; nilai null/kosong tidak dapat dipakai untuk menonaktifkan konfigurasi.
- POST `/validate`: tambahan `staffing_report` berisi counts, targets, deficits, conflicts dan checksum.
- POST `/publish`: tambahan `warnings_checksum`. Jika ada defisit, checksum hasil server pada versi terkini wajib cocok. Server menghitung ulang sebelum commit dan menyimpan snapshot warning serta bukti pengakuan pada audit.
- POST `/copy`: `expected_version`, `source_week_start`, `source_revision_id`, `reason`, dan konfigurasi staffing opsional. Hanya published source pada Outlet yang sama dan minggu sebelumnya; sumber stale ditolak. Menghasilkan draf saja.

Copy menggunakan save core dalam transaksi yang sama, dengan operasi idempotensi internal dan eksternal. Retry copy tidak membuat revisi/entri/audit tambahan. Otorisasi tetap diperiksa ulang sebelum replay. Tidak ada endpoint persetujuan Owner, Employee swap atau notification delivery baru.

## UX dan recovery

Board tujuh hari menampilkan coverage per shift; editor hanya dibuka saat diperlukan. UI Kit menggunakan komponen Board yang sama, dengan demo kosong tanpa identitas atau jadwal bisnis rekaan.

Pindah Outlet/minggu membuat konteks komponen baru. Respons konteks lama diabaikan. Saat editor/request aktif, kontrol konteks dinonaktifkan. Navigasi dengan perubahan yang belum disimpan memakai guard existing.

Respons 409 memblokir mutasi sampai pengguna memuat versi terbaru. Jika hasil jaringan belum pasti, perubahan baru diblokir dan tombol pemeriksaan mengulang payload dengan Idempotency-Key yang sama. Backend tetap menjadi sumber validasi; client tidak menghitung checksum sendiri.

## Batas dan rollback

Hanya lingkungan lokal dan database disposable `hadirinaja_test` digunakan. Identitas QA adalah fixture sintetis, bukan data tim nyata. Provisioning fixture tidak dihitung sebagai acceptance onboarding; bukti integrasi berasal dari aksi UI, request Laravel nyata, dan snapshot database.

Sebelum mengaktifkan UI ini di lingkungan lain, migrasi schema harus tersedia dan target terverifikasi. Rilis backend Phase 2 lama tidak menegakkan warning staffing; rollback demikian memerlukan penghentian write planner agar aturan baru tidak dilewati. JSON warning/audit/history tidak boleh dihapus sebagai rollback. Batas cutover Phase 2 tetap berlaku: resolver legacy-only tidak aman setelah cutover.

Tidak ada Employee swap, reminder, notification delivery, baseline-approval workflow, deployment, atau aktivasi Outlet nyata. Pengujian responsive adalah emulasi browser desktop; perangkat fisik dan penerimaan UX final Owner tidak diklaim.
