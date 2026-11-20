# Standar UX Writing HadirinAja

Pedoman ini menyamakan istilah, status, dan instruksi untuk Owner, Supervisor, Karyawan, serta pengguna kiosk. Terapkan pada halaman, dialog, formulir, bantuan kontekstual, notifikasi, dan nama aksesibel.

## Glosarium

| Konsep | Istilah UI | Pedoman |
| --- | --- | --- |
| Tenant | Organisasi | Gunakan untuk organisasi aktif dan pilihan organisasi. Jangan tampilkan istilah internal `tenant`. |
| Business unit | Unit bisnis | Tingkat organisasi di atas Outlet. |
| Outlet | Outlet | Pertahankan istilah domain ini. Jangan ganti dengan “cabang” atau “lokasi” jika yang dimaksud adalah unit operasional. |
| Owner, Supervisor | Owner, Supervisor | Gunakan nama peran resmi. Sebut “pengelola yang berwenang” jika peran tertentu tidak perlu dijelaskan. |
| Employee | Karyawan | Bedakan profil karyawan dari akun pengguna. |
| Access scope | Outlet yang dapat Anda akses | Jelaskan hak yang berlaku dengan kata konkret. Gunakan “cakupan” hanya saat membahas konfigurasi akses itu sendiri. |
| Attendance action/event | Presensi | Gunakan untuk tindakan dan catatan masuk/keluar, misalnya “Catat presensi masuk”. |
| Attendance result/report | Kehadiran | Gunakan untuk hasil, ringkasan, dan laporan, misalnya “Hasil kehadiran”. |
| Attendance session | Sesi presensi | Gunakan untuk rentang sesi dari catatan masuk sampai keluar. |
| Work date | Tanggal kerja | Tanggal kerja mengikuti jadwal dan zona waktu lokal Outlet. |
| Audit/effective date-time | Waktu audit / tanggal efektif (UTC) | Sebut UTC pada konteks audit dan perubahan bertanggal. Jangan samakan dengan tanggal kerja lokal Outlet. |
| Request | Permintaan | Gunakan untuk pengajuan cuti/izin, lembur, atau koreksi. |
| Approval/decision | Persetujuan / keputusan | Gunakan “Menunggu persetujuan” sebelum ada keputusan, lalu “Disetujui” atau “Ditolak”. |
| Attendance review case | Tinjauan presensi | Bedakan pemeriksaan kasus dari persetujuan permintaan. Gunakan “Menunggu tinjauan” atau “Sudah ditinjau”. |
| Local unsaved edits | Draf | Draf berada di editor dan belum dikirim atau disimpan ke server. |
| Computed attendance result | Pratinjau hasil kehadiran | Hasil yang dihitung dari presensi, jadwal, koreksi, dan tinjauan sebelum ditetapkan. Hindari istilah internal “proyeksi”. |
| Audited attendance finalization | Penetapan hasil kehadiran | Gunakan “Tetapkan hasil” untuk tindakan dan “Hasil ditetapkan” setelah berhasil. Penetapan menyimpan hasil, alasan, dan revisi audit; koreksi independen yang disetujui dapat menghasilkan penetapan berikutnya. Hindari istilah internal “finalisasi”. |
| Calendar version | Perubahan kalender | Gunakan “Jadwalkan perubahan” dan “Riwayat perubahan”. Tampilkan tanggal mulai efektif dalam UTC dan ID perubahan bila diperlukan untuk audit. Jangan menyebut perubahan sebagai “versi” di UI. |
| Calendar date exception | Status Outlet untuk tanggal tertentu | Gunakan “Atur status” atau “Terapkan status”. Status hanya berlaku pada tanggal yang dipilih. |
| Holiday reference | Referensi hari libur | Tegaskan bahwa referensi hari libur hanya catatan dan tidak otomatis menutup Outlet. |
| Kiosk | Kiosk | Pertahankan istilah produk. Gunakan “perangkat kiosk” untuk pemasangan dan akses. |

## Pedoman microcopy

1. Tulis ringkas, langsung, dan dalam bentuk kalimat. Hapus kalimat yang mengulang judul atau status yang sudah terlihat.
2. Gunakan kapitalisasi kalimat. Pertahankan huruf kapital untuk nama peran dan istilah domain yang dipakai produk: Owner, Supervisor, Karyawan, Organisasi, Outlet, dan Kiosk.
3. Tulis tombol dengan kata kerja dan objek. Contoh: “Ajukan permintaan”, “Tinjau perubahan”, “Jadwalkan perubahan”, “Tetapkan hasil”, dan “Cabut akses perangkat”. Hindari label umum jika ada tindakan yang lebih spesifik.
4. Bedakan draf, pengajuan, tinjauan, penjadwalan, dan penyimpanan. Gunakan “tersimpan” hanya setelah server mengonfirmasi penyimpanan. Gunakan “dijadwalkan” untuk perubahan bertanggal yang sudah diterima.
5. Bedakan “Menunggu persetujuan” dari “Menunggu tinjauan”. Setelah tinjauan ketidakhadiran diterima, jelaskan bahwa hasil masih menunggu penetapan.
6. Gunakan konfirmasi yang menyebut objek dan dampak. Untuk perubahan kalender, tampilkan tanggal UTC. Untuk status satu tanggal, tegaskan tanggal berlakunya. Referensi libur tidak menutup Outlet otomatis.
7. Bedakan pembatalan dari penghapusan. Sebutkan apa yang tetap tersimpan dan apa yang tidak dapat digunakan lagi.
8. Untuk hasil mutasi yang belum pasti, minta pengguna memeriksa status terbaru. Jangan sarankan mengirim ulang tindakan yang mungkin sudah diterima. Tombol “Coba lagi” hanya untuk pemuatan data yang gagal.
9. Tampilkan akses dan konsekuensinya dengan jelas. Gunakan “Outlet yang dapat Anda akses” untuk hasil yang dibatasi izin; gunakan “hak akses” untuk aturan izin; hindari frasa kabur seperti “sesuai cakupan”.
10. Pertahankan informasi yang memengaruhi keputusan: Outlet, tanggal efektif, zona waktu, batas pengajuan, sumber kebijakan, dampak persetujuan, dan peringatan keamanan.
11. Pertahankan istilah teknis hanya jika membantu tindakan atau diagnosis. Contohnya API, HTTP, UTC, dan nama zona waktu lokal pada halaman koneksi atau informasi teknis. Hindari istilah implementasi seperti `payload`, `metadata`, `IANA`, `scope`, dan `override` di teks umum.
12. Label visual dan nama aksesibel harus menjelaskan tindakan atau objek yang sama. Label ikon tanpa teks harus tetap spesifik dalam Bahasa Indonesia; status penting tidak boleh hanya dibedakan lewat warna.
13. Pertahankan makna nilai yang dikenal. Jangan menebak arti enum baru atau ringkasan audit yang dibuat sumber data. Catat untuk klarifikasi bila makna bisnis belum dapat dipastikan.

## Cakupan route dan state yang ditinjau

Audit meliputi teks pada state muat, kosong, berhasil, gagal, validasi, akses terbatas, konfirmasi, dan pemulihan yang tersedia di tiap alur. State yang tidak dapat dicapai tanpa respons API dicatat sebagai kebutuhan fixture untuk QA browser.

| Route aktif | State dan alur yang ditinjau |
| --- | --- |
| `/` | Pemeriksaan sesi; arahkan ke alur masuk atau halaman sesuai konteks. |
| `/login` | Pemeriksaan akun, kredensial tidak cocok, kirim formulir, dan kegagalan masuk. |
| `/activate` | Tautan tidak lengkap, undangan aktif/kedaluwarsa/dicabut/terpakai, aktivasi akun, dan penerimaan undangan. |
| `/select-tenant` | Memuat, daftar organisasi, daftar kosong, ganti organisasi, dan kegagalan pemuatan/pergantian. |
| `/attendance` | Data siap/kosong/tidak tersedia; presensi masuk/keluar; izin kamera/lokasi; hasil operasi belum pasti; permintaan dan riwayat. |
| `/requests` | Daftar kosong; formulir dan validasi; permintaan menunggu/disetujui/ditolak/dibatalkan; riwayat tidak tersedia; pembatalan. |
| `/scheduling` | Jadwal mingguan; penugasan dan pengecualian tanggal; kalender buka/tutup; referensi libur; perubahan kalender terjadwal dan riwayat; akses Owner/Supervisor; konfirmasi dan pemulihan. |
| `/workspace` | Tim kosong/terfilter; buat dan ubah profil; penempatan; perangkat kiosk; kode satu kali; hasil perubahan belum pasti. |
| `/access` | Undangan dan tautan satu kali; akses Outlet; aktivasi/nonaktifkan/cabut akses; batalkan/terbitkan ulang undangan; konfirmasi dan kegagalan. |
| `/approvals` | Antrean permintaan/tinjauan; hasil kosong; rincian dan bukti sesuai izin; keputusan; pratinjau hasil kehadiran; konflik; penetapan hasil dan revisi audit. |
| `/reports` | Filter tanggal dan organisasi; metrik; tindak lanjut; data kosong, memuat, dan gagal. |
| `/reports/attendance` | Filter, daftar, pagination, status hasil, rincian baris, ekspor, tinjauan, penetapan hasil, dan konteks zona waktu. |
| `/reports/audit` | Filter UTC, sumber aktivitas, pagination, rincian audit, pembatasan data sensitif, dan kegagalan pemuatan. |
| `/settings` | Pengaturan Owner/Supervisor; Outlet tidak tersedia; navigasi; kegagalan pemuatan dan akses terbatas. |
| `/settings/organization` | Struktur organisasi; pencarian dan hasil kosong; buat/ubah unit atau Outlet; konfirmasi draf; tampilan hanya baca. |
| `/settings/shift-templates` | Daftar kosong; pilihan awal dan deep link; pencarian; editor; pratinjau revisi; simpan, konfirmasi, dan pemulihan draf. |
| `/settings/attendance-policy` | Pilih Outlet; nilai organisasi/Outlet; warisan dan nilai khusus; tanggal efektif UTC; editor/tinjauan; draf; izin Supervisor; kegagalan dan hasil simpan belum pasti. |
| `/settings/outlet-calendar` | Kalender Outlet; status harian; referensi libur; dialog status tanggal; jadwalkan perubahan kalender; riwayat; baca saja; kegagalan dan pemulihan. |
| `/settings/kiosk-devices` | Perangkat terdaftar/tidak tersedia; pemasangan; pembuatan PIN; cabut akses; kode dan data akses yang hanya dapat ditampilkan sekali. |
| `/kiosk` | Memuat, belum dipasangkan, siap/dicabut; PIN; kamera; presensi masuk/keluar; ditolak atau hasil belum pasti. |
| `/api-health` | Pemeriksaan awal; API dan database sehat/tidak sehat; respons browser tidak valid; rincian HTTP untuk diagnosis. |

Rute `/dashboard-1`–`/dashboard-3` dan `/ui-kit` adalah showcase pengembangan, bukan pengalaman produk aktif. Teks demonstrasi dan komponen marketing yang hanya dipakai oleh showcase tidak termasuk audit produk.

## Semantik bisnis yang sudah diverifikasi

| Konsep | Makna yang dipertahankan pada UI |
| --- | --- |
| Kalender Outlet | Perubahan terjadwal berlaku mulai tanggal UTC. Status untuk satu tanggal mengikuti tanggal lokal Outlet. Referensi hari libur hanya catatan dan tidak otomatis menutup Outlet. |
| Kebijakan presensi | Kebijakan organisasi menjadi nilai dasar. Pengaturan Outlet mengganti nilai terkait; nilai lain tetap mengikuti organisasi. Tanggal efektif menggunakan UTC. |
| Tanggal kerja | Tanggal kerja mengikuti jadwal dan zona waktu Outlet, bukan waktu audit UTC. |
| Koreksi presensi | Waktu asli tetap tersimpan sebagai catatan sumber. Koreksi yang disetujui mengubah hasil efektif dan tidak menghapus sesi asli. |
| Penetapan hasil kehadiran | Keputusan disimpan sebagai revisi audit. Riwayat lama tetap tersedia; tindakan baru mengikuti syarat peninjauan dan persetujuan yang berlaku. |
| Nama zona waktu | Identitas seperti `Asia/Jakarta` ditampilkan persis pada konteks waktunya. |

## Ambiguitas yang belum diselesaikan

| Data atau teks | Batas saat ini | Tindak lanjut |
| --- | --- | --- |
| Enum status atau hasil baru yang belum dikenal | Nama enum tidak cukup untuk memastikan makna bisnis. UI mempertahankan nilai sumber dengan format ringan. | Minta definisi dan contoh transisi dari pemilik API sebelum menambah label. |
| Ringkasan, tindakan, dan alasan audit dari sumber | Terjemahan tebakan dapat mengubah kronologi atau arti tindakan. | Tetapkan kamus per sumber bersama pemilik domain/API, lalu lokalisasi pada lapisan presentasi. |

## Pola status

| Keadaan | Pola |
| --- | --- |
| Memuat | “Memuat [data]…” |
| Kosong | “Belum ada [data].” |
| Gagal memuat | “[Data] belum dapat dimuat. Coba lagi.” |
| Tidak berizin | “Akses ke [objek] tidak tersedia untuk akun Anda.” |
| Draf | “Perubahan belum disimpan. Tetap di editor atau buang draf untuk melanjutkan.” |
| Tersimpan | “[Perubahan] tersimpan.” Gunakan setelah server mengonfirmasi penyimpanan. |
| Dijadwalkan | “[Perubahan] dijadwalkan mulai [tanggal] (UTC).” Gunakan setelah server mengonfirmasi penjadwalan. |
| Hasil mutasi belum pasti | “Hasil belum dapat dipastikan. Periksa status terbaru sebelum membuat perubahan lain.” |
