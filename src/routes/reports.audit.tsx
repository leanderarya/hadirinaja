import { createFileRoute } from "@tanstack/react-router"
import { useCallback, useEffect, useRef, useState } from "react"

import { ManagementSidebar, ManagementTopbar } from "@/components/management-sidebar"
import {
  PageHeading,
  ReportSectionNavigation,
  ScopeBanner,
} from "@/components/r2c/screen-blocks"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
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
import { ApiError, type AuthSession, apiRequest } from "@/lib/api"
import { formatAuditTime } from "@/lib/audit-time"
import {
  REPORT_DATE_PRESETS,
  reportDateDaysAgo,
  reportDateRange,
  reportDateValue,
} from "@/lib/report-date-presets"

export const Route = createFileRoute("/reports/audit")({
  component: AuditTrailPage,
})

type Options = {
  business_units: Array<{ id: number; name: string }>
  outlets: Array<{ id: number; name: string; business_unit_id: number }>
}
type AuditEntry = {
  source_type: string
  source_id: number
  tenant_id: number
  occurred_at: string
  actor_user_id: number | null
  actor_name: string | null
  employee_id: number | null
  employee_name: string | null
  outlet_id: number | null
  outlet_name: string | null
  action: string
  summary: string
  reason: string | null
  resource_type: string | null
  resource_id: number | null
}
type AuditPage = {
  data: AuditEntry[]
  pagination: {
    current_page: number
    per_page: number
    total: number
    last_page: number
    has_more: boolean
  }
  provenance: { timestamp_semantics: string; historical_coverage: string }
}
type AuditDetail = AuditEntry & { details: Record<string, unknown> }

function today() {
  return reportDateValue(new Date(), "utc")
}
function daysAgo(days: number) {
  return reportDateDaysAgo(days, new Date(), "utc")
}
function formatAuditRange(from: string, to: string) {
  const format = (value: string) =>
    new Date(`${value}T12:00:00Z`).toLocaleDateString("id-ID", {
      day: "numeric",
      month: "short",
      timeZone: "UTC",
      year: "numeric",
    })
  return from === to ? format(from) : `${format(from)}–${format(to)}`
}
function sourceLabel(value: string) {
  const labels: Record<string, string> = {
    attendance_event: "Peristiwa presensi",
    approval_request: "Permintaan",
    approval_decision: "Keputusan persetujuan",
    attendance_finalization: "Penetapan hasil kehadiran",
    schedule_change: "Perubahan jadwal atau konfigurasi",
    employee_assignment: "Penempatan karyawan",
    management_change: "Perubahan pengelolaan",
    report_export: "Ekspor laporan",
  }
  return labels[value] ?? value.replaceAll("_", " ")
}

function resourceLabel(value: string | null) {
  if (!value) return "Catatan"
  const labels: Record<string, string> = {
    attendance_session: "Sesi presensi",
    attendance_finalization: "Penetapan hasil kehadiran",
    approval_attendance_correction: "Permintaan koreksi presensi",
    approval_leave: "Permintaan cuti atau izin",
    approval_overtime: "Permintaan lembur",
    weekly_schedule_rule: "Aturan jadwal mingguan",
    schedule_exception: "Pengecualian jadwal",
    outlet_policy: "Kebijakan presensi Outlet",
    outlet_calendar: "Kalender Outlet",
    calendar_exception: "Pengecualian kalender Outlet",
    employee_outlet_assignment: "Penempatan karyawan di Outlet",
  }
  return labels[value] ?? value.replaceAll("_", " ")
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

function auditQuery(filters: {
  from: string
  to: string
  page: number
  source: string
  businessUnitId: string
  outletId: string
  employeeId: string
}) {
  const params = new URLSearchParams({
    from: filters.from,
    to: filters.to,
    page: String(filters.page),
    per_page: "25",
  })
  if (filters.source) params.set("source", filters.source)
  if (filters.businessUnitId)
    params.set("business_unit_id", filters.businessUnitId)
  if (filters.outletId) params.append("outlet_ids[]", filters.outletId)
  if (filters.employeeId) params.set("employee_id", filters.employeeId)
  return params.toString()
}

function AuditTrailPage() {
  const [navigationSession, setNavigationSession] = useState<AuthSession | null>(null)
  const [options, setOptions] = useState<Options | null>(null)
  const [result, setResult] = useState<AuditPage | null>(null)
  const [selected, setSelected] = useState<AuditDetail | null>(null)
  const [from, setFrom] = useState(daysAgo(30))
  const [to, setTo] = useState(today())
  const [source, setSource] = useState("")
  const [businessUnitId, setBusinessUnitId] = useState("")
  const [outletId, setOutletId] = useState("")
  const [employeeId, setEmployeeId] = useState("")
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false)
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [detailLoading, setDetailLoading] = useState(false)
  const [error, setError] = useState("")
  const initialLoad = useRef(false)
  const mobileDetailTrigger = useRef<HTMLButtonElement | null>(null)
  const mobileDetailBack = useRef<HTMLButtonElement | null>(null)

  const visibleOutlets =
    options?.outlets.filter(
      (outlet) =>
        !businessUnitId || String(outlet.business_unit_id) === businessUnitId
    ) ?? []
  const resultSourceCount = new Set(
    (result?.data ?? []).map((entry) => entry.source_type)
  ).size
  const resultOutletCount = new Set(
    (result?.data ?? [])
      .map((entry) => entry.outlet_id)
      .filter((outletId): outletId is number => outletId !== null)
  ).size

  const load = useCallback(
    async (targetPage = 1, loadOptions = false) => {
      setLoading(true)
      setError("")
      try {
        if (!(await ensureManagementAccess(setNavigationSession))) return
        if (loadOptions || !options)
          setOptions(await apiRequest<Options>("/management/reports/filters"))
        const next = await apiRequest<AuditPage>(
          `/management/reports/audit?${auditQuery({
            from,
            to,
            page: targetPage,
            source,
            businessUnitId,
            outletId,
            employeeId,
          })}`
        )
        setResult(next)
        setSelected(null)
        setMobileDetailOpen(false)
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
            : "Riwayat audit belum dapat dimuat."
        )
        setResult(null)
        setMobileDetailOpen(false)
      } finally {
        setLoading(false)
      }
    },
    [businessUnitId, employeeId, from, options, outletId, source, to]
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

  async function showDetail(
    entry: AuditEntry,
    trigger?: HTMLButtonElement
  ) {
    setDetailLoading(true)
    setError("")
    mobileDetailTrigger.current = trigger ?? null
    try {
      const detail = await apiRequest<{ entry: AuditDetail }>(
        `/management/reports/audit/${entry.source_type}/${entry.source_id}?${auditQuery(
          {
            from,
            to,
            page,
            source,
            businessUnitId,
            outletId,
            employeeId,
          }
        )}`
      )
      setSelected(detail.entry)
      if (window.matchMedia("(max-width: 1279px)").matches) {
        setMobileDetailOpen(true)
        requestAnimationFrame(() => mobileDetailBack.current?.focus())
      }
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught.message
          : "Rincian audit belum dapat dimuat."
      )
    } finally {
      setDetailLoading(false)
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

  function closeMobileDetail() {
    setSelected(null)
    setMobileDetailOpen(false)
    requestAnimationFrame(() => mobileDetailTrigger.current?.focus())
  }

  const navigationContext = navigationSession?.active_membership ? { tenantName: navigationSession.active_membership.tenant.name, roles: navigationSession.active_membership.roles, userName: navigationSession.user.name, kioskEnabled: navigationSession.features.kiosk_enabled } : null
  const membershipRoles = navigationSession?.active_membership?.roles ?? []
  const isSupervisor =
    membershipRoles.includes("supervisor") && !membershipRoles.includes("owner")
  const scopeTitle = isSupervisor
    ? "Supervisor · Outlet yang dapat Anda akses"
    : "Owner · seluruh Outlet dalam organisasi aktif"

  return (
    <SidebarProvider className="pb-[calc(6rem+env(safe-area-inset-bottom))] md:pb-0">
      <ManagementSidebar activePage="audit" context={navigationContext} />
      <main className="min-w-0 flex-1 bg-canvas">
        <ManagementTopbar context={navigationContext} />
        <div
          className={`owner-audit-layout mx-auto flex max-w-7xl flex-col gap-6 p-4 md:gap-8 md:p-8 ${mobileDetailOpen ? "is-detail-open" : ""}`}
        >
          <div className="owner-audit-heading-row">
            <PageHeading
              className="owner-audit-heading"
              description="Perubahan dan akses yang tercatat, menurut waktu UTC."
              role={isSupervisor ? "Supervisor" : "Owner"}
              mobileTitle="Laporan"
              title="Aktivitas audit"
            />
          </div>
          <ReportSectionNavigation active="audit" />
          {navigationSession?.active_membership ? (
            <div className="owner-audit-date-banner">
              <ScopeBanner
                title={`Waktu audit UTC · ${formatAuditRange(from, to)}`}
              >
                Waktu audit memakai UTC, bukan tanggal kerja Outlet.
                {isSupervisor ? " Data dan pilihan Outlet mengikuti izin akses Anda." : ""}
              </ScopeBanner>
            </div>
          ) : null}
          {navigationSession?.active_membership ? (
            <div
              className={`owner-audit-scope-banner ${isSupervisor ? "is-supervisor" : "is-owner"}`}
            >
              <ScopeBanner title={scopeTitle}>
                {isSupervisor
                  ? "Data dan pilihan Outlet mengikuti izin akses akun Anda."
                  : "Aktivitas berasal dari sumber yang tersedia pada organisasi aktif; waktu kejadian memakai UTC."}
              </ScopeBanner>
            </div>
          ) : null}
          <Card
            className={`owner-audit-filters ${mobileFiltersOpen ? "" : "owner-mobile-filters-collapsed"}`}
            id="audit-report-filters"
          >
            <CardHeader>
              <CardTitle>Filter aktivitas</CardTitle>
              <CardDescription>
                Waktu audit mengikuti UTC. Rentang maksimal 31 hari.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div
                className="mb-4 flex flex-wrap items-center gap-2"
                role="group"
                aria-label="Preset periode audit UTC"
              >
                {REPORT_DATE_PRESETS.map((preset) => (
                  <Button
                    key={preset.value}
                    type="button"
                    variant="outline"
                    onClick={() => {
                      const range = reportDateRange(
                        preset.value,
                        new Date(),
                        "utc"
                      )
                      setFrom(range.from)
                      setTo(range.to)
                    }}
                  >
                    {preset.label}
                  </Button>
                ))}
              </div>
              <form
                className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5"
                onSubmit={(event) => {
                  event.preventDefault()
                  setMobileFiltersOpen(false)
                  void load(1)
                }}
              >
                <div className="owner-audit-date-range-field">
                  <FieldLabel id="audit-range-label">
                    Rentang waktu (UTC)
                  </FieldLabel>
                  <div
                    aria-labelledby="audit-range-label"
                    className="owner-audit-date-range-values"
                    role="group"
                  >
                    <Field>
                      <FieldLabel className="sr-only" htmlFor="audit-from">
                        Dari tanggal (UTC)
                      </FieldLabel>
                      <Input
                        aria-label="Dari tanggal (UTC)"
                        id="audit-from"
                        type="date"
                        value={from}
                        onChange={(event) => setFrom(event.target.value)}
                        required
                      />
                    </Field>
                    <span aria-hidden="true">–</span>
                    <Field>
                      <FieldLabel className="sr-only" htmlFor="audit-to">
                        Sampai tanggal (UTC)
                      </FieldLabel>
                      <Input
                        aria-label="Sampai tanggal (UTC)"
                        id="audit-to"
                        type="date"
                        value={to}
                        onChange={(event) => setTo(event.target.value)}
                        required
                      />
                    </Field>
                  </div>
                </div>
                <Field>
                  <FieldLabel htmlFor="audit-source">
                    Jenis aktivitas
                  </FieldLabel>
                  <NativeSelect
                    id="audit-source"
                    value={source}
                    onChange={(event) => setSource(event.target.value)}
                  >
                    <NativeSelectOption value="">
                      Semua sumber
                    </NativeSelectOption>
                    {[
                      "attendance_event",
                      "approval_request",
                      "approval_decision",
                      "attendance_finalization",
                      "schedule_change",
                      "employee_assignment",
                      "management_change",
                      "report_export",
                    ].map((value) => (
                      <NativeSelectOption key={value} value={value}>
                        {sourceLabel(value)}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                </Field>
                <Field>
                  <FieldLabel htmlFor="audit-unit">Unit bisnis</FieldLabel>
                  <NativeSelect
                    id="audit-unit"
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
                  <FieldLabel htmlFor="audit-outlet">Outlet</FieldLabel>
                  <NativeSelect
                    id="audit-outlet"
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
                  <FieldLabel htmlFor="audit-employee">ID karyawan</FieldLabel>
                  <Input
                    id="audit-employee"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    value={employeeId}
                    onChange={(event) => setEmployeeId(event.target.value)}
                    placeholder="Semua karyawan"
                  />
                </Field>
                <div className="owner-audit-apply-filter flex items-end">
                  <Button type="submit" disabled={loading} className="w-full">
                    {loading ? "Memuat…" : "Terapkan filter"}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
          {error ? (
            <Alert className="owner-audit-error" variant="destructive">
              <AlertTitle>Audit belum tersedia</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          <div className="owner-audit-results-heading">
            <div>
              <h2 className="sr-only">Riwayat sumber</h2>
              <p className="owner-audit-results-summary-full text-caption text-muted-foreground">
                {result
                  ? `${new Intl.NumberFormat("id-ID").format(result.pagination.total)} aktivitas · ${resultSourceCount} sumber di halaman ini · halaman ${result.pagination.current_page} dari ${result.pagination.last_page}`
                  : "Aktivitas akan tampil setelah filter diterapkan."}
              </p>
              <p className="owner-audit-results-summary-compact text-caption text-muted-foreground">
                {result
                  ? `${new Intl.NumberFormat("id-ID").format(result.pagination.total)} aktivitas · ${resultOutletCount} Outlet`
                  : "Aktivitas akan tampil setelah filter diterapkan."}
              </p>
            </div>
            <div className="owner-audit-results-actions">
              <p className="text-caption text-muted-foreground">
                Diurutkan dari terbaru · waktu UTC
              </p>
              <Button
                aria-controls="audit-report-filters"
                aria-expanded={mobileFiltersOpen && !mobileDetailOpen}
                className="owner-audit-mobile-filter-toggle"
                disabled={mobileDetailOpen}
                onClick={() => setMobileFiltersOpen((open) => !open)}
                type="button"
                variant="outline"
              >
                Filter
              </Button>
            </div>
          </div>
          <Card className="owner-audit-desktop-results">
            <CardContent>
              {loading && !result ? (
                <p role="status" className="text-body text-muted-foreground">
                  Memuat aktivitas…
                </p>
              ) : result?.data.length ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Waktu (UTC)</TableHead>
                      <TableHead>Sumber</TableHead>
                      <TableHead>Aktivitas</TableHead>
                      <TableHead>Aktor</TableHead>
                      <TableHead>Karyawan / Outlet</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {result.data.map((entry) => (
                      <TableRow
                        data-state={
                          selected?.source_type === entry.source_type &&
                          selected.source_id === entry.source_id
                            ? "selected"
                            : undefined
                        }
                        key={`${entry.source_type}-${entry.source_id}`}
                      >
                        <TableCell>
                          {formatAuditTime(entry.occurred_at)}
                        </TableCell>
                        <TableCell>
                          <Badge variant="secondary">
                            {sourceLabel(entry.source_type)}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Button
                            aria-label={`Lihat rincian ${entry.summary}`}
                            aria-pressed={
                              selected?.source_type === entry.source_type &&
                              selected.source_id === entry.source_id
                            }
                            className="owner-audit-row-select"
                            disabled={detailLoading}
                            onClick={(event) =>
                              void showDetail(entry, event.currentTarget)
                            }
                            type="button"
                            variant="ghost"
                          >
                            <span className="font-medium">{entry.summary}</span>
                            <span className="text-caption text-muted-foreground">
                              {entry.reason ?? entry.action} · Rincian
                            </span>
                          </Button>
                        </TableCell>
                        <TableCell>
                          {entry.actor_name ? (
                            <>
                              {entry.actor_name}
                              <div className="text-caption text-muted-foreground">
                                ID pengguna {entry.actor_user_id}
                              </div>
                            </>
                          ) : (
                            "Tidak tercatat"
                          )}
                        </TableCell>
                        <TableCell>
                          {entry.employee_name ?? "—"}
                          <div className="text-caption text-muted-foreground">
                            {entry.outlet_name ?? "Organisasi"}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <p className="py-5 text-body text-muted-foreground">
                  Tidak ada aktivitas sumber pada periode ini.
                </p>
              )}
              <div className="mt-4 flex items-center justify-between border-t pt-4">
                <span className="text-caption text-muted-foreground">
                  {result
                    ? `Menampilkan ${((result.pagination.current_page - 1) * result.pagination.per_page) + 1}–${Math.min(result.pagination.current_page * result.pagination.per_page, result.pagination.total)} dari ${result.pagination.total} aktivitas. ${result.provenance.historical_coverage}`
                    : ""}
                </span>
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
          <section
            aria-label="Aktivitas audit"
            className="owner-audit-mobile-results"
          >
            {loading && !result ? (
              <p role="status" className="text-body text-muted-foreground">
                Memuat aktivitas…
              </p>
            ) : result?.data.length ? (
              result.data.map((entry) => (
                <article
                  className="owner-audit-mobile-entry"
                  data-state={
                    selected?.source_type === entry.source_type &&
                    selected.source_id === entry.source_id
                      ? "selected"
                      : undefined
                  }
                  key={`${entry.source_type}-${entry.source_id}`}
                >
                  <div className="owner-audit-mobile-entry-meta">
                    <time dateTime={entry.occurred_at}>
                      {formatAuditTime(entry.occurred_at)}
                    </time>
                    <Badge variant="secondary">
                      {sourceLabel(entry.source_type)}
                    </Badge>
                  </div>
                  <h3 className="text-label">{entry.summary}</h3>
                  <p className="text-caption text-muted-foreground">
                    {entry.actor_name ?? "Tidak tercatat"}
                    {entry.employee_name ? ` · ${entry.employee_name}` : ""}
                    {` · ${entry.outlet_name ?? "Organisasi"}`}
                  </p>
                  <Button
                    className="owner-audit-mobile-detail-action"
                    disabled={detailLoading}
                    onClick={(event) =>
                      void showDetail(entry, event.currentTarget)
                    }
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    Detail aktivitas
                  </Button>
                </article>
              ))
            ) : (
              <p className="py-5 text-body text-muted-foreground">
                Tidak ada aktivitas sumber pada periode ini.
              </p>
            )}
            <div className="owner-audit-mobile-pagination">
              <span className="text-caption text-muted-foreground">
                {result
                  ? `Menampilkan ${((result.pagination.current_page - 1) * result.pagination.per_page) + 1}–${Math.min(result.pagination.current_page * result.pagination.per_page, result.pagination.total)} dari ${result.pagination.total} aktivitas. ${result.provenance.historical_coverage}`
                  : ""}
              </span>
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
          </section>
          {detailLoading ? (
            <p role="status" className="text-body text-muted-foreground">
              Memuat rincian…
            </p>
          ) : selected ? (
            <Card
              className={`owner-audit-detail ${mobileDetailOpen ? "is-open" : ""}`}
            >
              <CardHeader>
                <Button
                  className="owner-audit-mobile-back"
                  onClick={closeMobileDetail}
                  ref={mobileDetailBack}
                  type="button"
                  variant="ghost"
                >
                  Kembali ke aktivitas
                </Button>
                <div className="owner-audit-detail-heading">
                  <CardTitle>Detail aktivitas · {selected.summary}</CardTitle>
                  <Badge variant="secondary">
                    {sourceLabel(selected.source_type)}
                  </Badge>
                </div>
                <CardDescription>
                  {selected.summary} · {formatAuditTime(selected.occurred_at)}
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4 sm:grid-cols-2">
                <div>
                  <p className="text-label">Aktor</p>
                  <p className="text-body">
                    {selected.actor_name ?? "Tidak tercatat pada sumber"}
                    {selected.actor_user_id
                      ? ` · Pengguna ${selected.actor_user_id}`
                      : ""}
                  </p>
                </div>
                <div>
                  <p className="text-label">Subjek</p>
                  <p className="text-body">
                    {selected.employee_name
                      ? `${selected.employee_name} · Karyawan ${selected.employee_id}`
                      : "Tidak terkait karyawan"}
                  </p>
                </div>
                {selected.reason ? (
                  <div className="sm:col-span-2">
                    <p className="text-label">Alasan yang tercatat</p>
                    <p className="text-body whitespace-pre-wrap">
                      {selected.reason}
                    </p>
                  </div>
                ) : null}
                <div className="sm:col-span-2">
                  <p className="text-label">Referensi sumber</p>
                  <p className="text-caption text-muted-foreground">
                    {sourceLabel(selected.source_type)} ·{" "}
                    {resourceLabel(selected.resource_type)} #
                    {selected.resource_id ?? selected.source_id} · Outlet{" "}
                    {selected.outlet_name ?? "tingkat organisasi"}
                  </p>
                </div>
                <div className="sm:col-span-2 rounded-2xl border bg-muted/20 p-4">
                  <p className="mb-2 text-label">Rincian aktivitas</p>
                  <dl className="grid gap-2 sm:grid-cols-2">
                    {Object.entries(selected.details).map(([key, value]) => (
                      <div key={key}>
                        <dt className="text-caption text-muted-foreground">
                          {key.replaceAll("_", " ")}
                        </dt>
                        <dd className="text-body">
                          {Array.isArray(value)
                            ? value.join(", ")
                            : value === null
                              ? "—"
                              : typeof value === "object"
                                ? "Tersedia"
                                : String(value)}
                        </dd>
                      </div>
                    ))}
                  </dl>
                  <p className="mt-3 text-caption text-muted-foreground">
                    Data lokasi, bukti pribadi, dan nilai mentah tidak
                    ditampilkan di sini.
                  </p>
                </div>
              </CardContent>
            </Card>
          ) : null}
        </div>
      </main>
    </SidebarProvider>
  )
}
