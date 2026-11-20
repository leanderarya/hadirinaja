export type PolicyConfiguration = {
  late_tolerance_minutes: number
  check_in_window: { early_minutes: number; late_minutes: number }
  attendance_mode: "kiosk" | "personal" | "hybrid"
  personal_location_validation: {
    required: true
    radius_meters: number
    latitude?: number | null
    longitude?: number | null
  }
  retroactive_request_limit_days: number
  operational_review: {
    schedule_change_reason_required: true
    minimum_notice_hours: number
  }
}
export type PolicyResponse = {
  effective_date: string
  effective: {
    effective_from: string | null
    configuration: PolicyConfiguration | null
    tenant_default: PolicyConfiguration | null
    outlet_overrides: Record<string, unknown>
    tenant_version_id: number | null
    outlet_version_id: number | null
  }
  history: null | {
    tenant_versions: Array<{
      id: number
      effective_from: string
      configuration: PolicyConfiguration
      reason: string | null
      actor_user_id?: number | null
    }>
    outlet_versions: Array<{
      id: number
      effective_from: string
      overrides: Record<string, unknown>
      reason: string | null
      actor_user_id?: number | null
    }>
  }
}
export const policyDefaults: PolicyConfiguration = {
  late_tolerance_minutes: 5,
  check_in_window: { early_minutes: 60, late_minutes: 60 },
  attendance_mode: "kiosk",
  personal_location_validation: {
    required: true,
    radius_meters: 100,
    latitude: null,
    longitude: null,
  },
  retroactive_request_limit_days: 7,
  operational_review: {
    schedule_change_reason_required: true,
    minimum_notice_hours: 24,
  },
}
export const policyFields = [
  {
    key: "check_in_window.early_minutes",
    label: "Presensi masuk sebelum mulai (menit)",
    group: "time",
    min: 0,
    max: 360,
  },
  {
    key: "check_in_window.late_minutes",
    label: "Batas presensi masuk setelah mulai (menit)",
    group: "time",
    min: 0,
    max: 360,
  },
  {
    key: "late_tolerance_minutes",
    label: "Toleransi terlambat (menit)",
    group: "time",
    min: 0,
    max: 180,
  },
  {
    key: "personal_location_validation.radius_meters",
    label: "Radius dari titik lokasi (meter)",
    group: "location",
    min: 25,
    max: 5000,
  },
  {
    key: "personal_location_validation.latitude",
    label: "Latitude",
    group: "location",
    min: -90,
    max: 90,
    coordinate: true,
  },
  {
    key: "personal_location_validation.longitude",
    label: "Longitude",
    group: "location",
    min: -180,
    max: 180,
    coordinate: true,
  },
  { key: "attendance_mode", label: "Mode presensi", group: "other" },
  {
    key: "retroactive_request_limit_days",
    label: "Batas pengajuan retrospektif (hari)",
    group: "other",
    min: 0,
    max: 30,
  },
  {
    key: "operational_review.minimum_notice_hours",
    label: "Pemberitahuan perubahan jadwal (jam)",
    group: "other",
    min: 0,
    max: 168,
  },
] as const
export type PolicyField = (typeof policyFields)[number]
export type PolicyKey = PolicyField["key"]
export type PolicyGroup = PolicyField["group"]
export type PolicyDraft = Record<PolicyKey, string>
export type PolicyScope = "outlet" | "tenant"
export function policyLeaf(object: unknown, path: string): unknown {
  return path
    .split(".")
    .reduce<unknown>(
      (value, key) =>
        value !== null && typeof value === "object"
          ? (value as Record<string, unknown>)[key]
          : undefined,
      object
    )
}
export function hasPolicyOverride(object: unknown, path: string) {
  return policyLeaf(object, path) !== undefined
}
export function policyDraft(config: PolicyConfiguration): PolicyDraft {
  return Object.fromEntries(
    policyFields.map((f) => [f.key, String(policyLeaf(config, f.key) ?? "")])
  ) as PolicyDraft
}
function fieldValue(key: PolicyKey, draft: PolicyDraft) {
  return key === "attendance_mode"
    ? draft[key]
    : draft[key].trim() === ""
      ? null
      : Number(draft[key])
}
export function changedPolicyFields(
  base: PolicyConfiguration,
  draft: PolicyDraft
) {
  return policyFields.filter(
    (f) => (policyLeaf(base, f.key) ?? null) !== fieldValue(f.key, draft)
  )
}
export function validatePolicyDraft(
  draft: PolicyDraft
): Record<string, string> {
  const errors: Record<string, string> = {}
  for (const f of policyFields) {
    const value = fieldValue(f.key, draft)
    if (f.key === "attendance_mode") {
      if (!["kiosk", "personal", "hybrid"].includes(String(value)))
        errors[f.key] = "Pilih mode presensi yang tersedia."
    } else if (
      !("coordinate" in f && value === null) &&
      (typeof value !== "number" ||
        !Number.isFinite(value) ||
        value < f.min ||
        value > f.max ||
        (!("coordinate" in f) && !Number.isInteger(value)))
    ) {
      errors[f.key] =
        `Isi ${"coordinate" in f ? "angka" : "bilangan bulat"} ${f.min}–${f.max}.`
    }
  }
  const lat = draft["personal_location_validation.latitude"].trim(),
    lon = draft["personal_location_validation.longitude"].trim()
  if (Boolean(lat) !== Boolean(lon))
    errors["personal_location_validation.latitude"] =
      "Latitude dan longitude harus diisi bersama, atau keduanya kosong."
  return errors
}
export const utcToday = () => new Date().toISOString().slice(0, 10)
export function validatePolicyDate(date: string, today = utcToday()) {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(date) &&
    !Number.isNaN(Date.parse(`${date}T00:00:00Z`)) &&
    new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) === date &&
    date >= today
  )
}
function setLeaf(
  target: Record<string, unknown>,
  path: string,
  value: unknown
) {
  const parts = path.split("."),
    key = parts.pop() as string
  let node = target
  for (const part of parts) {
    node[part] ??= {}
    node = node[part] as Record<string, unknown>
  }
  node[key] = value
}
// Stop instead of dropping a future/unknown server field from the next snapshot.
function assertSupportedOverrides(
  overrides: Record<string, unknown>,
  prefix = ""
) {
  const fixed = [
    "personal_location_validation.required",
    "operational_review.schedule_change_reason_required",
  ]
  for (const [key, value] of Object.entries(overrides)) {
    const path = prefix ? `${prefix}.${key}` : key
    if (value !== null && typeof value === "object" && !Array.isArray(value))
      assertSupportedOverrides(value as Record<string, unknown>, path)
    else if (!policyFields.some((f) => f.key === path) && !fixed.includes(path))
      throw new Error(
        "Data kebijakan memuat bagian yang belum didukung editor. Penyimpanan dihentikan agar data tidak hilang."
      )
    if (fixed.includes(path) && value !== true)
      throw new Error(
        "Aturan wajib pada data kebijakan tidak valid. Muat ulang kebijakan."
      )
  }
}
export function buildPolicySnapshot(
  target: PolicyResponse,
  scope: PolicyScope,
  changed: PolicyField[],
  draft: PolicyDraft
) {
  if (Object.keys(validatePolicyDraft(draft)).length)
    throw new Error("Periksa nilai kebijakan sebelum menyimpan.")
  if (!changed.length && target.effective.tenant_default)
    throw new Error("Belum ada perubahan untuk disimpan.")
  if (scope === "outlet" && !target.effective.configuration)
    throw new Error(
      "Kebijakan organisasi harus tersedia sebelum kebijakan Outlet diubah."
    )
  const rawOverrides = target.effective.outlet_overrides
  if (Array.isArray(rawOverrides) && rawOverrides.length)
    throw new Error(
      "Data pengaturan khusus Outlet tidak valid; penyimpanan dihentikan."
    )
  const snapshot: Record<string, unknown> = structuredClone(
    scope === "tenant"
      ? (target.effective.tenant_default ?? policyDefaults)
      : Array.isArray(rawOverrides)
        ? {}
        : rawOverrides
  )
  if (scope === "outlet") assertSupportedOverrides(snapshot)
  for (const f of changed) setLeaf(snapshot, f.key, fieldValue(f.key, draft))
  if (
    changed.some(
      (f) =>
        f.key === "personal_location_validation.latitude" ||
        f.key === "personal_location_validation.longitude"
    )
  ) {
    for (const key of [
      "personal_location_validation.latitude",
      "personal_location_validation.longitude",
    ] as const)
      setLeaf(snapshot, key, fieldValue(key, draft))
  }
  return snapshot
}
function stable(value: unknown): unknown {
  if (value && typeof value === "object" && !Array.isArray(value))
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, stable(item)])
    )
  return Array.isArray(value) ? value.map(stable) : value
}
export function policyFingerprint(
  response: PolicyResponse,
  scope: PolicyScope
) {
  return JSON.stringify(
    stable(
      scope === "tenant"
        ? {
            id: response.effective.tenant_version_id,
            configuration: response.effective.tenant_default,
          }
        : response.effective
    )
  )
}
