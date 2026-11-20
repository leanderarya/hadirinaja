import type { StatusTone } from "@/components/r2c/components"

export function employeeReference(id: number) {
  return `EMP-${String(id).padStart(3, "0")}`
}

export function employeeAccess(status?: string | null): {
  label: string
  helper: string
  action: string
  tone: StatusTone
} {
  if (status === "active" || status === "accepted")
    return {
      label: "Terhubung",
      helper: "Akun aktif",
      action: "Kelola akses",
      tone: "success",
    }
  if (status === "pending")
    return {
      label: "Undangan menunggu",
      helper: "Tautan dikirim manual",
      action: "Lihat undangan",
      tone: "warning",
    }
  if (status === "none")
    return {
      label: "Belum ada akun",
      helper: "Profil tersimpan",
      action: "Undang",
      tone: "warning",
    }
  if (status === "expired")
    return {
      label: "Undangan kedaluwarsa",
      helper: "Periksa undangan",
      action: "Kelola akses",
      tone: "warning",
    }
  if (status === "revoked")
    return {
      label: "Akses dicabut",
      helper: "Profil tetap tersimpan",
      action: "Kelola akses",
      tone: "danger",
    }
  if (status === "deactivated")
    return {
      label: "Akun nonaktif",
      helper: "Profil tetap tersimpan",
      action: "Kelola akses",
      tone: "neutral",
    }
  return {
    label: "Tidak tersedia",
    helper: "Status akses tidak tersedia",
    action: "Kelola akses",
    tone: "neutral",
  }
}

export interface RosterEmployee {
  id: number
  name: string
  business_unit_id: number | null
  business_unit_name: string | null
  outlet_id: number | null
  outlet_name: string | null
  access_status?: string | null
}

export function filterRoster<T extends RosterEmployee>(
  employees: T[],
  query: string,
  unitId: string,
  outletId: string
) {
  const needle = query.trim().toLocaleLowerCase("id-ID")
  return employees.filter(
    (employee) =>
      (!unitId || String(employee.business_unit_id) === unitId) &&
      (!outletId || String(employee.outlet_id) === outletId) &&
      (!needle ||
        `${employee.name} ${employee.id} ${employeeReference(employee.id)}`
          .toLocaleLowerCase("id-ID")
          .includes(needle))
  )
}

export function workspaceSection(
  hash: string
): "team" | "organization" | "kiosk" {
  return hash === "#organization"
    ? "organization"
    : hash === "#kiosk-devices"
      ? "kiosk"
      : "team"
}

export function validateWorkDateRange(
  from: string,
  to: string,
  maximumDays = 31
) {
  const valid = (value: string) =>
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(`${value}T00:00:00Z`)) &&
    new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value
  if (!valid(from) || !valid(to)) return "Pilih tanggal kerja yang valid."
  const days =
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) /
      86400000 +
    1
  if (days < 1) return "Tanggal akhir harus sama atau setelah tanggal awal."
  if (days > maximumDays) return `Rentang maksimal ${maximumDays} hari.`
  return ""
}

export function formatWorkDateRange(from: string, to: string) {
  if (validateWorkDateRange(from, to, 36600)) return "Pilih periode"
  const a = new Date(`${from}T00:00:00Z`),
    b = new Date(`${to}T00:00:00Z`)
  const format = (date: Date) =>
    new Intl.DateTimeFormat("id-ID", {
      day: "numeric",
      month: "short",
      year: "numeric",
      timeZone: "UTC",
    }).format(date)
  if (from === to) return format(a)
  if (from.slice(0, 7) === to.slice(0, 7))
    return `${a.getUTCDate()}–${format(b)}`
  return `${format(a)} – ${format(b)}`
}
