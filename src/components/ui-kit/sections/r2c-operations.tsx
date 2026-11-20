import { WeeklyPlannerBoard } from "@/components/weekly-planner-board"
import { useState } from "react"
import {
  OperationalSummary,
  ScheduleMatrix,
  WorkWeekControl,
  type ScheduleDaySummary,
} from "@/components/r2c/operational-blocks"
import { ContextDrawer } from "@/components/r2c/screen-blocks"
import { UiKitSection } from "@/components/ui-kit/ui-kit-section"

const days: ScheduleDaySummary[] = [
  "2026-10-26",
  "2026-10-27",
  "2026-10-28",
  "2026-10-29",
  "2026-10-30",
  "2026-10-31",
  "2026-11-01",
].map((work_date, index) => ({
  work_date,
  status: index > 4 ? "rest" : "scheduled",
  outlet: { id: 1, name: "Menteng" },
  shift:
    index > 4
      ? null
      : {
          start_time: index === 2 ? "10:00" : "09:00",
          end_time: index === 2 ? "18:00" : "17:00",
          crosses_midnight: false,
        },
  provenance: {
    source: index === 2 ? "exception" : "weekly_rule",
    schedule_rule_id: 1,
    exception_id: index === 2 ? 2 : null,
  },
  conflicts: [],
}))
export function R2cOperationsSection() {
  const [week, setWeek] = useState("2026-10-26"),
    [open, setOpen] = useState(false)
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <UiKitSection id="weekly-planner-board" title="Weekly planner · empty roster" importPath="@/components/weekly-planner-board" description="Komponen nyata dengan data kosong; tanpa akun atau jadwal rekaan.">
        <WeeklyPlannerBoard weekStart="2026-11-02" entries={[]} employees={[]} shiftLabels={{}} />
      </UiKitSection>
      <UiKitSection
        id="r2c-work-week"
        className="min-h-[320px]"
        title="R2C · Work-week control"
        importPath="@/components/r2c/operational-blocks"
      >
        <WorkWeekControl weekStart={week} onChange={setWeek} />
      </UiKitSection>
      <UiKitSection
        id="r2c-schedule-matrix"
        title="R2C · Weekly schedule matrix"
        importPath="@/components/r2c/operational-blocks"
      >
        <ScheduleMatrix
          days={days.map((day) => day.work_date)}
          employees={[{ id: 3, name: "Arif Rahman", days }]}
          onSelect={() => setOpen(true)}
        />
      </UiKitSection>
      <UiKitSection
        id="r2c-operation-summary"
        title="R2C · Read-first operational summary"
        importPath="@/components/r2c/operational-blocks"
      >
        <OperationalSummary
          title="Penugasan shift"
          action="Kelola penugasan"
          onAction={() => setOpen(true)}
        >
          Pola mingguan mengikuti tanggal berlaku dan alasan perubahan.
        </OperationalSummary>
      </UiKitSection>
      <ContextDrawer
        open={open}
        onOpenChange={setOpen}
        title="Rincian sintetis"
        description="Demo komponen tanpa API."
      >
        <p className="text-body">
          Detail dan editor nyata disediakan pemanggil sesuai capability.
        </p>
      </ContextDrawer>
    </div>
  )
}
