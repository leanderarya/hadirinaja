# HadirinAja — Rencana internal pilot

**2 November 2026 · PREPARED / BELUM AKTIF.** Pilot hanya untuk tim internal Owner yang diundang. Dokumen ini tidak mengizinkan akses real-user, DNS, deployment atau pengisian data karyawan nyata. UX B3 C/B3 D telah diterima Owner; penerimaan itu tidak meliputi readiness operasional atau semua modul V1.

## Isolasi yang diusulkan

| Lapisan | Rencana | Guard sebelum penulisan |
|---|---|---|
| URL | `https://hadirinaja-pilot.cahayaarkana.site` | Usulan, belum resolve dari client pemeriksaan. Verifikasi parent-zone, semua record/wildcard, dependency hostname, target IP hPanel dan document root sebelum meminta persetujuan DNS baru. Jangan repurpose staging. |
| Public root | `~/domains/hadirinaja-pilot.cahayaarkana.site/public_html` | Root tersebut belum ada pada inspeksi; absennya folder bukan bukti vhost/hostname tidak digunakan. Gunakan vhost baru terisolasi. |
| Laravel | `~/hadirinaja-pilot/app` | Private root baru, parent700, `.env`600; hanya static shell/assets dan PHP entry point di public. Tidak symlink storage ke public atau ke staging. |
| Database | DB baru bersuffix `_hajpilot1102` dan user scoped khusus | Nama lengkap/final belum dibuat; periksa kapasitas/privilege MariaDB. Assert DATABASE()/CURRENT_USER()/environment/root dan DB kosong sebelum forward migration. Tidak copy dump/seed QA. |
| Secrets/session | APP_KEY baru, kredensial DB sendiri, cookie `hadirinaja_pilot_session`, host-only | Dibuat hanya setelah otorisasi provisioning. Jangan clone `.env`/APP_KEY/password/kiosk cookie staging. SESSION_DOMAIN=null, secure/HttpOnly, SameSite=lax. XSRF cookie tetap readable oleh client sesuai Sanctum. |
| Runtime | Static SPA, Laravel sole backend, PHP83 web+CLI | CLI eksplisit `/opt/alt/php83/usr/bin/php`; web handler diverifikasi per vhost. Pertahankan default PHP account. Tidak menjalankan Node application server. |
| Routing | Same-origin `/api`, `/sanctum` ke Laravel; SPA fallback hanya HTML GET/HEAD tanpa ekstensi | Paket candidate mengganti `.htaccess` frontend generik dengan template same-origin dan private `index.php`. Missing assets/API tetap404; rahasia403/404. Uji di pilot sebenarnya sebelum akses dibuka. |
| Schedule | Job baru khusus path pilot, bukan edit job staging | Setelah approval: `* * * * * /opt/alt/php83/usr/bin/php "$HOME/hadirinaja-pilot/app/artisan" schedule:run >> "$HOME/hadirinaja-pilot/scheduler.log" 2>&1`. Ini contoh konfigurasi, belum dipasang. |
| Queue/mail/evidence | Queue sync, invitation dibagikan manual, private JPEG dan kebijakan evidence existing | Tidak menambah worker daemon/email provider. Jangan mengubah photo requirements, retention/deletion, geofence, accuracy atau kiosk exception secara diam-diam. |

Isolasi ini logis pada shared hosting: filesystem UID, resource dan account compromise tetap satu failure domain. Directory700 tidak melindungi dari proses website lain dengan UID yang sama. Tidak mengklaim sandbox OS independen.

## Rencana resource dan batas pilot

hPanel saat pemeriksaan:25 GB account, terpakai1.79 GB; inode126329/400000; CPU average6%, memory average20 MB. Ini agregat account dan snapshot, bukan resource yang dijamin untuk HadirinAja atau load test. Limit website/database, kapasitas membuat DB/user baru, web PHP handler dan quota per DB **belum diverifikasi untuk pilot**; hentikan provisioning jika tidak cukup. Jangan upgrade/boost atau membersihkan website lain.

Usulan cohort awal maksimum10 user internal,1 Outlet,1 kiosk,5 hari kerja; Owner harus menetapkan angka dan periode final. Tidak menambahkan cap baru ke source. Operator memantau jumlah undangan dan pertumbuhan harian. Untuk10 orang×2 event×30 hari×200 KB foto, skenario sekitar120 MB/bulan; bukan ukuran produksi terukur. Pada maksimum encoded5 MiB/event, skenario600 event mencapai~3 GiB tanpa backup. Archive snapshot/restore/spool membuat kebutuhan lebih besar; cadangkan minimal5 GB free account sebelum rehearsal kecil dan hitung actual app+DB+files serta2×spool+reserve. Angka5 GB adalah ambang usulan, bukan jaminan cukup untuk semua retensi. Pause intake pada85% disk/inode atau growth tak terkendali, review pada70%; jangan auto-delete evidence.

## Onboarding Owner dan tim — hanya dijalankan setelah approval

1. **Owner awal:** operator memverifikasi DB pilot baru kosong dan config benar; jalankan `hadirinaja:bootstrap-owner` memakai PHP83 secara interaktif. Owner memasukkan identitas/password sendiri melalui kanal privat, bukan argumen/log/chat. Command menolak tenant existing; jangan menggunakan command development provisioning atau seed demo. Rehearsal sebelum aktivasi memakai identitas synthetic saja.
2. **Organisasi/Outlet:** Owner membuka Settings → Organisasi (`/settings/organization`); buat BU/Outlet, tentukan timezone, lokasi marker Leaflet dan radius dalam meter sesuai lokasi yang diotorisasi. Simpan/reload, pastikan koordinat/radius persisted; jangan menggunakan koordinat QA staging atau melonggarkan radius agar GPS gagal lolos.
3. **Kalender/kebijakan/shift:** gunakan `/settings/outlet-calendar`, policy dan scheduling existing; cek effective date, timezone, version dan exception sebelum penugasan. Persetujuan UX B3 C bukan izin mengubah business rules. Tautkan employee ke Outlet dengan tanggal berlaku yang benar.
4. **Undangan:** daftar internal yang disetujui Owner menjadi allowlist prosedural. Buat profil employee, primary Outlet assignment dan invitation melalui `/access`; employee role ditautkan employee yang tepat, Supervisor hanya Outlet eksplisit. Tidak memberi semua anggota Owner. Link aktivasi dibagikan satu per satu melalui kanal privat yang disetujui; token tidak masuk spreadsheet, screenshot, URL laporan atau log operasional.
5. **Aktivasi/login:** pengguna membuka `/activate` melalui link undangan, menetapkan password, lalu login; existing user harus login sebagai identitas yang diundang sebelum accept. Token single-use/expiry default24 jam. Owner cancel/reissue bila salah penerima/expired. Tidak ada pendaftaran publik atau undangan yang disebar umum. Operator memeriksa pending/active/revoked dan membatalkan undangan tidak terpakai.
6. **Employee personal:** `/attendance`, pilih Outlet berhak; izinkan native location, periksa marker/accuracy/eligibility. Missing/invalid/outside/insufficient accuracy ditolak server tanpa attendance. Jangan mengedit GPS/mock location atau menganggap consent browser membuktikan posisi fisik. Ikuti photo requirement yang sudah berlaku; jangan menjanjikan kewajiban foto personal baru.
7. **Kiosk:** Owner membuka `/settings/kiosk-devices`, pilih Outlet, issue pairing code lalu masukkan di `/kiosk` pada perangkat yang dimiliki tim. Jangan menyalin credential ke perangkat lain. Pairing harus short-lived/single-use; PIN employee/camera dan validasi attendance tetap berlaku. No-GPS hanya untuk device yang server verifikasi trusted dan Outlet-bound; bukan bypass personal. Credential maksimum30 hari; renew sebelum expiry melalui Owner, lalu buktikan credential lama403. Revoke saat hilang, dipindahkan Outlet, offboarding atau pilot berakhir. Uji renew/revoke dengan synthetic device sebelum dipakai nyata.
8. **Review harian:** Supervisor memeriksa presensi, exception dan reports di Outlet scope. Owner membandingkan laporan dengan attendance/evidence dan jurnal fallback; tidak memperbaiki data langsung lewat SQL. Dokumentasikan masalah tanpa foto, GPS, PIN atau password di issue umum.

Invitation-only adalah kontrol akun, bukan firewall privat: halaman login dapat diakses publik dan user valid bisa membagikan password. Tidak ada penambahan IP allowlist/SSO/MFA/restriction baru yang diklaim pada task ini. Owner harus menerima residual risk atau meminta kontrol tambahan terpisah.

## Baseline, restore dan fallback

**Baseline pilot belum dapat dibuat karena pilot belum diprovision.** Setelah resource dan rehearsal synthetic diotorisasi, ambil recovery set di kondisi tenang: release/config manifest, forward migration state, paired database/private files, audit/revocation state, timestampUTC dan envelope APP_KEY. Tidak copy QA accounts, attendance, PIN, pairing codes, sessions atau evidence dari staging ke pilot. Rehearsal synthetic berada pada DB disposable terpisah; DB pilot final dimulai fresh tanpa seed QA, kemudian bootstrap Owner hanya saat akses nyata disetujui. Bedakan baseline schema sebelum user dengan baseline onboarding yang kelak mengandung rahasia/data nyata.

Restore hanya ke DB/user/root **baru kosong**; assert identity/empty, restore paired set, cocokkan schema/data/hash/evidence, uji login/tenant/revoked/expired credentials dan scoped evidence. Jangan reset database rehearsal existing atau staging. Snapshot lama dapat menghidupkan kembali kiosk revocation/session/membership lama; reconciliate ledger terbaru atau tetap quarantine sampai keputusan Owner. Jangan reset absolute credential expiry. Gunakan UTC pada koneksi baru sejak awal, preserve timestamp/work_date/timezone semantics.

Bukti saat persiapan: restore schema lokal MySQL disposable50 tabel/trigger definitions lulus; berisi migration baseline,0 evidence. **Bukan full restore MariaDB pilot atau evidence recovery.** Baseline storage account saja tidak melindungi kehilangan account. Off-host backup tetap dilarang pada task ini; sebelum pilot nyata, Owner harus menyetujui residual shared-account/local-only recovery secara eksplisit atau mengotorisasi solusi backup independen melalui task terpisah. Ini tidak mencabut gate NO-GO produksi.

**Fallback manual tanpa bypass:** gunakan kertas/jurnal lokal terbatas, format [CSV header kosong](../output/internal-pilot-preparation-20261102/manual-attendance-fallback.csv). Catat internal code, Outlet, tanggal/timezone, jam nyata, incident reference dan acknowledgment employee+Supervisor. Tanpa PIN/password/GPS/foto. Pisahkan planned shift dari observed attendance. Owner menentukan kustodi, akses dan retensi sebelum penggunaan nyata; jangan isi data nyata di repo atau mengirim ke layanan eksternal.

Jika request timeout setelah submit, periksa status personal/session di server sebelum retry; gunakan retry existing, jangan membuat check-in baru berkali-kali. Jika server tidak dapat dibaca, tandai hasil unknown di jurnal; jangan klaim gagal pasti atau menggunakan kiosk palsu. Saat pulih, rekonsiliasi dengan server untuk mencegah duplikasi. Endpoint koreksi existing membutuhkan attendance session existing; jurnal untuk sesi yang sama sekali tidak pernah tercatat **tidak otomatis bisa diimpor/backdate**. Owner review sebagai catatan operasional terpisah; tidak menambah API, bulk import atau SQL patch. Mode manual bukan alasan menerima GPS invalid.

## Rollback/pause pilot

Deklarasikan incident dan waktuUTC, hentikan undangan serta penggunaan pilot, aktifkan fallback setelah operator mengonfirmasi scope. Bila diperlukan dan diotorisasi, maintenance **hanya pilot**, nonaktifkan hanya cron pilot yang baru, batalkan pending invitations dan revoke device melalui workflow resmi. Jangan mematikan shared cron/PHP atau staging.

Untuk frontend, pulihkan shell/asset dari manifest baseline pilot dan verifikasi routing/cache/auth; jangan rollback DB hanya karena JS gagal. Bila ada attendance ambigu, preserve logs/data dan reconcile sebelum retry. Restore database hanya sebagai keputusan recovery terpisah ke target baru kosong dengan rekonsiliasi revocation, bukan overwrite database aktif atau down migration. Tetap simpan audit/evidence; tidak menghapus root, database, DNS atau backup sebagai cleanup otomatis. Pastikan health dan resource website lain tidak berubah. Owner memutuskan re-open setelah scope, fix dan verifikasi tertulis.

## Prasyarat go-live yang harus semuanya ditutup

- [ ] Owner menyetujui hostname/resource provisioning dan perubahan DNS spesifik, tanpa mengubah record lain; kepemilikan/isolasi/slot database/website/kuota terbukti.
- [ ] Pilot root, fresh DB/user/APP_KEY/cookies/private evidence dan PHP83 web+cron terpasang terpisah dengan authorization baru; tidak ada QA data.
- [ ] Candidate manifest dipin, HTTPS valid, HTTP redirect, SPA/API/asset routing, CSRF/secure cookies dan no-public-registration POST checks terbukti pada pilot.
- [ ] Rehearsal synthetic isolated melalui HTTPS pilot-equivalent: login, tenant isolation, native GPS success/reject/no-record, kiosk expiry/renew/revoke, camera/permission, protected evidence dan cron cadence PASS. Hardware yang belum diuji tetap NOT TESTED.
- [ ] Baseline dan paired-file restore ke resource disposable baru di MariaDB terbukti, APP_KEY recovery/kiosk revocation/timestamp diperiksa; RPO/RTO dan custody dipilih Owner.
- [ ] Operator primer/cadangan, manual fallback, jam review, incident escalation, batas cohort/periode dan kriteria pause disetujui; cek harian backup age/health/disk/inode ditugaskan. External monitor belum diaktifkan.
- [ ] Owner menyetujui daftar user internal dan pemrosesan data nyata, kebijakan evidence/privasi/retensi serta risiko local-only backup atau solusi independen yang terotorisasi.
- [ ] **Owner memberi explicit final approval untuk aktivasi internal pilot** setelah bukti di atas, terpisah dari UX acceptance. Tidak berarti production GO.

[Laporan persiapan dan bukti](../output/internal-pilot-preparation-20261102/REPORT.md) · [Runbook DR/monitoring](../output/dr-monitoring-readiness-20261102/OPERATIONS-RUNBOOK.md).
