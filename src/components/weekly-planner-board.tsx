import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  plannerDateLabel,
  plannerDates,
  staffingLabels,
  type PlannerEntry,
  type StaffingReport,
  type StaffingRole,
} from "@/lib/weekly-planner"

export function WeeklyPlannerBoard({
  weekStart,
  entries,
  employees,
  report,
  shiftLabels,
  disabled = false,
  onEdit,
}: {
  weekStart: string
  entries: PlannerEntry[]
  employees: Array<{ id: number; name: string }>
  report?: StaffingReport
  shiftLabels: Record<number, string>
  disabled?: boolean
  onEdit?: (date: string, entry?: PlannerEntry) => void
}) {
  return (
    <section
      className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4"
      aria-label="Roster Senin sampai Minggu"
    >
      {plannerDates(weekStart).map((date, index) => {
        const day = report?.days.find((item) => item.work_date === date)
        const targets =
          day?.targets ??
          (index < 5
            ? { morning: 1, middle: 1, evening: 1 }
            : { morning: 2, evening: 2 })
        const roster = entries.filter((entry) => entry.work_date === date)
        return (
          <Card size="sm" key={date}>
            <CardHeader>
              <CardTitle>
                <time dateTime={date}>{plannerDateLabel(date)}</time>
              </CardTitle>
              <CardDescription>
                {index < 5 ? "Hari kerja" : "Akhir pekan · tanpa tengah"}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <div
                role="group"
                className="flex flex-wrap gap-1"
                aria-label={`Kebutuhan ${date}`}
              >
                {(Object.entries(targets) as Array<[StaffingRole, number]>).map(
                  ([role, target]) => (
                    <Badge
                      variant={
                        (day?.counts[role] ?? 0) < target
                          ? "outline"
                          : "secondary"
                      }
                      key={role}
                    >
                      {staffingLabels[role]} {day?.counts[role] ?? 0}/{target}
                    </Badge>
                  )
                )}
              </div>
              {roster.length ? (
                <ul className="flex min-w-0 flex-col gap-2">
                  {roster.map((entry) => {
                    const name =
                      employees.find(
                        (employee) => employee.id === entry.employee_id
                      )?.name ?? "Karyawan tidak tersedia"
                    const label =
                      entry.status === "rest"
                        ? "Istirahat"
                        : entry.status === "unscheduled"
                          ? "Tidak dijadwalkan"
                          : (shiftLabels[
                              entry.shift_template_version_id ?? 0
                            ] ?? "Versi shift tidak tersedia")
                    return (
                      <li key={entry.employee_id} className="min-w-0">
                        <Button
                          variant="outline"
                          className="h-auto min-h-11 w-full flex-col items-start whitespace-normal py-2"
                          disabled={disabled || !onEdit}
                          onClick={() => onEdit?.(date, entry)}
                          aria-label={`Ubah ${name} ${date}`}
                        >
                          <span className="text-label wrap-anywhere">
                            {name}
                          </span>
                          <span className="text-caption wrap-anywhere">
                            {label}
                          </span>
                        </Button>
                      </li>
                    )
                  })}
                </ul>
              ) : (
                <p className="text-caption text-muted-foreground">
                  Belum ada penugasan.
                </p>
              )}
            </CardContent>
            <CardFooter>
              <Button
                variant="ghost"
                className="w-full"
                disabled={disabled || !onEdit || !employees.length}
                onClick={() => onEdit?.(date)}
                aria-label={`Tambah penugasan ${date}`}
              >
                Tambah penugasan
              </Button>
            </CardFooter>
          </Card>
        )
      })}
    </section>
  )
}
