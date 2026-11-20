import { id } from "date-fns/locale"
import { useEffect, useMemo, useRef, useState } from "react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer"
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"

type ScheduleScenario = "varied" | "unknown" | "loading" | "error"
type ScheduleStatus =
  | "scheduled"
  | "rest"
  | "unscheduled"
  | "unpublished"
  | "unknown"

type PrototypeShift = {
  id: string
  name: string
  scheduled_start: string
  scheduled_end: string
  timezone: string
  outlet: { id: number; name: string }
}

type PrototypeDay = {
  work_date: string
  status: ScheduleStatus
  timezone: string
  shifts: PrototypeShift[]
}

const outlets = {
  menteng: { id: 1, name: "Outlet Menteng" },
  kemang: { id: 2, name: "Outlet Kemang" },
  kuningan: { id: 3, name: "Outlet Kuningan" },
}

const scenarioLabels: Record<ScheduleScenario, string> = {
  varied: "Jadwal beragam",
  unknown: "Jadwal belum tersedia",
  loading: "Sedang memuat",
  error: "Gagal memuat",
}

export function localScheduleDate(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

export function addScheduleDays(value: string, amount: number): string {
  const [year, month, day] = value.split("-").map(Number)
  const date = new Date(year, month - 1, day, 12)
  date.setDate(date.getDate() + amount)
  return localScheduleDate(date)
}

export function mondayForScheduleDate(value: string): string {
  const [year, month, day] = value.split("-").map(Number)
  const date = new Date(year, month - 1, day, 12)
  date.setDate(date.getDate() - ((date.getDay() + 6) % 7))
  return localScheduleDate(date)
}

function dateFromScheduleDate(value: string): Date {
  const [year, month, day] = value.split("-").map(Number)
  return new Date(year, month - 1, day, 12)
}

function formatDate(
  value: string,
  options: Intl.DateTimeFormatOptions
): string {
  return new Intl.DateTimeFormat("id-ID", {
    ...options,
    timeZone: "UTC",
  }).format(new Date(`${value}T12:00:00Z`))
}

function longDate(value: string): string {
  return formatDate(value, {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  })
}

function shortDate(value: string): string {
  return formatDate(value, {
    weekday: "long",
    day: "numeric",
    month: "short",
  })
}

function dateInRange(value: string): string {
  return formatDate(value, { day: "numeric", month: "short", year: "numeric" })
}

function weekRange(start: string, end: string): string {
  const startDate = dateFromScheduleDate(start)
  const endDate = dateFromScheduleDate(end)
  const sameMonth =
    startDate.getMonth() === endDate.getMonth() &&
    startDate.getFullYear() === endDate.getFullYear()
  if (sameMonth) {
    return `${startDate.getDate()}–${endDate.getDate()} ${formatDate(end, {
      month: "short",
      year: "numeric",
    })}`
  }
  return `${dateInRange(start)} – ${dateInRange(end)}`
}

function formatInstant(value: string, timezone: string): string {
  return new Intl.DateTimeFormat("id-ID", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: timezone,
  }).format(new Date(value))
}

function shiftTimeRange(shift: PrototypeShift, workDate: string): string {
  const endDate = shift.scheduled_end.slice(0, 10)
  const dayOffset = Math.max(
    0,
    Math.round(
      (dateFromScheduleDate(endDate).getTime() -
        dateFromScheduleDate(workDate).getTime()) /
        86_400_000
    )
  )
  const overnight = dayOffset ? ` (+${dayOffset} hari)` : ""
  return `${formatInstant(shift.scheduled_start, shift.timezone)}–${formatInstant(shift.scheduled_end, shift.timezone)}${overnight}`
}

function shift(
  workDate: string,
  id: string,
  name: string,
  start: string,
  end: string,
  outlet: PrototypeShift["outlet"],
  overnight = false
): PrototypeShift {
  const endDate = overnight ? addScheduleDays(workDate, 1) : workDate
  return {
    id,
    name,
    scheduled_start: `${workDate}T${start}:00+07:00`,
    scheduled_end: `${endDate}T${end}:00+07:00`,
    timezone: "Asia/Jakarta",
    outlet,
  }
}

function unknownDay(workDate: string): PrototypeDay {
  return {
    work_date: workDate,
    status: "unknown",
    timezone: "Asia/Jakarta",
    shifts: [],
  }
}

function makeWeek(
  weekStart: string,
  scenario: ScheduleScenario
): PrototypeDay[] {
  return Array.from({ length: 7 }, (_, index) => {
    const workDate = addScheduleDays(weekStart, index)
    if (scenario === "unknown") return unknownDay(workDate)

    switch (index) {
      case 0:
        return {
          work_date: workDate,
          status: "scheduled",
          timezone: "Asia/Jakarta",
          shifts: [
            shift(
              workDate,
              `${workDate}-morning`,
              "Shift pagi",
              "09:00",
              "17:00",
              outlets.menteng
            ),
          ],
        }
      case 1:
        return {
          work_date: workDate,
          status: "rest",
          timezone: "Asia/Jakarta",
          shifts: [],
        }
      case 2:
        return {
          work_date: workDate,
          status: "scheduled",
          timezone: "Asia/Jakarta",
          shifts: [
            shift(
              workDate,
              `${workDate}-afternoon`,
              "Shift siang",
              "13:30",
              "17:30",
              outlets.kemang
            ),
            shift(
              workDate,
              `${workDate}-morning`,
              "Shift pagi",
              "08:30",
              "12:00",
              outlets.menteng
            ),
          ],
        }
      case 3:
        return {
          work_date: workDate,
          status: "scheduled",
          timezone: "Asia/Jakarta",
          shifts: [
            shift(
              workDate,
              `${workDate}-overnight`,
              "Shift malam",
              "22:00",
              "02:00",
              outlets.kuningan,
              true
            ),
          ],
        }
      case 4:
        return {
          work_date: workDate,
          status: "unpublished",
          timezone: "Asia/Jakarta",
          shifts: [],
        }
      case 5:
        return {
          work_date: workDate,
          status: "scheduled",
          timezone: "Asia/Jakarta",
          shifts: [
            shift(
              workDate,
              `${workDate}-first`,
              "Shift pagi",
              "10:00",
              "13:00",
              outlets.kemang
            ),
            shift(
              workDate,
              `${workDate}-second`,
              "Shift sore",
              "14:00",
              "18:00",
              outlets.menteng
            ),
          ],
        }
      default:
        return {
          work_date: workDate,
          status: "unscheduled",
          timezone: "Asia/Jakarta",
          shifts: [],
        }
    }
  })
}

function chronologicalShifts(day: PrototypeDay): PrototypeShift[] {
  return [...day.shifts].sort(
    (left, right) =>
      new Date(left.scheduled_start).getTime() -
      new Date(right.scheduled_start).getTime()
  )
}

function dayStatusLabel(day: PrototypeDay): string {
  if (day.status === "scheduled") {
    return day.shifts.length > 0 ? "Jadwal tersedia" : "Jadwal belum diketahui"
  }
  if (day.status === "rest") return "Libur dikonfirmasi"
  if (day.status === "unpublished") return "Belum dipublikasikan"
  if (day.status === "unscheduled") return "Belum dijadwalkan"
  return "Jadwal belum diketahui"
}

function daySummary(day: PrototypeDay): string {
  if (day.status !== "scheduled" || day.shifts.length === 0) {
    return dayStatusLabel(day)
  }
  if (day.shifts.length > 1) return `${day.shifts.length} shift`
  const [single] = chronologicalShifts(day)
  return `${shiftTimeRange(single, day.work_date)} · ${single.outlet.name}`
}

function ShiftRows({ day }: { day: PrototypeDay }) {
  const shifts = chronologicalShifts(day)
  if (day.status !== "scheduled" || shifts.length === 0) {
    const message =
      day.status === "rest"
        ? "Hari libur dikonfirmasi untuk tanggal ini."
        : day.status === "unpublished"
          ? "Jadwal untuk tanggal ini belum dipublikasikan."
          : day.status === "unscheduled"
            ? "Jadwal belum diatur. Ini bukan konfirmasi hari libur."
            : "Informasi jadwal belum tersedia. Ini bukan konfirmasi hari libur."
    return (
      <p className="border-s-2 border-border ps-3 text-body" role="status">
        {message}
      </p>
    )
  }

  return (
    <ol
      aria-label="Shift berurutan berdasarkan waktu mulai"
      className="divide-y divide-border"
    >
      {shifts.map((item, index) => (
        <li className="py-3" key={item.id}>
          <p className="text-label">
            Shift {index + 1} · {item.name}
          </p>
          <p className="mt-1 text-title tabular-nums">
            {shiftTimeRange(item, day.work_date)}
          </p>
          <p className="mt-1 text-body text-muted-foreground">
            {item.outlet.name} · {item.timezone}
          </p>
        </li>
      ))}
    </ol>
  )
}

function ScheduleDayDetails({ day }: { day: PrototypeDay }) {
  return (
    <div
      className="flex min-h-0 flex-col gap-3 overflow-y-auto overscroll-contain px-4 pb-[calc(1rem+env(safe-area-inset-bottom))]"
      data-schedule-detail-scroll="true"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-3">
        <p className="text-label">{dayStatusLabel(day)}</p>
        {day.status === "scheduled" && day.shifts.length > 1 ? (
          <span className="text-caption text-muted-foreground">
            {day.shifts.length} shift
          </span>
        ) : null}
      </div>
      <ShiftRows day={day} />
    </div>
  )
}

function ScheduleDayDialog({
  day,
  wide,
  onClose,
}: {
  day: PrototypeDay
  wide: boolean
  onClose: () => void
}) {
  const title = `Jadwal · ${longDate(day.work_date)}`
  if (wide) {
    return (
      <Sheet open onOpenChange={(open) => !open && onClose()}>
        <SheetContent
          className="w-full overflow-hidden pb-[env(safe-area-inset-bottom)] sm:max-w-md"
          side="right"
        >
          <SheetHeader className="gap-1 border-b border-border px-5 pb-3 pt-5 pr-14">
            <SheetTitle>{title}</SheetTitle>
          </SheetHeader>
          <ScheduleDayDetails day={day} />
        </SheetContent>
      </Sheet>
    )
  }
  return (
    <Drawer open onOpenChange={(open) => !open && onClose()}>
      <DrawerContent className="max-h-[86dvh] overflow-hidden rounded-t-lg pb-0 before:rounded-lg">
        <DrawerHeader className="px-5 pb-2 pt-1 text-left">
          <DrawerTitle>{title}</DrawerTitle>
        </DrawerHeader>
        <ScheduleDayDetails day={day} />
      </DrawerContent>
    </Drawer>
  )
}

function TodaySummary({ today, day }: { today: string; day: PrototypeDay }) {
  const shifts = chronologicalShifts(day)
  return (
    <section
      aria-labelledby="schedule-today-title"
      className="rounded-lg border border-border bg-primary/5 p-4"
      data-schedule-today="true"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="text-subtitle" id="schedule-today-title">
            Hari ini
          </h2>
          <time className="text-caption text-muted-foreground" dateTime={today}>
            {longDate(today)}
          </time>
        </div>
        {day.status === "scheduled" && shifts.length > 0 ? (
          <span className="text-label">{shifts.length} shift hari ini</span>
        ) : null}
      </div>
      {day.status === "scheduled" && shifts.length > 0 ? (
        <ol
          aria-label="Shift hari ini"
          className="mt-3 divide-y divide-border/70"
        >
          {shifts.map((item) => (
            <li
              className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2 first:pt-0 last:pb-0"
              key={item.id}
            >
              <span className="min-w-0 text-body font-medium">{item.name}</span>
              <span className="text-body tabular-nums">
                {shiftTimeRange(item, day.work_date)}
              </span>
              <span className="w-full text-caption text-muted-foreground">
                {item.outlet.name}
              </span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="mt-2 text-body">{dayStatusLabel(day)}</p>
      )}
    </section>
  )
}

export function EmployeeSchedulePrototype() {
  const [today] = useState(() => localScheduleDate(new Date()))
  const [weekStart, setWeekStart] = useState(() => mondayForScheduleDate(today))
  const [scenario, setScenario] = useState<ScheduleScenario>("varied")
  const [pickerOpen, setPickerOpen] = useState(false)
  const [devPanelOpen, setDevPanelOpen] = useState(false)
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const [wide, setWide] = useState(false)
  const detailOpener = useRef<HTMLButtonElement | null>(null)
  const todayWeekStart = mondayForScheduleDate(today)
  const todayDay = useMemo(
    () =>
      makeWeek(
        todayWeekStart,
        scenario === "unknown" ? "unknown" : "varied"
      ).find((day) => day.work_date === today) ?? unknownDay(today),
    [scenario, today, todayWeekStart]
  )
  const weekEnd = addScheduleDays(weekStart, 6)
  const weekDates = Array.from({ length: 7 }, (_, index) =>
    addScheduleDays(weekStart, index)
  )
  const days = useMemo(
    () => makeWeek(weekStart, scenario === "unknown" ? "unknown" : "varied"),
    [scenario, weekStart]
  )
  const selectedDay = days.find((day) => day.work_date === selectedDate) ?? null
  const isLoading = scenario === "loading"
  const hasError = scenario === "error"

  useEffect(() => {
    const media = window.matchMedia("(min-width: 768px)")
    const update = () => setWide(media.matches)
    update()
    media.addEventListener("change", update)
    return () => media.removeEventListener("change", update)
  }, [])

  useEffect(() => {
    if (selectedDate !== null || !detailOpener.current) return
    window.requestAnimationFrame(() => detailOpener.current?.focus())
  }, [selectedDate])

  const selectWeekForDate = (date: Date | undefined) => {
    if (!date) return
    const value = localScheduleDate(date)
    setWeekStart(mondayForScheduleDate(value))
    setPickerOpen(false)
  }
  const changeWeek = (offset: number) => {
    setWeekStart(addScheduleDays(weekStart, offset * 7))
  }
  const openDay = (day: PrototypeDay, trigger: HTMLButtonElement) => {
    detailOpener.current = trigger
    setSelectedDate(day.work_date)
  }
  const closeDay = () => setSelectedDate(null)
  const rangeLabel = weekRange(weekStart, weekEnd)

  return (
    <div
      className="min-h-svh bg-canvas text-foreground"
      data-schedule-prototype="true"
    >
      <header className="sticky top-0 z-40 border-b border-border bg-surface pt-[env(safe-area-inset-top)]">
        <div className="relative mx-auto flex min-h-14 w-full max-w-2xl items-center justify-center px-3">
          <a
            aria-label="Kembali ke Presensi prototype"
            className="absolute left-3 inline-flex min-h-11 min-w-11 cursor-pointer items-center justify-center rounded-md px-2 text-caption outline-none hover:bg-muted active:bg-muted/70 focus-visible:ring-2 focus-visible:ring-ring"
            href="/dev-employee-mobile-prototype"
          >
            <span aria-hidden="true">‹</span>
            <span className="sr-only">Presensi</span>
          </a>
          <h1 className="text-subtitle">Jadwal</h1>
        </div>
        <p className="pb-2 text-center text-caption text-muted-foreground">
          Pratinjau · data sintetis · tanpa API
        </p>
      </header>

      <main className="mx-auto flex w-full max-w-2xl flex-col gap-5 px-4 pb-[max(2rem,env(safe-area-inset-bottom))] pt-4 sm:pt-6">
        <TodaySummary day={todayDay} today={today} />

        <section
          aria-labelledby="schedule-week-title"
          className="flex flex-col gap-3"
        >
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-subtitle" id="schedule-week-title">
              Jadwal mingguan
            </h2>
            <span className="text-caption text-muted-foreground">
              Senin–Minggu
            </span>
          </div>

          <div
            className="relative mx-auto flex min-h-11 w-full max-w-xs items-center justify-center"
            data-week-navigation="true"
          >
            <Button
              aria-label="Minggu sebelumnya"
              className="absolute left-0 top-1/2 size-11 -translate-y-1/2 rounded-md"
              onClick={() => changeWeek(-1)}
              size="icon"
              variant="ghost"
            >
              <span aria-hidden="true">‹</span>
            </Button>
            <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
              <PopoverTrigger
                render={
                  <Button
                    aria-label={`Pilih tanggal untuk minggu ${longDate(weekStart)} sampai ${longDate(weekEnd)}`}
                    className="min-h-11 min-w-0 max-w-[calc(100%-6rem)] justify-center gap-2 rounded-md px-2 text-label"
                    variant="ghost"
                  />
                }
              >
                <span className="truncate">{rangeLabel}</span>
                <span aria-hidden="true">⌄</span>
              </PopoverTrigger>
              <PopoverContent
                align="center"
                className="max-h-[var(--available-height)] w-auto max-w-[calc(100vw-1rem)] gap-2 overflow-y-auto rounded-lg p-2"
                sideOffset={6}
              >
                <PopoverHeader className="px-2 pt-1">
                  <PopoverTitle>Pilih tanggal</PopoverTitle>
                  <PopoverDescription>
                    Minggu ditampilkan dari Senin sampai Minggu.
                  </PopoverDescription>
                </PopoverHeader>
                <Calendar
                  autoFocus
                  className="[--cell-radius:6px] [--cell-size:2.25rem]"
                  defaultMonth={dateFromScheduleDate(weekStart)}
                  labels={{
                    labelDayButton: (date, modifiers) => {
                      const label = new Intl.DateTimeFormat("id-ID", {
                        weekday: "long",
                        day: "numeric",
                        month: "long",
                        year: "numeric",
                      }).format(date)
                      return `${modifiers.today ? "Hari ini, " : ""}${label}${modifiers.selected ? ", dipilih" : ""}`
                    },
                    labelNav: () => "Navigasi kalender",
                    labelNext: () => "Bulan berikutnya",
                    labelPrevious: () => "Bulan sebelumnya",
                  }}
                  locale={id}
                  mode="single"
                  onSelect={selectWeekForDate}
                  required
                  selected={dateFromScheduleDate(weekStart)}
                  weekStartsOn={1}
                />
              </PopoverContent>
            </Popover>
            <Button
              aria-label="Minggu berikutnya"
              className="absolute right-0 top-1/2 size-11 -translate-y-1/2 rounded-md"
              onClick={() => changeWeek(1)}
              size="icon"
              variant="ghost"
            >
              <span aria-hidden="true">›</span>
            </Button>
          </div>

          {scenario === "unknown" ? (
            <p
              className="border-s-2 border-border ps-3 text-caption text-muted-foreground"
              role="status"
            >
              Jadwal belum tersedia. Data kosong tidak berarti hari libur.
            </p>
          ) : null}
          {isLoading ? (
            <p className="py-4 text-body text-muted-foreground" role="status">
              Memuat jadwal contoh…
            </p>
          ) : null}
          {hasError ? (
            <Alert
              className="rounded-lg border-0 border-s-2 bg-transparent p-0 ps-3 shadow-none"
              variant="destructive"
            >
              <AlertTitle>Jadwal minggu ini belum dapat dimuat</AlertTitle>
              <AlertDescription>
                Status hari tidak disimpulkan dari data yang gagal dimuat.
              </AlertDescription>
              <Button
                className="mt-2 w-fit"
                onClick={() => setScenario("varied")}
                variant="outline"
              >
                Coba lagi
              </Button>
            </Alert>
          ) : null}
          {!isLoading && !hasError ? (
            <ol
              aria-label="Jadwal Senin sampai Minggu"
              className="divide-y divide-border"
              data-schedule-week-list="true"
            >
              {weekDates.map((workDate) => {
                const day =
                  days.find((item) => item.work_date === workDate) ??
                  unknownDay(workDate)
                const todayRow = workDate === today
                const summary = daySummary(day)
                return (
                  <li key={workDate}>
                    <button
                      aria-label={`${shortDate(workDate)}${todayRow ? ", hari ini" : ""}. ${summary}. Buka detail jadwal`}
                      className="flex min-h-[68px] w-full cursor-pointer items-center gap-3 py-3 text-left outline-none hover:bg-muted/30 active:bg-muted/50 focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                      onClick={(event) => openDay(day, event.currentTarget)}
                      type="button"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block text-label">
                          {shortDate(workDate)}
                          {todayRow ? " · Hari ini" : ""}
                        </span>
                        <span className="mt-0.5 block truncate text-caption text-muted-foreground">
                          {summary}
                        </span>
                      </span>
                      <span
                        aria-hidden="true"
                        className="shrink-0 text-muted-foreground"
                      >
                        ›
                      </span>
                    </button>
                  </li>
                )
              })}
            </ol>
          ) : null}
        </section>

        <section className="border-t border-border pt-3">
          <button
            aria-controls="schedule-prototype-controls"
            aria-expanded={devPanelOpen}
            className="flex min-h-11 w-full cursor-pointer items-center justify-between gap-3 rounded-md text-left text-label outline-none hover:bg-muted/30 active:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring"
            onClick={() => setDevPanelOpen((open) => !open)}
            type="button"
          >
            <span>Panel pengembangan · skenario</span>
            <span aria-hidden="true">{devPanelOpen ? "−" : "+"}</span>
          </button>
          <div
            className="py-3"
            hidden={!devPanelOpen}
            id="schedule-prototype-controls"
          >
            <label className="flex max-w-sm flex-col gap-1 text-caption">
              Skenario jadwal sintetis
              <select
                className="min-h-11 cursor-pointer rounded-md border border-input bg-background px-3 text-body outline-none hover:bg-muted/30 focus-visible:ring-2 focus-visible:ring-ring"
                onChange={(event) =>
                  setScenario(event.target.value as ScheduleScenario)
                }
                value={scenario}
              >
                {Object.entries(scenarioLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </section>
      </main>

      {selectedDay ? (
        <ScheduleDayDialog day={selectedDay} onClose={closeDay} wide={wide} />
      ) : null}
    </div>
  )
}
