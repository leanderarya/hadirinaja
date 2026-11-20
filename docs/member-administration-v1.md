# Administrasi keanggotaan V1

Status: implementasi lokal. Belum diterapkan ke pilot atau staging.

## Kontrak Owner

Pada Pengelolaan akses → Lihat akses pengguna, Owner lain yang aktif dapat mengganti seluruh role akun menjadi tepat satu role: Owner, Supervisor, atau Karyawan. Karyawan harus ditautkan ke profil existing dalam organisasi yang sama; Supervisor harus memiliki pilihan Outlet yang eksplisit. Penggantian role melepaskan role, tautan profil, dan lingkup Supervisor sebelumnya tanpa menghapus profil atau riwayatnya. Penempatan Outlet tetap mengikuti profil, bukan diubah oleh role.

Akses yang dicabut atau dinonaktifkan hanya dipulihkan dengan konfirmasi pengaktifan kembali. Undangan yang belum dipakai untuk akun atau profil terpilih dicabut dalam transaksi yang sama. Undangan yang sudah diterima tetap disimpan. Login global, email, password, dan keanggotaan organisasi lain tidak diubah.

Owner harus mengisi alasan dan password miliknya sendiri. Aksi pada keanggotaan sendiri ditolak; organisasi harus mempertahankan Owner aktif. Mutasi dibatasi enam permintaan per menit oleh middleware throttle, selain autentikasi Sanctum, active-tenant, dan no-store yang sudah ada.

## Hapus permanen

Owner dapat menghapus keanggotaan dan profil terpilih yang belum memiliki riwayat. Jika akun sudah tertaut profil, profil tersebut wajib sesuai; jika belum tertaut, Owner harus memilih profil secara eksplisit atau memilih keanggotaan saja. Profil yang tertaut akun lain dan profil lintas organisasi ditolak.

Pemeriksaan mencakup semua FK masuk ke employees/tenant_memberships, termasuk referensi baru pada skema. Hanya tautan role, lingkup Supervisor, dan employee-user link yang boleh dibersihkan. Riwayat penempatan, presensi, jadwal, audit, undangan, dan referensi lainnya menghalangi penghapusan. Audit subject dan penerima undangan juga diperiksa karena sebagian referensinya tidak berupa FK ke keanggotaan. Riwayat tidak dihapus untuk meloloskan pemeriksaan.

Pemeriksaan awal hanya preview. Server memeriksa ulang dalam transaksi dengan kunci tenant, keanggotaan target, dan profil yang dipilih. Konflik FK membatalkan seluruh transaksi. Penghapusan memerlukan alasan, password Owner, pengetikan email target, dan dialog konfirmasi. Akun login global tetap ada sehingga email tetap milik identitas yang sama.

Profil yang dibuat lewat UI normal sudah dapat memiliki audit penciptaan; profil demikian sengaja tidak memenuhi syarat tanpa riwayat. Gunakan nonaktifkan/cabut akses. Perubahan role langsung tersedia terpisah dan tidak mensyaratkan penghapusan riwayat.

## API tambahan

- PUT `/api/v1/management/access/members/{id}/role`: role, employee_id khusus Karyawan, outlet_ids khusus Supervisor, reactivate bila diperlukan, reason, password Owner.
- GET `/api/v1/management/access/members/{id}/permanent-deletion`: optional employee_id; hasil can_delete, blockers, employee_id, global_login_preserved.
- DELETE endpoint yang sama: confirmation_email, optional employee_id, reason, password Owner.

DELETE lama pada `/access/members/{id}` tetap bermakna cabut akses. Tidak ada penghapusan akun global.

## Migrasi dan audit

Migrasi additive `2026_11_04_000001_add_management_change_details` menambah JSON nullable `management_change_events.details`. Baris lama tidak ditulis ulang. Audit tetap append-only; pencatatan baru menyimpan alasan, snapshot sebelum/sesudah, serta ID undangan yang dicabut. Password dan token tidak dimasukkan snapshot. Audit penghapusan menyimpan ID/nama profil sebagai metadata, tanpa FK baru ke objek yang dihapus. Kontrak tampilan audit lama tetap dipertahankan.

Migrasi ini belum dijalankan di hosting. Backend baru memerlukan kolom tersebut sebelum fitur digunakan. Rollback skema di luar database pengujian lokal `hadirinaja_test` ditolak; rollback kode dapat mempertahankan kolom nullable tanpa menghapus audit baru. Pemulihan data yang sudah benar-benar dihapus memerlukan backup, bukan sekadar rollback kode.

## Verifikasi dan batas rilis

Tes backend menggunakan database MySQL lokal `hadirinaja_test` yang dijaga TestCase; tes frontend memakai jsdom dan komponen UI nyata dengan API mock. Hasil dan inventaris SHA256 ada di `output/member-administration-v1-20261104/REPORT.md` serta `manifest.json`.

Uji visual browser, rehearsal hosting/migrasi, dan UAT pilot belum dilakukan. Tidak ada deploy, perubahan database hosting, perubahan akun operasional, commit, atau merge dalam pekerjaan ini. Rilis harus mencakup backend, SPA yang sesuai, serta migrasi additive setelah prosedur backup/recovery yang disetujui. Aktivasi cutover tetap di luar fitur ini.
