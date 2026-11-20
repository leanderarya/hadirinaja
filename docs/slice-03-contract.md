# Slice 03 — kontrak personal attendance dan requests

Catatan discovery read-only sebelum perubahan Slice 03, 24 Oktober 2026.

## Attendance

- `GET /api/v1/attendance/me` dilindungi Sanctum dan active-tenant. Respons sukses mengembalikan identitas employee yang tertaut, outlet dengan assignment efektif saat ini, jadwal hasil resolver, sesi aktif, riwayat, dan `allowed_next_operation`.
- `allowed_next_operation` adalah sinyal server untuk operasi personal berikutnya. Nilainya mempertimbangkan kebijakan attendance mode; check-in juga divalidasi ulang terhadap assignment, policy, jadwal, dan geofence saat POST. Konflik jadwal seperti hari istirahat atau tanpa jadwal dapat dicatat untuk review tanpa memblokir operasi jika policy mengizinkannya.
- Daftar outlet pada status personal hanya memuat assignment yang efektif pada waktu sekarang. Daftar kosong tanpa sesi aktif berarti tidak ada outlet yang bisa dipilih untuk check-in saat ini.
- Policy efektif dapat menunjukkan `attendance_mode` (`personal`, `kiosk`, atau `hybrid`) dan konflik `attendance_policy_missing`. Koordinat geofence tetap dihapus dari snapshot jadwal/riwayat. Field `personal_location.latitude` dan `longitude` hanya memuat titik kebijakan efektif untuk Outlet yang telah diotorisasi pada konteks presensi personal (termasuk Outlet asal sesi aktif).
- Link employee yang hilang saat ini melempar 403 tanpa kode khusus. Membership tenant yang tidak aktif, outlet di luar cakupan, dan mode yang ditolak juga dapat menghasilkan 403 dengan kontrak yang berbeda; status HTTP saja tidak cukup untuk menentukan penyebab.
- Model `Employee` hanya memiliki tenant dan nama. Tidak ada status aktif/nonaktif. Foreign key tenant-aware menjaga link employee tetap dalam tenant.

## Requests

- `GET /api/v1/attendance/me/requests` mengembalikan request milik requester atau identitas employee yang terhubung. Endpoint dapat dipakai tanpa link, tetapi saat ini tidak menjelaskan apakah form boleh diajukan.
- `GET /api/v1/attendance/me/effective` mengembalikan proyeksi personal dan melempar 403 jika link employee tidak ada.
- `POST /api/v1/attendance/me/requests` memerlukan link employee dan role `employee`. Owner dapat tetap memegang role Owner sekaligus Employee.
- Izin/cuti memerlukan rentang tanggal, kategori, alasan, dan assignment yang konsisten bila ada; jadwal hari ini tidak menjadi syarat. Lembur memvalidasi tanggal dan jam lokal, dapat merujuk sesi milik employee, serta mengambil outlet dari assignment pada tanggal yang diajukan. Koreksi memerlukan sesi attendance milik employee.
- Employee tanpa link bukan alasan untuk menyamarkan seluruh halaman sebagai error API. Kegagalan 401, membership, tenant, validasi, atau server harus tetap dibedakan dari eligibility.

## Batas implementasi

- Tambahkan sinyal eligibility terbatas pada endpoint personal yang hanya mengungkap status link/peran milik membership aktif yang sedang login.
- Jangan menambah business rule, kolom status employee, migration, endpoint management, atau perubahan approval workflow.
- Attendance tetap mengikuti `allowed_next_operation`; requests tetap dinilai terpisah dan tidak memakai jadwal hari ini sebagai gate.
- Owner tanpa link mendapat tautan ke `/access`; Supervisor/karyawan diarahkan ke Owner atau administrator. Tidak ada link management untuk non-Owner.
- Pertahankan auth middleware, tenant scope, redaksi koordinat pada riwayat serta otorisasi koordinat konteks aktif, request idempotency, dan record approval/attendance yang sudah ada.

## Implementasi dan verifikasi — 24 Oktober 2026

- `GET /api/v1/attendance/me` sekarang membedakan `employee_link_required`, `employee_unavailable`, dan `employee_role_required`. Ketiganya hanya mengembalikan status dan `employee: null`; detail identitas baru dikirim untuk membership aktif yang memiliki Employee link dan role Employee.
- Operasi personal attendance dan proyeksi efektif menolak membership tanpa role Employee dengan kode `employee_role_required`. `GET /api/v1/attendance/me/requests` mengembalikan `request_access` yang terpisah dari eligibility attendance. Pengajuan menolak identitas atau role yang tidak memenuhi syarat, lalu workflow tetap memeriksa ulang otorisasi di dalam transaksi.
- Tidak ada kolom status aktif Employee di model/schema saat ini, jadi keadaan Employee nonaktif tidak dapat dibedakan dan tidak dibuat-buat. Assignment, jadwal, mode kiosk, policy, serta `allowed_next_operation` tetap ditentukan backend yang ada.
- `php artisan test --filter='PersonalEligibilityTest|ApiAuthenticationNegotiationTest|AccessManagementTest|AttendanceEngineTest'`: 23 test dan 313 assertion lulus. Vitest: 14 test lulus; TypeScript, Biome (7 file), Pint, dan production build lulus. Build menampilkan warning chunk >500 kB dan directive `use client` dari dependency bundler, tetapi proses build berhasil.
- Browser QA memakai login normal dan identitas sintetis lokal untuk Owner tanpa link, Owner+Employee, Employee tertaut, Employee tanpa assignment, dan kiosk-only. Validasi request yang gagal tidak membuat record. Kegagalan API sementara dan active-membership conflict diuji dengan route mock browser.
- Screenshot sintetis untuk review Owner disimpan di `output/playwright/`. Fixture lokal tidak membuat attendance session atau request berhasil. Setelah QA, akun uji dinonaktifkan lewat akses membership dan kredensialnya dirotasi; data serta audit dipertahankan.
- Slice 03 tidak menambahkan migration dan tidak mengubah data production. Akses langsung non-Owner ke route `/access` masih menampilkan shell UI yang ada, tetapi API management menolaknya dengan 403 dan tidak mengungkap data management; isu shell route ini di luar scope Slice 03.

## Gate geofence V1

- Presensi personal dengan validasi lokasi wajib ditolak HTTP 422 jika GPS hilang, izin ditolak, koordinat invalid, akurasi tidak memadai, atau titik/radius belum valid. Penolakan tidak membuat/mengubah sesi, event, bukti, ataupun pemilik sesi aktif. Metadata idempotensi menyimpan hasil penolakan agar retry konsisten.
- Jarak memakai Haversine dengan radius bumi 6.371.000 m. Batas inklusif; toleransi numerik 0,0000001 m hanya menutup error floating point. Koordinat/akurasi divalidasi sebelum pembulatan penyimpanan.
- Ambang akurasi existing dipertahankan: akurasi harus positif dan tidak melebihi radius Outlet; tidak ada ambang tetap 20/30 m baru atau tambahan radius berdasarkan akurasi.
- Jalur kiosk tetap mengikuti perangkat terpasang, PIN, dan foto baru; `personal_location_validation` tidak diterapkan ke kiosk. Checkout personal terhadap sesi asal kiosk tetap wajib lolos validasi lokasi jika mode hybrid mengizinkannya. Koreksi administratif tetap melalui workflow approval existing.
- Peta Leaflet dimuat dalam effect React pada client, dibersihkan saat unmount, dan disesuaikan saat ukuran berubah. Marker/radius Owner adalah draft; penyimpanan mengikuti versi policy bertanggal existing. GPS Employee diminta melalui tindakan pengguna dan diperbarui kembali sebelum presensi.
- Tile default adalah OpenStreetMap dengan attribution terlihat. Provider dapat diatur melalui `VITE_MAP_TILE_URL` dan `VITE_MAP_TILE_ATTRIBUTION`; custom provider tanpa attribution tidak dimuat. Kegagalan tile tidak mengubah keputusan geofence server.
