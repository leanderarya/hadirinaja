import { settingsOrigin } from "./settings-navigation"

export type ShiftVersion = {
  id: number
  revision: number
  start_time: string
  end_time: string
  crosses_midnight: boolean
  effective_from: string
  template_name?: string | null
}
export type ShiftTemplate = {
  id: number
  name: string
  versions: ShiftVersion[]
}
export type ShiftSelection = { templateId?: number; versionId?: number }
export type ShiftDraft = {
  name: string
  start_time: string
  end_time: string
  crosses_midnight: boolean
  effective_from: string
  reason: string
}
export type ShiftCommand =
  | { kind: "create"; draft: ShiftDraft }
  | { kind: "revision"; templateId: number; draft: ShiftDraft }
export type ShiftContext = {
  tenant: { id: number; name: string }
  user: { id: number; name: string }
  roles: string[]
  capabilities: {
    manage_templates: boolean
    manage_schedules: boolean
    manage_policies: boolean
    manage_calendars: boolean
    read_personal_schedule: boolean
  }
  employee_id: number | null
  business_units: Array<{ id: number; name: string }>
  outlets: Array<{ id: number; name: string; business_unit_id: number }>
  employees: Array<{ id: number; name: string }>
  shift_templates: ShiftTemplate[]
}
export class ShiftSaveError extends Error {
  constructor(
    message: string,
    public readonly uncertain = false,
    public readonly fields: Record<string, string[]> = {}
  ) {
    super(message)
  }
}
function id(value: unknown) {
  if (typeof value !== "string" && typeof value !== "number") return undefined
  const number = Number(value)
  return Number.isSafeInteger(number) && number > 0 ? number : undefined
}
export function shiftSearch(search: Record<string, unknown>) {
  return {
    ...settingsOrigin(search),
    templateId: id(search.templateId),
    versionId: id(search.versionId),
    q: typeof search.q === "string" ? search.q.slice(0, 120) : undefined,
  }
}
export function selectedShift(
  templates: ShiftTemplate[],
  selection: ShiftSelection
) {
  const template = templates.find(
    (item) =>
      item.id === selection.templateId ||
      (!selection.templateId &&
        selection.versionId &&
        item.versions.some((version) => version.id === selection.versionId))
  )
  const version = template?.versions.find(
    (item) => item.id === selection.versionId
  )
  const invalid = Boolean(
    (selection.templateId && !template) || (selection.versionId && !version)
  )
  return {
    template: invalid ? undefined : template,
    version: invalid ? undefined : version,
    invalid,
  }
}
export function defaultShiftSelection(
  templates: ShiftTemplate[],
  selection: ShiftSelection
) {
  const current = selectedShift(templates, selection)
  if (current.template && !current.invalid) return undefined
  const first = templates[0]
  return first ? { templateId: first.id } : undefined
}
export const utcDate = () => new Date().toISOString().slice(0, 10)
export function validateShift(
  draft: ShiftDraft,
  create: boolean,
  today = utcDate()
) {
  const errors: Record<string, string> = {}
  if (
    create &&
    (draft.name.trim().length < 2 || draft.name.trim().length > 120)
  )
    errors.name = "Nama wajib 2–120 karakter."
  const validTime = (value: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(value)
  if (!validTime(draft.start_time))
    errors.start_time = "Pilih jam mulai dalam format 24 jam."
  if (!validTime(draft.end_time))
    errors.end_time = "Pilih jam selesai dalam format 24 jam."
  if (!errors.start_time && !errors.end_time) {
    const minutes = (time: string) =>
      Number(time.slice(0, 2)) * 60 + Number(time.slice(3))
    const start = minutes(draft.start_time),
      end = minutes(draft.end_time)
    const duration = draft.crosses_midnight
      ? (end - start + 1440) % 1440
      : end - start
    if (
      duration < 15 ||
      duration > 1080 ||
      (draft.crosses_midnight ? end >= start : end <= start)
    )
      errors.end_time =
        "Durasi harus 15 menit–18 jam; periksa penanda lintas tengah malam."
  }
  const date = new Date(`${draft.effective_from}T00:00:00Z`)
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(draft.effective_from) ||
    Number.isNaN(date.getTime()) ||
    date.toISOString().slice(0, 10) !== draft.effective_from ||
    draft.effective_from < today
  )
    errors.effective_from =
      "Pilih tanggal valid, hari ini atau ke depan menurut UTC."
  if (draft.reason.trim().length < 3 || draft.reason.trim().length > 1000)
    errors.reason = "Alasan wajib 3–1000 karakter."
  return errors
}
export function canReadTemplates(roles: string[], legacy: boolean) {
  return roles.includes("owner") || (legacy && roles.includes("supervisor"))
}
