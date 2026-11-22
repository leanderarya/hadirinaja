import { ArrowDown01Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { useEffect, useId, useRef, useState } from "react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Skeleton } from "@/components/ui/skeleton"
import { ApiError, apiRequest } from "@/lib/api"
import {
  correctionHref,
  correctionTypeLabel,
  type PersonalCorrectionOptions,
} from "@/lib/attendance-correction-navigation"
import {
  attendanceIdentityChangeEventName,
  attendanceIdentityChangeSignalKey,
} from "@/lib/attendance-photo-recovery"
import {
  type ActiveAttendanceSession,
  attendanceDurationMinutes,
  attendanceOutcomeLabel,
  currentWeekAttendance,
  type EffectiveAttendanceDay,
  type EffectiveAttendanceSession,
  formatAttendanceDuration,
  formatAttendanceTime,
  formatCompactWorkDate,
  formatWorkDate,
  originalOutletId,
  reviewIndicatorLabel,
  weeklyAttendanceSummary,
} from "@/lib/attendance-presentation"
import { getAuthRecoveryPath } from "@/lib/auth-navigation"

export function EmployeeAttendanceHistory({
  days,
  outletNames,
  correctionOptions,
  currentWorkDate,
  activeSession = null,
  now = new Date(),
  summary: suppliedSummary,
  id = "history",
}: {
  days: EffectiveAttendanceDay[] | undefined
  outletNames?: ReadonlyMap<number, string | null>
  correctionOptions?: PersonalCorrectionOptions
  currentWorkDate?: string | null
  activeSession?: ActiveAttendanceSession | null
  now?: Date
  summary?: { workedDays: number; totalMinutes: number | null } | null
  id?: string
}) {
  const fetchedDays = currentWorkDate
    ? currentWeekAttendance(days, currentWorkDate)
    : days
        ?.slice()
        .sort((left, right) => right.work_date.localeCompare(left.work_date))
  const candidateActiveDay: EffectiveAttendanceDay | null = activeSession
    ? {
        work_date: activeSession.work_date,
        outcome: "present",
        sessions: [
          {
            id: activeSession.id,
            recording_status: "active",
            outlet: { id: 0, name: null },
            original: {
              work_date: activeSession.work_date,
              check_in_at: activeSession.check_in_at,
              check_out_at: null,
            },
            effective: {
              work_date: activeSession.work_date,
              check_in_at: activeSession.check_in_at,
              check_out_at: null,
            },
            schedule_snapshot: { timezone: activeSession.timezone },
            review_indicators: [],
            correction: null,
          },
        ],
        review: { status: "none", indicators: [] },
        unresolved_conflicts: [],
        is_finalized: false,
      }
    : null
  const activeDay =
    candidateActiveDay &&
    (!currentWorkDate ||
      Boolean(
        currentWeekAttendance([candidateActiveDay], currentWorkDate)?.length
      ))
      ? candidateActiveDay
      : null
  const visibleDays =
    fetchedDays === undefined
      ? activeDay
        ? [activeDay]
        : undefined
      : activeDay &&
          !fetchedDays.some((day) => day.work_date === activeDay.work_date)
        ? [...fetchedDays, activeDay].sort((left, right) =>
            right.work_date.localeCompare(left.work_date)
          )
        : fetchedDays
  const [selectedWorkDate, setSelectedWorkDate] = useState<string | null>(null)
  const [wide, setWide] = useState(false)
  const opener = useRef<HTMLButtonElement | null>(null)
  const selectedDay = visibleDays?.find(
    (day) => day.work_date === selectedWorkDate
  )
  const summary =
    suppliedSummary === undefined
      ? weeklyAttendanceSummary(visibleDays, activeSession, now)
      : suppliedSummary

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return
    const media = window.matchMedia("(min-width: 768px)")
    const update = () => setWide(media.matches)
    update()
    media.addEventListener("change", update)
    return () => media.removeEventListener("change", update)
  }, [])

  useEffect(() => {
    if (selectedWorkDate) return
    const frame = window.requestAnimationFrame(() => {
      if (opener.current?.isConnected) opener.current.focus()
    })
    return () => window.cancelAnimationFrame(frame)
  }, [selectedWorkDate])

  const closeDay = () => setSelectedWorkDate(null)

  return (
    <section
      id={id}
      tabIndex={-1}
      aria-labelledby={`${id}-title`}
      className="flex min-w-0 scroll-mt-4 flex-col gap-3 rounded-lg focus-visible:outline-2 focus-visible:outline-ring"
    >
      <h2 className="text-body font-semibold" id={`${id}-title`}>
        Minggu ini
      </h2>
      {summary ? (
        <p className="text-body">
          {summary.workedDays} hari ·{" "}
          {summary.totalMinutes === null
            ? "total belum tersedia"
            : formatAttendanceDuration(summary.totalMinutes)}
        </p>
      ) : null}
      {!visibleDays?.length ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyTitle>
              {days ? "Belum ada riwayat" : "Riwayat kehadiran belum tersedia"}
            </EmptyTitle>
            <EmptyDescription>
              {days
                ? "Belum ada catatan kehadiran minggu ini."
                : "Muat ulang status untuk memeriksa riwayat."}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <ol
          aria-label="Riwayat minggu ini, terbaru lebih dulu"
          className="divide-y divide-border"
        >
          {visibleDays.map((day) => (
            <li key={day.work_date}>
              <HistoryDay
                activeSession={activeSession}
                day={day}
                now={now}
                onOpen={(button) => {
                  opener.current = button
                  setSelectedWorkDate(day.work_date)
                }}
              />
            </li>
          ))}
        </ol>
      )}
      {selectedDay && (
        <HistoryDayDetails
          correctionOptions={correctionOptions}
          day={selectedDay}
          outletNames={outletNames}
          wide={wide}
          onClose={closeDay}
        />
      )}
    </section>
  )
}

function HistoryDay({
  day,
  activeSession,
  now,
  onOpen,
}: {
  day: EffectiveAttendanceDay
  activeSession: ActiveAttendanceSession | null
  now: Date
  onOpen: (button: HTMLButtonElement) => void
}) {
  const entries = historyEntries(day)
  const activeToday =
    activeSession?.work_date === day.work_date ? activeSession : null
  const displayEntries = entries.filter((entry) => entry.id !== activeToday?.id)
  let totalMinutes = 0
  let hasCompleteDurations = true
  const ranges = displayEntries.flatMap((entry) => {
    if (entry.kind === "reconstruction") {
      if (!entry.checkIn || !entry.checkOut) {
        hasCompleteDurations = false
        return []
      }
      const minutes = attendanceDurationMinutes(entry.checkIn, entry.checkOut)
      if (minutes === null) {
        hasCompleteDurations = false
        return []
      }
      totalMinutes += minutes
      const timezone =
        day.outlet?.id === entry.outletId ? day.schedule?.timezone : undefined
      return [
        `${formatCompactTime(entry.checkIn, timezone)}–${formatCompactTime(entry.checkOut, timezone)}`,
      ]
    }
    const start =
      entry.session.effective.check_in_at ?? entry.session.original.check_in_at
    const end =
      entry.session.effective.check_out_at ??
      entry.session.original.check_out_at
    if (!start || !end) {
      hasCompleteDurations = false
      return start
        ? [
            `${formatCompactTime(start, entry.session.schedule_snapshot?.timezone)}–…`,
          ]
        : []
    }
    const minutes = attendanceDurationMinutes(start, end)
    if (minutes === null) {
      hasCompleteDurations = false
      return []
    }
    totalMinutes += minutes
    const originId = originalOutletId(day, entry.session)
    const timezone =
      entry.session.correction && originId !== entry.session.outlet.id
        ? undefined
        : entry.session.schedule_snapshot?.timezone
    return [
      `${formatCompactTime(start, timezone)}–${formatCompactTime(end, timezone)}`,
    ]
  })
  const activeMinutes = activeToday
    ? attendanceDurationMinutes(activeToday.check_in_at, now)
    : null
  if (activeToday && activeMinutes !== null) totalMinutes += activeMinutes
  if (activeToday && activeMinutes === null) hasCompleteDurations = false
  if (displayEntries.length === 0 && !activeToday) hasCompleteDurations = false
  const timeSummary = activeToday
    ? `${formatCompactTime(activeToday.check_in_at, activeToday.timezone)}–… · berjalan`
    : ranges.length
      ? `${ranges.join(", ")}${hasCompleteDurations ? ` · ${formatAttendanceDuration(totalMinutes)}` : ""}`
      : ""
  const label = `${formatWorkDate(day.work_date)}, ${attendanceOutcomeLabel(day.outcome)}${entries.length ? `, ${entries.length} sesi` : ""}${timeSummary ? `, ${timeSummary}` : ""}`

  return (
    <button
      aria-label={label}
      className="flex min-h-[68px] w-full min-w-0 items-center justify-between gap-3 px-2 py-3 text-left outline-none transition-colors hover:bg-muted/40 focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      onClick={(event) => onOpen(event.currentTarget)}
      type="button"
    >
      <span className="min-w-0 flex-1">
        <time className="text-body font-medium" dateTime={day.work_date}>
          {formatCompactWorkDate(day.work_date)}
        </time>
      </span>
      <span className="min-w-0 flex-1 text-right text-body tabular-nums">
        {timeSummary || attendanceOutcomeLabel(day.outcome)}
      </span>
      <HugeiconsIcon
        icon={ArrowDown01Icon}
        className="size-4 shrink-0 -rotate-90 text-muted-foreground"
        aria-hidden="true"
      />
    </button>
  )
}

type HistoryEntry =
  | {
      kind: "physical_session"
      id: number
      start: string | null
      session: EffectiveAttendanceSession
    }
  | {
      kind: "reconstruction"
      id: number
      start: string | null
      outletId: number
      checkIn: string | null
      checkOut: string | null
    }

function historyEntries(day: EffectiveAttendanceDay): HistoryEntry[] {
  const entries: HistoryEntry[] = day.sessions.map((session) => ({
    kind: "physical_session",
    id: session.id,
    start: session.effective.check_in_at ?? session.original.check_in_at,
    session,
  }))
  for (const source of day.sources ?? []) {
    if (source.source_kind === "reconstruction")
      entries.push({
        kind: "reconstruction",
        id: source.source_id,
        start: source.effective.check_in_at,
        outletId: source.effective.outlet_id,
        checkIn: source.effective.check_in_at,
        checkOut: source.effective.check_out_at,
      })
  }
  return entries.sort((left, right) => {
    const leftTime = left.start ? Date.parse(left.start) : Number.NaN
    const rightTime = right.start ? Date.parse(right.start) : Number.NaN
    const leftKnown = Number.isFinite(leftTime)
    const rightKnown = Number.isFinite(rightTime)
    if (leftKnown && rightKnown && leftTime !== rightTime)
      return leftTime - rightTime
    if (leftKnown !== rightKnown) return leftKnown ? -1 : 1
    return left.id - right.id
  })
}

function HistoryDayDetails({
  day,
  outletNames,
  correctionOptions,
  wide,
  onClose,
}: {
  day: EffectiveAttendanceDay
  outletNames?: ReadonlyMap<number, string | null>
  correctionOptions?: PersonalCorrectionOptions
  wide: boolean
  onClose: () => void
}) {
  const entries = historyEntries(day)
  const description = `${attendanceOutcomeLabel(day.outcome)} · ${entries.length} sesi`
  const descriptionId = useId()
  if (wide) {
    return (
      <Sheet open onOpenChange={(open) => !open && onClose()}>
        <SheetContent
          aria-modal="true"
          aria-describedby={descriptionId}
          className="w-full overflow-hidden pb-[env(safe-area-inset-bottom)] sm:max-w-md"
          side="right"
        >
          <SheetHeader className="shrink-0 gap-1 px-5 pb-3 pt-5 pr-14">
            <SheetTitle>Presensi · {formatWorkDate(day.work_date)}</SheetTitle>
            <SheetDescription id={descriptionId}>
              {description}
            </SheetDescription>
          </SheetHeader>
          <DayDetailContent
            correctionOptions={correctionOptions}
            day={day}
            entries={entries}
            outletNames={outletNames}
          />
        </SheetContent>
      </Sheet>
    )
  }

  return (
    <Drawer open onOpenChange={(open) => !open && onClose()}>
      <DrawerContent
        aria-modal="true"
        aria-describedby={descriptionId}
        className="max-h-[85dvh] overflow-hidden pb-0"
      >
        <DrawerHeader className="shrink-0 px-5 pb-2 pt-1 text-left">
          <DrawerTitle>Presensi · {formatWorkDate(day.work_date)}</DrawerTitle>
          <DrawerDescription id={descriptionId}>
            {description}
          </DrawerDescription>
        </DrawerHeader>
        <DayDetailContent
          correctionOptions={correctionOptions}
          day={day}
          entries={entries}
          outletNames={outletNames}
        />
      </DrawerContent>
    </Drawer>
  )
}

function DayDetailContent({
  day,
  entries,
  outletNames,
  correctionOptions,
}: {
  day: EffectiveAttendanceDay
  entries: HistoryEntry[]
  outletNames?: ReadonlyMap<number, string | null>
  correctionOptions?: PersonalCorrectionOptions
}) {
  const reconstructions = correctionOptions?.reconstructions.filter(
    (option) => option.work_date === day.work_date && option.can_start
  )

  return (
    <div className="flex min-h-0 flex-col gap-4 overflow-y-auto overscroll-contain px-4 pb-[calc(1.25rem+env(safe-area-inset-bottom))]">
      <p className="text-caption text-muted-foreground">
        {day.is_finalized ? "Hasil ditetapkan" : "Belum ditetapkan"}
        {day.review.status === "pending" && " · Perlu ditinjau"}
        {day.review.status === "resolved" && " · Sudah ditinjau"}
      </p>
      {day.unresolved_conflicts.length > 0 && (
        <p className="text-caption">
          {day.unresolved_conflicts.map(reviewIndicatorLabel).join(" · ")}
        </p>
      )}
      {entries.length === 0 ? (
        <p className="py-4 text-body">Belum ada sesi pada tanggal kerja ini.</p>
      ) : (
        <ol
          aria-label="Sesi berurutan berdasarkan waktu masuk"
          className="flex flex-col divide-y divide-border"
        >
          {entries.map((entry, index) => (
            <li key={`${entry.kind}-${entry.id}`}>
              {entry.kind === "physical_session" ? (
                <PhysicalSessionSummary
                  day={day}
                  session={entry.session}
                  sessionNumber={index + 1}
                  outletNames={outletNames}
                  correctionOptions={correctionOptions}
                />
              ) : (
                <ReconstructionSummary
                  day={day}
                  entry={entry}
                  sessionNumber={index + 1}
                  outletNames={outletNames}
                />
              )}
            </li>
          ))}
        </ol>
      )}
      {Boolean(reconstructions?.length && correctionOptions) && (
        <details className="group border-t border-border pt-2">
          <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 rounded-md px-2 text-label outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
            <span className="group-open:hidden">Koreksi sesi terlewat</span>
            <span className="hidden group-open:inline">
              Sembunyikan koreksi sesi terlewat
            </span>
            <HugeiconsIcon
              icon={ArrowDown01Icon}
              className="size-4 text-muted-foreground transition-transform group-open:rotate-180"
              aria-hidden="true"
            />
          </summary>
          <div className="flex flex-col gap-2 px-2 pt-2">
            {reconstructions?.map((option) =>
              correctionOptions ? (
                <Button
                  className="min-h-11 self-start"
                  key={`${option.work_date}-${option.outlet.id}`}
                  nativeButton={false}
                  render={
                    <a href={correctionHref(correctionOptions, option)} />
                  }
                  variant="outline"
                >
                  Ajukan sesi terlewat · {option.outlet.name}
                </Button>
              ) : null
            )}
          </div>
        </details>
      )}
    </div>
  )
}

function ReconstructionSummary({
  day,
  entry,
  sessionNumber,
  outletNames,
}: {
  day: EffectiveAttendanceDay
  entry: Extract<HistoryEntry, { kind: "reconstruction" }>
  sessionNumber: number
  outletNames?: ReadonlyMap<number, string | null>
}) {
  const outletName =
    outletNames?.get(entry.outletId) ??
    (day.outlet?.id === entry.outletId ? day.outlet.name : null) ??
    `#${entry.outletId}`
  const timezone =
    day.outlet?.id === entry.outletId ? day.schedule?.timezone : undefined

  return (
    <section
      className="flex flex-col gap-3 py-4"
      aria-label={`Sesi ${sessionNumber} · Rekonstruksi disetujui`}
    >
      <div className="flex min-w-0 flex-col gap-1">
        <p className="text-label">Sesi {sessionNumber}</p>
        <p className="text-body font-medium">Rekonstruksi disetujui</p>
        <p className="text-caption text-muted-foreground">{outletName}</p>
      </div>
      <SessionTimes
        checkIn={entry.checkIn}
        checkOut={entry.checkOut}
        timezone={timezone}
        prominent
      />
      <details className="group">
        <summary className="flex min-h-11 w-full cursor-pointer list-none items-center justify-between gap-3 rounded-md px-2 text-label outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
          <span className="group-open:hidden">Lihat detail</span>
          <span className="hidden group-open:inline">Sembunyikan detail</span>
          <HugeiconsIcon
            icon={ArrowDown01Icon}
            className="size-4 text-muted-foreground transition-transform group-open:rotate-180"
            aria-hidden="true"
          />
        </summary>
        <dl className="mt-2 grid gap-3 text-body sm:grid-cols-2">
          <div>
            <dt className="text-caption">Work Date efektif</dt>
            <dd>{formatWorkDate(day.work_date)}</dd>
          </div>
          <div>
            <dt className="text-caption">Outlet efektif</dt>
            <dd>{outletName}</dd>
          </div>
        </dl>
      </details>
    </section>
  )
}

function PhysicalSessionSummary({
  day,
  session,
  sessionNumber,
  outletNames,
  correctionOptions,
}: {
  day: EffectiveAttendanceDay
  session: EffectiveAttendanceSession
  sessionNumber: number
  outletNames?: ReadonlyMap<number, string | null>
  correctionOptions?: PersonalCorrectionOptions
}) {
  const originId = originalOutletId(day, session)
  const originName =
    session.original.outlet?.id === originId
      ? session.original.outlet?.name
      : originId === session.outlet.id
        ? session.outlet.name
        : originId !== undefined
          ? outletNames?.get(originId)
          : null
  const pending = day.pending_corrections?.find(
    ({ details }) => details.attendance_session_id === session.id
  )
  const timezone = session.schedule_snapshot?.timezone
  const destination = session.checkout_destination
  const checkoutTimezone =
    destination && destination.id !== originId
      ? (destination.timezone ?? undefined)
      : (destination?.timezone ?? timezone)
  const status = sessionStatusLabel(session.recording_status)
  const summaryCheckInTimezone =
    session.correction && originId !== session.outlet.id ? undefined : timezone
  const summaryCheckoutTimezone =
    session.correction && originId !== session.outlet.id
      ? undefined
      : checkoutTimezone

  const originalOutlet =
    originName ?? (originId ? `#${originId}` : "Belum tersedia")
  const summaryCheckIn = session.correction
    ? session.effective.check_in_at
    : (session.effective.check_in_at ?? session.original.check_in_at)
  const summaryCheckOut = session.correction
    ? session.effective.check_out_at
    : (session.effective.check_out_at ?? session.original.check_out_at)
  const detailCorrection = correctionOptions?.sessions.find(
    (option) => option.session_id === session.id && option.can_start
  )
  const effectiveTimezone =
    originId === session.outlet.id ? timezone : undefined

  return (
    <section
      className="flex flex-col gap-3 py-4"
      aria-label={`Sesi ${sessionNumber} · ${status}`}
    >
      <div className="flex min-w-0 flex-col gap-1">
        <p className="text-label">Sesi {sessionNumber}</p>
        <p className="text-body font-medium">{status}</p>
        <p className="truncate text-caption text-muted-foreground">
          {originalOutlet}
        </p>
      </div>
      <SessionTimes
        checkIn={summaryCheckIn}
        checkOut={summaryCheckOut}
        checkInTimezone={summaryCheckInTimezone}
        checkOutTimezone={summaryCheckoutTimezone}
        prominent
      />
      <details className="group">
        <summary className="flex min-h-11 w-full cursor-pointer list-none items-center justify-between gap-3 rounded-md px-2 text-label outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
          <span className="group-open:hidden">Lihat detail</span>
          <span className="hidden group-open:inline">Sembunyikan detail</span>
          <HugeiconsIcon
            icon={ArrowDown01Icon}
            className="size-4 text-muted-foreground transition-transform group-open:rotate-180"
            aria-hidden="true"
          />
        </summary>
        <div className="mt-2 flex flex-col gap-3">
          <dl className="grid gap-3 text-body sm:grid-cols-2">
            <div>
              <dt className="text-caption">Work Date asal</dt>
              <dd>
                <time dateTime={session.original.work_date}>
                  {formatWorkDate(session.original.work_date)}
                </time>
              </dd>
            </div>
            <div>
              <dt className="text-caption">Outlet asal</dt>
              <dd>{originalOutlet}</dd>
            </div>
            {session.correction && (
              <>
                <div>
                  <dt className="text-caption">Work Date efektif</dt>
                  <dd>
                    <time dateTime={session.effective.work_date}>
                      {formatWorkDate(session.effective.work_date)}
                    </time>
                  </dd>
                </div>
                <div>
                  <dt className="text-caption">Outlet efektif</dt>
                  <dd>{session.outlet.name ?? `#${session.outlet.id}`}</dd>
                </div>
              </>
            )}
            {session.original.check_out_at && (
              <div>
                <dt className="text-caption">Outlet tujuan keluar</dt>
                <dd>
                  {destination?.name ??
                    (destination ? `#${destination.id}` : "Belum tersedia")}
                  {destination?.timezone && ` · ${destination.timezone}`}
                </dd>
              </div>
            )}
          </dl>
          <div className="flex flex-col gap-1">
            <p className="text-label">Waktu tercatat</p>
            <SessionTimes
              checkIn={session.original.check_in_at}
              checkOut={session.original.check_out_at}
              checkInTimezone={timezone}
              checkOutTimezone={checkoutTimezone}
            />
          </div>
          {session.correction && (
            <div className="flex flex-col gap-1">
              <p className="text-label">Koreksi disetujui</p>
              <SessionTimes
                checkIn={session.effective.check_in_at}
                checkOut={session.effective.check_out_at}
                checkInTimezone={effectiveTimezone}
                checkOutTimezone={effectiveTimezone}
              />
            </div>
          )}
          {session.recording_status === "active" && (
            <p className="text-caption">Sesi masih terbuka</p>
          )}
          {session.review_indicators.length > 0 && (
            <p className="text-caption text-muted-foreground">
              {session.review_indicators.map(reviewIndicatorLabel).join(" · ")}
            </p>
          )}
          {session.evidence?.map((evidence) =>
            evidence.available ? (
              <AttendancePhoto
                key={evidence.event_id}
                evidence={evidence}
                sessionId={session.id}
              />
            ) : (
              <p
                key={evidence.event_id}
                className="text-caption text-muted-foreground"
              >
                Foto {evidence.type === "check_in" ? "masuk" : "keluar"} tidak
                tersedia
              </p>
            )
          )}
          {!session.evidence &&
            session.original.events?.some((event) => event.has_evidence) && (
              <p className="text-caption text-muted-foreground">
                Akses foto dari riwayat belum tersedia.
              </p>
            )}
          {pending && (
            <Button
              className="min-h-11 self-start"
              nativeButton={false}
              render={<a href={`/requests#request-${pending.id}`} />}
              variant="outline"
            >
              Lihat koreksi yang menunggu
            </Button>
          )}
          {detailCorrection && correctionOptions && (
            <Button
              className="min-h-11 self-start"
              nativeButton={false}
              render={
                <a href={correctionHref(correctionOptions, detailCorrection)} />
              }
              variant="outline"
            >
              Koreksi{" "}
              {correctionTypeLabel(
                detailCorrection.correction_type
              ).toLocaleLowerCase("id-ID")}
            </Button>
          )}
        </div>
      </details>
    </section>
  )
}

function AttendancePhoto({
  evidence,
  sessionId,
}: {
  evidence: NonNullable<EffectiveAttendanceSession["evidence"]>[number]
  sessionId: number
}) {
  const [open, setOpen] = useState(false)
  const [url, setUrl] = useState("")
  const [error, setError] = useState("")
  const [attempt, setAttempt] = useState(0)
  const label = evidence.type === "check_in" ? "masuk" : "keluar"

  // biome-ignore lint/correctness/useExhaustiveDependencies: ponytail: Retry repeats the authenticated read without changing its target.
  useEffect(() => {
    if (!open) return
    const controller = new AbortController()
    let objectUrl = ""
    setUrl("")
    setError("")
    void apiRequest<Blob>(
      `/attendance/me/events/${evidence.event_id}/evidence`,
      {
        responseType: "blob",
        signal: controller.signal,
      }
    )
      .then((blob) => {
        if (controller.signal.aborted) return
        if (!["image/jpeg", "image/webp"].includes(blob.type))
          throw new Error("Invalid attendance image")
        objectUrl = URL.createObjectURL(blob)
        setUrl(objectUrl)
      })
      .catch((caught) => {
        if (controller.signal.aborted) return
        const recovery = getAuthRecoveryPath(caught)
        if (recovery) window.location.assign(recovery)
        else
          setError(
            caught instanceof ApiError && [403, 404].includes(caught.status)
              ? "Foto kedaluwarsa atau tidak tersedia untuk akun ini."
              : "Foto belum dapat dimuat. Coba lagi."
          )
      })
    const close = () => setOpen(false)
    const onStorage = (event: StorageEvent) => {
      if (event.key === attendanceIdentityChangeSignalKey()) close()
    }
    const onVisibility = () => {
      if (document.hidden) close()
    }
    window.addEventListener(attendanceIdentityChangeEventName(), close)
    window.addEventListener("storage", onStorage)
    document.addEventListener("visibilitychange", onVisibility)
    return () => {
      controller.abort()
      if (objectUrl) URL.revokeObjectURL(objectUrl)
      window.removeEventListener(attendanceIdentityChangeEventName(), close)
      window.removeEventListener("storage", onStorage)
      document.removeEventListener("visibilitychange", onVisibility)
    }
  }, [open, evidence.event_id, attempt])

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={<Button className="min-h-11 self-start" variant="outline" />}
      >
        Lihat foto {label} · sesi #{sessionId}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Foto presensi {label}</DialogTitle>
          <DialogDescription>Sesi #{sessionId}</DialogDescription>
        </DialogHeader>
        {error ? (
          <Alert variant="destructive">
            <AlertTitle>Foto tidak tersedia</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
            <Button
              className="mt-2"
              onClick={() => setAttempt((value) => value + 1)}
              variant="outline"
            >
              Coba lagi
            </Button>
          </Alert>
        ) : url ? (
          <img
            alt={`Foto presensi ${label} sesi #${sessionId}`}
            src={url}
            width={640}
            height={640}
            className="aspect-square max-h-[60svh] w-full object-contain"
          />
        ) : (
          <div role="status" className="flex flex-col gap-2">
            <Skeleton className="aspect-square w-full" />
            <p className="text-caption">Memuat foto…</p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

function SessionTimes({
  checkIn,
  checkOut,
  timezone,
  checkInTimezone = timezone,
  checkOutTimezone = timezone,
  prominent = false,
}: {
  checkIn: string | null
  checkOut: string | null
  timezone?: string
  checkInTimezone?: string
  checkOutTimezone?: string
  prominent?: boolean
}) {
  const valueClass = (value: string | null) =>
    prominent
      ? `mt-1 ${value ? "text-title font-semibold" : "text-body font-medium"} tabular-nums`
      : "text-caption"

  return (
    <dl className="grid grid-cols-2 gap-3">
      <div>
        <dt className="text-caption text-muted-foreground">Masuk</dt>
        <dd className={valueClass(checkIn)}>
          {prominent
            ? formatCompactTime(checkIn, checkInTimezone)
            : formatAttendanceTime(checkIn, checkInTimezone)}
        </dd>
      </div>
      <div>
        <dt className="text-caption text-muted-foreground">Keluar</dt>
        <dd className={valueClass(checkOut)}>
          {prominent
            ? formatCompactTime(checkOut, checkOutTimezone)
            : formatAttendanceTime(checkOut, checkOutTimezone)}
        </dd>
      </div>
    </dl>
  )
}

function formatCompactTime(value: string | null, timezone?: string): string {
  if (!value) return "Belum tercatat"
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return "Waktu tidak tersedia"
  const options: Intl.DateTimeFormatOptions = {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }
  if (timezone) {
    try {
      return new Intl.DateTimeFormat("id-ID", {
        ...options,
        timeZone: timezone,
      }).format(date)
    } catch {
      return `${date.toISOString()} (zona waktu tidak tersedia)`
    }
  }
  return `${new Intl.DateTimeFormat("id-ID", {
    ...options,
    timeZone: "UTC",
  }).format(date)} UTC · zona Outlet tidak tersedia`
}

function sessionStatusLabel(status: string): string {
  switch (status) {
    case "active":
      return "Sesi masih terbuka"
    case "administratively_resolved":
      return "Diselesaikan secara administratif"
    case "closed":
      return "Selesai"
    default:
      return "Status sesi belum tersedia"
  }
}
