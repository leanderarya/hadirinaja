export type CorrectionType =
  | "check_in"
  | "missing_checkout"
  | "session"
  | "reconstruction"

export type CorrectionOption = {
  session_id?: number
  work_date: string
  outlet: { id: number; name: string }
  correction_type: CorrectionType
  can_start: boolean
  deadline: {
    exclusive_at: string
    historical_timezone: string
    owner_required: boolean
  }
}

export type PersonalCorrectionOptions = {
  tenant_id: number
  employee_id: number
  evaluated_at: string
  sessions: CorrectionOption[]
  reconstructions: CorrectionOption[]
}

export type CorrectionSearch = {
  correction?: CorrectionType | "invalid"
  workDate?: string
  outletId?: number
  sessionId?: number
  tenantId?: number
  employeeId?: number
}

function positiveId(value: unknown): number | undefined {
  if (typeof value === "string" && /^[1-9]\d*$/.test(value))
    value = Number(value)
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0
    ? value
    : undefined
}

export function correctionSearch(
  search: Record<string, unknown>
): CorrectionSearch {
  if (search.correction === undefined) return {}
  const kind = search.correction
  const date =
    typeof search.workDate === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(search.workDate)
      ? new Date(`${search.workDate}T00:00:00Z`)
      : null
  const outletId = positiveId(search.outletId)
  const sessionId = positiveId(search.sessionId)
  const tenantId = positiveId(search.tenantId)
  const employeeId = positiveId(search.employeeId)
  if (
    !["check_in", "missing_checkout", "session", "reconstruction"].includes(
      String(kind)
    ) ||
    !date ||
    !Number.isFinite(+date) ||
    date.toISOString().slice(0, 10) !== search.workDate ||
    !outletId ||
    !tenantId ||
    !employeeId ||
    (kind === "reconstruction" ? search.sessionId !== undefined : !sessionId)
  ) {
    return { correction: "invalid" }
  }
  return {
    correction: kind as CorrectionType,
    workDate: search.workDate as string,
    outletId,
    sessionId,
    tenantId,
    employeeId,
  }
}

export function correctionHref(
  options: PersonalCorrectionOptions,
  option: CorrectionOption
): string {
  const search = new URLSearchParams({
    correction: option.correction_type,
    workDate: option.work_date,
    outletId: String(option.outlet.id),
    tenantId: String(options.tenant_id),
    employeeId: String(options.employee_id),
  })
  if (option.session_id !== undefined)
    search.set("sessionId", String(option.session_id))
  return `/requests?${search.toString()}`
}

export function matchingCorrection(
  search: CorrectionSearch,
  options: PersonalCorrectionOptions | undefined
): CorrectionOption | undefined {
  if (
    !options ||
    !search.correction ||
    search.correction === "invalid" ||
    search.tenantId !== options.tenant_id ||
    search.employeeId !== options.employee_id
  )
    return
  return [...options.sessions, ...options.reconstructions].find(
    (option) =>
      option.can_start &&
      option.correction_type === search.correction &&
      option.work_date === search.workDate &&
      option.outlet.id === search.outletId &&
      option.session_id === search.sessionId
  )
}

export function correctionTypeLabel(kind: CorrectionType): string {
  return {
    check_in: "Waktu masuk",
    missing_checkout: "Presensi keluar terlewat",
    session: "Waktu masuk dan keluar",
    reconstruction: "Sesi terlewat",
  }[kind]
}
