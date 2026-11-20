const labels: Record<string, string> = {
  late_tolerance_minutes: "Toleransi keterlambatan",
  check_in_window: "Rentang presensi masuk",
  early_minutes: "Sebelum mulai (menit)",
  late_minutes: "Setelah mulai (menit)",
  attendance_mode: "Mode presensi",
  personal_location_validation: "Validasi lokasi",
  required: "Wajib",
  radius_meters: "Jarak (meter)",
  latitude: "Garis lintang",
  longitude: "Garis bujur",
  retroactive_request_limit_days: "Batas pengajuan untuk tanggal sebelumnya (hari)",
  operational_review: "Ketentuan perubahan jadwal",
  schedule_change_reason_required: "Alasan perubahan wajib",
  minimum_notice_hours: "Pemberitahuan minimum (jam)",
}
export function policyFieldLabel(key: string) {
  return labels[key] ?? key
}
export function policyValueText(value: unknown): string {
  if (value == null) return "Belum tersedia"
  if (typeof value === "boolean") return value ? "Ya" : "Tidak"
  if (typeof value === "object") return Object.entries(value).map(([key, item]) => `${policyFieldLabel(key)}: ${policyValueText(item)}`).join(" · ")
  if (value === "hybrid") return "Kiosk dan perangkat pribadi"
  if (value === "personal") return "Perangkat pribadi"
  if (value === "kiosk") return "Kiosk"
  return String(value)
}
