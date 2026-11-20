import { useEffect, useState } from "react"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Field, FieldLabel } from "@/components/ui/field"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  type PlannerEntry,
  plannerDateLabel,
  plannerDates,
  plannerEntryKey,
  type Staffing,
  type StaffingReport,
  type StaffingRole,
  staffingLabels,
  staffingRoles,
} from "@/lib/weekly-planner"

type PlannerView = "day" | "week"

export function WeeklyPlannerBoard({
  weekStart,
  entries,
  employees,
  report,
  staffing,
  shiftLabels,
  entryErrors = {},
  disabled = false,
  onEdit,
}: {
  weekStart: string
  entries: PlannerEntry[]
  employees: Array<{ id: number; name: string }>
  report?: StaffingReport
  staffing?: Staffing | null
  shiftLabels: Record<number, string>
  entryErrors?: Record<string, string[]>
  disabled?: boolean
  onEdit?: (date: string, entry?: PlannerEntry, role?: StaffingRole) => void
}) {
  const dates = plannerDates(weekStart)
  const [view, setView] = useState<PlannerView>("day")
  const [selectedDate, setSelectedDate] = useState(weekStart)

  useEffect(() => setSelectedDate(weekStart), [weekStart])

  const assignmentsFor = (date: string) =>
    entries.filter((entry) => entry.work_date === date)
  const reportFor = (date: string) =>
    report?.days.find((day) => day.work_date === date)
  const employeeName = (employeeId: number) =>
    employees.find((employee) => employee.id === employeeId)?.name ??
    "Karyawan tidak tersedia"

  function assignmentLabel(entry: PlannerEntry) {
    if (entry.status === "rest") return "Istirahat"
    if (entry.status === "unscheduled") return "Tidak dijadwalkan"
    return (
      shiftLabels[entry.shift_template_version_id ?? 0] ??
      "Shift tidak tersedia"
    )
  }

  function assignmentControl(entry: PlannerEntry) {
    const key = plannerEntryKey(entry)
    const rowErrors = entryErrors[key] ?? []
    const name = employeeName(entry.employee_id)
    return (
      <li key={key} className="flex min-w-0 flex-col gap-1">
        <Button
          variant="outline"
          className="h-auto min-h-11 w-full flex-col items-start whitespace-normal py-2 text-left"
          disabled={disabled || !onEdit}
          onClick={() => onEdit?.(entry.work_date, entry)}
          aria-label={`Ubah penugasan ${name}, ${plannerDateLabel(entry.work_date)}`}
        >
          <span className="text-label wrap-anywhere">{name}</span>
          <span className="text-caption wrap-anywhere">
            {assignmentLabel(entry)}
          </span>
        </Button>
        {rowErrors.length ? (
          <Alert variant="destructive" className="py-2">
            <AlertDescription className="text-caption">
              {rowErrors.join(" ")}
            </AlertDescription>
          </Alert>
        ) : null}
      </li>
    )
  }

  function assignmentSummary(entry: PlannerEntry) {
    return (
      <li key={plannerEntryKey(entry)} className="flex min-w-0 flex-col gap-1">
        <span className="text-label wrap-anywhere">
          {employeeName(entry.employee_id)}
        </span>
        <span className="text-caption wrap-anywhere">
          {assignmentLabel(entry)}
        </span>
      </li>
    )
  }

  function staffingSummary(date: string) {
    const day = reportFor(date)
    const roster = assignmentsFor(date)
    const assignedForRole = (role: StaffingRole) => {
      const shiftId = staffing?.[role]
      if (!shiftId) return 0
      return roster.filter(
        (entry) =>
          entry.status === "work" && entry.shift_template_version_id === shiftId
      ).length
    }

    if (!day) {
      return (
        <p className="text-caption text-muted-foreground">
          Kebutuhan karyawan belum tersedia.
        </p>
      )
    }

    return (
      <div
        className="flex flex-wrap gap-1.5"
        role="group"
        aria-label={`Kebutuhan ${plannerDateLabel(date)}`}
      >
        {staffingRoles.map((role) => {
          const target = day.targets[role]
          if (target === undefined) return null
          const assigned = assignedForRole(role)
          const missing = Math.max(target - assigned, 0)
          return (
            <Badge
              variant={assigned < target ? "outline" : "secondary"}
              key={role}
            >
              {staffingLabels[role]} {assigned}/{target}
              {missing ? `, kurang ${missing}` : ""}
            </Badge>
          )
        })}
      </div>
    )
  }

  function dayRoster(date: string) {
    const roster = assignmentsFor(date)
    const claimed = new Set<string>()
    const groups = staffingRoles.flatMap((role) => {
      const shiftId = staffing?.[role]
      if (!shiftId) return []
      const assigned = roster.filter((entry) => {
        const key = plannerEntryKey(entry)
        if (
          entry.status !== "work" ||
          entry.shift_template_version_id !== shiftId ||
          claimed.has(key)
        )
          return false
        claimed.add(key)
        return true
      })
      return [{ role, assigned }]
    })
    const otherEntries = roster.filter(
      (entry) => !claimed.has(plannerEntryKey(entry))
    )
    const hasGroups = groups.length > 0

    return (
      <div className="flex min-w-0 flex-col gap-4">
        {groups.map(({ role, assigned }) => (
          <section
            className="flex min-w-0 flex-col gap-2"
            key={role}
            aria-label={`Shift ${staffingLabels[role]}`}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-label">{staffingLabels[role]}</h3>
              <span className="text-caption text-muted-foreground">
                {assigned.length} penugasan
              </span>
            </div>
            {assigned.length ? (
              <ul className="flex min-w-0 flex-col gap-2">
                {assigned.map(assignmentControl)}
              </ul>
            ) : (
              <p className="text-caption text-muted-foreground">
                Belum ada penugasan.
              </p>
            )}
            {targetlessRoleMessage(reportFor(date), role)}
          </section>
        ))}
        {otherEntries.length ? (
          <section className="flex min-w-0 flex-col gap-2">
            <h3 className="text-label">
              {hasGroups ? "Penugasan lain" : "Penugasan"}
            </h3>
            <ul className="flex min-w-0 flex-col gap-2">
              {otherEntries.map(assignmentControl)}
            </ul>
          </section>
        ) : null}
        {!roster.length && !hasGroups ? (
          <p className="text-caption text-muted-foreground">
            Belum ada penugasan untuk tanggal ini.
          </p>
        ) : null}
        {onEdit ? (
          <Button
            type="button"
            variant="outline"
            className="min-h-11 justify-start"
            disabled={disabled || employees.length === 0}
            onClick={() => onEdit(date)}
            aria-label={`Tambah penugasan ${plannerDateLabel(date)}`}
          >
            Tambah penugasan
          </Button>
        ) : null}
      </div>
    )
  }

  return (
    <section className="flex min-w-0 flex-col gap-3" aria-label="Editor jadwal">
      <Tabs
        value={view}
        onValueChange={(value) => setView(value as PlannerView)}
        className="min-w-0"
      >
        <TabsList
          aria-label="Tampilan jadwal"
          className="grid w-full grid-cols-2 sm:max-w-sm"
        >
          <TabsTrigger value="day">Harian</TabsTrigger>
          <TabsTrigger value="week">Mingguan</TabsTrigger>
        </TabsList>
        <TabsContent value="day" className="min-w-0 pt-3">
          <Card>
            <CardHeader>
              <CardTitle>
                <time dateTime={selectedDate}>
                  {plannerDateLabel(selectedDate)}
                </time>
              </CardTitle>
              <CardDescription>
                Penugasan untuk satu tanggal kerja.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex min-w-0 flex-col gap-4">
              <Field className="max-w-sm">
                <FieldLabel htmlFor="planner-selected-day">
                  Tanggal kerja
                </FieldLabel>
                <NativeSelect
                  id="planner-selected-day"
                  value={selectedDate}
                  onChange={(event) => setSelectedDate(event.target.value)}
                >
                  {dates.map((date) => (
                    <NativeSelectOption value={date} key={date}>
                      {plannerDateLabel(date)}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </Field>
              {staffingSummary(selectedDate)}
              {dayRoster(selectedDate)}
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="week" className="min-w-0 pt-3">
          <section
            className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4"
            aria-label="Ikhtisar penugasan mingguan"
          >
            {dates.map((date, index) => {
              const roster = assignmentsFor(date)
              return (
                <Card size="sm" key={date}>
                  <CardHeader>
                    <CardTitle>
                      <Button
                        type="button"
                        variant="ghost"
                        className="h-auto min-h-11 whitespace-normal px-0 text-left"
                        onClick={() => {
                          setSelectedDate(date)
                          setView("day")
                        }}
                        aria-label={`Buka editor ${plannerDateLabel(date)}`}
                      >
                        <time dateTime={date}>{plannerDateLabel(date)}</time>
                      </Button>
                    </CardTitle>
                    <CardDescription>
                      {index < 5 ? "Hari kerja" : "Akhir pekan"}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="flex min-w-0 flex-col gap-3">
                    {staffingSummary(date)}
                    {roster.length ? (
                      <ul className="flex min-w-0 flex-col gap-2">
                        {roster.map(assignmentSummary)}
                      </ul>
                    ) : (
                      <p className="text-caption text-muted-foreground">
                        Belum ada penugasan.
                      </p>
                    )}
                  </CardContent>
                </Card>
              )
            })}
          </section>
        </TabsContent>
      </Tabs>
    </section>
  )
}

function targetlessRoleMessage(
  day: StaffingReport["days"][number] | undefined,
  role: StaffingRole
) {
  if (!day || day.targets[role] !== undefined) return null
  return (
    <p className="text-caption text-muted-foreground">
      Kebutuhan shift {staffingLabels[role].toLowerCase()} belum tersedia.
    </p>
  )
}
