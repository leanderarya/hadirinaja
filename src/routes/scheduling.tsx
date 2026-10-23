import { createFileRoute } from "@tanstack/react-router"
import { useCallback, useEffect, useMemo, useState } from "react"

import { ManagementSidebar } from "@/components/management-sidebar"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
} from "@/components/ui/breadcrumb"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty"
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldSet,
  FieldLegend,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { apiRequest, ApiError, type AuthSession } from "@/lib/api"

export const Route = createFileRoute("/scheduling")({
  component: SchedulingPage,
})

type OutletOption = { id: number; name: string; business_unit_id: number }
type EmployeeOption = { id: number; name: string }
type ShiftVersion = {
  id: number
  revision: number
  start_time: string
  end_time: string
  crosses_midnight: boolean
  effective_from: string
  template_name?: string | null
}
type ShiftTemplate = { id: number; name: string; versions: ShiftVersion[] }
type SchedulingContext = {
  tenant: { id: number; name: string }
  user: { id: number; name: string }
  roles: string[]
  capabilities: {
    manage_schedules: boolean
    manage_policies: boolean
    manage_templates: boolean
    manage_calendars: boolean
    read_personal_schedule: boolean
  }
  employee_id: number | null
  business_units: Array<{ id: number; name: string }>
  outlets: OutletOption[]
  employees: EmployeeOption[]
  shift_templates: ShiftTemplate[]
}
type EffectiveDay = {
  employee_id: number
  tenant_id: number
  work_date: string
  status: "scheduled" | "rest" | "unscheduled"
  outlet: { id: number; name: string } | null
  timezone: string
  shift: {
    template_id: number
    version_id: number
    revision: number
    name: string | null
    start_time: string
    end_time: string
    crosses_midnight: boolean
  } | null
  scheduled_start: string | null
  scheduled_end: string | null
  policy: {
    tenant_version_id: number | null
    outlet_version_id: number | null
    effective: PolicyConfiguration | null
  }
  provenance: {
    source: string
    schedule_rule_id: number | null
    exception_id: number | null
  }
  holiday_references: Array<{ id: number; name: string; region: string | null }>
  outlet_operating: boolean | null
  conflicts: string[]
}
type PolicyConfiguration = {
  late_tolerance_minutes: number
  check_in_window: { early_minutes: number; late_minutes: number }
  attendance_mode: "kiosk" | "personal" | "hybrid"
  personal_location_validation: { required: true; radius_meters: number }
  retroactive_request_limit_days: number
  operational_review: {
    schedule_change_reason_required: true
    minimum_notice_hours: number
  }
}
type PolicyResponse = {
  effective_date: string
  effective: {
    effective_from: string | null
    configuration: PolicyConfiguration | null
    tenant_default: PolicyConfiguration | null
    outlet_overrides: Record<string, unknown>
    tenant_version_id: number | null
    outlet_version_id: number | null
  }
  history: null | {
    tenant_versions: Array<{
      id: number
      effective_from: string
      configuration: PolicyConfiguration
      reason: string | null
    }>
    outlet_versions: Array<{
      id: number
      effective_from: string
      overrides: Record<string, unknown>
      reason: string | null
    }>
  }
}
type WeekResponse = {
  week_start: string
  week_end: string
  timezone: string
  outlet: OutletOption
  days: string[]
  employees: Array<{ id: number; name: string; days: EffectiveDay[] }>
}
type CalendarResponse = {
  outlet: { id: number; name: string }
  days: Array<{
    date: string
    timezone: string
    status: "open" | "closed"
    holiday_references: Array<{
      id: number
      name: string
      region: string | null
    }>
    exception: {
      id: number
      revision: number
      status: "open" | "closed"
    } | null
  }>
  versions: Array<{
    id: number
    effective_from: string
    timezone: string
    operating_weekdays: number[]
    reason: string | null
  }> | null
}

const weekdays = [
  { id: 1, label: "Senin" },
  { id: 2, label: "Selasa" },
  { id: 3, label: "Rabu" },
  { id: 4, label: "Kamis" },
  { id: 5, label: "Jumat" },
  { id: 6, label: "Sabtu" },
  { id: 7, label: "Minggu" },
]

const defaultPolicy: PolicyConfiguration = {
  late_tolerance_minutes: 5,
  check_in_window: { early_minutes: 60, late_minutes: 60 },
  attendance_mode: "kiosk",
  personal_location_validation: { required: true, radius_meters: 100 },
  retroactive_request_limit_days: 7,
  operational_review: {
    schedule_change_reason_required: true,
    minimum_notice_hours: 24,
  },
}

function SchedulingPage() {
  const [context, setContext] = useState<SchedulingContext | null>(null)
  const [weekStart, setWeekStart] = useState(mondayOfToday())
  const [businessUnitId, setBusinessUnitId] = useState("")
  const [outletId, setOutletId] = useState("")
  const [week, setWeek] = useState<WeekResponse | null>(null)
  const [personalDays, setPersonalDays] = useState<EffectiveDay[]>([])
  const [policy, setPolicy] = useState<PolicyResponse | null>(null)
  const [calendar, setCalendar] = useState<CalendarResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")
  const [activeTab, setActiveTab] = useState("jadwal")

  const [ruleEmployeeId, setRuleEmployeeId] = useState("")
  const [ruleWeekday, setRuleWeekday] = useState("1")
  const [ruleShiftId, setRuleShiftId] = useState("")
  const [ruleEffectiveFrom, setRuleEffectiveFrom] = useState(tomorrow())
  const [ruleEffectiveUntil, setRuleEffectiveUntil] = useState("")
  const [ruleReason, setRuleReason] = useState("")

  const [exceptionEmployeeId, setExceptionEmployeeId] = useState("")
  const [exceptionDate, setExceptionDate] = useState(tomorrow())
  const [exceptionStatus, setExceptionStatus] = useState<"work" | "rest">(
    "work"
  )
  const [exceptionShiftId, setExceptionShiftId] = useState("")
  const [exceptionReason, setExceptionReason] = useState("")

  const [shiftName, setShiftName] = useState("")
  const [shiftStart, setShiftStart] = useState("09:00")
  const [shiftEnd, setShiftEnd] = useState("17:00")
  const [shiftOvernight, setShiftOvernight] = useState(false)
  const [shiftEffectiveFrom, setShiftEffectiveFrom] = useState(tomorrow())
  const [shiftReason, setShiftReason] = useState("")
  const [revisionTemplateId, setRevisionTemplateId] = useState("")
  const [revisionStart, setRevisionStart] = useState("09:00")
  const [revisionEnd, setRevisionEnd] = useState("17:00")
  const [revisionOvernight, setRevisionOvernight] = useState(false)
  const [revisionEffectiveFrom, setRevisionEffectiveFrom] = useState(tomorrow())
  const [revisionReason, setRevisionReason] = useState("")

  const [policyEffectiveFrom, setPolicyEffectiveFrom] = useState(tomorrow())
  const [policyReason, setPolicyReason] = useState("")
  const [policyLateTolerance, setPolicyLateTolerance] = useState("5")
  const [policyEarlyWindow, setPolicyEarlyWindow] = useState("60")
  const [policyLateWindow, setPolicyLateWindow] = useState("60")
  const [policyMode, setPolicyMode] =
    useState<PolicyConfiguration["attendance_mode"]>("kiosk")
  const [policyRadius, setPolicyRadius] = useState("100")
  const [policyRetroactiveDays, setPolicyRetroactiveDays] = useState("7")
  const [policyNoticeHours, setPolicyNoticeHours] = useState("24")
  const [overrideField, setOverrideField] = useState("late_tolerance_minutes")
  const [overrideValue, setOverrideValue] = useState("5")
  const [overrideEffectiveFrom, setOverrideEffectiveFrom] = useState(tomorrow())
  const [overrideReason, setOverrideReason] = useState("")

  const [calendarEffectiveFrom, setCalendarEffectiveFrom] = useState(tomorrow())
  const [calendarTimezone, setCalendarTimezone] = useState("Asia/Jakarta")
  const [calendarWeekdays, setCalendarWeekdays] = useState<number[]>([
    1, 2, 3, 4, 5, 6, 7,
  ])
  const [calendarReason, setCalendarReason] = useState("")
  const [calendarExceptionDate, setCalendarExceptionDate] = useState(tomorrow())
  const [calendarExceptionStatus, setCalendarExceptionStatus] = useState<
    "open" | "closed"
  >("closed")
  const [calendarExceptionHoliday, setCalendarExceptionHoliday] = useState("")
  const [calendarExceptionReason, setCalendarExceptionReason] = useState("")
  const [holidayDate, setHolidayDate] = useState(tomorrow())
  const [holidayName, setHolidayName] = useState("")
  const [holidayRegion, setHolidayRegion] = useState("")

  const managerOutlets = useMemo(() => {
    if (!context) return []
    return businessUnitId
      ? context.outlets.filter(
          (outlet) => String(outlet.business_unit_id) === businessUnitId
        )
      : context.outlets
  }, [businessUnitId, context])

  const loadPageData = useCallback(
    async (
      current: SchedulingContext,
      currentOutletId: string,
      currentWeek: string
    ) => {
      setLoading(true)
      setError("")

      try {
        if (current.capabilities.manage_schedules) {
          if (!currentOutletId) {
            setWeek(null)
            setPolicy(null)
            setCalendar(null)
            return
          }

          const query = new URLSearchParams({ outlet_id: currentOutletId })
          const calendarQuery = new URLSearchParams({
            outlet_id: currentOutletId,
            start_date: currentWeek,
            days: "7",
          })
          const [weekData, policyData, calendarData] = await Promise.all([
            apiRequest<WeekResponse>(
              `/management/scheduling/week?week_start=${currentWeek}&outlet_id=${currentOutletId}`
            ),
            apiRequest<PolicyResponse>(
              `/management/scheduling/policies?${query.toString()}`
            ),
            apiRequest<CalendarResponse>(
              `/management/scheduling/calendar?${calendarQuery.toString()}`
            ),
          ])
          setWeek(weekData)
          setPolicy(policyData)
          setCalendar(calendarData)

          const config = policyData.effective.tenant_default ?? defaultPolicy
          setPolicyLateTolerance(String(config.late_tolerance_minutes))
          setPolicyEarlyWindow(String(config.check_in_window.early_minutes))
          setPolicyLateWindow(String(config.check_in_window.late_minutes))
          setPolicyMode(config.attendance_mode)
          setPolicyRadius(
            String(config.personal_location_validation.radius_meters)
          )
          setPolicyRetroactiveDays(
            String(config.retroactive_request_limit_days)
          )
          setPolicyNoticeHours(
            String(config.operational_review.minimum_notice_hours)
          )
          const calendarVersion = calendarData.versions?.at(-1)
          if (calendarVersion) {
            setCalendarTimezone(calendarVersion.timezone)
            setCalendarWeekdays(calendarVersion.operating_weekdays)
          }
        } else if (current.employee_id !== null) {
          const result = await apiRequest<{
            week_start: string
            days: EffectiveDay[]
          }>(`/management/scheduling/me/week?week_start=${currentWeek}`)
          setPersonalDays(result.days)
        } else {
          setError("Akun ini belum terhubung ke jadwal pribadi.")
        }
      } catch (caught) {
        setError(
          caught instanceof ApiError
            ? caught.message
            : "Jadwal dan kebijakan belum dapat dimuat. Coba muat ulang halaman."
        )
      } finally {
        setLoading(false)
      }
    },
    []
  )

  useEffect(() => {
    let cancelled = false
    async function bootstrap() {
      try {
        const session = await apiRequest<AuthSession>("/auth/me")
        if (!session.active_membership) {
          window.location.assign("/select-tenant")
          return
        }
        const nextContext = await apiRequest<SchedulingContext>(
          "/management/scheduling/context"
        )
        if (cancelled) return
        setContext(nextContext)
        const firstOutlet = nextContext.outlets[0]
        setBusinessUnitId(
          firstOutlet
            ? String(firstOutlet.business_unit_id)
            : nextContext.business_units[0]
              ? String(nextContext.business_units[0].id)
              : ""
        )
        setOutletId(firstOutlet ? String(firstOutlet.id) : "")
        setRuleEmployeeId(
          nextContext.employees[0] ? String(nextContext.employees[0].id) : ""
        )
        setExceptionEmployeeId(
          nextContext.employees[0] ? String(nextContext.employees[0].id) : ""
        )
      } catch (caught) {
        if (
          caught instanceof ApiError &&
          (caught.status === 401 || caught.status === 419)
        ) {
          window.location.assign("/login?expired=1")
          return
        }
        if (!cancelled)
          setError("Sesi atau organisasi aktif belum dapat dimuat.")
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void bootstrap()
    const expireSession = () => window.location.assign("/login?expired=1")
    window.addEventListener("hadirinaja:session-expired", expireSession)

    return () => {
      cancelled = true
      window.removeEventListener("hadirinaja:session-expired", expireSession)
    }
  }, [])

  useEffect(() => {
    if (!context) return
    void loadPageData(context, outletId, weekStart)
  }, [context, loadPageData, outletId, weekStart])

  async function reloadContext() {
    const updated = await apiRequest<SchedulingContext>(
      "/management/scheduling/context"
    )
    setContext(updated)
  }

  async function runAction(
    action: () => Promise<unknown>,
    success: string,
    refreshContext = false
  ): Promise<boolean> {
    setBusy(true)
    setError("")
    setNotice("")
    let saved = false
    try {
      await action()
      saved = true
      setNotice(success)
      try {
        if (refreshContext) await reloadContext()
        else if (context) await loadPageData(context, outletId, weekStart)
      } catch {
        setError("Perubahan tersimpan, tetapi data terbaru belum dapat dimuat.")
      }
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught.message
          : "Perubahan tidak dapat disimpan. Periksa akses dan data yang dimasukkan."
      )
    } finally {
      setBusy(false)
    }
    return saved
  }

  function logout() {
    setBusy(true)
    void apiRequest("/auth/logout", { method: "POST" })
      .catch(() => undefined)
      .finally(() => window.location.assign("/login"))
  }

  if (loading && !context) {
    return (
      <main className="flex min-h-svh items-center justify-center text-body text-muted-foreground">
        Memuat jadwal…
      </main>
    )
  }

  if (!context) {
    return (
      <main className="flex min-h-svh items-center justify-center p-6">
        <Alert className="max-w-lg" variant="destructive">
          <AlertTitle>Jadwal belum dapat dibuka</AlertTitle>
          <AlertDescription>
            {error || "Periksa sesi dan organisasi aktif Anda."}
          </AlertDescription>
        </Alert>
      </main>
    )
  }

  const isOwner = context.capabilities.manage_policies
  const canManage = context.capabilities.manage_schedules
  const config = policy?.effective.tenant_default ?? defaultPolicy
  const flatHolidayOptions =
    calendar?.days.flatMap((day) => day.holiday_references) ?? []

  async function createWeeklyRule(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!outletId) return
    const saved = await runAction(
      () =>
        apiRequest("/management/scheduling/weekly-rules", {
          method: "POST",
          body: {
            employee_id: Number(ruleEmployeeId),
            outlet_id: Number(outletId),
            weekday: Number(ruleWeekday),
            shift_template_version_id: ruleShiftId ? Number(ruleShiftId) : null,
            effective_from: ruleEffectiveFrom,
            effective_until: ruleEffectiveUntil || null,
            reason: ruleReason,
          },
        }),
      "Jadwal mingguan berhasil disimpan."
    )
    if (saved) setRuleReason("")
  }

  async function createException(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!outletId) return
    const saved = await runAction(
      () =>
        apiRequest("/management/scheduling/exceptions", {
          method: "POST",
          body: {
            employee_id: Number(exceptionEmployeeId),
            outlet_id: Number(outletId),
            work_date: exceptionDate,
            status: exceptionStatus,
            shift_template_version_id:
              exceptionStatus === "work" ? Number(exceptionShiftId) : null,
            reason: exceptionReason,
          },
        }),
      "Perubahan satu hari berhasil disimpan."
    )
    if (saved) setExceptionReason("")
  }

  async function createShift(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const saved = await runAction(
      () =>
        apiRequest("/management/scheduling/shifts", {
          method: "POST",
          body: {
            name: shiftName,
            start_time: shiftStart,
            end_time: shiftEnd,
            crosses_midnight: shiftOvernight,
            effective_from: shiftEffectiveFrom,
            reason: shiftReason,
          },
        }),
      "Template shift berhasil dibuat.",
      true
    )
    if (saved) {
      setShiftName("")
      setShiftReason("")
    }
  }

  async function reviseShift(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const saved = await runAction(
      () =>
        apiRequest(
          `/management/scheduling/shifts/${revisionTemplateId}/versions`,
          {
            method: "POST",
            body: {
              start_time: revisionStart,
              end_time: revisionEnd,
              crosses_midnight: revisionOvernight,
              effective_from: revisionEffectiveFrom,
              reason: revisionReason,
            },
          }
        ),
      "Revisi baru tersimpan. Jadwal lama tetap menggunakan versi sebelumnya.",
      true
    )
    if (saved) setRevisionReason("")
  }

  async function createTenantPolicy(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const saved = await runAction(
      () =>
        apiRequest("/management/scheduling/policies/tenant", {
          method: "POST",
          body: {
            effective_from: policyEffectiveFrom,
            reason: policyReason,
            configuration: {
              late_tolerance_minutes: Number(policyLateTolerance),
              check_in_window: {
                early_minutes: Number(policyEarlyWindow),
                late_minutes: Number(policyLateWindow),
              },
              attendance_mode: policyMode,
              personal_location_validation: {
                required: true,
                radius_meters: Number(policyRadius),
              },
              retroactive_request_limit_days: Number(policyRetroactiveDays),
              operational_review: {
                schedule_change_reason_required: true,
                minimum_notice_hours: Number(policyNoticeHours),
              },
            },
          },
        }),
      "Versi kebijakan tenant berhasil dijadwalkan."
    )
    if (saved) setPolicyReason("")
  }

  async function createOutletPolicy(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!outletId) return
    const value = Number(overrideValue)
    let overrides: Record<string, unknown>
    switch (overrideField) {
      case "early_minutes":
        overrides = { check_in_window: { early_minutes: value } }
        break
      case "late_minutes":
        overrides = { check_in_window: { late_minutes: value } }
        break
      case "attendance_mode":
        overrides = { attendance_mode: overrideValue }
        break
      case "radius_meters":
        overrides = { personal_location_validation: { radius_meters: value } }
        break
      case "retroactive_request_limit_days":
        overrides = { retroactive_request_limit_days: value }
        break
      case "minimum_notice_hours":
        overrides = { operational_review: { minimum_notice_hours: value } }
        break
      default:
        overrides = { late_tolerance_minutes: value }
    }
    const saved = await runAction(
      () =>
        apiRequest(`/management/scheduling/outlets/${outletId}/policy`, {
          method: "POST",
          body: {
            effective_from: overrideEffectiveFrom,
            reason: overrideReason,
            overrides,
          },
        }),
      "Override outlet berhasil dijadwalkan."
    )
    if (saved) setOverrideReason("")
  }

  async function createCalendarVersion(
    event: React.FormEvent<HTMLFormElement>
  ) {
    event.preventDefault()
    if (!outletId) return
    const saved = await runAction(
      () =>
        apiRequest("/management/scheduling/calendar/versions", {
          method: "POST",
          body: {
            outlet_id: Number(outletId),
            effective_from: calendarEffectiveFrom,
            timezone: calendarTimezone,
            operating_weekdays: calendarWeekdays,
            reason: calendarReason,
          },
        }),
      "Versi kalender outlet berhasil disimpan."
    )
    if (saved) setCalendarReason("")
  }

  async function createCalendarException(
    event: React.FormEvent<HTMLFormElement>
  ) {
    event.preventDefault()
    if (!outletId) return
    const saved = await runAction(
      () =>
        apiRequest("/management/scheduling/calendar/exceptions", {
          method: "POST",
          body: {
            outlet_id: Number(outletId),
            calendar_date: calendarExceptionDate,
            status: calendarExceptionStatus,
            holiday_reference_id: calendarExceptionHoliday
              ? Number(calendarExceptionHoliday)
              : null,
            reason: calendarExceptionReason,
          },
        }),
      "Perubahan kalender satu hari berhasil disimpan."
    )
    if (saved) setCalendarExceptionReason("")
  }

  async function createHoliday(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const saved = await runAction(
      () =>
        apiRequest("/management/scheduling/holidays", {
          method: "POST",
          body: {
            holiday_date: holidayDate,
            name: holidayName,
            region: holidayRegion || null,
          },
        }),
      "Referensi hari libur tercatat. Outlet tetap mengikuti kalender operasionalnya."
    )
    if (saved) {
      setHolidayName("")
      setHolidayRegion("")
    }
  }

  function changeWeek(value: string) {
    if (value) setWeekStart(mondayOf(value))
  }

  const weekRows = week?.employees ?? []
  const displayDays = week?.days ?? []
  const shiftVersions = context.shift_templates.flatMap((template) =>
    template.versions.map((version) => ({
      ...version,
      template_id: template.id,
      template_name: template.name,
    }))
  )

  return (
    <SidebarProvider>
      <div className="flex min-h-svh w-full bg-muted/20">
        <ManagementSidebar activePage="scheduling" />
        <div className="min-w-0 flex-1">
          <header className="flex min-h-14 flex-wrap items-center gap-3 border-b bg-background px-4 py-2 lg:min-h-[60px] lg:px-6">
            <SidebarTrigger className="-ml-1" />
            <Breadcrumb className="min-w-0 flex-1">
              <BreadcrumbList>
                <BreadcrumbItem>
                  <BreadcrumbPage className="truncate font-semibold">
                    {context.tenant.name}
                  </BreadcrumbPage>
                </BreadcrumbItem>
                <BreadcrumbItem>
                  <BreadcrumbPage>Jadwal & kebijakan</BreadcrumbPage>
                </BreadcrumbItem>
              </BreadcrumbList>
            </Breadcrumb>
            <Button
              onClick={() => window.location.assign("/select-tenant")}
              variant="outline"
            >
              Ganti organisasi
            </Button>
            <Button disabled={busy} onClick={logout} variant="ghost">
              Keluar
            </Button>
          </header>

          <main className="flex flex-col gap-6 p-4 lg:p-6">
            <section className="flex flex-col gap-2">
              <p className="text-label text-muted-foreground">Operasional</p>
              <h1 className="text-title">Jadwal & kebijakan</h1>
              <p className="text-body text-muted-foreground">
                Atur pola kerja berdasarkan outlet, riwayat penugasan, dan
                tanggal berlaku.
              </p>
            </section>

            {error ? (
              <Alert variant="destructive">
                <AlertTitle>Permintaan belum berhasil</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}
            {notice ? (
              <Alert>
                <AlertTitle>Perubahan tersimpan</AlertTitle>
                <AlertDescription>{notice}</AlertDescription>
              </Alert>
            ) : null}

            {canManage ? (
              <FieldGroup className="grid gap-4 rounded-2xl border bg-background p-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] md:items-end">
                <Field>
                  <FieldLabel htmlFor="business-unit-filter">
                    Unit bisnis
                  </FieldLabel>
                  <NativeSelect
                    id="business-unit-filter"
                    onChange={(event) => {
                      const nextUnit = event.target.value
                      const nextOutlet = context.outlets.find(
                        (item) => String(item.business_unit_id) === nextUnit
                      )
                      setBusinessUnitId(nextUnit)
                      setOutletId(nextOutlet ? String(nextOutlet.id) : "")
                    }}
                    value={businessUnitId}
                  >
                    <NativeSelectOption value="">
                      Semua unit bisnis
                    </NativeSelectOption>
                    {context.business_units.map((unit) => (
                      <NativeSelectOption key={unit.id} value={unit.id}>
                        {unit.name}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                </Field>
                <Field>
                  <FieldLabel htmlFor="outlet-filter">Outlet</FieldLabel>
                  <NativeSelect
                    id="outlet-filter"
                    onChange={(event) => setOutletId(event.target.value)}
                    value={outletId}
                  >
                    <NativeSelectOption value="">
                      Pilih outlet
                    </NativeSelectOption>
                    {managerOutlets.map((outlet) => (
                      <NativeSelectOption key={outlet.id} value={outlet.id}>
                        {outlet.name}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                </Field>
                <Field>
                  <FieldLabel htmlFor="week-picker">Minggu mulai</FieldLabel>
                  <Input
                    id="week-picker"
                    onChange={(event) => changeWeek(event.target.value)}
                    type="date"
                    value={weekStart}
                  />
                </Field>
              </FieldGroup>
            ) : (
              <div className="flex flex-wrap items-end gap-3 rounded-2xl border bg-background p-4">
                <Field>
                  <FieldLabel htmlFor="personal-week-picker">
                    Minggu mulai
                  </FieldLabel>
                  <Input
                    id="personal-week-picker"
                    onChange={(event) => changeWeek(event.target.value)}
                    type="date"
                    value={weekStart}
                  />
                </Field>
              </div>
            )}

            {canManage ? (
              <Tabs
                onValueChange={(value) => setActiveTab(String(value))}
                value={activeTab}
              >
                <TabsList className="max-w-full overflow-x-auto">
                  <TabsTrigger value="jadwal">Jadwal mingguan</TabsTrigger>
                  <TabsTrigger value="shift">Template shift</TabsTrigger>
                  <TabsTrigger value="kebijakan">Kebijakan</TabsTrigger>
                  <TabsTrigger value="kalender">Kalender outlet</TabsTrigger>
                </TabsList>

                <TabsContent
                  className="flex flex-col gap-5 pt-4"
                  value="jadwal"
                >
                  <Card>
                    <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                      <div className="flex flex-col gap-1">
                        <CardTitle>Jadwal karyawan</CardTitle>
                        <CardDescription>
                          {week?.outlet.name ?? "Pilih outlet"} · {weekStart}{" "}
                          s.d. {week?.week_end ?? addDays(weekStart, 6)}
                        </CardDescription>
                      </div>
                      <div className="flex gap-2">
                        <Button
                          onClick={() => setWeekStart(addDays(weekStart, -7))}
                          variant="outline"
                        >
                          Minggu sebelumnya
                        </Button>
                        <Button
                          onClick={() => setWeekStart(addDays(weekStart, 7))}
                          variant="outline"
                        >
                          Minggu berikutnya
                        </Button>
                      </div>
                    </CardHeader>
                    <CardContent>
                      {loading ? (
                        <p className="text-body text-muted-foreground">
                          Memuat jadwal…
                        </p>
                      ) : null}
                      {!loading && weekRows.length === 0 ? (
                        <Empty>
                          <EmptyHeader>
                            <EmptyTitle>
                              Belum ada jadwal untuk outlet ini
                            </EmptyTitle>
                            <EmptyDescription>
                              Karyawan dengan penugasan atau jadwal pada minggu
                              ini akan tampil di sini.
                            </EmptyDescription>
                          </EmptyHeader>
                        </Empty>
                      ) : null}
                      {!loading && weekRows.length > 0 ? (
                        <>
                          <div className="hidden overflow-x-auto lg:block">
                            <Table>
                              <TableHeader>
                                <TableRow>
                                  <TableHead className="min-w-40">
                                    Karyawan
                                  </TableHead>
                                  {displayDays.map((date) => (
                                    <TableHead className="min-w-32" key={date}>
                                      {formatWorkDate(date)}
                                    </TableHead>
                                  ))}
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {weekRows.map((employee) => (
                                  <TableRow key={employee.id}>
                                    <TableCell className="font-medium">
                                      {employee.name}
                                    </TableCell>
                                    {employee.days.map((day) => (
                                      <ScheduleCell
                                        day={day}
                                        key={`${employee.id}-${day.work_date}`}
                                      />
                                    ))}
                                  </TableRow>
                                ))}
                              </TableBody>
                            </Table>
                          </div>
                          <div className="flex flex-col gap-3 lg:hidden">
                            {weekRows.map((employee) => (
                              <Card key={employee.id}>
                                <CardHeader>
                                  <CardTitle className="text-subtitle">
                                    {employee.name}
                                  </CardTitle>
                                </CardHeader>
                                <CardContent className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                                  {employee.days.map((day) => (
                                    <ScheduleDayCard
                                      day={day}
                                      key={`${employee.id}-${day.work_date}`}
                                    />
                                  ))}
                                </CardContent>
                              </Card>
                            ))}
                          </div>
                        </>
                      ) : null}
                    </CardContent>
                  </Card>

                  <div className="grid gap-5 xl:grid-cols-2">
                    <Card>
                      <CardHeader>
                        <CardTitle>Atur pola mingguan</CardTitle>
                        <CardDescription>
                          Perubahan berlaku mulai tanggal yang dipilih dan
                          menjaga periode sebelumnya.
                        </CardDescription>
                      </CardHeader>
                      <CardContent>
                        <form
                          className="flex flex-col gap-4"
                          onSubmit={createWeeklyRule}
                        >
                          <FieldGroup className="grid gap-4 sm:grid-cols-2">
                            <Field>
                              <FieldLabel htmlFor="rule-employee">
                                Karyawan
                              </FieldLabel>
                              <NativeSelect
                                id="rule-employee"
                                onChange={(event) =>
                                  setRuleEmployeeId(event.target.value)
                                }
                                required
                                value={ruleEmployeeId}
                              >
                                <NativeSelectOption value="">
                                  Pilih karyawan
                                </NativeSelectOption>
                                {context.employees.map((employee) => (
                                  <NativeSelectOption
                                    key={employee.id}
                                    value={employee.id}
                                  >
                                    {employee.name}
                                  </NativeSelectOption>
                                ))}
                              </NativeSelect>
                            </Field>
                            <Field>
                              <FieldLabel htmlFor="rule-weekday">
                                Hari berulang
                              </FieldLabel>
                              <NativeSelect
                                id="rule-weekday"
                                onChange={(event) =>
                                  setRuleWeekday(event.target.value)
                                }
                                value={ruleWeekday}
                              >
                                {weekdays.map((day) => (
                                  <NativeSelectOption
                                    key={day.id}
                                    value={day.id}
                                  >
                                    {day.label}
                                  </NativeSelectOption>
                                ))}
                              </NativeSelect>
                            </Field>
                            <Field>
                              <FieldLabel htmlFor="rule-shift">
                                Shift
                              </FieldLabel>
                              <NativeSelect
                                id="rule-shift"
                                onChange={(event) =>
                                  setRuleShiftId(event.target.value)
                                }
                                value={ruleShiftId}
                              >
                                <NativeSelectOption value="">
                                  Hari istirahat
                                </NativeSelectOption>
                                {shiftVersions.map((shift) => (
                                  <NativeSelectOption
                                    key={shift.id}
                                    value={shift.id}
                                  >
                                    {shift.template_name} · v{shift.revision} ·{" "}
                                    {shift.start_time}–{shift.end_time}
                                  </NativeSelectOption>
                                ))}
                              </NativeSelect>
                            </Field>
                            <Field>
                              <FieldLabel htmlFor="rule-start">
                                Berlaku mulai
                              </FieldLabel>
                              <Input
                                id="rule-start"
                                onChange={(event) =>
                                  setRuleEffectiveFrom(event.target.value)
                                }
                                required
                                type="date"
                                value={ruleEffectiveFrom}
                              />
                            </Field>
                            <Field>
                              <FieldLabel htmlFor="rule-until">
                                Berlaku sampai (opsional)
                              </FieldLabel>
                              <Input
                                id="rule-until"
                                onChange={(event) =>
                                  setRuleEffectiveUntil(event.target.value)
                                }
                                type="date"
                                value={ruleEffectiveUntil}
                              />
                            </Field>
                          </FieldGroup>
                          <Field>
                            <FieldLabel htmlFor="rule-reason">
                              Alasan perubahan
                            </FieldLabel>
                            <Input
                              id="rule-reason"
                              maxLength={1000}
                              minLength={3}
                              onChange={(event) =>
                                setRuleReason(event.target.value)
                              }
                              required
                              value={ruleReason}
                            />
                          </Field>
                          <Button
                            disabled={busy || !ruleEmployeeId || !outletId}
                            type="submit"
                          >
                            Simpan pola mingguan
                          </Button>
                        </form>
                      </CardContent>
                    </Card>

                    <Card>
                      <CardHeader>
                        <CardTitle>Pengecualian satu tanggal</CardTitle>
                        <CardDescription>
                          Pengecualian menggantikan pola berulang pada tanggal
                          tersebut dan selalu mencatat alasan.
                        </CardDescription>
                      </CardHeader>
                      <CardContent>
                        <form
                          className="flex flex-col gap-4"
                          onSubmit={createException}
                        >
                          <FieldGroup className="grid gap-4 sm:grid-cols-2">
                            <Field>
                              <FieldLabel htmlFor="exception-employee">
                                Karyawan
                              </FieldLabel>
                              <NativeSelect
                                id="exception-employee"
                                onChange={(event) =>
                                  setExceptionEmployeeId(event.target.value)
                                }
                                required
                                value={exceptionEmployeeId}
                              >
                                <NativeSelectOption value="">
                                  Pilih karyawan
                                </NativeSelectOption>
                                {context.employees.map((employee) => (
                                  <NativeSelectOption
                                    key={employee.id}
                                    value={employee.id}
                                  >
                                    {employee.name}
                                  </NativeSelectOption>
                                ))}
                              </NativeSelect>
                            </Field>
                            <Field>
                              <FieldLabel htmlFor="exception-date">
                                Tanggal kerja
                              </FieldLabel>
                              <Input
                                id="exception-date"
                                min={today()}
                                onChange={(event) =>
                                  setExceptionDate(event.target.value)
                                }
                                required
                                type="date"
                                value={exceptionDate}
                              />
                            </Field>
                            <Field>
                              <FieldLabel htmlFor="exception-status">
                                Status
                              </FieldLabel>
                              <NativeSelect
                                id="exception-status"
                                onChange={(event) =>
                                  setExceptionStatus(
                                    event.target.value as "work" | "rest"
                                  )
                                }
                                value={exceptionStatus}
                              >
                                <NativeSelectOption value="work">
                                  Bekerja
                                </NativeSelectOption>
                                <NativeSelectOption value="rest">
                                  Libur
                                </NativeSelectOption>
                              </NativeSelect>
                            </Field>
                            {exceptionStatus === "work" ? (
                              <Field>
                                <FieldLabel htmlFor="exception-shift">
                                  Shift untuk tanggal ini
                                </FieldLabel>
                                <NativeSelect
                                  id="exception-shift"
                                  onChange={(event) =>
                                    setExceptionShiftId(event.target.value)
                                  }
                                  required
                                  value={exceptionShiftId}
                                >
                                  <NativeSelectOption value="">
                                    Pilih shift
                                  </NativeSelectOption>
                                  {shiftVersions.map((shift) => (
                                    <NativeSelectOption
                                      key={shift.id}
                                      value={shift.id}
                                    >
                                      {shift.template_name} · v{shift.revision}{" "}
                                      · {shift.start_time}–{shift.end_time}
                                    </NativeSelectOption>
                                  ))}
                                </NativeSelect>
                              </Field>
                            ) : null}
                          </FieldGroup>
                          <Field>
                            <FieldLabel htmlFor="exception-reason">
                              Alasan perubahan
                            </FieldLabel>
                            <Input
                              id="exception-reason"
                              maxLength={1000}
                              minLength={3}
                              onChange={(event) =>
                                setExceptionReason(event.target.value)
                              }
                              required
                              value={exceptionReason}
                            />
                          </Field>
                          <Button
                            disabled={busy || !exceptionEmployeeId || !outletId}
                            type="submit"
                          >
                            Simpan pengecualian
                          </Button>
                        </form>
                      </CardContent>
                    </Card>
                  </div>
                </TabsContent>

                <TabsContent className="flex flex-col gap-5 pt-4" value="shift">
                  <div className="grid gap-5 xl:grid-cols-2">
                    <Card>
                      <CardHeader>
                        <CardTitle>Template shift</CardTitle>
                        <CardDescription>
                          Versi yang sudah dipakai jadwal tetap tersimpan
                          sebagai snapshot historis.
                        </CardDescription>
                      </CardHeader>
                      <CardContent className="flex flex-col gap-3">
                        {context.shift_templates.length === 0 ? (
                          <Empty>
                            <EmptyHeader>
                              <EmptyTitle>Belum ada template shift</EmptyTitle>
                              <EmptyDescription>
                                Buat template pertama untuk mulai menyusun
                                jadwal karyawan.
                              </EmptyDescription>
                            </EmptyHeader>
                          </Empty>
                        ) : (
                          context.shift_templates.map((template) => (
                            <div
                              className="flex flex-col gap-2 rounded-xl border p-3"
                              key={template.id}
                            >
                              <p className="text-label">{template.name}</p>
                              {template.versions.map((version) => (
                                <p
                                  className="text-caption text-muted-foreground"
                                  key={version.id}
                                >
                                  v{version.revision} · {version.start_time}–
                                  {version.end_time}
                                  {version.crosses_midnight
                                    ? " · lintas tengah malam"
                                    : ""}{" "}
                                  · berlaku {version.effective_from}
                                </p>
                              ))}
                            </div>
                          ))
                        )}
                      </CardContent>
                    </Card>
                    <div className="flex flex-col gap-5">
                      {isOwner ? (
                        <Card>
                          <CardHeader>
                            <CardTitle>Buat template shift</CardTitle>
                            <CardDescription>
                              Durasi minimum 15 menit dan maksimum 18 jam.
                            </CardDescription>
                          </CardHeader>
                          <CardContent>
                            <form
                              className="flex flex-col gap-4"
                              onSubmit={createShift}
                            >
                              <FieldGroup className="grid gap-4 sm:grid-cols-2">
                                <Field>
                                  <FieldLabel htmlFor="shift-name">
                                    Nama shift
                                  </FieldLabel>
                                  <Input
                                    id="shift-name"
                                    maxLength={120}
                                    minLength={2}
                                    onChange={(event) =>
                                      setShiftName(event.target.value)
                                    }
                                    required
                                    value={shiftName}
                                  />
                                </Field>
                                <Field>
                                  <FieldLabel htmlFor="shift-effective">
                                    Berlaku mulai
                                  </FieldLabel>
                                  <Input
                                    id="shift-effective"
                                    min={today()}
                                    onChange={(event) =>
                                      setShiftEffectiveFrom(event.target.value)
                                    }
                                    required
                                    type="date"
                                    value={shiftEffectiveFrom}
                                  />
                                </Field>
                                <Field>
                                  <FieldLabel htmlFor="shift-start">
                                    Mulai
                                  </FieldLabel>
                                  <Input
                                    id="shift-start"
                                    onChange={(event) =>
                                      setShiftStart(event.target.value)
                                    }
                                    required
                                    type="time"
                                    value={shiftStart}
                                  />
                                </Field>
                                <Field>
                                  <FieldLabel htmlFor="shift-end">
                                    Selesai
                                  </FieldLabel>
                                  <Input
                                    id="shift-end"
                                    onChange={(event) =>
                                      setShiftEnd(event.target.value)
                                    }
                                    required
                                    type="time"
                                    value={shiftEnd}
                                  />
                                </Field>
                              </FieldGroup>
                              <FieldSet className="gap-3">
                                <FieldLegend variant="label">
                                  Penanganan waktu
                                </FieldLegend>
                                <Field orientation="horizontal">
                                  <Checkbox
                                    checked={shiftOvernight}
                                    id="shift-overnight"
                                    onCheckedChange={(checked) =>
                                      setShiftOvernight(Boolean(checked))
                                    }
                                  />
                                  <FieldLabel htmlFor="shift-overnight">
                                    Shift selesai pada hari berikutnya
                                  </FieldLabel>
                                </Field>
                              </FieldSet>
                              <Field>
                                <FieldLabel htmlFor="shift-reason">
                                  Alasan
                                </FieldLabel>
                                <Input
                                  id="shift-reason"
                                  maxLength={1000}
                                  minLength={3}
                                  onChange={(event) =>
                                    setShiftReason(event.target.value)
                                  }
                                  required
                                  value={shiftReason}
                                />
                              </Field>
                              <Button disabled={busy} type="submit">
                                Buat template
                              </Button>
                            </form>
                          </CardContent>
                        </Card>
                      ) : null}
                      {isOwner ? (
                        <Card>
                          <CardHeader>
                            <CardTitle>Buat revisi template</CardTitle>
                            <CardDescription>
                              Revisi baru tidak mengubah jadwal yang sudah
                              menunjuk versi lama.
                            </CardDescription>
                          </CardHeader>
                          <CardContent>
                            <form
                              className="flex flex-col gap-4"
                              onSubmit={reviseShift}
                            >
                              <FieldGroup className="grid gap-4 sm:grid-cols-2">
                                <Field>
                                  <FieldLabel htmlFor="revision-template">
                                    Template
                                  </FieldLabel>
                                  <NativeSelect
                                    id="revision-template"
                                    onChange={(event) => {
                                      const templateId = event.target.value
                                      setRevisionTemplateId(templateId)
                                      const latest = context.shift_templates
                                        .find(
                                          (template) =>
                                            String(template.id) === templateId
                                        )
                                        ?.versions.at(-1)
                                      if (latest) {
                                        setRevisionStart(latest.start_time)
                                        setRevisionEnd(latest.end_time)
                                        setRevisionOvernight(
                                          latest.crosses_midnight
                                        )
                                      }
                                    }}
                                    required
                                    value={revisionTemplateId}
                                  >
                                    <NativeSelectOption value="">
                                      Pilih template
                                    </NativeSelectOption>
                                    {context.shift_templates.map((template) => (
                                      <NativeSelectOption
                                        key={template.id}
                                        value={template.id}
                                      >
                                        {template.name}
                                      </NativeSelectOption>
                                    ))}
                                  </NativeSelect>
                                </Field>
                                <Field>
                                  <FieldLabel htmlFor="revision-effective">
                                    Berlaku mulai
                                  </FieldLabel>
                                  <Input
                                    id="revision-effective"
                                    min={today()}
                                    onChange={(event) =>
                                      setRevisionEffectiveFrom(
                                        event.target.value
                                      )
                                    }
                                    required
                                    type="date"
                                    value={revisionEffectiveFrom}
                                  />
                                </Field>
                                <Field>
                                  <FieldLabel htmlFor="revision-start">
                                    Mulai
                                  </FieldLabel>
                                  <Input
                                    id="revision-start"
                                    onChange={(event) =>
                                      setRevisionStart(event.target.value)
                                    }
                                    required
                                    type="time"
                                    value={revisionStart}
                                  />
                                </Field>
                                <Field>
                                  <FieldLabel htmlFor="revision-end">
                                    Selesai
                                  </FieldLabel>
                                  <Input
                                    id="revision-end"
                                    onChange={(event) =>
                                      setRevisionEnd(event.target.value)
                                    }
                                    required
                                    type="time"
                                    value={revisionEnd}
                                  />
                                </Field>
                              </FieldGroup>
                              <Field orientation="horizontal">
                                <Checkbox
                                  checked={revisionOvernight}
                                  id="revision-overnight"
                                  onCheckedChange={(checked) =>
                                    setRevisionOvernight(Boolean(checked))
                                  }
                                />
                                <FieldLabel htmlFor="revision-overnight">
                                  Shift selesai pada hari berikutnya
                                </FieldLabel>
                              </Field>
                              <Field>
                                <FieldLabel htmlFor="revision-reason">
                                  Alasan revisi
                                </FieldLabel>
                                <Input
                                  id="revision-reason"
                                  maxLength={1000}
                                  minLength={3}
                                  onChange={(event) =>
                                    setRevisionReason(event.target.value)
                                  }
                                  required
                                  value={revisionReason}
                                />
                              </Field>
                              <Button
                                disabled={busy || !revisionTemplateId}
                                type="submit"
                              >
                                Simpan revisi
                              </Button>
                            </form>
                          </CardContent>
                        </Card>
                      ) : null}
                    </div>
                  </div>
                </TabsContent>

                <TabsContent
                  className="flex flex-col gap-5 pt-4"
                  value="kebijakan"
                >
                  <Card>
                    <CardHeader>
                      <CardTitle>Kebijakan efektif untuk outlet</CardTitle>
                      <CardDescription>
                        Nilai outlet mengubah field tertentu; field lain tetap
                        mewarisi kebijakan tenant.
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                        <PolicyValue
                          label="Toleransi terlambat"
                          value={`${policy?.effective.configuration?.late_tolerance_minutes ?? config.late_tolerance_minutes} menit`}
                        />
                        <PolicyValue
                          label="Jendela check-in"
                          value={`${policy?.effective.configuration?.check_in_window.early_minutes ?? config.check_in_window.early_minutes} menit lebih awal · ${policy?.effective.configuration?.check_in_window.late_minutes ?? config.check_in_window.late_minutes} menit setelah mulai`}
                        />
                        <PolicyValue
                          label="Mode kehadiran"
                          value={modeLabel(
                            policy?.effective.configuration?.attendance_mode ??
                              config.attendance_mode
                          )}
                        />
                        <PolicyValue
                          label="Validasi lokasi personal"
                          value={`Wajib · radius ${policy?.effective.configuration?.personal_location_validation.radius_meters ?? config.personal_location_validation.radius_meters} m`}
                        />
                        <PolicyValue
                          label="Batas permintaan retrospektif"
                          value={`${policy?.effective.configuration?.retroactive_request_limit_days ?? config.retroactive_request_limit_days} hari`}
                        />
                        <PolicyValue
                          label="Pemberitahuan minimum"
                          value={`${policy?.effective.configuration?.operational_review.minimum_notice_hours ?? config.operational_review.minimum_notice_hours} jam`}
                        />
                      </dl>
                    </CardContent>
                  </Card>

                  {isOwner ? (
                    <div className="grid gap-5 xl:grid-cols-2">
                      <Card>
                        <CardHeader>
                          <CardTitle>Versi kebijakan tenant</CardTitle>
                          <CardDescription>
                            Perubahan hanya berlaku pada tanggal yang dipilih
                            dan tercatat beserta alasannya.
                          </CardDescription>
                        </CardHeader>
                        <CardContent>
                          <form
                            className="flex flex-col gap-4"
                            onSubmit={createTenantPolicy}
                          >
                            <FieldGroup className="grid gap-4 sm:grid-cols-2">
                              <Field>
                                <FieldLabel htmlFor="policy-effective">
                                  Berlaku mulai
                                </FieldLabel>
                                <Input
                                  id="policy-effective"
                                  min={today()}
                                  onChange={(event) =>
                                    setPolicyEffectiveFrom(event.target.value)
                                  }
                                  required
                                  type="date"
                                  value={policyEffectiveFrom}
                                />
                              </Field>
                              <Field>
                                <FieldLabel htmlFor="policy-late-tolerance">
                                  Toleransi terlambat (menit)
                                </FieldLabel>
                                <Input
                                  id="policy-late-tolerance"
                                  max={180}
                                  min={0}
                                  onChange={(event) =>
                                    setPolicyLateTolerance(event.target.value)
                                  }
                                  required
                                  type="number"
                                  value={policyLateTolerance}
                                />
                              </Field>
                              <Field>
                                <FieldLabel htmlFor="policy-early-window">
                                  Check-in paling awal (menit)
                                </FieldLabel>
                                <Input
                                  id="policy-early-window"
                                  max={360}
                                  min={0}
                                  onChange={(event) =>
                                    setPolicyEarlyWindow(event.target.value)
                                  }
                                  required
                                  type="number"
                                  value={policyEarlyWindow}
                                />
                              </Field>
                              <Field>
                                <FieldLabel htmlFor="policy-late-window">
                                  Check-in setelah mulai (menit)
                                </FieldLabel>
                                <Input
                                  id="policy-late-window"
                                  max={360}
                                  min={0}
                                  onChange={(event) =>
                                    setPolicyLateWindow(event.target.value)
                                  }
                                  required
                                  type="number"
                                  value={policyLateWindow}
                                />
                              </Field>
                              <Field>
                                <FieldLabel htmlFor="policy-mode">
                                  Mode kehadiran
                                </FieldLabel>
                                <NativeSelect
                                  id="policy-mode"
                                  onChange={(event) =>
                                    setPolicyMode(
                                      event.target
                                        .value as PolicyConfiguration["attendance_mode"]
                                    )
                                  }
                                  value={policyMode}
                                >
                                  <NativeSelectOption value="kiosk">
                                    Kiosk
                                  </NativeSelectOption>
                                  <NativeSelectOption value="personal">
                                    Perangkat pribadi
                                  </NativeSelectOption>
                                  <NativeSelectOption value="hybrid">
                                    Kiosk dan perangkat pribadi
                                  </NativeSelectOption>
                                </NativeSelect>
                              </Field>
                              <Field>
                                <FieldLabel htmlFor="policy-radius">
                                  Radius lokasi (meter)
                                </FieldLabel>
                                <Input
                                  max={5000}
                                  min={50}
                                  onChange={(event) =>
                                    setPolicyRadius(event.target.value)
                                  }
                                  required
                                  type="number"
                                  value={policyRadius}
                                />
                              </Field>
                              <Field>
                                <FieldLabel htmlFor="policy-retro-days">
                                  Batas permintaan retrospektif (hari)
                                </FieldLabel>
                                <Input
                                  max={30}
                                  min={0}
                                  onChange={(event) =>
                                    setPolicyRetroactiveDays(event.target.value)
                                  }
                                  required
                                  type="number"
                                  value={policyRetroactiveDays}
                                />
                              </Field>
                              <Field>
                                <FieldLabel htmlFor="policy-notice-hours">
                                  Pemberitahuan minimum (jam)
                                </FieldLabel>
                                <Input
                                  max={168}
                                  min={0}
                                  onChange={(event) =>
                                    setPolicyNoticeHours(event.target.value)
                                  }
                                  required
                                  type="number"
                                  value={policyNoticeHours}
                                />
                              </Field>
                            </FieldGroup>
                            <p className="text-caption text-muted-foreground">
                              Validasi lokasi saat perangkat pribadi digunakan
                              dan alasan perubahan jadwal selalu wajib.
                            </p>
                            <Field>
                              <FieldLabel htmlFor="policy-reason">
                                Alasan kebijakan
                              </FieldLabel>
                              <Input
                                id="policy-reason"
                                maxLength={1000}
                                minLength={3}
                                onChange={(event) =>
                                  setPolicyReason(event.target.value)
                                }
                                required
                                value={policyReason}
                              />
                            </Field>
                            <Button disabled={busy} type="submit">
                              Jadwalkan kebijakan tenant
                            </Button>
                          </form>
                        </CardContent>
                      </Card>

                      <div className="flex flex-col gap-5">
                        <Card>
                          <CardHeader>
                            <CardTitle>Override khusus outlet</CardTitle>
                            <CardDescription>
                              Field yang tidak dipilih tetap memakai nilai
                              tenant pada tanggal berlaku.
                            </CardDescription>
                          </CardHeader>
                          <CardContent>
                            <form
                              className="flex flex-col gap-4"
                              onSubmit={createOutletPolicy}
                            >
                              <FieldGroup className="grid gap-4 sm:grid-cols-2">
                                <Field>
                                  <FieldLabel htmlFor="override-field">
                                    Field
                                  </FieldLabel>
                                  <NativeSelect
                                    id="override-field"
                                    onChange={(event) => {
                                      setOverrideField(event.target.value)
                                      setOverrideValue(
                                        event.target.value ===
                                          "late_tolerance_minutes"
                                          ? String(
                                              config.late_tolerance_minutes
                                            )
                                          : "60"
                                      )
                                    }}
                                    value={overrideField}
                                  >
                                    <NativeSelectOption value="late_tolerance_minutes">
                                      Toleransi terlambat
                                    </NativeSelectOption>
                                    <NativeSelectOption value="early_minutes">
                                      Check-in paling awal
                                    </NativeSelectOption>
                                    <NativeSelectOption value="late_minutes">
                                      Check-in setelah mulai
                                    </NativeSelectOption>
                                    <NativeSelectOption value="attendance_mode">
                                      Mode kehadiran
                                    </NativeSelectOption>
                                    <NativeSelectOption value="radius_meters">
                                      Radius lokasi pribadi
                                    </NativeSelectOption>
                                    <NativeSelectOption value="retroactive_request_limit_days">
                                      Batas retrospektif
                                    </NativeSelectOption>
                                    <NativeSelectOption value="minimum_notice_hours">
                                      Pemberitahuan minimum
                                    </NativeSelectOption>
                                  </NativeSelect>
                                </Field>
                                {overrideField === "attendance_mode" ? (
                                  <Field>
                                    <FieldLabel htmlFor="override-mode">
                                      Mode
                                    </FieldLabel>
                                    <NativeSelect
                                      id="override-mode"
                                      onChange={(event) =>
                                        setOverrideValue(event.target.value)
                                      }
                                      value={overrideValue}
                                    >
                                      <NativeSelectOption value="kiosk">
                                        Kiosk
                                      </NativeSelectOption>
                                      <NativeSelectOption value="personal">
                                        Perangkat pribadi
                                      </NativeSelectOption>
                                      <NativeSelectOption value="hybrid">
                                        Kiosk dan perangkat pribadi
                                      </NativeSelectOption>
                                    </NativeSelect>
                                  </Field>
                                ) : (
                                  <Field>
                                    <FieldLabel htmlFor="override-value">
                                      Nilai
                                    </FieldLabel>
                                    <Input
                                      id="override-value"
                                      max={
                                        overrideField === "radius_meters"
                                          ? 5000
                                          : overrideField ===
                                              "late_tolerance_minutes"
                                            ? 180
                                            : overrideField ===
                                                "retroactive_request_limit_days"
                                              ? 30
                                              : overrideField ===
                                                  "minimum_notice_hours"
                                                ? 168
                                                : 360
                                      }
                                      min={
                                        overrideField === "radius_meters"
                                          ? 50
                                          : 0
                                      }
                                      onChange={(event) =>
                                        setOverrideValue(event.target.value)
                                      }
                                      required
                                      type="number"
                                      value={overrideValue}
                                    />
                                  </Field>
                                )}
                                <Field>
                                  <FieldLabel htmlFor="override-effective">
                                    Berlaku mulai
                                  </FieldLabel>
                                  <Input
                                    id="override-effective"
                                    min={today()}
                                    onChange={(event) =>
                                      setOverrideEffectiveFrom(
                                        event.target.value
                                      )
                                    }
                                    required
                                    type="date"
                                    value={overrideEffectiveFrom}
                                  />
                                </Field>
                              </FieldGroup>
                              <Field>
                                <FieldLabel htmlFor="override-reason">
                                  Alasan
                                </FieldLabel>
                                <Input
                                  id="override-reason"
                                  maxLength={1000}
                                  minLength={3}
                                  onChange={(event) =>
                                    setOverrideReason(event.target.value)
                                  }
                                  required
                                  value={overrideReason}
                                />
                              </Field>
                              <Button
                                disabled={busy || !outletId}
                                type="submit"
                              >
                                Jadwalkan override outlet
                              </Button>
                            </form>
                          </CardContent>
                        </Card>
                        <Card>
                          <CardHeader>
                            <CardTitle>Riwayat kebijakan</CardTitle>
                            <CardDescription>
                              Versi lama tidak dihapus agar hasil historis dapat
                              direproduksi.
                            </CardDescription>
                          </CardHeader>
                          <CardContent className="grid gap-4 md:grid-cols-2">
                            <HistoryList
                              title="Tenant"
                              rows={
                                policy?.history?.tenant_versions.map(
                                  (item) => ({
                                    date: item.effective_from,
                                    label: `Toleransi ${item.configuration.late_tolerance_minutes} menit`,
                                    reason: item.reason,
                                  })
                                ) ?? []
                              }
                            />
                            <HistoryList
                              title="Outlet"
                              rows={
                                policy?.history?.outlet_versions.map(
                                  (item) => ({
                                    date: item.effective_from,
                                    label: Object.keys(item.overrides).join(
                                      ", "
                                    ),
                                    reason: item.reason,
                                  })
                                ) ?? []
                              }
                            />
                          </CardContent>
                        </Card>
                      </div>
                    </div>
                  ) : (
                    <Alert>
                      <AlertTitle>Kebijakan efektif</AlertTitle>
                      <AlertDescription>
                        Anda dapat melihat nilai kebijakan outlet ini. Perubahan
                        kebijakan hanya tersedia untuk Owner.
                      </AlertDescription>
                    </Alert>
                  )}
                </TabsContent>

                <TabsContent
                  className="flex flex-col gap-5 pt-4"
                  value="kalender"
                >
                  <Card>
                    <CardHeader>
                      <CardTitle>Operasional outlet minggu ini</CardTitle>
                      <CardDescription>
                        Hari libur referensi tidak menutup outlet secara
                        otomatis.
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                      {calendar?.days.map((day) => (
                        <div
                          className="flex flex-col gap-2 rounded-xl border p-3"
                          key={day.date}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-label">
                              {formatWorkDate(day.date)}
                            </p>
                            <Badge
                              variant={
                                day.status === "open" ? "secondary" : "outline"
                              }
                            >
                              {day.status === "open" ? "Buka" : "Tutup"}
                            </Badge>
                          </div>
                          <p className="text-caption text-muted-foreground">
                            {day.timezone}
                          </p>
                          {day.holiday_references.map((holiday) => (
                            <p className="text-caption" key={holiday.id}>
                              {holiday.name}
                              {holiday.region ? ` · ${holiday.region}` : ""}
                            </p>
                          ))}
                        </div>
                      ))}
                    </CardContent>
                  </Card>
                  {context.capabilities.manage_calendars ? (
                    <div className="grid gap-5 xl:grid-cols-2">
                      <div className="flex flex-col gap-5">
                        <Card>
                          <CardHeader>
                            <CardTitle>Versi kalender outlet</CardTitle>
                            <CardDescription>
                              Perubahan timezone dan hari buka berlaku efektif
                              ke depan.
                            </CardDescription>
                          </CardHeader>
                          <CardContent>
                            <form
                              className="flex flex-col gap-4"
                              onSubmit={createCalendarVersion}
                            >
                              <FieldGroup className="grid gap-4 sm:grid-cols-2">
                                <Field>
                                  <FieldLabel htmlFor="calendar-timezone">
                                    Zona waktu IANA
                                  </FieldLabel>
                                  <Input
                                    id="calendar-timezone"
                                    onChange={(event) =>
                                      setCalendarTimezone(event.target.value)
                                    }
                                    required
                                    value={calendarTimezone}
                                  />
                                </Field>
                                <Field>
                                  <FieldLabel htmlFor="calendar-effective">
                                    Berlaku mulai
                                  </FieldLabel>
                                  <Input
                                    id="calendar-effective"
                                    min={today()}
                                    onChange={(event) =>
                                      setCalendarEffectiveFrom(
                                        event.target.value
                                      )
                                    }
                                    required
                                    type="date"
                                    value={calendarEffectiveFrom}
                                  />
                                </Field>
                              </FieldGroup>
                              <FieldSet className="gap-3">
                                <FieldLegend variant="label">
                                  Hari operasional normal
                                </FieldLegend>
                                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                                  {weekdays.map((day) => (
                                    <Field
                                      className="flex-row items-center"
                                      key={day.id}
                                    >
                                      <Checkbox
                                        checked={calendarWeekdays.includes(
                                          day.id
                                        )}
                                        id={`calendar-day-${day.id}`}
                                        onCheckedChange={(checked) =>
                                          setCalendarWeekdays((current) =>
                                            checked
                                              ? [...current, day.id].sort()
                                              : current.filter(
                                                  (value) => value !== day.id
                                                )
                                          )
                                        }
                                      />
                                      <FieldLabel
                                        htmlFor={`calendar-day-${day.id}`}
                                      >
                                        {day.label}
                                      </FieldLabel>
                                    </Field>
                                  ))}
                                </div>
                              </FieldSet>
                              <Field>
                                <FieldLabel htmlFor="calendar-reason">
                                  Alasan perubahan
                                </FieldLabel>
                                <Input
                                  id="calendar-reason"
                                  maxLength={1000}
                                  minLength={3}
                                  onChange={(event) =>
                                    setCalendarReason(event.target.value)
                                  }
                                  required
                                  value={calendarReason}
                                />
                              </Field>
                              <Button
                                disabled={
                                  busy ||
                                  !outletId ||
                                  calendarWeekdays.length === 0
                                }
                                type="submit"
                              >
                                Simpan versi kalender
                              </Button>
                            </form>
                          </CardContent>
                        </Card>
                        <Card>
                          <CardHeader>
                            <CardTitle>Hari libur referensi</CardTitle>
                            <CardDescription>
                              Catatan operasional yang tidak mengubah status
                              buka atau tutup.
                            </CardDescription>
                          </CardHeader>
                          <CardContent>
                            <form
                              className="flex flex-col gap-4"
                              onSubmit={createHoliday}
                            >
                              <FieldGroup className="grid gap-4 sm:grid-cols-3">
                                <Field>
                                  <FieldLabel htmlFor="holiday-date">
                                    Tanggal
                                  </FieldLabel>
                                  <Input
                                    id="holiday-date"
                                    onChange={(event) =>
                                      setHolidayDate(event.target.value)
                                    }
                                    required
                                    type="date"
                                    value={holidayDate}
                                  />
                                </Field>
                                <Field>
                                  <FieldLabel htmlFor="holiday-name">
                                    Nama hari
                                  </FieldLabel>
                                  <Input
                                    id="holiday-name"
                                    maxLength={160}
                                    minLength={2}
                                    onChange={(event) =>
                                      setHolidayName(event.target.value)
                                    }
                                    required
                                    value={holidayName}
                                  />
                                </Field>
                                <Field>
                                  <FieldLabel htmlFor="holiday-region">
                                    Wilayah (opsional)
                                  </FieldLabel>
                                  <Input
                                    id="holiday-region"
                                    maxLength={120}
                                    onChange={(event) =>
                                      setHolidayRegion(event.target.value)
                                    }
                                    value={holidayRegion}
                                  />
                                </Field>
                              </FieldGroup>
                              <Button
                                disabled={busy}
                                type="submit"
                                variant="outline"
                              >
                                Catat hari libur
                              </Button>
                            </form>
                          </CardContent>
                        </Card>
                      </div>
                      <Card>
                        <CardHeader>
                          <CardTitle>Pengecualian buka atau tutup</CardTitle>
                          <CardDescription>
                            Penutupan outlet hanya terjadi setelah Owner
                            menyimpan status tutup untuk tanggal tertentu.
                          </CardDescription>
                        </CardHeader>
                        <CardContent>
                          <form
                            className="flex flex-col gap-4"
                            onSubmit={createCalendarException}
                          >
                            <FieldGroup className="grid gap-4 sm:grid-cols-2">
                              <Field>
                                <FieldLabel htmlFor="calendar-exception-date">
                                  Tanggal
                                </FieldLabel>
                                <Input
                                  id="calendar-exception-date"
                                  min={today()}
                                  onChange={(event) =>
                                    setCalendarExceptionDate(event.target.value)
                                  }
                                  required
                                  type="date"
                                  value={calendarExceptionDate}
                                />
                              </Field>
                              <Field>
                                <FieldLabel htmlFor="calendar-exception-status">
                                  Status outlet
                                </FieldLabel>
                                <NativeSelect
                                  id="calendar-exception-status"
                                  onChange={(event) =>
                                    setCalendarExceptionStatus(
                                      event.target.value as "open" | "closed"
                                    )
                                  }
                                  value={calendarExceptionStatus}
                                >
                                  <NativeSelectOption value="closed">
                                    Tutup
                                  </NativeSelectOption>
                                  <NativeSelectOption value="open">
                                    Buka
                                  </NativeSelectOption>
                                </NativeSelect>
                              </Field>
                              <Field>
                                <FieldLabel htmlFor="calendar-holiday">
                                  Referensi hari libur (opsional)
                                </FieldLabel>
                                <NativeSelect
                                  id="calendar-holiday"
                                  onChange={(event) =>
                                    setCalendarExceptionHoliday(
                                      event.target.value
                                    )
                                  }
                                  value={calendarExceptionHoliday}
                                >
                                  <NativeSelectOption value="">
                                    Tanpa referensi
                                  </NativeSelectOption>
                                  {flatHolidayOptions.map((holiday) => (
                                    <NativeSelectOption
                                      key={`${holiday.id}-${holiday.name}`}
                                      value={holiday.id}
                                    >
                                      {holiday.name}
                                    </NativeSelectOption>
                                  ))}
                                </NativeSelect>
                              </Field>
                            </FieldGroup>
                            <Field>
                              <FieldLabel htmlFor="calendar-exception-reason">
                                Alasan operasional
                              </FieldLabel>
                              <Input
                                id="calendar-exception-reason"
                                maxLength={1000}
                                minLength={3}
                                onChange={(event) =>
                                  setCalendarExceptionReason(event.target.value)
                                }
                                required
                                value={calendarExceptionReason}
                              />
                            </Field>
                            <Button disabled={busy || !outletId} type="submit">
                              Simpan status outlet
                            </Button>
                          </form>
                        </CardContent>
                      </Card>
                    </div>
                  ) : (
                    <Alert>
                      <AlertTitle>Kalender outlet</AlertTitle>
                      <AlertDescription>
                        Kalender ini hanya dapat dilihat dalam outlet yang
                        termasuk cakupan Supervisor.
                      </AlertDescription>
                    </Alert>
                  )}
                </TabsContent>
              </Tabs>
            ) : (
              <PersonalSchedule
                days={personalDays}
                loading={loading}
                weekStart={weekStart}
              />
            )}
          </main>
        </div>
      </div>
    </SidebarProvider>
  )
}

function ScheduleCell({ day }: { day: EffectiveDay }) {
  const conflicts = day.conflicts.length > 0
  return (
    <TableCell className="align-top">
      <div className="flex min-w-24 flex-col items-start gap-1.5">
        {day.status === "scheduled" && day.shift ? (
          <>
            <Badge variant="secondary">{day.shift.name ?? "Shift"}</Badge>
            <span className="text-caption text-muted-foreground">
              {formatInstant(day.scheduled_start, day.timezone)}–
              {formatInstant(day.scheduled_end, day.timezone)}
            </span>
          </>
        ) : (
          <Badge variant="outline">
            {day.status === "rest" ? "Libur" : "Belum dijadwalkan"}
          </Badge>
        )}
        {conflicts ? <Badge variant="destructive">Konflik</Badge> : null}
        {day.conflicts.map((conflict) => (
          <span
            className="max-w-36 text-caption text-destructive"
            key={conflict}
          >
            {conflictLabel(conflict)}
          </span>
        ))}
      </div>
    </TableCell>
  )
}

function ScheduleDayCard({ day }: { day: EffectiveDay }) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-xl border p-3">
      <div className="flex flex-col gap-1">
        <p className="text-label">{formatWorkDate(day.work_date)}</p>
        {day.status === "scheduled" && day.shift ? (
          <p className="text-caption text-muted-foreground">
            {day.shift.name} ·{" "}
            {formatInstant(day.scheduled_start, day.timezone)}–
            {formatInstant(day.scheduled_end, day.timezone)}
          </p>
        ) : null}
        {day.conflicts.map((conflict) => (
          <p className="text-caption text-destructive" key={conflict}>
            {conflictLabel(conflict)}
          </p>
        ))}
      </div>
      <Badge
        variant={
          day.conflicts.length
            ? "destructive"
            : day.status === "scheduled"
              ? "secondary"
              : "outline"
        }
      >
        {day.conflicts.length
          ? "Konflik"
          : day.status === "scheduled"
            ? "Shift"
            : day.status === "rest"
              ? "Libur"
              : "Belum diatur"}
      </Badge>
    </div>
  )
}

function PersonalSchedule({
  days,
  loading,
  weekStart,
}: {
  days: EffectiveDay[]
  loading: boolean
  weekStart: string
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Jadwal pribadi</CardTitle>
        <CardDescription>
          Minggu mulai {weekStart}. Tampilan hanya memuat jadwal milik Anda.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <p className="text-body text-muted-foreground">
            Memuat jadwal pribadi…
          </p>
        ) : null}
        {!loading && days.length === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>Belum ada jadwal</EmptyTitle>
              <EmptyDescription>
                Jadwal akan muncul setelah Owner atau Supervisor menyusunnya.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : null}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {days.map((day) => (
            <Card key={day.work_date}>
              <CardHeader className="pb-2">
                <CardTitle className="text-subtitle">
                  {formatWorkDate(day.work_date)}
                </CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-2">
                <p className="text-label">
                  {day.status === "scheduled"
                    ? (day.shift?.name ?? "Shift")
                    : day.status === "rest"
                      ? "Libur"
                      : "Belum dijadwalkan"}
                </p>
                {day.outlet ? (
                  <p className="text-caption text-muted-foreground">
                    {day.outlet.name}
                  </p>
                ) : null}
                {day.scheduled_start && day.scheduled_end ? (
                  <p className="text-caption text-muted-foreground">
                    {formatInstant(day.scheduled_start, day.timezone)}–
                    {formatInstant(day.scheduled_end, day.timezone)}
                  </p>
                ) : null}
                {day.conflicts.map((conflict) => (
                  <Badge key={conflict} variant="destructive">
                    {conflictLabel(conflict)}
                  </Badge>
                ))}
              </CardContent>
            </Card>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

function PolicyValue({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-xl border p-3">
      <dt className="text-caption text-muted-foreground">{label}</dt>
      <dd className="text-label">{value}</dd>
    </div>
  )
}

function HistoryList({
  title,
  rows,
}: {
  title: string
  rows: Array<{ date: string; label: string; reason: string | null }>
}) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-label">{title}</p>
      {rows.length === 0 ? (
        <p className="text-caption text-muted-foreground">
          Belum ada versi kebijakan.
        </p>
      ) : (
        rows.map((row) => (
          <div
            className="rounded-xl border p-3"
            key={`${row.date}-${row.label}`}
          >
            <p className="text-caption">
              {row.date} · {row.label}
            </p>
            {row.reason ? (
              <p className="text-caption text-muted-foreground">{row.reason}</p>
            ) : null}
          </div>
        ))
      )}
    </div>
  )
}

function formatWorkDate(value: string): string {
  const date = new Date(`${value}T00:00:00`)
  return new Intl.DateTimeFormat("id-ID", {
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(date)
}

function formatInstant(value: string | null, timezone: string): string {
  if (!value) return "—"
  return new Intl.DateTimeFormat("id-ID", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: timezone,
  }).format(new Date(value))
}

function modeLabel(value: PolicyConfiguration["attendance_mode"]): string {
  if (value === "personal") return "Perangkat pribadi"
  if (value === "hybrid") return "Kiosk dan perangkat pribadi"
  return "Kiosk"
}

function conflictLabel(value: string): string {
  const labels: Record<string, string> = {
    contradictory_schedule_rules: "Aturan jadwal bertentangan",
    shift_template_not_effective: "Versi shift belum berlaku",
    invalid_shift_interval: "Rentang shift tidak valid",
    employee_not_assigned_to_outlet: "Penugasan outlet tidak mencakup shift",
    outlet_closed: "Shift bertabrakan dengan outlet tutup",
    attendance_policy_missing: "Kebijakan efektif belum tersedia",
    invalid_local_time: "Jam lokal ambigu pada perubahan zona waktu",
  }
  return labels[value] ?? "Konflik jadwal"
}

function today(): string {
  return localDateString(new Date())
}

function tomorrow(): string {
  const date = new Date()
  date.setDate(date.getDate() + 1)
  return localDateString(date)
}

function mondayOfToday(): string {
  return mondayOf(localDateString(new Date()))
}

function mondayOf(value: string): string {
  const date = new Date(`${value}T00:00:00`)
  date.setDate(date.getDate() - ((date.getDay() + 6) % 7))
  return localDateString(date)
}

function addDays(value: string, amount: number): string {
  const date = new Date(`${value}T00:00:00`)
  date.setDate(date.getDate() + amount)
  return localDateString(date)
}

function localDateString(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}
