import type { ShiftTemplate } from "./shift-templates"

export type StaffingRole = "morning" | "middle" | "evening"
export type Staffing = Record<StaffingRole, number>
export type PlannerEntry = {
  employee_id: number
  work_date: string
  status: "work" | "rest" | "unscheduled"
  shift_template_version_id?: number | null
}
export type StaffingDay = {
  work_date: string
  targets: Partial<Record<StaffingRole, number>>
  counts: Record<StaffingRole, number>
}
export type StaffingReport = {
  enabled: boolean
  days: StaffingDay[]
  deficits: Array<{
    work_date: string
    role: StaffingRole
    missing: number
    required: number
    assigned: number
  }>
  conflicts: string[]
  checksum: string | null
}
export type PlannerRevision = {
  revision_id: number
  entries: PlannerEntry[]
  staffing: Staffing | null
  publication_warnings: StaffingReport["deficits"]
}
export type PlannerWeek = {
  version: number
  week_start: string
  draft: PlannerRevision | null
  published: PlannerRevision | null
  staffing_report?: StaffingReport
  outlet: {
    id: number
    name: string
    timezone?: string | null
    weekly_planner_start_on: string | null
  }
  employees: Array<{ id: number; name: string }>
  published_weeks: Array<{ week_start: string; published_revision_id: number }>
}
export const staffingRoles: StaffingRole[] = ["morning", "middle", "evening"]
export const staffingLabels = {
  morning: "Pagi",
  middle: "Tengah",
  evening: "Sore",
}
export const staffingTimes = {
  morning: ["08:00", "16:00"],
  middle: ["11:00", "19:00"],
  evening: ["16:00", "22:00"],
}
export function plannerDates(start: string) {
  return Array.from({ length: 7 }, (_, index) => shiftPlannerDate(start, index))
}
export function shiftPlannerDate(date: string, days: number) {
  const value = new Date(`${date}T12:00:00Z`)
  value.setUTCDate(value.getUTCDate() + days)
  return value.toISOString().slice(0, 10)
}
export function plannerDateLabel(date: string) {
  return new Intl.DateTimeFormat("id-ID", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(new Date(`${date}T12:00:00Z`))
}
export function staffingOptions(
  templates: ShiftTemplate[],
  role: StaffingRole,
  week: string
) {
  const [start, end] = staffingTimes[role]
  return templates
    .flatMap((template) =>
      template.versions.map((version) => ({ ...version, name: template.name }))
    )
    .filter(
      (version) =>
        !version.crosses_midnight &&
        version.start_time.slice(0, 5) === start &&
        version.end_time.slice(0, 5) === end &&
        version.effective_from <= week
    )
}
export function replacePlannerEntry(
  entries: PlannerEntry[],
  entry: PlannerEntry
) {
  return [
    ...entries.filter(
      (item) =>
        item.employee_id !== entry.employee_id ||
        item.work_date !== entry.work_date
    ),
    entry,
  ]
}

export function plannerEntryKey(entry: PlannerEntry) {
  return `${entry.work_date}:${entry.employee_id}`
}

export function plannerRequestEntries(entries: PlannerEntry[]) {
  return entries
    .map((entry) => ({
      employee_id: entry.employee_id,
      work_date: entry.work_date,
      status: entry.status,
      shift_template_version_id:
        entry.status === "work"
          ? (entry.shift_template_version_id ?? null)
          : null,
    }))
    .sort(
      (left, right) =>
        left.work_date.localeCompare(right.work_date) ||
        left.employee_id - right.employee_id
    )
}

export function samePlannerEntries(
  left: PlannerEntry[],
  right: PlannerEntry[]
) {
  return (
    JSON.stringify(plannerRequestEntries(left)) ===
    JSON.stringify(plannerRequestEntries(right))
  )
}
