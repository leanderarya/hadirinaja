const pageTitles: Record<string, string> = {
  "/": "Beranda",
  "/access": "Akses tim",
  "/activate": "Aktivasi akun",
  "/api-health": "Status API",
  "/approvals": "Persetujuan",
  "/attendance": "Presensi saya",
  "/kiosk": "Presensi kiosk",
  "/login": "Masuk",
  "/reports": "Ringkasan kehadiran",
  "/reports/attendance": "Laporan kehadiran",
  "/reports/audit": "Riwayat audit",
  "/requests": "Permintaan saya",
  "/reset-password": "Atur ulang kata sandi",
  "/scheduling": "Jadwal",
  "/select-tenant": "Pilih organisasi",
  "/settings": "Pengaturan",
  "/settings/attendance-policy": "Kebijakan presensi",
  "/settings/kiosk-devices": "Perangkat kiosk",
  "/settings/organization": "Struktur organisasi",
  "/settings/outlet-calendar": "Kalender Outlet",
  "/settings/shift-templates": "Templat shift",
  "/workspace": "Tim",
  "/ui-kit": "UI kit",
  "/dashboard-1": "Demo dashboard 1",
  "/dashboard-2": "Demo dashboard 2",
  "/dashboard-3": "Demo dashboard 3",
}

export function documentTitle(pathname: string): string {
  const path = pathname.replace(/\/$/, "") || "/"
  return `${pageTitles[path] ?? "Halaman tidak ditemukan"} | HadirinAja`
}
