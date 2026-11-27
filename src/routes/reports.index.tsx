import { FileText, History, Settings2, Users } from "lucide-react"
import {
  ContextFilterBar,
  LabeledControl,
  OperationalMetric,
} from "@/components/r2c/components"
import {
  FollowupCard,
  PageHeading,
  ScopeBanner,
  WorkDateRangeControl,
} from "@/components/r2c/screen-blocks"
import { createFileRoute } from "@tanstack/react-router"
import { useCallback, useEffect, useRef, useState } from "react"

import {
  ManagementSidebar,
  ManagementTopbar,
} from "@/components/management-sidebar"
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
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { SidebarProvider } from "@/components/ui/sidebar"
import { ApiError, type AuthSession, apiRequest } from "@/lib/api"

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
      "Ketidakhadiran terkonfirmasi · menunggu penetapan hasil",
    exceptional_attendance: "Kehadiran khusus",
    no_recorded_outcome: "Belum ada hasil kehadiran",
    potential_absence: "Potensi tidak hadir",
    present: "Hadir",
    leave: "Cuti",
    sick: "Sakit",
    permission: "Izin",
  }

  return labels[value] ?? value.replaceAll("_", " ")
}

function approvalTypeLabel(value: string) {
  const labels: Record<string, string> = {
    attendance_correction: "Koreksi presensi",
    attendance_review: "Tinjauan presensi",
    leave: "Cuti atau izin",
    overtime: "Lembur",
  }

  return labels[value] ?? value.replaceAll("_", " ")
}

function approvalStatusLabel(value: string, type: string) {
  const labels: Record<string, string> = {
    approved: "Disetujui",
    cancelled: "Dibatalkan",
    rejected: "Ditolak",
  }

  if (value === "pending") {
    return type === "attendance_review"
      ? "Menunggu tinjauan"
      : "Menunggu persetujuan"
  }

  return labels[value] ?? value
}

function ReportsPage() {
  const [navigationSession, setNavigationSession] =
    useState<AuthSession | null>(null)
  const [options, setOptions] = useState<ReportingOptions | null>(null)
  const [data, setData] = useState<DashboardData | null>(null)
  const [from, setFrom] = useState(localDate(new Date()))
  const [to, setTo] = useState(localDate(new Date()))
  const [businessUnitId, setBusinessUnitId] = useState("")
  const [outletId, setOutletId] = useState("")
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const initialLoad = useRef(false)
  const requestSequence = useRef(0)

  const refresh = useCallback(
    async (next?: {
      from: string
      to: string
      businessUnitId: string
      outletId: string
    }) => {
      const requestId = ++requestSequence.current
      const selected = next ?? { from, to, businessUnitId, outletId }
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
        setNavigationSession(session)
        const reportOptions =
          options ??
          (await apiRequest<ReportingOptions>("/management/reports/filters"))
        setOptions(reportOptions)
        const query = queryFor({
          from: selected.from,
          to: selected.to,
          business_unit_id: selected.businessUnitId,
          outlet_ids: selected.outletId ? [selected.outletId] : [],
        })
        const dashboard = await apiRequest<DashboardData>(
          `/management/reports/dashboard?${query}`
        )
        if (requestId === requestSequence.current) setData(dashboard)
      } catch (caught) {
        if (requestId !== requestSequence.current) return
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
        if (requestId === requestSequence.current) setLoading(false)
      }
    },
    [businessUnitId, from, options, outletId, to]
  )

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
  const scheduledWorkdays = metrics.scheduled_employee_workdays ?? 0
  const recordedWorkdays = metrics.recorded_attendance_employee_workdays ?? 0
  const attendanceRate = scheduledWorkdays
    ? Math.min(100, Math.round((recordedWorkdays / scheduledWorkdays) * 100))
    : null
  const pendingReviewCount = metrics.pending_review_requests ?? 0
  const cards = [
    ["Karyawan unik", metrics.unique_employees],
    ["Hari kerja terjadwal", metrics.scheduled_employee_workdays],
    [
      "Hari kerja belum tercatat",
      Math.max(scheduledWorkdays - recordedWorkdays, 0),
    ],
    ["Karyawan dengan kehadiran", metrics.recorded_attendance_unique_employees],
    ["Hari kerja karyawan", metrics.employee_workdays],
    ["Sesi presensi", metrics.attendance_sessions],
    ["Kasus tinjauan tertunda", metrics.pending_review_requests],
    [
      "Hari kerja dengan tinjauan",
      metrics.employee_workdays_with_unresolved_review,
    ],
    ["Potensi ketidakhadiran", metrics.potential_absence_employee_workdays],
    [
      "Durasi efektif diketahui",
      formatDuration(metrics.known_effective_duration_seconds),
    ],
  ] as const

  function updateBusinessUnit(value: string) {
    const nextOutlet = visibleOutlets.some(
      (outlet) =>
        String(outlet.id) === outletId &&
        (!value || String(outlet.business_unit_id) === value)
    )
      ? outletId
      : ""
    setBusinessUnitId(value)
    setOutletId(nextOutlet)
    void refresh({ from, to, businessUnitId: value, outletId: nextOutlet })
  }

  const navigationContext = navigationSession?.active_membership
    ? {
        tenantName: navigationSession.active_membership.tenant.name,
        roles: navigationSession.active_membership.roles,
        userName: navigationSession.user.name,
        kioskEnabled: navigationSession.features.kiosk_enabled,
      }
    : null

  return (
    <SidebarProvider className="pb-[calc(6rem+env(safe-area-inset-bottom))] md:pb-0">
      <ManagementSidebar activePage="reports" context={navigationContext} />
      <main className="min-w-0 flex-1 bg-canvas">
        <ManagementTopbar context={navigationContext} />
        <div
          className="flex min-w-0 flex-col gap-5 p-4 md:p-6"
          data-r2c-screen="overview"
        >
          <PageHeading
            title="Ringkasan"
            role={
              navigationSession?.active_membership?.roles.includes("owner")
                ? "Owner"
                : "Supervisor"
            }
            description="Pantau kehadiran dan tindak lanjut di organisasi aktif."
          />
          <ScopeBanner
            title={`Organisasi aktif · ${outletId ? (visibleOutlets.find((outlet) => String(outlet.id) === outletId)?.name ?? "Outlet terpilih") : businessUnitId ? (options?.business_units.find((unit) => String(unit.id) === businessUnitId)?.name ?? "Unit terpilih") : navigationSession?.active_membership?.roles.includes("owner") ? "seluruh Outlet" : "Outlet yang dapat Anda akses"}`}
          >
            Lihat ringkasan kehadiran menurut tanggal kerja lokal setiap
            Outlet.
          </ScopeBanner>
          <ContextFilterBar className="overflow-visible">
            <WorkDateRangeControl
              from={from}
              to={to}
              maximumDays={options?.maximum_days ?? 31}
              disabled={loading}
              onApply={(range) => {
                setFrom(range.from)
                setTo(range.to)
                void refresh({ ...range, businessUnitId, outletId })
              }}
            />
            <LabeledControl
              label="Unit bisnis"
              helper="Mengikuti organisasi aktif."
              control={
                <NativeSelect
                  id="report-unit"
                  className="w-full"
                  value={businessUnitId}
                  onChange={(event) => updateBusinessUnit(event.target.value)}
                >
                  <NativeSelectOption value="">
                    Semua unit bisnis
                  </NativeSelectOption>
                  {options?.business_units.map((unit) => (
                    <NativeSelectOption key={unit.id} value={String(unit.id)}>
                      {unit.name}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              }
            />
            <LabeledControl
              label="Outlet"
              helper="Supervisor hanya dapat melihat Outlet yang diizinkan."
              control={
                <NativeSelect
                  id="report-outlet"
                  className="w-full"
                  value={outletId}
                  onChange={(event) => {
                    const value = event.target.value
                    setOutletId(value)
                    void refresh({ from, to, businessUnitId, outletId: value })
                  }}
                >
                  <NativeSelectOption value="">Semua Outlet</NativeSelectOption>
                  {visibleOutlets.map((outlet) => (
                    <NativeSelectOption
                      key={outlet.id}
                      value={String(outlet.id)}
                    >
                      {outlet.name}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              }
            />
          </ContextFilterBar>
          {error ? (
            <Alert variant="destructive">
              <AlertTitle>Laporan belum tersedia</AlertTitle>
              <AlertDescription>
                {error}
                <Button
                  className="mt-3"
                  variant="outline"
                  onClick={() => void refresh()}
                >
                  Coba lagi
                </Button>
              </AlertDescription>
            </Alert>
          ) : null}
          {loading ? (
            <p className="text-caption" role="status">
              {data ? "Memperbarui ringkasan…" : "Memuat data organisasi…"}
            </p>
          ) : null}
          <section
            aria-label="Ringkasan kehadiran"
            aria-busy={loading}
            className="grid min-w-0 grid-cols-1 gap-4 min-[390px]:grid-cols-2 xl:grid-cols-4"
          >
            <OperationalMetric
              label="Tingkat kehadiran"
              value={
                loading && !data
                  ? "…"
                  : attendanceRate === null
                    ? "—"
                    : `${attendanceRate}%`
              }
              context={
                !data
                  ? "Menunggu data sumber"
                  : scheduledWorkdays
                    ? `${formatCount(recordedWorkdays)} dari ${formatCount(scheduledWorkdays)} hari kerja tercatat`
                    : "Belum ada hari kerja terjadwal"
              }
            />
            <OperationalMetric
              label="Hari kerja tercatat"
              value={
                data
                  ? `${formatCount(recordedWorkdays)} / ${formatCount(scheduledWorkdays)}`
                  : loading
                    ? "…"
                    : "—"
              }
              context="Tanggal kerja lokal Outlet"
            />
            <OperationalMetric
              label="Tinjauan tertunda"
              value={
                data ? formatCount(pendingReviewCount) : loading ? "…" : "—"
              }
              context="Perlu ditinjau di Persetujuan"
            />
            <OperationalMetric
              label="Potensi tidak hadir"
              value={
                data
                  ? formatCount(metrics.potential_absence_employee_workdays)
                  : loading
                    ? "…"
                    : "—"
              }
              context="Belum ditetapkan"
            />
          </section>
          <div className="grid min-w-0 items-start gap-5 lg:grid-cols-[minmax(0,1fr)_330px]">
            <FollowupCard
              items={[
                {
                  title: "Tinjauan presensi",
                  description: data
                    ? `${formatCount(pendingReviewCount)} kasus menunggu tinjauan`
                    : "Data belum tersedia",
                  href: "/approvals",
                  action: "Buka Persetujuan",
                },
                {
                  title: "Potensi tidak hadir",
                  description: data
                    ? `${formatCount(metrics.potential_absence_employee_workdays)} hari kerja karyawan · belum ditetapkan`
                    : "Data belum tersedia",
                  href: "/reports/attendance",
                  action: "Lihat Laporan",
                },
                {
                  title: "Pemeriksaan jadwal",
                  description:
                    "Periksa kelengkapan jadwal sebelum menetapkan ketidakhadiran.",
                  href: "/scheduling",
                  action: "Buka Jadwal",
                },
              ]}
            />
            <Card className="gap-3 p-6">
              <CardHeader className="p-0">
                <CardTitle
                  role="heading"
                  aria-level={2}
                  className="text-subtitle [font-size:20px]"
                >
                  Akses langsung
                </CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col items-start gap-3 p-0">
                <Button
                  variant="outline"
                  className="text-[13px]"
                  render={<a href="/workspace#people-devices" />}
                >
                  <Users
                    aria-hidden="true"
                    data-icon="inline-start"
                    className="text-brand-700"
                  />
                  Kelola Tim
                </Button>
                <Button
                  variant="outline"
                  className="text-[13px]"
                  render={<a href="/reports/attendance" />}
                >
                  <FileText
                    aria-hidden="true"
                    data-icon="inline-start"
                    className="text-brand-700"
                  />
                  Laporan kehadiran
                </Button>
                <Button
                  variant="outline"
                  className="text-[13px]"
                  render={<a href="/reports/audit" />}
                >
                  <History
                    aria-hidden="true"
                    data-icon="inline-start"
                    className="text-brand-700"
                  />
                  Audit aktivitas
                </Button>
                <Button
                  variant="outline"
                  className="text-[13px]"
                  render={
                    <a
                      href={
                        navigationSession?.active_membership?.roles.includes(
                          "owner"
                        )
                          ? "/workspace#organization"
                          : "/scheduling#kebijakan"
                      }
                    />
                  }
                >
                  <Settings2
                    aria-hidden="true"
                    data-icon="inline-start"
                    className="text-brand-700"
                  />
                  Pengaturan
                </Button>
                <p className="text-body text-[13px] text-muted-foreground">
                  Tim = profil dan penempatan. Laporan = hasil kehadiran dan
                  audit.
                </p>
              </CardContent>
            </Card>
          </div>
          <p className="text-caption">
            {data
              ? `Diperbarui ${new Date(data.provenance.generated_at).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" })} WIB · data yang berlaku saat ini, bukan rekaman historis. ${data.provenance.reporting_semantics}`
              : "Metrik belum tersedia untuk filter ini."}
          </p>
          <details className="rounded-[16px] border border-border bg-surface p-4">
            <summary className="flex min-h-11 cursor-pointer items-center text-label focus-visible:outline-2 focus-visible:outline-primary">
              Rincian metrik dan status
            </summary>
            <div className="mt-4 flex flex-col gap-4">
              <Button
                className="self-start"
                variant="outline"
                disabled={loading}
                onClick={() => void refresh()}
              >
                Perbarui data
              </Button>
              <section
                aria-label="Metrik kehadiran"
                className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 owner-period-metrics"
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
                      Status dihitung per karyawan dan tanggal kerja dari
                      jadwal, presensi, permintaan, serta penetapan hasil.
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
                    <CardTitle>Persetujuan dan tinjauan</CardTitle>
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
                              item.status === "pending"
                                ? "outline"
                                : "secondary"
                            }
                          >
                            {approvalStatusLabel(item.status, item.type)}:{" "}
                            {formatCount(item.requests)}
                          </Badge>
                        </div>
                      ))
                    ) : (
                      <p className="text-body text-muted-foreground">
                        Belum ada permintaan atau kasus tinjauan.
                      </p>
                    )}
                    <p className="pt-2 text-caption text-muted-foreground">
                      Sesi aktif:{" "}
                      {formatCount(metrics.active_attendance_sessions)} · sesi
                      selesai:{" "}
                      {formatCount(metrics.completed_attendance_sessions)} ·
                      durasi tercatat:{" "}
                      {formatDuration(metrics.known_actual_duration_seconds)}
                    </p>
                  </CardContent>
                </Card>
              </div>
            </div>
          </details>
        </div>
      </main>
    </SidebarProvider>
  )
}
