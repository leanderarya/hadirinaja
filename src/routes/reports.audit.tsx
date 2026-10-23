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
import { ApiError, type AuthSession, apiRequest } from "@/lib/api"
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
function formatTime(value: string) {
  return `${new Intl.DateTimeFormat("id-ID", {
    timeZone: "UTC",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value))} UTC`
}
function sourceLabel(value: string) {
  const labels: Record<string, string> = {
    attendance_event: "Kehadiran",
    approval_request: "Permintaan",
    approval_decision: "Keputusan",
    attendance_finalization: "Finalisasi",
    schedule_change: "Jadwal / kebijakan",
    employee_assignment: "Penugasan karyawan",
    report_export: "Ekspor laporan",
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
  const [options, setOptions] = useState<Options | null>(null)
  const [result, setResult] = useState<AuditPage | null>(null)
  const [selected, setSelected] = useState<AuditDetail | null>(null)
  const [from, setFrom] = useState(daysAgo(30))
  const [to, setTo] = useState(today())
  const [source, setSource] = useState("")
  const [businessUnitId, setBusinessUnitId] = useState("")
  const [outletId, setOutletId] = useState("")
  const [employeeId, setEmployeeId] = useState("")
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [detailLoading, setDetailLoading] = useState(false)
  const [error, setError] = useState("")
  const initialLoad = useRef(false)

  const visibleOutlets =
    options?.outlets.filter(
      (outlet) =>
        !businessUnitId || String(outlet.business_unit_id) === businessUnitId
    ) ?? []

  const load = useCallback(
    async (targetPage = 1, loadOptions = false) => {
      setLoading(true)
      setError("")
      try {
        if (!(await ensureManagementAccess())) return
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

  async function showDetail(entry: AuditEntry) {
    setDetailLoading(true)
    setError("")
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

  return (
    <SidebarProvider>
      <ManagementSidebar activePage="audit" />
      <main className="min-w-0 flex-1 bg-muted/20">
        <header className="flex items-center gap-3 border-b bg-background px-4 py-3 md:px-8">
          <SidebarTrigger />
          <Breadcrumb>
            <BreadcrumbList>
              <BreadcrumbItem>
                <BreadcrumbPage>Audit aktivitas</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
        </header>
        <div className="mx-auto flex max-w-7xl flex-col gap-6 p-4 md:gap-8 md:p-8">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="text-title">Audit aktivitas</h1>
              <p className="text-body text-muted-foreground">
                Jejak keputusan dan perubahan dari catatan sumber yang tersedia.
              </p>
            </div>
            <Button variant="outline" render={<a href="/reports" />}>
              Ringkasan laporan
            </Button>
          </div>
          <Card>
            <CardHeader>
              <CardTitle>Filter audit</CardTitle>
              <CardDescription>
                Timestamp audit mengikuti UTC. Rentang maksimal 31 hari.
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
                  void load(1)
                }}
              >
                <Field>
                  <FieldLabel htmlFor="audit-from">
                    Dari tanggal (UTC)
                  </FieldLabel>
                  <Input
                    id="audit-from"
                    type="date"
                    value={from}
                    onChange={(event) => setFrom(event.target.value)}
                    required
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="audit-to">
                    Sampai tanggal (UTC)
                  </FieldLabel>
                  <Input
                    id="audit-to"
                    type="date"
                    value={to}
                    onChange={(event) => setTo(event.target.value)}
                    required
                  />
                </Field>
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
                  <FieldLabel htmlFor="audit-outlet">Outlet</FieldLabel>
                  <NativeSelect
                    id="audit-outlet"
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
              <AlertTitle>Audit belum tersedia</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          <Card>
            <CardHeader>
              <CardTitle>Riwayat sumber</CardTitle>
              <CardDescription>
                {result
                  ? `${new Intl.NumberFormat("id-ID").format(result.pagination.total)} aktivitas · halaman ${result.pagination.current_page} dari ${result.pagination.last_page}`
                  : "Aktivitas akan tampil setelah filter diterapkan."}
              </CardDescription>
            </CardHeader>
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
                      <TableHead>Aktor</TableHead>
                      <TableHead>Karyawan / Outlet</TableHead>
                      <TableHead>Aktivitas</TableHead>
                      <TableHead />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {result.data.map((entry) => (
                      <TableRow key={`${entry.source_type}-${entry.source_id}`}>
                        <TableCell>{formatTime(entry.occurred_at)}</TableCell>
                        <TableCell>
                          <Badge variant="secondary">
                            {sourceLabel(entry.source_type)}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {entry.actor_name ? (
                            <>
                              {entry.actor_name}
                              <div className="text-caption text-muted-foreground">
                                User {entry.actor_user_id}
                              </div>
                            </>
                          ) : (
                            "Tidak tercatat"
                          )}
                        </TableCell>
                        <TableCell>
                          {entry.employee_name ?? "—"}
                          <div className="text-caption text-muted-foreground">
                            {entry.outlet_name ?? "Tenant"}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="font-medium">{entry.summary}</div>
                          {entry.reason ? (
                            <div className="max-w-sm truncate text-caption text-muted-foreground">
                              {entry.reason}
                            </div>
                          ) : (
                            <div className="text-caption text-muted-foreground">
                              {entry.action}
                            </div>
                          )}
                        </TableCell>
                        <TableCell>
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={detailLoading}
                            onClick={() => void showDetail(entry)}
                          >
                            Rincian
                          </Button>
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
                  {result?.provenance.historical_coverage}
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
          {detailLoading ? (
            <p role="status" className="text-body text-muted-foreground">
              Memuat rincian…
            </p>
          ) : selected ? (
            <Card>
              <CardHeader>
                <CardTitle>Rincian aktivitas #{selected.source_id}</CardTitle>
                <CardDescription>
                  {selected.summary} · {formatTime(selected.occurred_at)}
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4 sm:grid-cols-2">
                <div>
                  <p className="text-label">Aktor</p>
                  <p className="text-body">
                    {selected.actor_name ?? "Tidak tercatat pada sumber"}
                    {selected.actor_user_id
                      ? ` · User ${selected.actor_user_id}`
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
                    {selected.source_type} ·{" "}
                    {selected.resource_type ?? "record"} #
                    {selected.resource_id ?? selected.source_id} · Outlet{" "}
                    {selected.outlet_name ?? "tingkat Tenant"}
                  </p>
                </div>
                <div className="sm:col-span-2 rounded-2xl border bg-muted/20 p-4">
                  <p className="mb-2 text-label">Metadata aman</p>
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
                    Payload lokasi, bukti pribadi, serta nilai mentah tidak
                    ditampilkan di audit ini.
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
