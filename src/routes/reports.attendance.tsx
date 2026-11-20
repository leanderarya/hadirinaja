import { createFileRoute } from "@tanstack/react-router"
import { useCallback, useEffect, useRef, useState } from "react"

import { ManagementSidebar, ManagementTopbar } from "@/components/management-sidebar"
import {
  PageHeading,
  ReportSectionNavigation,
  ScopeBanner,
  WorkDateRangeControl,
} from "@/components/r2c/screen-blocks"
import { StatusBadge, type StatusTone } from "@/components/r2c/components"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { SidebarProvider } from "@/components/ui/sidebar"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  ApiError,
  type AuthSession,
  apiRequest,
  downloadApiFile,
} from "@/lib/api"

export const Route = createFileRoute("/reports/attendance")({
  component: AttendanceReportPage,
})

type Options = {
  business_units: Array<{ id: number; name: string }>
  maximum_days: number
  outlets: Array<{
    id: number
    name: string
    business_unit_id: number
    business_unit_name: string
  }>
}
type ReportRow = {
  work_date: string
  employee: { id: number; name: string }
  outlets: Array<{ id: number; name: string; business_unit_name: string }>
  schedule: {
    status: string
    shift: { name?: string } | null
    scheduled_start: string | null
    scheduled_end: string | null
    timezone: string | null
  }
  sessions: Array<{
    id: number
    timezone: string | null
    recording_status: string
    original: {
      check_in_at: string | null
      check_out_at: string | null
      event_ids: number[]
      events: Array<{ id: number; origin: string; type: string }>
    }
    effective: {
      check_in_at: string | null
      check_out_at: string | null
      duration_seconds: number | null
      work_date: string
    }
    actual_duration_seconds: number | null
    correction: {
      request_id: number
      decision_id: number
      actor_user_id: number
      decided_at: string
      classification: string
      reason: string
    } | null
    review_indicators: string[]
  }>
  reconstructions?: Array<{
    source_id: number
    decision_id: number
    effective: { check_in_at: string; check_out_at: string; timezone: string; outlet_id: number }
  }>
  actual_duration_seconds: number | null
  effective_duration_seconds: number | null
  leave_requests: Array<{ id: number; status: string; category: string | null }>
  overtime_requests: Array<{
    id: number
    status: string
    requested_minutes: number | null
    approved_minutes: number | null
  }>
  review: {
    status: string
    indicators: string[]
    unreviewed_indicators: string[]
    cases: Array<{ id: number; status: string; case_type: string | null }>
  }
  outcome: string
  is_finalized: boolean
  finalization: {
    id: number
    revision: number
    outcome: string
    reason: string
    actor_user_id: number
    finalized_at: string
  } | null
  correction_decision_ids: number[]
  source_attendance_event_ids: number[]
}
type ReportResult = {
  data: ReportRow[]
  pagination: {
    current_page: number
    per_page: number
    total: number
    last_page: number
    has_more: boolean
  }
  totals: {
    employee_workdays: number
    unique_employees: number
    attendance_sessions: number
    known_actual_duration_seconds: number
    known_effective_duration_seconds: number
  }
  provenance: {
    generated_at: string
    reporting_semantics: string
    values: string
  }
}

function today() {
  const date = new Date()
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-")
}
function daysAgo(days: number) {
  const date = new Date()
  date.setDate(date.getDate() - days)
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-")
}
function count(value: number) {
  return new Intl.NumberFormat("id-ID").format(value)
}
function duration(seconds: number | null) {
  if (seconds === null) return "Belum diketahui"
  return `${Math.floor(seconds / 3600)} jam ${String(Math.floor((seconds % 3600) / 60)).padStart(2, "0")} menit`
}
function instant(value: string | null, timezone: string | null) {
  if (!value) return "—"
  return new Intl.DateTimeFormat("id-ID", {
    timeZone: timezone || "Asia/Jakarta",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value))
}
function clockTime(value: string, timezone: string | null) {
  return new Intl.DateTimeFormat("id-ID", {
    timeZone: timezone || "Asia/Jakarta",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value))
}
function timeRange(
  start: string | null,
  end: string | null,
  timezone: string | null
) {
  if (!start && !end) return "Belum tercatat"
  return `${start ? clockTime(start, timezone) : "—"}–${end ? clockTime(end, timezone) : "—"}`
}
function formatReportDate(value: string) {
  return new Date(`${value}T12:00:00`).toLocaleDateString("id-ID", {
    weekday: "short",
    day: "numeric",
    month: "short",
  })
}
function formatReportRange(from: string, to: string) {
  const format = (value: string) =>
    new Date(`${value}T12:00:00`).toLocaleDateString("id-ID", {
      day: "numeric",
      month: "short",
      year: "numeric",
    })
  return from === to ? format(from) : `${format(from)}–${format(to)}`
}
function statusLabel(value: string) {
  const labels: Record<string, string> = {
    present: "Hadir",
    leave: "Cuti",
    sick: "Sakit",
    permission: "Izin",
    potential_absence: "Potensi tidak hadir",
    confirmed_absence_pending_finalization:
      "Ketidakhadiran terkonfirmasi · menunggu penetapan hasil",
    exceptional_attendance: "Kehadiran khusus",
    no_recorded_outcome: "Belum ada hasil kehadiran",
  }
  return labels[value] ?? value.replaceAll("_", " ")
}

function statusTone(value: string): StatusTone {
  if (value === "present") return "success"
  if (value === "potential_absence") return "warning"
  if (value === "confirmed_absence_pending_finalization") return "danger"
  if (["leave", "sick", "permission", "exceptional_attendance"].includes(value))
    return "info"
  return "neutral"
}

function hasEffectiveCorrection(row: ReportRow) {
  return row.sessions.some((session) => session.correction !== null)
}

async function ensureManagementAccess(onSession?: (session: AuthSession) => void) {
  const session = await apiRequest<AuthSession>("/auth/me")
  if (!session.active_membership) {
    window.location.assign("/select-tenant")
    return false
  }
  if (
    !session.active_membership.roles.some(
      (role) => role === "owner" || role === "supervisor"
    )
  ) {
    window.location.assign("/attendance")
    return false
  }
  onSession?.(session)
  return true
}

function reportQuery(filters: {
  from: string
  to: string
  page: number
  businessUnitId: string
  outletId: string
  employeeId: string
  status: string
}) {
  const params = new URLSearchParams({
    from: filters.from,
    to: filters.to,
    page: String(filters.page),
    per_page: "25",
  })
  if (filters.businessUnitId)
    params.set("business_unit_id", filters.businessUnitId)
  if (filters.outletId) params.append("outlet_ids[]", filters.outletId)
  if (filters.employeeId) params.set("employee_id", filters.employeeId)
  if (filters.status) params.set("status", filters.status)
  return params.toString()
}

function AttendanceReportPage() {
  const [navigationSession, setNavigationSession] = useState<AuthSession | null>(null)
  const [options, setOptions] = useState<Options | null>(null)
  const [result, setResult] = useState<ReportResult | null>(null)
  const [selected, setSelected] = useState<ReportRow | null>(null)
  const [from, setFrom] = useState(daysAgo(13))
  const [to, setTo] = useState(today())
  const [businessUnitId, setBusinessUnitId] = useState("")
  const [outletId, setOutletId] = useState("")
  const [employeeId, setEmployeeId] = useState("")
  const [status, setStatus] = useState("")
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false)
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [exporting, setExporting] = useState(false)
  const [error, setError] = useState("")
  const initialLoad = useRef(false)
  const mobileDetailTrigger = useRef<HTMLButtonElement | null>(null)
  const mobileDetailBack = useRef<HTMLButtonElement | null>(null)

  const visibleOutlets =
    options?.outlets.filter(
      (outlet) =>
        !businessUnitId || String(outlet.business_unit_id) === businessUnitId
    ) ?? []

  const pageRows = result?.data ?? []
  const resultOutletCount = new Set(
    pageRows.flatMap((row) => row.outlets.map((outlet) => outlet.id))
  ).size

  const load = useCallback(
    async (
      targetPage = 1,
      includeOptions = false,
      dateRange?: { from: string; to: string }
    ) => {
      setLoading(true)
      setError("")
      try {
        if (!(await ensureManagementAccess(setNavigationSession))) return
        if (includeOptions || !options)
          setOptions(await apiRequest<Options>("/management/reports/filters"))
        const next = await apiRequest<ReportResult>(
          `/management/reports/attendance?${reportQuery({
            from: dateRange?.from ?? from,
            to: dateRange?.to ?? to,
            page: targetPage,
            businessUnitId,
            outletId,
            employeeId,
            status,
          })}`
        )
        setResult(next)
        setSelected((current) =>
          current
            ? (next.data.find(
                (row) =>
                  row.employee.id === current.employee.id &&
                  row.work_date === current.work_date
              ) ??
              next.data[0] ??
              null)
            : (next.data[0] ?? null)
        )
        setPage(targetPage)
      } catch (caught) {
        if (
          caught instanceof ApiError &&
          (caught.status === 401 || caught.status === 419)
        ) {
          window.location.assign("/login?expired=1")
          return
        }
        setError(
          caught instanceof ApiError
            ? caught.message
            : "Laporan detail belum dapat dimuat."
        )
        setResult(null)
      } finally {
        setLoading(false)
      }
    },
    [businessUnitId, employeeId, from, options, outletId, status, to]
  )

  useEffect(() => {
    if (!initialLoad.current) {
      initialLoad.current = true
      const range = window.matchMedia("(max-width: 767px)").matches
        ? { from: today(), to: today() }
        : { from, to }
      if (range.from !== from || range.to !== to) {
        setFrom(range.from)
        setTo(range.to)
      }
      void load(1, true, range)
    }
    const expireSession = () => window.location.assign("/login?expired=1")
    window.addEventListener("hadirinaja:session-expired", expireSession)
    return () =>
      window.removeEventListener("hadirinaja:session-expired", expireSession)
    // Load once; filter changes are applied only after submit.
  }, [from, load, to])

  async function exportCsv() {
    setExporting(true)
    setError("")
    try {
      if (!(await ensureManagementAccess(setNavigationSession))) return
      await downloadApiFile(
        `/management/reports/attendance.csv?${reportQuery({
          from,
          to,
          page: 1,
          businessUnitId,
          outletId,
          employeeId,
          status,
        })}`,
        `laporan-kehadiran-${from}-${to}.csv`
      )
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught.message
          : "Ekspor CSV belum dapat dibuat."
      )
    } finally {
      setExporting(false)
    }
  }

  function updateBusinessUnit(value: string) {
    setBusinessUnitId(value)
    if (
      outletId &&
      !options?.outlets.some(
        (outlet) =>
          String(outlet.id) === outletId &&
          (!value || String(outlet.business_unit_id) === value)
      )
    )
      setOutletId("")
  }

  function selectReportRow(row: ReportRow, trigger?: HTMLButtonElement) {
    setSelected(row)
    if (window.matchMedia("(max-width: 1279px)").matches) {
      mobileDetailTrigger.current = trigger ?? null
      setMobileDetailOpen(true)
      requestAnimationFrame(() => mobileDetailBack.current?.focus())
    }
  }

  function closeMobileDetail() {
    setMobileDetailOpen(false)
    requestAnimationFrame(() => mobileDetailTrigger.current?.focus())
  }

  const navigationContext = navigationSession?.active_membership ? { tenantName: navigationSession.active_membership.tenant.name, roles: navigationSession.active_membership.roles, userName: navigationSession.user.name } : null
  const membershipRoles = navigationSession?.active_membership?.roles ?? []
  const isSupervisor =
    membershipRoles.includes("supervisor") && !membershipRoles.includes("owner")
  const scopeTitle = isSupervisor
    ? "Supervisor · Outlet yang dapat Anda akses"
    : "Owner · seluruh Outlet dalam organisasi aktif"

  return (
    <SidebarProvider className="pb-[calc(6rem+env(safe-area-inset-bottom))] md:pb-0">
      <ManagementSidebar activePage="attendance-report" context={navigationContext} />
      <main className="min-w-0 flex-1 bg-canvas">
        <ManagementTopbar context={navigationContext} />
        <div
          className={`owner-report-page mx-auto flex max-w-7xl flex-col gap-6 p-4 md:gap-8 md:p-8 ${mobileDetailOpen ? "is-detail-open" : ""}`}
        >
          <div className="owner-attendance-report-heading-row">
            <PageHeading
              className="owner-attendance-report-heading"
              description="Kehadiran diringkas per karyawan dan tanggal kerja, terpisah dari pengelolaan Tim."
              role={isSupervisor ? "Supervisor" : "Owner"}
              mobileTitle="Laporan"
              title="Laporan"
            />
          </div>
          <ReportSectionNavigation active="attendance" />
          {navigationSession?.active_membership ? (
            <div className="owner-attendance-workdate-banner">
              <ScopeBanner title={`Tanggal kerja Outlet · ${formatReportRange(from, to)}`}>
                Waktu sesi mengikuti zona waktu lokal Outlet; laporan menampilkan nilai efektif saat ini.
              </ScopeBanner>
            </div>
          ) : null}
          {navigationSession?.active_membership && isSupervisor ? (
            <ScopeBanner title={scopeTitle}>
              Data dan pilihan Outlet mengikuti izin akses Anda.
            </ScopeBanner>
          ) : null}

          <Card
            className={`owner-attendance-report-filters ${mobileFiltersOpen ? "" : "owner-mobile-filters-collapsed"}`}
            id="attendance-report-filters"
          >
            <CardHeader>
              <CardTitle>Filter laporan</CardTitle>
              <CardDescription>
                Tanggal kerja memakai zona waktu lokal masing-masing Outlet.
              </CardDescription>
            </CardHeader>
            <CardContent className="owner-attendance-report-filters-content">
              <div className="owner-attendance-report-date-filter">
                <WorkDateRangeControl
                  disabled={loading}
                  from={from}
                  maximumDays={options?.maximum_days ?? 31}
                  onApply={(range) => {
                    setFrom(range.from)
                    setTo(range.to)
                  }}
                  to={to}
                />
              </div>
              <form
                className="owner-attendance-report-filter-form grid gap-4 sm:grid-cols-2 lg:grid-cols-4"
                onSubmit={(event) => {
                  event.preventDefault()
                  setMobileFiltersOpen(false)
                  void load(1)
                }}
              >
                <Field>
                  <FieldLabel htmlFor="attendance-unit">Unit bisnis</FieldLabel>
                  <NativeSelect
                    id="attendance-unit"
                    value={businessUnitId}
                    onChange={(event) => updateBusinessUnit(event.target.value)}
                  >
                    <NativeSelectOption value="">
                      Semua unit bisnis yang dapat Anda akses
                    </NativeSelectOption>
                    {options?.business_units.map((unit) => (
                      <NativeSelectOption key={unit.id} value={String(unit.id)}>
                        {unit.name}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                </Field>
                <Field>
                  <FieldLabel htmlFor="attendance-outlet">Outlet</FieldLabel>
                  <NativeSelect
                    id="attendance-outlet"
                    value={outletId}
                    onChange={(event) => setOutletId(event.target.value)}
                  >
                    <NativeSelectOption value="">
                      Semua Outlet yang dapat Anda akses
                    </NativeSelectOption>
                    {visibleOutlets.map((outlet) => (
                      <NativeSelectOption
                        key={outlet.id}
                        value={String(outlet.id)}
                      >
                        {outlet.name}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                </Field>
                <Field>
                  <FieldLabel htmlFor="attendance-employee">
                    ID karyawan
                  </FieldLabel>
                  <Input
                    id="attendance-employee"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    value={employeeId}
                    onChange={(event) => setEmployeeId(event.target.value)}
                    placeholder="Semua karyawan"
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="attendance-status">
                    Status efektif
                  </FieldLabel>
                  <NativeSelect
                    id="attendance-status"
                    value={status}
                    onChange={(event) => setStatus(event.target.value)}
                  >
                    <NativeSelectOption value="">
                      Semua status
                    </NativeSelectOption>
                    {[
                      "present",
                      "leave",
                      "sick",
                      "permission",
                      "potential_absence",
                      "confirmed_absence_pending_finalization",
                      "exceptional_attendance",
                      "no_recorded_outcome",
                    ].map((value) => (
                      <NativeSelectOption key={value} value={value}>
                        {statusLabel(value)}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                </Field>
                <div className="flex items-end">
                  <Button type="submit" disabled={loading} className="w-full">
                    {loading ? "Memuat…" : "Terapkan filter"}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>

          {error ? (
            <Alert variant="destructive">
              <AlertTitle>Laporan belum tersedia</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          <section
            aria-label="Hasil laporan kehadiran"
            className={`owner-attendance-mobile-results ${mobileDetailOpen ? "is-detail-open" : ""}`}
          >
            <div className="owner-attendance-mobile-results-heading">
              <div>
                <h2 className="sr-only">Baris laporan</h2>
                <p className="text-caption text-muted-foreground">
                  {result
                    ? `${count(result.pagination.total)} hasil · ${resultOutletCount} Outlet`
                    : "Data akan tampil setelah laporan dimuat."}
                </p>
              </div>
              <Button
                aria-controls="attendance-report-filters"
                aria-expanded={mobileFiltersOpen && !mobileDetailOpen}
                className="owner-mobile-report-filter-toggle"
                disabled={mobileDetailOpen}
                onClick={() => setMobileFiltersOpen((open) => !open)}
                type="button"
                variant="outline"
              >
                Filter
              </Button>
            </div>
            {loading && !result ? (
              <p className="text-body text-muted-foreground" role="status">
                Memuat laporan…
              </p>
            ) : pageRows.length ? (
              <div className="owner-attendance-mobile-cards">
                {pageRows.map((row) => {
                  const session = row.sessions[0]
                  const timezone = session?.timezone ?? row.schedule.timezone
                  const selectedRow =
                    selected?.employee.id === row.employee.id &&
                    selected.work_date === row.work_date
                  return (
                    <article
                      className="owner-attendance-mobile-card"
                      key={`${row.employee.id}-${row.work_date}`}
                    >
                      <div className="owner-attendance-mobile-card-heading">
                        <div>
                          <h3 className="text-subtitle">{row.employee.name}</h3>
                          <p className="text-body text-muted-foreground">
                            {row.outlets
                              .map((outlet) => `${outlet.business_unit_name} · ${outlet.name}`)
                              .join(", ") || "Tanpa Outlet"}
                            {` · ${formatReportDate(row.work_date)}`}
                          </p>
                        </div>
                        <StatusBadge
                          tone={
                            row.review.status === "pending"
                              ? "warning"
                              : statusTone(row.outcome)
                          }
                        >
                          {row.review.status === "pending"
                            ? "Perlu tinjauan"
                            : statusLabel(row.outcome)}
                        </StatusBadge>
                        {hasEffectiveCorrection(row) ? (
                          <StatusBadge tone="info">
                            Koreksi efektif
                          </StatusBadge>
                        ) : null}
                      </div>
                      <div className="owner-attendance-mobile-card-times">
                        <p className="text-body">
                          Asli: {timeRange(
                            session?.original.check_in_at ?? null,
                            session?.original.check_out_at ?? null,
                            timezone
                          )}
                        </p>
                        <p className="text-body">
                          Efektif: {timeRange(
                            session?.effective.check_in_at ?? null,
                            session?.effective.check_out_at ?? null,
                            timezone
                          )}
                        </p>
                        <p className="text-caption text-muted-foreground">
                          Durasi asli {duration(row.actual_duration_seconds)} · efektif {duration(row.effective_duration_seconds)}
                          {timezone ? ` · ${timezone}` : ""}
                          {row.is_finalized ? " · Hasil ditetapkan" : ""}
                        </p>
                      </div>
                      <Button
                        aria-label={`Lihat rincian ${row.employee.name}, ${row.work_date}`}
                        aria-controls="owner-attendance-report-detail"
                        aria-expanded={mobileDetailOpen && selectedRow}
                        className="owner-attendance-mobile-detail-action"
                        onClick={(event) =>
                          selectReportRow(row, event.currentTarget)
                        }
                        type="button"
                        variant="outline"
                      >
                        Rincian
                      </Button>
                    </article>
                  )
                })}
              </div>
            ) : (
              <p className="owner-attendance-mobile-empty text-body text-muted-foreground">
                Tidak ada hari kerja karyawan yang cocok dengan filter ini.
              </p>
            )}
            {result ? (
              <div className="owner-attendance-mobile-pagination">
                <p className="text-caption text-muted-foreground">
                  {pageRows.length} baris di halaman ini · {count(result.pagination.total)} hasil
                </p>
                <div className="flex gap-2">
                  <Button
                    aria-label="Halaman sebelumnya"
                    disabled={page <= 1 || loading}
                    onClick={() => void load(page - 1)}
                    size="sm"
                    variant="outline"
                  >
                    Sebelumnya
                  </Button>
                  <Button
                    aria-label="Halaman berikutnya"
                    disabled={!result.pagination.has_more || loading}
                    onClick={() => void load(page + 1)}
                    size="sm"
                    variant="outline"
                  >
                    Berikutnya
                  </Button>
                </div>
              </div>
            ) : null}
            {result ? (
              <p className="owner-attendance-report-aggregate text-caption text-muted-foreground">
                {count(result.totals.unique_employees)} karyawan unik · {count(result.totals.attendance_sessions)} sesi · durasi asli {duration(result.totals.known_actual_duration_seconds)} · durasi efektif {duration(result.totals.known_effective_duration_seconds)}
              </p>
            ) : null}
          </section>

          <Card className="owner-attendance-report-desktop-results">
            <CardHeader className="owner-attendance-results-heading">
              <div>
                <CardTitle>Baris laporan</CardTitle>
                <CardDescription>
                  {result
                    ? `${count(result.pagination.total)} hasil · ${resultOutletCount} Outlet`
                    : "Data akan tampil setelah laporan dimuat."}
                </CardDescription>
              </div>
              {result ? (
                <Button
                  disabled={exporting || loading}
                  onClick={() => void exportCsv()}
                  type="button"
                >
                  {exporting ? "Menyiapkan…" : "Ekspor CSV"}
                </Button>
              ) : null}
            </CardHeader>
            <CardContent>
              {loading && !result ? (
                <p role="status" className="text-body text-muted-foreground">
                  Memuat laporan…
                </p>
              ) : result?.data.length ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Karyawan</TableHead>
                      <TableHead>Tanggal kerja Outlet</TableHead>
                      <TableHead>Durasi asli</TableHead>
                      <TableHead>Durasi efektif</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {result.data.map((row) => (
                      <TableRow
                        key={`${row.employee.id}-${row.work_date}`}
                        data-state={
                          selected?.employee.id === row.employee.id &&
                          selected.work_date === row.work_date
                            ? "selected"
                            : undefined
                        }
                      >
                        <TableCell>
                          <Button
                            aria-label={`Lihat rincian ${row.employee.name}, ${row.work_date}`}
                            aria-pressed={
                              selected?.employee.id === row.employee.id &&
                              selected.work_date === row.work_date
                            }
                            variant="ghost"
                            className="owner-report-row-select"
                            onClick={() => selectReportRow(row)}
                          >
                            <span className="font-medium">
                              {row.employee.name}
                            </span>
                            <span className="text-caption text-muted-foreground">
                              ID {row.employee.id}
                            </span>
                          </Button>
                        </TableCell>
                        <TableCell>
                          <div className="font-medium">
                            {new Date(`${row.work_date}T12:00:00`).toLocaleDateString(
                              "id-ID",
                              { dateStyle: "medium" }
                            )}
                          </div>
                          {row.outlets
                            .map((outlet) => outlet.name)
                            .join(", ") || "—"}
                          <div className="text-caption text-muted-foreground">
                            {row.sessions[0]?.timezone ?? row.schedule.timezone ?? "Zona waktu Outlet"}
                          </div>
                        </TableCell>
                        <TableCell>
                          {duration(row.actual_duration_seconds)}
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-wrap items-center gap-2">
                            <span>{duration(row.effective_duration_seconds)}</span>
                            <StatusBadge
                              tone={
                                row.review.status === "pending"
                                  ? "warning"
                                  : statusTone(row.outcome)
                              }
                            >
                              {row.review.status === "pending"
                                ? "Perlu tinjauan"
                                : statusLabel(row.outcome)}
                            </StatusBadge>
                            {hasEffectiveCorrection(row) ? (
                              <StatusBadge tone="info">
                                Koreksi efektif
                              </StatusBadge>
                            ) : null}
                          </div>
                          {row.is_finalized ? (
                            <span className="text-caption text-muted-foreground">
                              Hasil ditetapkan
                            </span>
                          ) : null}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <p className="py-5 text-body text-muted-foreground">
                  Tidak ada hari kerja karyawan yang cocok dengan filter ini.
                </p>
              )}
              <div className="owner-attendance-report-pagination mt-4 flex items-center justify-between border-t pt-4">
                <p className="text-caption text-muted-foreground">
                  {result
                    ? `Menampilkan ${((result.pagination.current_page - 1) * result.pagination.per_page) + 1}–${Math.min(result.pagination.current_page * result.pagination.per_page, result.pagination.total)} dari ${count(result.pagination.total)} hasil`
                    : ""}
                </p>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    disabled={!result || page <= 1 || loading}
                    onClick={() => void load(page - 1)}
                  >
                    Sebelumnya
                  </Button>
                  <Button
                    variant="outline"
                    disabled={!result?.pagination.has_more || loading}
                    onClick={() => void load(page + 1)}
                  >
                    Berikutnya
                  </Button>
                </div>
              </div>
              <p className="owner-attendance-report-aggregate text-caption text-muted-foreground">
                {result
                  ? `${count(result.totals.unique_employees)} karyawan unik · ${count(result.totals.attendance_sessions)} sesi · durasi asli ${duration(result.totals.known_actual_duration_seconds)} · durasi efektif ${duration(result.totals.known_effective_duration_seconds)}`
                  : "Ringkasan totals tampil setelah laporan dimuat."}
              </p>
            </CardContent>
          </Card>

          {selected ? (
            <Card
              className={`owner-attendance-report-detail ${mobileDetailOpen ? "is-open" : ""}`}
              id="owner-attendance-report-detail"
            >
              <CardHeader>
                <div className="flex items-start justify-between gap-3">
                  <CardTitle>
                    Rincian: {selected.employee.name} ·{" "}
                    {new Date(
                      `${selected.work_date}T12:00:00`
                    ).toLocaleDateString("id-ID", { dateStyle: "long" })}
                  </CardTitle>
                  <Button
                    aria-label="Kembali ke laporan"
                    className="owner-mobile-detail-close"
                    onClick={closeMobileDetail}
                    ref={mobileDetailBack}
                    type="button"
                    variant="ghost"
                  >
                    Kembali ke laporan
                  </Button>
                </div>
                <CardDescription>
                  {selected.outlets
                    .map(
                      (outlet) =>
                        `${outlet.business_unit_name} / ${outlet.name}`
                    )
                    .join(" · ") || "Tanpa Outlet teratribusi"}
                </CardDescription>
              </CardHeader>
              <CardContent className="owner-attendance-report-detail-grid">
                <section className="owner-attendance-detail-section">
                  <h2 className="text-label">Jadwal dan waktu</h2>
                  {selected.sessions.map((session) => (
                    <div className="owner-attendance-detail-session-values" key={session.id}>
                      <p className="text-caption text-muted-foreground">
                        Catatan asli: {instant(session.original.check_in_at, session.timezone)}{" – "}
                        {instant(session.original.check_out_at, session.timezone)}
                      </p>
                      <p className="text-caption text-muted-foreground">
                        Efektif saat ini: {instant(session.effective.check_in_at, session.timezone)}{" – "}
                        {instant(session.effective.check_out_at, session.timezone)}
                      </p>
                    </div>
                  ))}
                  {selected.reconstructions?.map(({ source_id, effective }) => (
                    <div key={source_id}>
                      <p className="text-label">Rekonstruksi presensi #{source_id}</p>
                      <p className="text-caption text-muted-foreground">
                        {selected.outlets.find((outlet) => outlet.id === effective.outlet_id)?.name} ·{" "}
                        {instant(effective.check_in_at, effective.timezone)} –{" "}
                        {instant(effective.check_out_at, effective.timezone)}
                      </p>
                    </div>
                  ))}
                  <p className="text-body">
                    {selected.schedule.status === "scheduled"
                      ? `${selected.schedule.shift?.name ?? "Shift"}: ${instant(selected.schedule.scheduled_start, selected.schedule.timezone)} – ${instant(selected.schedule.scheduled_end, selected.schedule.timezone)}`
                      : statusLabel(selected.schedule.status)}
                  </p>
                  <p className="text-body">
                    Durasi asli: {duration(selected.actual_duration_seconds)} ·
                    efektif: {duration(selected.effective_duration_seconds)}
                  </p>
                  <p className="text-caption text-muted-foreground">
                    Waktu ditampilkan memakai zona waktu Outlet terkait.
                  </p>
                </section>
                <section className="owner-attendance-detail-section">
                  <h2 className="text-label">Tinjauan dan penetapan hasil</h2>
                  <p className="text-body">
                    Status tinjauan:{" "}
                    {selected.review.status === "pending"
                      ? "Menunggu"
                      : selected.review.status === "resolved"
                        ? "Selesai"
                        : "Tidak ada"}
                  </p>
                  <p className="text-body">
                    Indikator:{" "}
                    {selected.review.indicators.join(", ") || "Tidak ada"}
                  </p>
                  <p className="text-body">
                    Penetapan hasil:{" "}
                    {selected.finalization
                      ? `${statusLabel(selected.finalization.outcome)} · revisi ${selected.finalization.revision} · oleh pengguna ${selected.finalization.actor_user_id}`
                      : "Belum ditetapkan"}
                  </p>
                </section>
                <section className="owner-attendance-detail-section">
                  <h2 className="text-label">Sesi, koreksi, dan sumber</h2>
                  {selected.sessions.length ? (
                    selected.sessions.map((session) => (
                      <div key={session.id} className="rounded-2xl border p-4">
                        <p className="text-body font-medium">
                          Sesi #{session.id} ·{" "}
                          {session.recording_status === "active"
                            ? "Masih aktif"
                            : session.recording_status === "closed"
                              ? "Selesai"
                              : "Diselesaikan secara administratif"}
                        </p>
                        <p className="text-caption text-muted-foreground">
                          Asli:{" "}
                          {instant(
                            session.original.check_in_at,
                            session.timezone
                          )}{" "}
                          –{" "}
                          {instant(
                            session.original.check_out_at,
                            session.timezone
                          )}
                        </p>
                        <p className="text-caption text-muted-foreground">
                          Efektif:{" "}
                          {instant(
                            session.effective.check_in_at,
                            session.timezone
                          )}{" "}
                          –{" "}
                          {instant(
                            session.effective.check_out_at,
                            session.timezone
                          )}
                        </p>
                        <p className="text-caption text-muted-foreground">
                          Peristiwa sumber:{" "}
                          {session.original.event_ids.join(", ") || "Tidak ada"}{" "}
                          · indikator:{" "}
                          {session.review_indicators.join(", ") || "Tidak ada"}
                        </p>
                        {session.correction ? (
                          <p className="mt-2 text-caption">
                            Koreksi disetujui #{session.correction.request_id} ·
                            keputusan #{session.correction.decision_id} oleh
                            Pengguna {session.correction.actor_user_id} pada{" "}
                            {instant(session.correction.decided_at, "UTC")}.
                            Alasan: {session.correction.reason}
                          </p>
                        ) : (
                          <p className="mt-2 text-caption text-muted-foreground">
                            Tidak ada koreksi yang diterapkan.
                          </p>
                        )}
                      </div>
                    ))
                  ) : (
                    <p className="text-body text-muted-foreground">
                      Belum ada sesi presensi.
                    </p>
                  )}
                  {selected.leave_requests.length ? (
                    <p className="text-caption">
                      Permintaan cuti/izin:{" "}
                      {selected.leave_requests
                        .map(
                          (item) =>
                            `${item.category ?? "izin"} (${item.status})`
                        )
                        .join(", ")}
                    </p>
                  ) : null}
                  {selected.overtime_requests.length ? (
                    <p className="text-caption">
                      Lembur:{" "}
                      {selected.overtime_requests
                        .map(
                          (item) =>
                            `${item.status}${item.approved_minutes === null ? "" : ` · disetujui ${item.approved_minutes} menit`}`
                        )
                        .join(", ")}
                      . Lembur tidak menambah durasi kerja tercatat.
                    </p>
                  ) : null}
                  <p className="text-caption text-muted-foreground">
                    Referensi peristiwa:{" "}
                    {selected.source_attendance_event_ids.join(", ") || "—"} ·
                    keputusan koreksi:{" "}
                    {selected.correction_decision_ids.join(", ") || "—"}
                  </p>
                </section>
              </CardContent>
            </Card>
          ) : null}
          <div className="owner-attendance-report-footer">
            <ScopeBanner title="Batas laporan dan ekspor">
              {`Rentang maksimal ${options?.maximum_days ?? 31} hari · detail maksimal 5.000 hari kerja karyawan · CSV maksimal 500 baris. Ekspor di atas batas ditolak tanpa pemotongan.`}
            </ScopeBanner>
            <div className="owner-attendance-mobile-export-row">
              {result ? (
                <Button
                  className="owner-mobile-report-export"
                  disabled={exporting || loading}
                  onClick={() => void exportCsv()}
                  type="button"
                >
                  {exporting ? "Menyiapkan…" : "Ekspor CSV"}
                </Button>
              ) : null}
            </div>
            <p className="owner-attendance-export-note text-caption text-muted-foreground">
              Ekspor tercatat di audit. Waktu audit memakai UTC; tanggal kerja mengikuti zona waktu lokal Outlet.
            </p>
          </div>
          {result ? (
            <p className="text-caption text-muted-foreground">
              {new Date(result.provenance.generated_at).toLocaleString(
                "id-ID",
                { timeZone: "Asia/Jakarta" }
              )}{" "}
              WIB. {result.provenance.reporting_semantics}
            </p>
          ) : null}
        </div>
      </main>
    </SidebarProvider>
  )
}
