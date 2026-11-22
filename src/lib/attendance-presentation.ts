// Presentation of server-owned values only; no attendance eligibility calculations.
export function formatAttendanceTime(
  value: string | null,
  timezone: string | null | undefined
): string {
  if (!value) return "Belum tercatat"
  if (!timezone) return `${value} (zona waktu tidak tersedia)`
  try {
    return `${new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeStyle: "short", timeZone: timezone }).format(new Date(value))} · ${timezone}`
  } catch {
    return value
  }
}

export function attendanceConfirmation(result: {
  operation: { type: "check_in" | "check_out" }
  event?: { recorded_at: string }
  session?: {
    timezone: string
    check_in_at: string
    check_out_at: string | null
  }
}): string {
  const checkIn = result.operation.type === "check_in"
  const recordedAt =
    result.event?.recorded_at ??
    (checkIn ? result.session?.check_in_at : result.session?.check_out_at)
  const title = checkIn
    ? "Presensi masuk dikonfirmasi oleh server."
    : "Presensi keluar dicatat oleh server."
  return recordedAt
    ? `${title} ${formatAttendanceTime(recordedAt, result.session?.timezone)}`
    : `${title} Waktu pencatatan belum tersedia.`
}

export function reviewIndicatorLabel(value: string): string {
  const labels: Record<string, string> = {
    unscheduled_work: "Kerja tanpa jadwal",
    rest_day_work: "Kerja pada hari istirahat",
    check_in_outside_window: "Presensi masuk di luar rentang jadwal",
    late_arrival: "Datang terlambat",
    early_departure: "Pulang lebih awal",
    late_checkout: "Presensi keluar melewati jadwal",
    missing_checkout: "Presensi keluar belum dicatat setelah jadwal",
    location_outside_range: "Lokasi di luar radius",
    location_low_accuracy: "Akurasi lokasi rendah",
    location_unavailable: "Lokasi tidak tersedia",
    location_permission_denied: "Izin lokasi ditolak",
    location_geofence_unconfigured: "Titik batas lokasi belum diatur",
    outlet_closed: "Outlet tercatat tutup",
    schedule_conflict: "Ada konflik pada data jadwal",
    approved_leave_with_recorded_attendance:
      "Ada presensi pada tanggal izin atau cuti yang disetujui",
    attendance_review_required: "Kehadiran perlu ditinjau pengelola",
    pending_attendance_correction: "Koreksi masih menunggu keputusan",
    potential_absence: "Belum ada presensi · perlu ditinjau pengelola",
  }
  return labels[value] ?? value
}

export function attendanceWorkDate(value: string, timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value))
}

export function formatWorkDate(value: string): string {
  return new Intl.DateTimeFormat("id-ID", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  }).format(new Date(`${value}T00:00:00Z`))
}

export function formatCompactWorkDate(value: string): string {
  return new Intl.DateTimeFormat("id-ID", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(new Date(`${value}T00:00:00Z`))
}

export function currentWeekAttendance(
  days: EffectiveAttendanceDay[] | undefined,
  today: string
) {
  return days
    ?.filter((day) => isCurrentWeekWorkDate(day.work_date, today))
    .sort((left, right) => right.work_date.localeCompare(left.work_date))
}

export function isCurrentWeekWorkDate(workDate: string, today: string) {
  const monday = new Date(`${today}T00:00:00Z`)
  monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7))
  const firstWorkDate = monday.toISOString().slice(0, 10)
  return workDate >= firstWorkDate && workDate <= today
}

export function attendanceGreeting(
  name: string,
  date: Date,
  timeZone: string
): string {
  let hour = 0
  try {
    hour = Number(
      new Intl.DateTimeFormat("en-GB", {
        hour: "2-digit",
        hourCycle: "h23",
        timeZone,
      })
        .formatToParts(date)
        .find((part) => part.type === "hour")?.value ?? 0
    )
  } catch {
    hour = date.getUTCHours()
  }
  const greeting =
    hour < 11
      ? "Selamat pagi"
      : hour < 15
        ? "Selamat siang"
        : hour < 19
          ? "Selamat sore"
          : "Selamat malam"
  const firstName = name.trim().split(/\s+/)[0] || "Karyawan"
  return `${greeting}, ${firstName}`
}

export function formatAttendanceHeaderTime(date: Date, timeZone: string) {
  const day = new Intl.DateTimeFormat("id-ID", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone,
  }).format(date)
  const time = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    hourCycle: "h23",
    minute: "2-digit",
    timeZone,
  })
    .format(date)
    .replace(":", ".")
  return `${day} · ${time}`
}

export function attendanceDurationMinutes(
  start: string | Date,
  end: string | Date
): number | null {
  const startTime = new Date(start).getTime()
  const endTime = new Date(end).getTime()
  if (
    !Number.isFinite(startTime) ||
    !Number.isFinite(endTime) ||
    endTime < startTime
  )
    return null
  return Math.floor((endTime - startTime) / 60_000)
}

export function formatAttendanceDuration(minutes: number): string {
  const safeMinutes = Math.max(0, Math.floor(minutes))
  const hours = Math.floor(safeMinutes / 60)
  const remainder = String(safeMinutes % 60).padStart(2, "0")
  return `${hours} j ${remainder} m`
}

export type ActiveAttendanceSession = {
  id: number
  work_date: string
  check_in_at: string
  timezone: string
}

export function weeklyAttendanceSummary(
  days: EffectiveAttendanceDay[] | undefined,
  activeSession: ActiveAttendanceSession | null,
  now: Date
): { workedDays: number; totalMinutes: number | null } | null {
  if (!days) return null
  const workedDates = new Set<string>()
  let totalMinutes = 0
  let complete = true

  for (const day of days) {
    for (const session of day.sessions) {
      if (session.id === activeSession?.id) continue
      const start =
        session.effective.check_in_at ?? session.original.check_in_at
      const end =
        session.effective.check_out_at ?? session.original.check_out_at
      if (!start && !end) continue
      workedDates.add(day.work_date)
      const minutes =
        start && end ? attendanceDurationMinutes(start, end) : null
      if (minutes === null) complete = false
      else totalMinutes += minutes
    }
    for (const source of day.sources ?? []) {
      if (source.source_kind !== "reconstruction") continue
      workedDates.add(day.work_date)
      const minutes = attendanceDurationMinutes(
        source.effective.check_in_at,
        source.effective.check_out_at
      )
      if (minutes === null) complete = false
      else totalMinutes += minutes
    }
  }

  if (activeSession) {
    workedDates.add(activeSession.work_date)
    const minutes = attendanceDurationMinutes(activeSession.check_in_at, now)
    if (minutes === null) complete = false
    else totalMinutes += minutes
  }

  return {
    workedDays: workedDates.size,
    totalMinutes: complete ? totalMinutes : null,
  }
}

export function attendanceOutcomeLabel(outcome: string): string {
  const labels: Record<string, string> = {
    present: "Hadir",
    exceptional_attendance: "Hadir di luar jadwal",
    no_recorded_outcome: "Belum ada presensi",
    potential_absence: "Belum ada presensi",
    confirmed_absence_pending_finalization: "Tidak hadir · menunggu penetapan",
    absent: "Tidak hadir",
    permission: "Izin disetujui",
    sick: "Sakit disetujui",
    leave: "Cuti disetujui",
    pending_review: "Menunggu tinjauan",
    unscheduled: "Tanpa jadwal",
    rest: "Hari istirahat",
    incomplete: "Presensi belum lengkap",
    no_attendance: "Belum ada presensi",
  }
  return labels[outcome] ?? "Status belum tersedia"
}

export type EffectiveAttendanceSession =
  EffectiveAttendanceDay["sessions"][number]

export type EffectiveAttendanceDay = {
  work_date: string
  outcome: string
  outlet?: { id: number; name: string | null } | null
  sources?: Array<
    | {
        source_kind: "physical_session"
        source_id: number
        physical: { outlet_id: number }
      }
    | {
        source_kind: "reconstruction"
        source_id: number
        effective: {
          outlet_id: number
          check_in_at: string
          check_out_at: string
        }
      }
  >
  sessions: Array<{
    id: number
    recording_status: string
    outlet: { id: number; name: string | null }
    original: {
      outlet_id?: number
      outlet?: { id: number; name: string | null }
      work_date: string
      check_in_at: string | null
      check_out_at: string | null
      events?: Array<{
        id: number
        type: "check_in" | "check_out"
        has_evidence: boolean
      }>
    }
    effective: {
      work_date: string
      check_in_at: string | null
      check_out_at: string | null
    }
    schedule_snapshot: { timezone?: string } | null
    review_indicators: string[]
    correction: { request_id: number; reason: string | null } | null
    checkout_destination?: {
      id: number
      name: string | null
      timezone: string | null
    } | null
    evidence?: Array<{
      event_id: number
      type: "check_in" | "check_out"
      available: boolean
      expires_at: string
    }>
  }>
  pending_corrections?: Array<{ id: number; details: Record<string, unknown> }>
  schedule?: { timezone?: string } | null
  review: { status: string; indicators: string[] }
  unresolved_conflicts: string[]
  is_finalized: boolean
}

export function originalOutletId(
  day: EffectiveAttendanceDay,
  session: EffectiveAttendanceSession
): number | undefined {
  if (session.original.outlet_id !== undefined)
    return session.original.outlet_id
  const source = day.sources?.find(
    (item) =>
      item.source_id === session.id && item.source_kind === "physical_session"
  )
  if (source?.source_kind === "physical_session")
    return source.physical.outlet_id
  return session.correction ? undefined : session.outlet.id
}
