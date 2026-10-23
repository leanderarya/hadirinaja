import { createFileRoute } from "@tanstack/react-router"
import { useCallback, useEffect, useRef, useState } from "react"

import { ManagementSidebar } from "@/components/management-sidebar"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
} from "@/components/ui/breadcrumb"
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
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar"
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
import { REPORT_DATE_PRESETS, reportDateRange } from "@/lib/report-date-presets"

export const Route = createFileRoute("/reports/attendance")({
  component: AttendanceReportPage,
})

type Options = {
  business_units: Array<{ id: number; name: string }>
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
function statusLabel(value: string) {
  const labels: Record<string, string> = {
    present: "Hadir",
    leave: "Cuti",
    sick: "Sakit",
    permission: "Izin",
    potential_absence: "Potensi absen",
    confirmed_absence_pending_finalization: "Absen menunggu finalisasi",
    exceptional_attendance: "Kehadiran khusus",
    no_recorded_outcome: "Belum ada hasil",
  }
  return labels[value] ?? value.replaceAll("_", " ")
}

async function ensureManagementAccess() {
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
  const [options, setOptions] = useState<Options | null>(null)
  const [result, setResult] = useState<ReportResult | null>(null)
  const [selected, setSelected] = useState<ReportRow | null>(null)
  const [from, setFrom] = useState(daysAgo(13))
  const [to, setTo] = useState(today())
  const [businessUnitId, setBusinessUnitId] = useState("")
  const [outletId, setOutletId] = useState("")
  const [employeeId, setEmployeeId] = useState("")
  const [status, setStatus] = useState("")
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [exporting, setExporting] = useState(false)
  const [error, setError] = useState("")
  const initialLoad = useRef(false)

  const visibleOutlets =
    options?.outlets.filter(
      (outlet) =>
        !businessUnitId || String(outlet.business_unit_id) === businessUnitId
    ) ?? []

  const load = useCallback(
    async (targetPage = 1, includeOptions = false) => {
      setLoading(true)
      setError("")
      try {
        if (!(await ensureManagementAccess())) return
        if (includeOptions || !options)
          setOptions(await apiRequest<Options>("/management/reports/filters"))
        const next = await apiRequest<ReportResult>(
          `/management/reports/attendance?${reportQuery({
            from,
            to,
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
      void load(1, true)
    }
    const expireSession = () => window.location.assign("/login?expired=1")
    window.addEventListener("hadirinaja:session-expired", expireSession)
    return () =>
      window.removeEventListener("hadirinaja:session-expired", expireSession)
    // Load once; filter changes are applied only after submit.
  }, [load])

  async function exportCsv() {
    setExporting(true)
    setError("")
    try {
      if (!(await ensureManagementAccess())) return
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

  return (
    <SidebarProvider>
      <ManagementSidebar activePage="reports" />
      <main className="min-w-0 flex-1 bg-muted/20">
        <header className="flex items-center gap-3 border-b bg-background px-4 py-3 md:px-8">
          <SidebarTrigger />
          <Breadcrumb>
            <BreadcrumbList>
              <BreadcrumbItem>
                <BreadcrumbPage>Laporan detail</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
        </header>
        <div className="mx-auto flex max-w-7xl flex-col gap-6 p-4 md:gap-8 md:p-8">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="text-title">Laporan kehadiran</h1>
              <p className="text-body text-muted-foreground">
                Bandingkan jadwal, catatan asli, dan nilai efektif S5.
              </p>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" render={<a href="/reports" />}>
                Ringkasan
              </Button>
              <Button variant="outline" render={<a href="/reports/audit" />}>
                Audit aktivitas
              </Button>
            </div>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Filter laporan</CardTitle>
              <CardDescription>
                Work date mengikuti label tanggal lokal Outlet. Maksimal 31
                hari dan 5.000 employee-workdays per laporan. CSV memuat
                maksimal 500 baris setelah filter; ekspor yang melewati batas
                ditolak, tidak dipotong diam-diam.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div
                className="mb-4 flex flex-wrap items-center gap-2"
                role="group"
                aria-label="Preset periode laporan"
              >
                {REPORT_DATE_PRESETS.map((preset) => (
                  <Button
                    key={preset.value}
                    type="button"
                    variant="outline"
                    onClick={() => {
                      const range = reportDateRange(preset.value)
                      setFrom(range.from)
                      setTo(range.to)
                    }}
                  >
                    {preset.label}
                  </Button>
                ))}
              </div>
              <form
                className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"
                onSubmit={(event) => {
                  event.preventDefault()
                  void load(1)
                }}
              >
                <Field>
                  <FieldLabel htmlFor="attendance-from">
                    Dari tanggal
                  </FieldLabel>
                  <Input
                    id="attendance-from"
                    type="date"
                    value={from}
                    onChange={(event) => setFrom(event.target.value)}
                    required
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="attendance-to">
                    Sampai tanggal
                  </FieldLabel>
                  <Input
                    id="attendance-to"
                    type="date"
                    value={to}
                    onChange={(event) => setTo(event.target.value)}
                    required
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="attendance-unit">Unit bisnis</FieldLabel>
                  <NativeSelect
                    id="attendance-unit"
                    value={businessUnitId}
                    onChange={(event) => updateBusinessUnit(event.target.value)}
                  >
                    <NativeSelectOption value="">
                      Semua unit dalam cakupan
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
                      Semua Outlet dalam cakupan
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
                <div className="flex items-end">
                  <Button
                    type="button"
                    variant="outline"
                    disabled={exporting || loading}
                    onClick={() => void exportCsv()}
                    className="w-full"
                  >
                    {exporting ? "Menyiapkan…" : "Unduh CSV"}
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
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {[
              ["Hari kerja", result?.totals.employee_workdays ?? 0],
              ["Karyawan unik", result?.totals.unique_employees ?? 0],
              ["Sesi attendance", result?.totals.attendance_sessions ?? 0],
              [
                "Durasi efektif diketahui",
                duration(
                  result?.totals.known_effective_duration_seconds ?? null
                ),
              ],
            ].map(([label, value]) => (
              <Card key={label}>
                <CardHeader className="pb-2">
                  <CardDescription>{label}</CardDescription>
                  <CardTitle className="text-title">
                    {typeof value === "number" ? count(value) : value}
                  </CardTitle>
                </CardHeader>
              </Card>
            ))}
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Baris laporan</CardTitle>
              <CardDescription>
                {result
                  ? `${count(result.pagination.total)} hari kerja karyawan · halaman ${result.pagination.current_page} dari ${result.pagination.last_page}`
                  : "Data akan tampil setelah laporan dimuat."}
              </CardDescription>
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
                      <TableHead>Tanggal</TableHead>
                      <TableHead>Karyawan</TableHead>
                      <TableHead>Outlet</TableHead>
                      <TableHead>Jadwal</TableHead>
                      <TableHead>Kehadiran efektif</TableHead>
                      <TableHead>Hasil</TableHead>
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
                            variant="ghost"
                            className="h-auto p-1"
                            onClick={() => setSelected(row)}
                          >
                            {new Date(
                              `${row.work_date}T12:00:00`
                            ).toLocaleDateString("id-ID", {
                              dateStyle: "medium",
                            })}
                          </Button>
                        </TableCell>
                        <TableCell>
                          <div className="font-medium">{row.employee.name}</div>
                          <div className="text-caption text-muted-foreground">
                            ID {row.employee.id}
                          </div>
                        </TableCell>
                        <TableCell>
                          {row.outlets
                            .map((outlet) => outlet.name)
                            .join(", ") || "—"}
                        </TableCell>
                        <TableCell>
                          {row.schedule.status === "scheduled"
                            ? `${row.schedule.shift?.name ?? "Terjadwal"} · ${instant(row.schedule.scheduled_start, row.schedule.timezone)}`
                            : row.schedule.status === "rest"
                              ? "Hari istirahat"
                              : "Tidak terjadwal"}
                        </TableCell>
                        <TableCell>
                          {row.sessions.length
                            ? row.sessions.map((session) => (
                                <div key={session.id}>
                                  {instant(
                                    session.effective.check_in_at,
                                    session.timezone
                                  )}{" "}
                                  –{" "}
                                  {instant(
                                    session.effective.check_out_at,
                                    session.timezone
                                  )}
                                </div>
                              ))
                            : "Belum ada sesi"}
                          <div className="text-caption text-muted-foreground">
                            {duration(row.effective_duration_seconds)}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-col items-start gap-1">
                            <Badge
                              variant={
                                row.review.status === "pending"
                                  ? "outline"
                                  : "secondary"
                              }
                            >
                              {statusLabel(row.outcome)}
                            </Badge>
                            {row.review.status === "pending" ? (
                              <span className="text-caption text-muted-foreground">
                                Review menunggu
                              </span>
                            ) : row.is_finalized ? (
                              <span className="text-caption text-muted-foreground">
                                Difinalisasi
                              </span>
                            ) : null}
                          </div>
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
              <div className="mt-4 flex items-center justify-between border-t pt-4">
                <p className="text-caption text-muted-foreground">
                  Durasi asli diketahui:{" "}
                  {duration(
                    result?.totals.known_actual_duration_seconds ?? null
                  )}{" "}
                  · durasi efektif:{" "}
                  {duration(
                    result?.totals.known_effective_duration_seconds ?? null
                  )}
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
            </CardContent>
          </Card>

          {selected ? (
            <Card>
              <CardHeader>
                <CardTitle>
                  Rincian: {selected.employee.name} ·{" "}
                  {new Date(
                    `${selected.work_date}T12:00:00`
                  ).toLocaleDateString("id-ID", { dateStyle: "long" })}
                </CardTitle>
                <CardDescription>
                  {selected.outlets
                    .map(
                      (outlet) =>
                        `${outlet.business_unit_name} / ${outlet.name}`
                    )
                    .join(" · ") || "Tanpa Outlet teratribusi"}
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-6 md:grid-cols-2">
                <section className="space-y-2">
                  <h2 className="text-label">Jadwal dan waktu</h2>
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
                <section className="space-y-2">
                  <h2 className="text-label">Review dan finalisasi</h2>
                  <p className="text-body">
                    Status review:{" "}
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
                    Finalisasi:{" "}
                    {selected.finalization
                      ? `${statusLabel(selected.finalization.outcome)} · revisi ${selected.finalization.revision} · oleh User ${selected.finalization.actor_user_id}`
                      : "Belum difinalisasi"}
                  </p>
                </section>
                <section className="space-y-2 md:col-span-2">
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
                          Event sumber:{" "}
                          {session.original.event_ids.join(", ") || "Tidak ada"}{" "}
                          · indikator:{" "}
                          {session.review_indicators.join(", ") || "Tidak ada"}
                        </p>
                        {session.correction ? (
                          <p className="mt-2 text-caption">
                            Koreksi disetujui #{session.correction.request_id} ·
                            keputusan #{session.correction.decision_id} oleh
                            User {session.correction.actor_user_id} pada{" "}
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
                      Belum ada sesi attendance.
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
                    Referensi event:{" "}
                    {selected.source_attendance_event_ids.join(", ") || "—"} ·
                    keputusan koreksi:{" "}
                    {selected.correction_decision_ids.join(", ") || "—"}
                  </p>
                </section>
              </CardContent>
            </Card>
          ) : null}
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
