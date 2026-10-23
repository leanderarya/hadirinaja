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
import { ApiError, type AuthSession, apiRequest } from "@/lib/api"
import { REPORT_DATE_PRESETS, reportDateRange } from "@/lib/report-date-presets"

export const Route = createFileRoute("/reports/")({ component: ReportsPage })

type ReportingOptions = {
  business_units: Array<{ id: number; name: string }>
  outlets: Array<{
    id: number
    name: string
    business_unit_id: number
    business_unit_name: string
  }>
  maximum_days: number
}
type ReportFilters = {
  from: string
  to: string
  business_unit_id?: string
  outlet_ids?: string[]
}
type DashboardData = {
  metrics: Record<string, number>
  outcomes: Record<string, number>
  approval_requests: {
    total_requests: number
    by_type_and_status: Array<{
      type: string
      status: string
      requests: number
    }>
  }
  provenance: {
    active_tenant: { name: string }
    generated_at: string
    reporting_semantics: string
    values: string
  }
}

function localDate(date: Date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-")
}

function dateDaysAgo(days: number) {
  const date = new Date()
  date.setDate(date.getDate() - days)
  return localDate(date)
}

function queryFor(filters: ReportFilters) {
  const params = new URLSearchParams({ from: filters.from, to: filters.to })
  if (filters.business_unit_id)
    params.set("business_unit_id", filters.business_unit_id)
  for (const outletId of filters.outlet_ids ?? [])
    params.append("outlet_ids[]", outletId)
  return params.toString()
}

function formatCount(value: number | undefined) {
  return new Intl.NumberFormat("id-ID").format(value ?? 0)
}

function formatDuration(seconds: number | undefined) {
  if (seconds === undefined) return "—"
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  return `${hours} jam ${String(minutes).padStart(2, "0")} menit`
}

function outcomeLabel(value: string) {
  const labels: Record<string, string> = {
    confirmed_absence_pending_finalization:
      "Absensi terkonfirmasi · menunggu finalisasi",
    exceptional_attendance: "Kehadiran khusus",
    no_recorded_outcome: "Belum ada hasil",
    potential_absence: "Potensi absen",
    present: "Hadir",
    leave: "Cuti",
    sick: "Sakit",
    permission: "Izin",
  }

  return labels[value] ?? value.replaceAll("_", " ")
}

function approvalTypeLabel(value: string) {
  const labels: Record<string, string> = {
    attendance_correction: "Koreksi kehadiran",
    attendance_review: "Review kehadiran",
    leave: "Cuti atau izin",
    overtime: "Lembur",
  }

  return labels[value] ?? value.replaceAll("_", " ")
}

function approvalStatusLabel(value: string) {
  const labels: Record<string, string> = {
    approved: "Disetujui",
    cancelled: "Dibatalkan",
    pending: "Menunggu",
    rejected: "Ditolak",
  }

  return labels[value] ?? value
}

function ReportsPage() {
  const [options, setOptions] = useState<ReportingOptions | null>(null)
  const [data, setData] = useState<DashboardData | null>(null)
  const [from, setFrom] = useState(dateDaysAgo(13))
  const [to, setTo] = useState(localDate(new Date()))
  const [businessUnitId, setBusinessUnitId] = useState("")
  const [outletId, setOutletId] = useState("")
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const initialLoad = useRef(false)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError("")
    try {
      const session = await apiRequest<AuthSession>("/auth/me")
      if (!session.active_membership) {
        window.location.assign("/select-tenant")
        return
      }
      if (
        !session.active_membership.roles.some(
          (role) => role === "owner" || role === "supervisor"
        )
      ) {
        window.location.assign("/attendance")
        return
      }
      const reportOptions =
        options ??
        (await apiRequest<ReportingOptions>("/management/reports/filters"))
      setOptions(reportOptions)
      const query = queryFor({
        from,
        to,
        business_unit_id: businessUnitId,
        outlet_ids: outletId ? [outletId] : [],
      })
      const dashboard = await apiRequest<DashboardData>(
        `/management/reports/dashboard?${query}`
      )
      setData(dashboard)
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
          : "Ringkasan laporan belum dapat dimuat."
      )
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [businessUnitId, from, options, outletId, to])

  useEffect(() => {
    if (!initialLoad.current) {
      initialLoad.current = true
      void refresh()
    }
    const expireSession = () => window.location.assign("/login?expired=1")
    window.addEventListener("hadirinaja:session-expired", expireSession)
    return () =>
      window.removeEventListener("hadirinaja:session-expired", expireSession)
  }, [refresh])

  const visibleOutlets =
    options?.outlets.filter(
      (outlet) =>
        !businessUnitId || String(outlet.business_unit_id) === businessUnitId
    ) ?? []
  const metrics = data?.metrics ?? {}
  const cards = [
    ["Karyawan unik", metrics.unique_employees],
    ["Hari kerja terjadwal", metrics.scheduled_employee_workdays],
    ["Karyawan dengan kehadiran", metrics.recorded_attendance_unique_employees],
    ["Hari kerja karyawan", metrics.employee_workdays],
    ["Sesi kehadiran", metrics.attendance_sessions],
    ["Kasus review tertunda", metrics.pending_review_requests],
    [
      "Hari kerja dengan review",
      metrics.employee_workdays_with_unresolved_review,
    ],
    ["Potensi ketidakhadiran", metrics.potential_absence_employee_workdays],
    [
      "Durasi efektif diketahui",
      formatDuration(metrics.known_effective_duration_seconds),
    ],
  ] as const

  function updateBusinessUnit(value: string) {
    setBusinessUnitId(value)
    if (
      outletId &&
      !options?.outlets.some(
        (outlet) =>
          String(outlet.id) === outletId &&
          (!value || String(outlet.business_unit_id) === value)
      )
    ) {
      setOutletId("")
    }
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
                <BreadcrumbPage>Laporan kehadiran</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
        </header>
        <div className="mx-auto flex max-w-7xl flex-col gap-6 p-4 md:gap-8 md:p-8">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="space-y-1">
              <h1 className="text-title">Ringkasan operasional</h1>
              <p className="text-body text-muted-foreground">
                Nilai kehadiran efektif terkini untuk{" "}
                {data?.provenance.active_tenant.name ?? "organisasi aktif"}.
              </p>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                render={<a href="/reports/attendance" />}
              >
                Laporan detail
              </Button>
              <Button variant="outline" render={<a href="/reports/audit" />}>
                Audit aktivitas
              </Button>
            </div>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Periode laporan</CardTitle>
              <CardDescription>
                Work date adalah tanggal lokal Outlet; rentang maksimal 31 hari.
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
                className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5"
                onSubmit={(event) => {
                  event.preventDefault()
                  void refresh()
                }}
              >
                <Field>
                  <FieldLabel htmlFor="report-from">Dari tanggal</FieldLabel>
                  <Input
                    id="report-from"
                    type="date"
                    value={from}
                    onChange={(event) => setFrom(event.target.value)}
                    required
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="report-to">Sampai tanggal</FieldLabel>
                  <Input
                    id="report-to"
                    type="date"
                    value={to}
                    onChange={(event) => setTo(event.target.value)}
                    required
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="report-unit">Unit bisnis</FieldLabel>
                  <NativeSelect
                    id="report-unit"
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
                  <FieldLabel htmlFor="report-outlet">Outlet</FieldLabel>
                  <NativeSelect
                    id="report-outlet"
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
                <div className="flex items-end">
                  <Button type="submit" disabled={loading} className="w-full">
                    {loading ? "Memuat…" : "Perbarui"}
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
          {loading && !data ? (
            <p className="text-body text-muted-foreground" role="status">
              Memuat data organisasi…
            </p>
          ) : null}

          <section
            aria-label="Metrik kehadiran"
            className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3"
          >
            {cards.map(([label, value]) => (
              <Card key={label}>
                <CardHeader className="pb-2">
                  <CardDescription>{label}</CardDescription>
                  <CardTitle className="text-title">
                    {loading && !data
                      ? "…"
                      : typeof value === "string"
                        ? value
                        : formatCount(value)}
                  </CardTitle>
                </CardHeader>
              </Card>
            ))}
          </section>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Status kehadiran</CardTitle>
                <CardDescription>
                  Hari kerja dihitung dari proyeksi S5 per karyawan dan tanggal.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-2">
                {Object.entries(data?.outcomes ?? {}).length === 0 ? (
                  <p className="text-body text-muted-foreground">
                    Belum ada catatan pada periode ini.
                  </p>
                ) : (
                  Object.entries(data?.outcomes ?? {}).map(
                    ([status, count]) => (
                      <Badge key={status} variant="secondary">
                        {outcomeLabel(status)}: {formatCount(count)}
                      </Badge>
                    )
                  )
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Approval dan review</CardTitle>
                <CardDescription>
                  {formatCount(data?.approval_requests.total_requests)}{" "}
                  permintaan dalam periode.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-2">
                {data?.approval_requests.by_type_and_status.length ? (
                  data.approval_requests.by_type_and_status.map((item) => (
                    <div
                      key={`${item.type}-${item.status}`}
                      className="flex items-center justify-between border-b py-2 last:border-0"
                    >
                      <span className="text-body">
                        {approvalTypeLabel(item.type)}
                      </span>
                      <Badge
                        variant={
                          item.status === "pending" ? "outline" : "secondary"
                        }
                      >
                        {approvalStatusLabel(item.status)}:{" "}
                        {formatCount(item.requests)}
                      </Badge>
                    </div>
                  ))
                ) : (
                  <p className="text-body text-muted-foreground">
                    Belum ada permintaan approval atau review.
                  </p>
                )}
                <p className="pt-2 text-caption text-muted-foreground">
                  Sesi aktif: {formatCount(metrics.active_attendance_sessions)}{" "}
                  · sesi selesai:{" "}
                  {formatCount(metrics.completed_attendance_sessions)} · durasi
                  tercatat:{" "}
                  {formatDuration(metrics.known_actual_duration_seconds)}
                </p>
              </CardContent>
            </Card>
          </div>

          <p className="text-caption text-muted-foreground">
            {data
              ? `Diperbarui ${new Date(data.provenance.generated_at).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" })} WIB. ${data.provenance.reporting_semantics}`
              : "Metrik kosong menunjukkan belum ada data sumber yang cocok dengan filter."}
          </p>
        </div>
      </main>
    </SidebarProvider>
  )
}
