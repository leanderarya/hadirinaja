import { ChevronDown, ClipboardList } from "lucide-react"
import { useEffect, useId, useRef, type ReactNode } from "react"
import { Field, FieldLabel, FieldDescription } from "@/components/ui/field"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { cn } from "@/lib/utils"

export interface ScheduleDaySummary {
  work_date: string
  status: "scheduled" | "rest" | "unscheduled"
  outlet: { id: number; name: string } | null
  shift: {
    start_time: string
    end_time: string
    crosses_midnight: boolean
  } | null
  provenance: {
    source: string
    schedule_rule_id: number | null
    exception_id: number | null
  }
  conflicts: string[]
}

export function workDateLabel(
  value: string,
  options: Intl.DateTimeFormatOptions = {
    day: "numeric",
    month: "short",
    year: "numeric",
  }
) {
  return new Intl.DateTimeFormat("id-ID", options).format(
    new Date(`${value}T12:00:00`)
  )
}

export function scheduleTimeLabel(day: ScheduleDaySummary) {
  if (day.conflicts.length) return "Konflik"
  if (day.status === "rest") return "Libur"
  if (day.status !== "scheduled" || !day.shift) return "Belum diatur"
  const clock = (value: string) => value.slice(0, 5).replace(/:00$/, "")
  return `${clock(day.shift.start_time)}–${clock(day.shift.end_time)}${day.shift.crosses_midnight ? " +1" : ""}${day.provenance.exception_id ? "*" : ""}`
}

export function WorkWeekControl({
  weekStart,
  onChange,
  disabled = false,
}: {
  weekStart: string
  onChange: (value: string) => void
  disabled?: boolean
}) {
  const id = useId()
  const details = useRef<HTMLDetailsElement>(null)
  useEffect(() => {
    const close = (event: PointerEvent) => {
      if (
        details.current?.open &&
        !details.current.contains(event.target as Node)
      )
        details.current.open = false
    }
    document.addEventListener("pointerdown", close)
    return () => document.removeEventListener("pointerdown", close)
  }, [])
  const end = new Date(`${weekStart}T12:00:00`)
  end.setDate(end.getDate() + 6)
  const endDate = `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, "0")}-${String(end.getDate()).padStart(2, "0")}`
  return (
    <Field data-pen-origin="jr3jc">
      <FieldLabel id={`${id}-label`}>Minggu kerja</FieldLabel>
      <details
        ref={details}
        className="relative min-w-0"
        onKeyDown={(event) => {
          if (event.key === "Escape" && details.current) {
            details.current.open = false
            details.current.querySelector("summary")?.focus()
          }
        }}
      >
        <summary
          role="button"
          aria-labelledby={`${id}-label ${id}-value`}
          aria-disabled={disabled}
          onClick={(event) => {
            if (disabled) event.preventDefault()
          }}
          className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 rounded-[9px] border border-border bg-canvas px-3 text-body focus-visible:outline-2 focus-visible:outline-primary [&::-webkit-details-marker]:hidden"
        >
          <span id={`${id}-value`}>
            {workDateLabel(weekStart, { day: "numeric", month: "short" })}–
            {workDateLabel(endDate)}
          </span>
          <ChevronDown aria-hidden="true" size={14} />
        </summary>
        <div className="absolute start-0 top-[calc(100%+8px)] z-40 flex w-full flex-col gap-3 rounded-[16px] border border-border bg-surface p-4 shadow-[var(--shadow-overlay)]">
          <label className="text-label" htmlFor={`${id}-date`}>
            Pilih tanggal dalam minggu
          </label>
          <Input
            id={`${id}-date`}
            type="date"
            value={weekStart}
            disabled={disabled}
            onChange={(e) => {
              if (e.target.value) {
                onChange(e.target.value)
                if (details.current) details.current.open = false
                details.current?.querySelector("summary")?.focus()
              }
            }}
          />
          <div className="flex flex-wrap gap-2">
            {[-7, 7].map((offset) => (
              <Button
                key={offset}
                disabled={disabled}
                variant="outline"
                onClick={() => {
                  const date = new Date(`${weekStart}T12:00:00`)
                  date.setDate(date.getDate() + offset)
                  onChange(
                    `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
                  )
                  if (details.current) details.current.open = false
                  details.current?.querySelector("summary")?.focus()
                }}
              >
                {offset < 0 ? "Minggu sebelumnya" : "Minggu berikutnya"}
              </Button>
            ))}
          </div>
        </div>
      </details>
      <FieldDescription>Jam lokal mengikuti Outlet.</FieldDescription>
    </Field>
  )
}

export function ScheduleMatrix<T extends ScheduleDaySummary>({
  days,
  employees,
  onSelect,
}: {
  days: string[]
  employees: Array<{ id: number; name: string; days: T[] }>
  onSelect: (employee: { id: number; name: string }, day: T) => void
}) {
  function dayButton(employee: { id: number; name: string }, day: T) {
    return (
      <button
        type="button"
        aria-label={`${employee.name}, ${workDateLabel(day.work_date)}, ${scheduleTimeLabel(day)}. Buka rincian jadwal`}
        onClick={() => onSelect(employee, day)}
        className={cn(
          "flex min-h-11 w-full min-w-0 items-center justify-center rounded-[8px] px-1 py-2 text-caption text-foreground focus-visible:outline-2 focus-visible:outline-primary",
          day.status === "rest" && "text-muted-foreground",
          day.provenance.exception_id && "bg-brand-50 text-brand-700",
          day.conflicts.length && "bg-danger-soft text-danger-strong"
        )}
      >
        {scheduleTimeLabel(day)}
      </button>
    )
  }
  return (
    <div data-r2c-schedule-matrix>
      <div className="hidden overflow-hidden rounded-[16px] border border-border bg-surface lg:block">
        <Table className="table-fixed">
          <caption className="sr-only">
            Jadwal mingguan per karyawan. Pilih hari untuk rincian sumber, versi
            dan konflik.
          </caption>
          <TableHeader>
            <TableRow className="h-11 bg-canvas">
              <TableHead className="w-[22%] px-3 text-caption">
                Karyawan / Outlet
              </TableHead>
              {days.map((date) => (
                <TableHead key={date} className="px-1 text-center text-caption">
                  {workDateLabel(date, { weekday: "short", day: "numeric" })}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {employees.map((employee) => (
              <TableRow key={employee.id} className="h-[76px]">
                <TableCell className="whitespace-normal px-3 py-3">
                  <p className="text-label wrap-anywhere">{employee.name}</p>
                  <p className="text-caption">
                    {Array.from(
                      new Set(
                        employee.days.map((d) => d.outlet?.name).filter(Boolean)
                      )
                    ).join(" · ") || "Tanpa Outlet"}
                  </p>
                </TableCell>
                {days.map((date) => {
                  const day = employee.days.find((d) => d.work_date === date)
                  return (
                    <TableCell
                      key={date}
                      className="whitespace-normal px-1 py-2"
                    >
                      {day ? (
                        dayButton(employee, day)
                      ) : (
                        <span className="text-caption">Tidak tersedia</span>
                      )}
                    </TableCell>
                  )
                })}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <div className="grid gap-3 lg:hidden">
        {employees.map((employee) => (
          <article
            key={employee.id}
            className="flex min-w-0 flex-col gap-3 rounded-[16px] border border-border bg-surface p-4"
          >
            <h2 className="text-label wrap-anywhere">{employee.name}</h2>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {employee.days.map((day) => (
                <div
                  key={day.work_date}
                  className="min-w-0 rounded-[10px] border border-border p-2"
                >
                  <p className="text-caption">
                    {workDateLabel(day.work_date, {
                      weekday: "short",
                      day: "numeric",
                    })}
                  </p>
                  <p className="text-caption wrap-anywhere">
                    {day.outlet?.name ?? "Tanpa Outlet"}
                  </p>
                  {dayButton(employee, day)}
                </div>
              ))}
            </div>
          </article>
        ))}
      </div>
    </div>
  )
}

export function OperationalSummary({
  title,
  children,
  action,
  onAction,
}: {
  title: string
  children: ReactNode
  action: string
  onAction: () => void
}) {
  return (
    <section className="flex min-w-0 flex-col items-start gap-3 rounded-[16px] border border-border bg-surface p-4">
      <h2 className="text-subtitle [font-size:17px]">{title}</h2>
      <div className="text-body [font-size:13px] text-muted-foreground">
        {children}
      </div>
      <Button variant="outline" className="text-[13px]" onClick={onAction}>
        <ClipboardList
          aria-hidden="true"
          data-icon="inline-start"
          className="text-brand-700"
        />
        {action}
      </Button>
    </section>
  )
}
