import { CorrectionEvidencePanel } from "@/components/correction-evidence-panel"
import { createFileRoute } from "@tanstack/react-router"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  ArrowLeft,
  ArrowUpRight,
  Check,
  ClipboardCheck,
  SlidersHorizontal,
  ShieldCheck,
  History,
  X,
} from "lucide-react"
import {
  ApprovalQueueItem,
  AttendanceProjection,
  ContextAlert,
  EvidenceAccess,
  LabeledControl,
  StatusBadge,
} from "@/components/r2c/components"
import { workDateLabel } from "@/components/r2c/operational-blocks"
import { PageHeading } from "@/components/r2c/screen-blocks"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { cn } from "@/lib/utils"

import {
  ManagementSidebar,
  ManagementTopbar,
} from "@/components/management-sidebar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { SidebarProvider } from "@/components/ui/sidebar"
import { Textarea } from "@/components/ui/textarea"
import {
  ApiError,
  type AuthSession,
  apiRequest,
  apiUrl,
  type OrganizationSummary,
} from "@/lib/api"

export const Route = createFileRoute("/approvals")({ component: ApprovalsPage })

type ApprovalItem = {
  id: number
  type: "leave" | "overtime" | "attendance_correction" | "attendance_review"
  status: "pending" | "approved" | "rejected" | "cancelled"
  reversed?: boolean
  employee: { id: number; name: string }
  outlet: { id: number; name: string } | null
  requester_user_id: number | null
  work_date: string | null
  starts_on: string | null
  ends_on: string | null
  reason: string | null
  details: Record<string, unknown>
  classification: string | null
  correction?: {
    original_values: Record<string, unknown>
    proposed_values: Record<string, unknown>
  } | null
  can_decide: boolean
  eligibility_reason: string | null
  decision_history: Array<{
    id: number
    action: string
    reason: string | null
    actor_user_id: number
    acted_at: string
    original_values: Record<string, unknown> | null
    proposed_values: Record<string, unknown> | null
    effective_values: Record<string, unknown> | null
  }>
}
type EffectiveDay = {
  tenant_id: number
  employee: { id: number; name: string }
  work_date: string
  outlet: { id: number; name: string } | null
  schedule: {
    timezone?: string | null
    status: string
    scheduled_start: string | null
    scheduled_end: string | null
  }
  sessions: Array<{
    id: number
    original: {
      check_in_at: string | null
      check_out_at: string | null
      events: Array<{ id: number; has_evidence: boolean; recorded_at: string }>
    }
    effective: {
      check_in_at: string | null
      check_out_at: string | null
      duration_seconds: number | null
      outlet_id: number
    }
    actual_duration_seconds: number | null
    review_indicators: string[]
  }>
  actual_duration_seconds: number | null
  effective_duration_seconds: number | null
  approved_leave: { category?: string } | null
  overtime_requests: Array<{ status: string; details: Record<string, unknown> }>
  review: { status: string; indicators: string[]; cases: ApprovalItem[] }
  outcome: string
  conflicts: string[]
  unresolved_conflicts: string[]
  is_finalized: boolean
  finalization_review_basis?: string | null
  finalization: {
    id: number
    revision: number
    outcome: string
    reason: string
  } | null
}
type QueueData = { pending_count: number; requests: ApprovalItem[] }
type OrganizationData = OrganizationSummary & {
  outlets: Array<{ id: number; name: string; business_unit_id: number }>
}

function today() {
  const date = new Date()
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-")
}
function dateAgo(days: number) {
  const date = new Date()
  date.setDate(date.getDate() - days)
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-")
}

function ApprovalsPage() {
  const [organization, setOrganization] = useState<OrganizationData | null>(
    null
  )
  const [kioskEnabled, setKioskEnabled] = useState(false)
  const [employees, setEmployees] = useState<
    Array<{ id: number; name: string }>
  >([])
  const [queue, setQueue] = useState<QueueData | null>(null)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [projection, setProjection] = useState<EffectiveDay[]>([])
  const [loading, setLoading] = useState(true)
  const [detailLoading, setDetailLoading] = useState(false)
  const [requestOnly, setRequestOnly] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [actionError, setActionError] = useState("")
  const [notice, setNotice] = useState("")
  const [statusFilter, setStatusFilter] = useState("pending")
  const [typeFilter, setTypeFilter] = useState("")
  const [outletFilter, setOutletFilter] = useState("")
  const [employeeFilter, setEmployeeFilter] = useState("")
  const [from, setFrom] = useState(dateAgo(13))
  const [to, setTo] = useState(today())
  const [advancedFiltersOpen, setAdvancedFiltersOpen] = useState(false)
  const [mobileSelectedOpen, setMobileSelectedOpen] = useState(false)
  const [decisionReason, setDecisionReason] = useState("")
  const [finalizationOutcome, setFinalizationOutcome] = useState("present")
  const [finalizationReason, setFinalizationReason] = useState("")
  const queueRequestId = useRef(0)
  const decisionAttempt = useRef<{ payload: string; key: string } | null>(null)
  const [queueCategory, setQueueCategory] = useState("requests")
  const queueTrigger = useRef<HTMLElement | null>(null)
  const detailHeading = useRef<HTMLHeadingElement>(null)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [supplementBlockedId, setSupplementBlockedId] = useState<number | null>(null)
  const [retentionOpen, setRetentionOpen] = useState(false)
  const isOwner = organization?.roles.includes("owner") ?? false
  useEffect(() => {
    if (mobileSelectedOpen && (selectedId === null || selectedId > 0))
      requestAnimationFrame(() => detailHeading.current?.focus())
  }, [mobileSelectedOpen, selectedId])

  const selected = useMemo(
    () => queue?.requests.find((item) => item.id === selectedId) ?? null,
    [queue, selectedId]
  )
  const updateSupplement = useCallback((blocked: boolean) => {
    const id = selected?.id
    if (id) setSupplementBlockedId((current) => blocked ? id : current === id ? null : current)
  }, [selected?.id])
  const reversibleDecision = isOwner && selected?.type === "attendance_correction"
    && selected.status === "approved" && !selected.reversed
    ? selected.decision_history.find(({ action }) => action === "approved" || action === "routine_applied")
    : undefined
  const visibleQueueRequests = useMemo(
    () =>
      (queue?.requests ?? []).filter((item) =>
        queueCategory === "attendance"
          ? item.type === "attendance_review"
          : item.type !== "attendance_review"
      ),
    [queue, queueCategory]
  )

  async function loadSelectedEmployeeProjection() {
    if (!employeeFilter) {
      setError("Pilih karyawan untuk menampilkan pratinjau hasil kehadiran.")
      return
    }
    setSelectedId(null)
    setMobileSelectedOpen(true)
    setDetailLoading(true)
    setError("")
    try {
      const result = await apiRequest<{ attendance: EffectiveDay[] }>(
        `/management/attendance/effective?employee_id=${employeeFilter}&from=${from}&to=${to}`
      )
      setProjection(result.attendance)
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught.message
          : "Hasil kehadiran belum dapat dimuat."
      )
      setProjection([])
    } finally {
      setDetailLoading(false)
    }
  }

  const refreshQueue = useCallback(
    async (nextStatus = statusFilter) => {
      const requestId = ++queueRequestId.current
      const params = new URLSearchParams()
      if (nextStatus) params.set("status", nextStatus)
      if (typeFilter) params.set("type", typeFilter)
      if (outletFilter) params.set("outlet_id", outletFilter)
      if (employeeFilter) params.set("employee_id", employeeFilter)
      if (from) params.set("from", from)
      if (to) params.set("to", to)
      try {
        const result = await apiRequest<QueueData>(
          `/management/approvals?${params.toString()}`
        )
        if (requestId !== queueRequestId.current) return
        setQueue(result)
        setError("")
        setSelectedId((current) =>
          current && result.requests.some((item) => item.id === current)
            ? current
            : (result.requests[0]?.id ?? null)
        )
      } catch (caught) {
        if (requestId === queueRequestId.current) {
          setError(
            caught instanceof ApiError
              ? caught.message
              : "Daftar permintaan belum dapat dimuat."
          )
        }
      }
    },
    [employeeFilter, from, outletFilter, statusFilter, to, typeFilter]
  )

  const refresh = useCallback(async () => {
    setError("")
    try {
      const currentSession = await apiRequest<AuthSession>("/auth/me")
      if (!currentSession.active_membership) {
        window.location.assign("/select-tenant")
        return
      }
      setKioskEnabled(currentSession.features.kiosk_enabled)
      if (
        !currentSession.active_membership.roles.some(
          (role) => role === "owner" || role === "supervisor"
        )
      ) {
        window.location.assign("/attendance")
        return
      }
      const [org, employeePayload] = await Promise.all([
        apiRequest<OrganizationData>("/management/organization"),
        apiRequest<{ employees: Array<{ id: number; name: string }> }>(
          "/management/employees"
        ),
      ])
      setOrganization(org)
      setEmployees(employeePayload.employees)
      await apiRequest("/management/attendance/reviews/discover", {
        method: "POST",
        body: { from: dateAgo(13), to: today() },
      })
      await refreshQueue()
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
          : "Halaman persetujuan belum dapat dimuat."
      )
    } finally {
      setLoading(false)
    }
  }, [refreshQueue])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    if (!selected) {
      setProjection([])
      setRequestOnly(false)
      return
    }
    const first = selected.work_date ?? selected.starts_on
    const last = selected.ends_on ?? selected.work_date ?? selected.starts_on
    if (!first || !last) {
      setProjection([])
      return
    }
    let cancelled = false
    setProjection([])
    setRequestOnly(false)
    setDetailLoading(true)
    setError("")
    apiRequest<{ attendance: EffectiveDay[] }>(
      `/management/attendance/effective?employee_id=${selected.employee.id}&from=${first}&to=${last}`
    )
      .then((result) => {
        if (!cancelled) setProjection(result.attendance)
      })
      .catch((caught: unknown) => {
        if (!cancelled && selected.type === "attendance_correction" && caught instanceof ApiError && caught.status === 403) {
          setRequestOnly(true)
        } else if (!cancelled) setError(
            caught instanceof ApiError
              ? caught.message
              : "Hasil kehadiran belum dapat dimuat."
          )
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [selected])

  async function applyDecision(decision: "approved" | "rejected") {
    if (!selected?.can_decide || busy || (decision === "approved" && supplementBlockedId === selected.id)) return
    setBusy(true)
    setActionError("")
    setNotice("")
    try {
      const body = { decision, reason: decisionReason || undefined }
      const payload = JSON.stringify({ requestId: selected.id, ...body })
      if (decisionAttempt.current?.payload !== payload) {
        decisionAttempt.current = { payload, key: crypto.randomUUID() }
      }
      const result = await apiRequest<{ request: ApprovalItem }>(
        `/management/approvals/${selected.id}/decision`,
        {
          method: "POST",
          headers: { "Idempotency-Key": decisionAttempt.current.key },
          body,
        }
      )
      decisionAttempt.current = null
      setNotice(
        decision === "approved"
          ? "Keputusan persetujuan tersimpan."
          : "Keputusan penolakan tersimpan."
      )
      setDecisionReason("")
      await refreshQueue()
      if (
        result.request.status === "approved" &&
        selected.type === "attendance_review"
      ) {
        setNotice(
          "Tinjauan diterima. Hasil masih menunggu penetapan."
        )
      }
    } catch (caught) {
      setActionError(
        caught instanceof ApiError
          ? caught.message
          : "Keputusan belum dapat disimpan."
      )
    } finally {
      setBusy(false)
    }
  }

  async function finalize(day: EffectiveDay, outcome: string) {
    setBusy(true)
    setActionError("")
    setNotice("")
    try {
      await apiRequest("/management/attendance/finalizations", {
        method: "POST",
        body: {
          employee_id: day.employee.id,
          work_date: day.work_date,
          outcome,
          reason: finalizationReason,
          reviewed_basis: day.finalization_review_basis ?? undefined,
        },
      })
      setNotice(
        `Hasil kehadiran ${day.work_date} ditetapkan. Sumber dan keputusan tercatat di riwayat.`
      )
      setFinalizationReason("")
      await refreshQueue()
      const result = await apiRequest<{ attendance: EffectiveDay[] }>(
        `/management/attendance/effective?employee_id=${day.employee.id}&from=${day.work_date}&to=${day.work_date}`
      )
      setProjection(result.attendance)
    } catch (caught) {
      setActionError(
        caught instanceof ApiError
          ? caught.message
          : "Hasil kehadiran belum dapat ditetapkan."
      )
    } finally {
      setBusy(false)
    }
  }

  async function logout() {
    await apiRequest("/auth/logout", { method: "POST" }).catch(() => undefined)
    window.location.assign("/login")
  }

  if (loading && !queue) {
    return (
      <main className="flex min-h-svh items-center justify-center text-body text-muted-foreground">
        Memuat persetujuan…
      </main>
    )
  }

  const navigationContext = organization
    ? {
        tenantName: organization.tenant.name,
        roles: organization.roles,
        kioskEnabled,
      }
    : null

  return (
    <SidebarProvider className="pb-[calc(6rem+env(safe-area-inset-bottom))] md:pb-0">
      <div className="flex min-h-svh w-full bg-canvas">
        <ManagementSidebar activePage="approvals" context={navigationContext} />
        <div className="min-w-0 flex-1">
          <ManagementTopbar context={navigationContext} onLogout={logout} />

          <main
            className="@container flex min-w-0 flex-col wrap-anywhere gap-[14px] p-4 md:gap-4 md:p-6"
            data-r2c-screen="approvals"
          >
            <PageHeading
              title="Persetujuan"
              role={
                organization?.roles.includes("owner") ? "Owner" : "Supervisor"
              }
              description={
                mobileSelectedOpen
                  ? "Periksa bukti, nilai asli/efektif, dan alasan sebelum memutus."
                  : "Permintaan dan tinjauan presensi dalam organisasi aktif."
              }
            />
            {isOwner ? (
              <div className="flex flex-col items-start gap-2">
                <Button variant="outline" type="button" aria-expanded={retentionOpen} onClick={() => setRetentionOpen(!retentionOpen)}>
                  Retensi bukti koreksi
                </Button>
                {retentionOpen ? <CorrectionRetentionSettings /> : null}
              </div>
            ) : null}
            {actionError || error ? (
              <ContextAlert
                tone="danger"
                title={
                  actionError ? "Perubahan belum tersimpan" : "Belum berhasil"
                }
                action={
                  actionError ? undefined : (
                    <Button
                      variant="outline"
                      disabled={busy}
                      onClick={() => void refresh()}
                    >
                      Coba lagi
                    </Button>
                  )
                }
              >
                {actionError || error}
              </ContextAlert>
            ) : null}
            {notice ? (
              <ContextAlert title="Perubahan tersimpan">{notice}</ContextAlert>
            ) : null}
            <div
              className={cn(
                "grid min-w-0 gap-5 @min-[960px]:grid-cols-[minmax(300px,0.8fr)_minmax(0,1.2fr)]",
                !mobileSelectedOpen && "@min-[960px]:grid-cols-1"
              )}
            >
              <section
                className={cn(
                  "flex min-w-0 flex-col gap-4",
                  mobileSelectedOpen && "hidden @min-[960px]:flex"
                )}
                aria-label="Antrean Persetujuan"
              >
                <Tabs
                  value={queueCategory}
                  onValueChange={(value) => {
                    setQueueCategory(String(value))
                    setTypeFilter(
                      value === "attendance" ? "attendance_review" : ""
                    )
                  }}
                >
                  <TabsList
                    aria-label="Kategori antrean"
                    className="max-w-full"
                  >
                    <TabsTrigger value="requests">Permintaan</TabsTrigger>
                    <TabsTrigger value="attendance">
                      Tinjauan presensi
                    </TabsTrigger>
                  </TabsList>
                  <TabsContent
                    value={queueCategory}
                    className="flex min-w-0 flex-col gap-4 pt-2"
                  >
                    <form
                      className="flex min-w-0 flex-col gap-4"
                      onSubmit={(event) => {
                        event.preventDefault()
                        void refreshQueue()
                      }}
                    >
                      <div className="grid gap-3 sm:grid-cols-2">
                        <LabeledControl
                          label="Status"
                          helper="Permintaan yang sudah ditinjau tetap dapat ditelusuri."
                          control={
                            <NativeSelect
                              id="r2c-approval-status"
                              value={statusFilter}
                              onChange={(event) =>
                                setStatusFilter(event.target.value)
                              }
                            >
                              <NativeSelectOption value="pending">
                                Menunggu
                              </NativeSelectOption>
                              <NativeSelectOption value="approved">
                                Disetujui
                              </NativeSelectOption>
                              <NativeSelectOption value="rejected">
                                Ditolak
                              </NativeSelectOption>
                              <NativeSelectOption value="cancelled">
                                Dibatalkan
                              </NativeSelectOption>
                              <NativeSelectOption value="">
                                Semua
                              </NativeSelectOption>
                            </NativeSelect>
                          }
                        />
                        <LabeledControl
                          label="Outlet"
                          helper="Daftar hanya menampilkan Outlet yang dapat Anda akses."
                          control={
                            <NativeSelect
                              id="r2c-approval-outlet"
                              value={outletFilter}
                              onChange={(event) =>
                                setOutletFilter(event.target.value)
                              }
                            >
                              <NativeSelectOption value="">
                                Semua Outlet
                              </NativeSelectOption>
                              {organization?.outlets.map((outlet) => (
                                <NativeSelectOption
                                  key={outlet.id}
                                  value={outlet.id}
                                >
                                  {outlet.name}
                                </NativeSelectOption>
                              ))}
                            </NativeSelect>
                          }
                        />
                      </div>
                      <Button
                        variant="outline"
                        className="self-start"
                        aria-expanded={advancedFiltersOpen}
                        aria-controls="r2c-approval-advanced"
                        onClick={() => setAdvancedFiltersOpen((open) => !open)}
                      >
                        <SlidersHorizontal
                          aria-hidden="true"
                          data-icon="inline-start"
                        />
                        {advancedFiltersOpen
                          ? "Tutup filter lanjutan"
                          : "Filter lanjutan"}
                      </Button>
                      {advancedFiltersOpen ? (
                        <div
                          id="r2c-approval-advanced"
                          className="grid gap-3 rounded-[16px] border border-border bg-surface p-4 sm:grid-cols-2"
                        >
                          <LabeledControl
                            label="Dari tanggal"
                            control={
                              <Input
                                type="date"
                                value={from}
                                onChange={(event) =>
                                  setFrom(event.target.value)
                                }
                              />
                            }
                          />
                          <LabeledControl
                            label="Sampai tanggal"
                            control={
                              <Input
                                type="date"
                                value={to}
                                onChange={(event) => setTo(event.target.value)}
                              />
                            }
                          />
                          <LabeledControl
                            label="Kategori"
                            control={
                              <NativeSelect
                                value={typeFilter}
                                onChange={(event) => {
                                  setTypeFilter(event.target.value)
                                  setQueueCategory(
                                    event.target.value === "attendance_review"
                                      ? "attendance"
                                      : "requests"
                                  )
                                }}
                              >
                                <NativeSelectOption value="">
                                  Semua kategori
                                </NativeSelectOption>
                                <NativeSelectOption value="leave">
                                  Izin / sakit / cuti
                                </NativeSelectOption>
                                <NativeSelectOption value="overtime">
                                  Lembur
                                </NativeSelectOption>
                                <NativeSelectOption value="attendance_correction">
                                  Koreksi
                                </NativeSelectOption>
                                <NativeSelectOption value="attendance_review">
                                  Tinjauan presensi
                                </NativeSelectOption>
                              </NativeSelect>
                            }
                          />
                          <LabeledControl
                            label="Karyawan"
                            control={
                              <NativeSelect
                                value={employeeFilter}
                                onChange={(event) =>
                                  setEmployeeFilter(event.target.value)
                                }
                              >
                                <NativeSelectOption value="">
                                  Semua karyawan
                                </NativeSelectOption>
                                {employees.map((employee) => (
                                  <NativeSelectOption
                                    key={employee.id}
                                    value={employee.id}
                                  >
                                    {employee.name}
                                  </NativeSelectOption>
                                ))}
                              </NativeSelect>
                            }
                          />
                          <div className="flex flex-wrap gap-2 sm:col-span-2">
                            <Button
                              variant="outline"
                              type="submit"
                              disabled={busy}
                            >
                              Terapkan filter
                            </Button>
                            <Button
                              variant="outline"
                              disabled={busy || !employeeFilter}
                              onClick={() =>
                                void loadSelectedEmployeeProjection()
                              }
                            >
                              Lihat hasil kehadiran
                            </Button>
                          </div>
                        </div>
                      ) : null}
                    </form>
                    <p className="text-body [font-size:13px] text-muted-foreground">
                      Filter lanjutan: tanggal, kategori, dan karyawan. Pilihan
                      filter tetap tersimpan saat membuka detail.
                    </p>
                    <h2
                      className="text-subtitle [font-size:18px]"
                      aria-live="polite"
                    >
                      {visibleQueueRequests.length}{" "}
                      {queueCategory === "attendance"
                        ? statusFilter === "pending"
                          ? "tinjauan menunggu keputusan"
                          : "tinjauan pada filter"
                        : statusFilter === "pending"
                          ? "permintaan menunggu persetujuan"
                          : "permintaan pada filter"}
                    </h2>
                    {visibleQueueRequests.length ? (
                      visibleQueueRequests.map((item) => (
                        <ApprovalQueueItem
                          key={item.id}
                          subject={item.employee.name}
                          requestType={requestTitle(item)}
                          context={`${item.outlet?.name ?? "Organisasi"} · ${item.work_date ? workDateLabel(item.work_date) : `${item.starts_on ? workDateLabel(item.starts_on) : "—"} – ${item.ends_on ? workDateLabel(item.ends_on) : "—"}`} · ${requestReference(item.id)}`}
                          status={statusLabel(item)}
                          tone={
                            item.status === "approved"
                              ? "success"
                              : item.status === "rejected"
                                ? "danger"
                                : item.status === "cancelled"
                                  ? "neutral"
                                  : "warning"
                          }
                          selected={selectedId === item.id}
                          disabled={busy}
                          onSelect={() => {
                            queueTrigger.current =
                              document.activeElement instanceof HTMLElement
                                ? document.activeElement
                                : null
                            setSelectedId(item.id)
                            setHistoryOpen(false)
                            setDecisionReason("")
                            setActionError("")
                            setMobileSelectedOpen(true)
                          }}
                        />
                      ))
                    ) : (
                      <section
                        role="status"
                        className="flex flex-col items-center gap-3 rounded-[16px] border border-border bg-surface p-6 text-center"
                      >
                        <ClipboardCheck
                          aria-hidden="true"
                          className="text-primary"
                        />
                        <h3 className="text-label">
                          {queueCategory === "attendance"
                            ? "Tidak ada tinjauan pada filter ini"
                            : "Tidak ada permintaan pada filter ini"}
                        </h3>
                        <p className="text-body text-muted-foreground">
                          Periksa status, kategori, dan filter untuk
                          melihat item lain.
                        </p>
                      </section>
                    )}
                    <p className="text-body [font-size:13px] text-muted-foreground">
                      Pilih permintaan untuk melihat rincian dan tindakan yang
                      tersedia. Peran saja tidak memberi izin untuk memutus
                      setiap kasus.
                    </p>
                  </TabsContent>
                </Tabs>
              </section>
              {mobileSelectedOpen ? (
                <section
                  className="flex min-w-0 flex-col gap-4"
                  aria-label="Rincian Persetujuan"
                >
                  <div className="flex min-w-0 flex-wrap items-center gap-3">
                    <Button
                      variant="outline"
                      disabled={busy}
                      onClick={() => {
                        setMobileSelectedOpen(false)
                        requestAnimationFrame(() =>
                          queueTrigger.current?.focus()
                        )
                      }}
                    >
                      <ArrowLeft aria-hidden="true" data-icon="inline-start" />
                      Kembali ke daftar
                    </Button>
                    <p className="text-caption">
                      Persetujuan /{" "}
                      {selected
                        ? requestReference(selected.id)
                        : "Hasil kehadiran karyawan"}
                    </p>
                  </div>
                  {selected ? (
                    <>
                      <div className="self-start">
                        <StatusBadge
                          tone={
                            selected.status !== "pending"
                              ? "neutral"
                              : selected.can_decide
                                ? "success"
                                : "warning"
                          }
                        >
                          {selected.status !== "pending"
                            ? "Kasus sudah ditinjau"
                            : selected.can_decide
                              ? "Dapat diputus"
                              : "Tidak dapat memutus kasus ini"}
                        </StatusBadge>
                      </div>
                      <article className="flex min-w-0 flex-col gap-4 rounded-[16px] border border-border bg-surface p-4 md:p-6">
                        <h2
                          ref={detailHeading}
                          tabIndex={-1}
                          className="text-subtitle [font-size:21px] outline-none"
                        >
                          {selected.employee.name} · {requestTitle(selected)}
                        </h2>
                        <p className="whitespace-pre-line text-body text-muted-foreground">
                          {requestReference(selected.id)} ·{" "}
                          {statusLabel(selected)} ·{" "}
                          {selected.outlet?.name ?? "Organisasi"}
                          {"\n"}Tanggal kerja{" "}
                          {selected.work_date
                            ? workDateLabel(selected.work_date)
                            : `${selected.starts_on ? workDateLabel(selected.starts_on) : "—"} – ${selected.ends_on ? workDateLabel(selected.ends_on) : "—"}`}{" "}
                          {projection.find(
                            (day) =>
                              day.employee.id === selected.employee.id &&
                              day.work_date === selected.work_date
                          )?.schedule.timezone
                            ? ` · ${projection.find((day) => day.employee.id === selected.employee.id && day.work_date === selected.work_date)?.schedule.timezone}`
                            : ""}
                        </p>
                        {requestOnly ? <p role="status" className="text-caption text-muted-foreground">
                          Anda dapat meninjau permintaan dan bukti ini. Riwayat kehadiran lengkap memerlukan cakupan akses tersendiri.
                        </p> : null}
                        {selected.type === "attendance_correction" ? (
                          <CorrectionReview
                            item={selected}
                            projection={projection}
                            loading={detailLoading}
                          />
                        ) : null}
                        {selected.type === "attendance_correction" ? (
                          <CorrectionEvidencePanel
                            key={`evidence-${selected.id}`}
                            requestId={selected.id}
                            canRequireSupplement={selected.status === "pending" && selected.can_decide && selected.classification === "sensitive"}
                            decisions={selected.decision_history.filter(({ action }) =>
                              ["approved", "routine_applied", "rejected", "reversed"].includes(action)
                            )}
                            onSupplementChange={updateSupplement}
                          />
                        ) : null}
                        {reversibleDecision ? (
                          <CorrectionReversalForm
                            key={`reversal-${reversibleDecision.id}`}
                            requestId={selected.id}
                            decisionId={reversibleDecision.id}
                            onReversed={async () => {
                              setNotice("Koreksi dibalik. Tinjau kembali hasil yang sudah ditetapkan.")
                              await refreshQueue()
                            }}
                          />
                        ) : null}
                        {selected.reason ? (
                          <p className="whitespace-pre-wrap text-body">
                            {selected.reason}
                          </p>
                        ) : null}
                        {selected.type === "leave" ? (
                          <p className="text-caption">
                            Kategori:{" "}
                            {categoryLabel(
                              String(selected.details.category ?? "permission")
                            )}
                          </p>
                        ) : null}
                        {selected.type === "overtime" ? (
                          <div className="flex flex-col gap-1 rounded-[12px] bg-canvas p-3">
                            <p className="text-body">
                              {String(selected.details.starts_at ?? "")} —{" "}
                              {String(selected.details.ends_at ?? "")}
                            </p>
                            <p className="text-caption">
                              Durasi yang diminta{" "}
                              {String(selected.details.requested_minutes ?? 0)}{" "}
                              menit. Persetujuan tidak mengubah jam kerja
                              aktual.
                            </p>
                          </div>
                        ) : null}
                        {selected.type === "attendance_review" ? (
                          <ContextAlert title="Kasus tinjauan">
                            <p>
                              {caseLabel(
                                String(
                                  selected.details.case_type ??
                                    "attendance_exception"
                                )
                              )}
                            </p>
                            <p>
                              Indikator:{" "}
                              {(
                                (selected.details.indicators as
                                  | string[]
                                  | undefined) ?? []
                              )
                                .map(indicatorLabel)
                                .join(", ") || "Perlu keputusan manusia."}
                            </p>
                            {selected.details.schedule ? (
                              <ReviewSchedule
                                schedule={
                                  selected.details.schedule as Record<
                                    string,
                                    unknown
                                  >
                                }
                              />
                            ) : null}
                          </ContextAlert>
                        ) : null}
                        <p className="text-body [font-size:13px] text-muted-foreground">
                          Koreksi yang disetujui tidak menghapus catatan asli.
                          Lembur disetujui tetap terpisah dari durasi kerja
                          aktual.
                        </p>
                        {selected.status === "pending" ? (
                          <ContextAlert
                            title={
                              selected.can_decide
                                ? "Peninjau memenuhi syarat"
                                : "Peninjau lain diperlukan"
                            }
                            tone={selected.can_decide ? "success" : "warning"}
                            icon={
                              <ShieldCheck
                                aria-hidden="true"
                                size={18}
                                className="shrink-0"
                              />
                            }
                          >
                            {selected.can_decide
                              ? "Server mengizinkan keputusan untuk kasus ini. Kelayakan tetap diperiksa per kasus dan tidak ditentukan oleh peran saja."
                              : (selected.eligibility_reason ??
                                "Akun ini tidak dapat memutuskan kasus ini.")}
                          </ContextAlert>
                        ) : null}
                        <EvidenceAccess
                          actions={<EvidenceLinks item={selected} />}
                        />
                        {selected.status === "pending" ? (
                          <div className="flex flex-col gap-4">
                            <LabeledControl
                              label={
                                selected.type === "attendance_correction" ||
                                selected.type === "attendance_review"
                                  ? "Alasan keputusan · wajib"
                                  : "Alasan keputusan"
                              }
                              helper="Alasan dicatat di riwayat dan wajib untuk tinjauan, koreksi, atau penolakan."
                              control={
                                <Textarea
                                  id="decision-reason"
                                  required={
                                    selected.type === "attendance_correction" ||
                                    selected.type === "attendance_review"
                                  }
                                  maxLength={1000}
                                  disabled={busy || !selected.can_decide}
                                  onChange={(event) =>
                                    setDecisionReason(event.target.value)
                                  }
                                  placeholder="Tuliskan pertimbangan keputusan"
                                  value={decisionReason}
                                />
                              }
                            />
                            <div className="flex flex-wrap gap-2">
                              <Button
                                variant="destructive-outline"
                                disabled={
                                  busy ||
                                  !selected.can_decide ||
                                  !decisionReason.trim()
                                }
                                onClick={() => void applyDecision("rejected")}
                              >
                                <X
                                  aria-hidden="true"
                                  data-icon="inline-start"
                                />
                                Tolak
                              </Button>
                              <Button
                                disabled={
                                  busy ||
                                  !selected.can_decide ||
                                  supplementBlockedId === selected.id ||
                                  ((selected.type === "attendance_correction" ||
                                    selected.type === "attendance_review") &&
                                    !decisionReason.trim())
                                }
                                onClick={() => void applyDecision("approved")}
                              >
                                <Check
                                  aria-hidden="true"
                                  data-icon="inline-start"
                                />
                                {busy
                                  ? "Menyimpan…"
                                  : selected.type === "attendance_correction"
                                    ? "Setujui koreksi"
                                    : "Setujui"}
                              </Button>
                              <Button
                                variant="outline"
                                aria-expanded={historyOpen}
                                aria-controls="r2c-decision-history"
                                onClick={() => setHistoryOpen((open) => !open)}
                              >
                                <History
                                  aria-hidden="true"
                                  data-icon="inline-start"
                                />
                                Riwayat keputusan ·{" "}
                                {selected.decision_history.length}
                              </Button>
                            </div>
                          </div>
                        ) : null}
                        {selected.status !== "pending" ? (
                          <Button
                            variant="outline"
                            className="self-start"
                            aria-expanded={historyOpen}
                            aria-controls="r2c-decision-history"
                            onClick={() => setHistoryOpen((open) => !open)}
                          >
                            <History
                              aria-hidden="true"
                              data-icon="inline-start"
                            />
                            Riwayat keputusan ·{" "}
                            {selected.decision_history.length}
                          </Button>
                        ) : null}
                        {historyOpen ? (
                          <section
                            id="r2c-decision-history"
                            className="min-w-0"
                          >
                            <ol className="flex flex-col gap-2 pt-2">
                              {selected.decision_history.map((decision) => (
                                <li
                                  key={decision.id}
                                  className="flex min-w-0 flex-col gap-1 rounded-[12px] bg-canvas p-3 text-caption"
                                >
                                  <p>
                                    {decisionLabel(decision.action)} · Pengguna #
                                    {decision.actor_user_id} ·{" "}
                                    {formatDate(decision.acted_at)}
                                  </p>
                                  {decision.reason ? (
                                    <p>{decision.reason}</p>
                                  ) : null}
                                  {decision.original_values ||
                                  decision.proposed_values ||
                                  decision.effective_values ? (
                                    <details>
                                      <summary className="min-h-11 cursor-pointer py-3">
                                        Nilai sumber dan keputusan
                                      </summary>
                                      <pre className="whitespace-pre-wrap break-all text-caption">
                                        {JSON.stringify(
                                          {
                                            original: decision.original_values,
                                            proposed: decision.proposed_values,
                                            effective:
                                              decision.effective_values,
                                          },
                                          null,
                                          2
                                        )}
                                      </pre>
                                    </details>
                                  ) : null}
                                </li>
                              ))}
                            </ol>
                            {!selected.decision_history.length ? (
                              <p className="text-caption">
                                Belum ada keputusan tercatat.
                              </p>
                            ) : null}
                          </section>
                        ) : null}
                      </article>
                      {projection.length ? (
                        <section className="flex flex-col gap-3 rounded-[16px] border border-border bg-surface p-5">
                          <h3 className="text-subtitle [font-size:17px]">
                            {projection.every((day) => day.is_finalized)
                              ? "Hasil telah ditetapkan"
                              : `Belum ditetapkan · ${projection.reduce((n, day) => n + day.unresolved_conflicts.length, 0)} konflik belum selesai`}
                          </h3>
                          <p className="text-body text-muted-foreground">
                            Selesaikan konflik dan periksa pratinjau sebelum
                            menetapkan hasil. Hasil dan alasan tercatat di
                            riwayat.
                          </p>
                        </section>
                      ) : null}
                      <details className="min-w-0 rounded-[16px] border border-border bg-surface p-4">
                        <summary className="flex min-h-11 cursor-pointer items-center text-label text-brand-700">
                          Rincian dan penetapan hasil
                        </summary>
                        <div className="pt-4">
                          <ProjectionPanel
                            projection={projection}
                            allowHistoricalComparison={isOwner}
                            detailLoading={detailLoading}
                            busy={busy}
                            outcome={finalizationOutcome}
                            reason={finalizationReason}
                            onOutcome={setFinalizationOutcome}
                            onReason={setFinalizationReason}
                            onFinalize={(day, outcome) =>
                              void finalize(day, outcome)
                            }
                          />
                        </div>
                      </details>
                    </>
                  ) : (
                    <>
                      <h2
                        ref={detailHeading}
                        tabIndex={-1}
                        className="text-subtitle outline-none"
                      >
                        Hasil kehadiran karyawan
                      </h2>
                      <ProjectionPanel
                        projection={projection}
                        allowHistoricalComparison={isOwner}
                        detailLoading={detailLoading}
                        busy={busy}
                        outcome={finalizationOutcome}
                        reason={finalizationReason}
                        onOutcome={setFinalizationOutcome}
                        onReason={setFinalizationReason}
                        onFinalize={(day, outcome) =>
                          void finalize(day, outcome)
                        }
                      />
                    </>
                  )}
                </section>
              ) : null}
            </div>
          </main>
        </div>
      </div>
    </SidebarProvider>
  )
}

export function CorrectionReversalForm({
  requestId, decisionId, onReversed,
}: {
  requestId: number
  decisionId: number
  onReversed: () => Promise<void>
}) {
  const [reason, setReason] = useState("")
  const [busy, setBusy] = useState(false)
  const [complete, setComplete] = useState(false)
  const [error, setError] = useState("")
  const attempt = useRef<{ reason: string; key: string } | null>(null)
  const id = `reversal-reason-${requestId}`

  async function reverse(event: React.FormEvent) {
    event.preventDefault()
    if (!reason.trim() || busy || complete) return
    const normalized = reason.trim()
    if (attempt.current?.reason !== normalized) {
      attempt.current = { reason: normalized, key: crypto.randomUUID() }
    }
    setBusy(true)
    setError("")
    try {
      await apiRequest(`/management/approvals/${requestId}/reversal`, {
        method: "POST",
        headers: { "Idempotency-Key": attempt.current.key },
        body: { decision_id: decisionId, reason: normalized },
      })
      setComplete(true)
      await onReversed()
    } catch (caught) {
      setError(caught instanceof ApiError
        ? caught.errors?.decision_id?.[0] ?? caught.errors?.reason?.[0] ?? caught.message
        : "Pembalikan belum dapat dipastikan. Coba lagi dengan alasan yang sama.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <details>
      <summary className="cursor-pointer text-label">Balikkan koreksi</summary>
      <form onSubmit={reverse} className="mt-3 flex flex-col gap-3">
        <p className="text-caption">Keputusan #{decisionId}. Koreksi lanjutan yang masih berlaku harus dibalik terlebih dahulu.</p>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor={id}>Alasan pembalikan</FieldLabel>
            <Textarea id={id} required maxLength={1000} disabled={busy || complete} value={reason} onChange={(event) => setReason(event.target.value)} />
          </Field>
        </FieldGroup>
        {error ? <p role="alert" className="text-caption text-danger-strong">{error}</p> : null}
        <Button type="submit" className="self-start" variant="destructive-outline" disabled={busy || complete || !reason.trim()}>
          Konfirmasi pembalikan
        </Button>
      </form>
    </details>
  )
}

export function CorrectionRetentionSettings() {
  const path = "/management/correction-evidence/retention"
  const [days, setDays] = useState("")
  const [saved, setSaved] = useState<number | null>(null)
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")
  const [reload, setReload] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    apiRequest<{ days: number }>(path, { signal: controller.signal })
      .then((result) => {
        if (controller.signal.aborted) return
        setDays(String(result.days))
        setSaved(result.days)
        setBusy(false)
      })
      .catch((caught: unknown) => {
        if (controller.signal.aborted) return
        setError(
          caught instanceof ApiError
            ? caught.message
            : "Pengaturan retensi belum dapat dimuat."
        )
        setBusy(false)
      })
    return () => controller.abort()
  }, [reload])

  async function save(event: React.FormEvent) {
    event.preventDefault()
    const value = Number(days)
    if (
      busy ||
      saved === null ||
      !Number.isInteger(value) ||
      value < 90 ||
      value > 1825
    )
      return
    setBusy(true)
    setError("")
    setNotice("")
    try {
      const result = await apiRequest<{ days: number }>(path, {
        method: "PUT",
        body: { days: value },
      })
      setSaved(result.days)
      setDays(String(result.days))
      setEditing(false)
      setNotice("Retensi bukti tersimpan.")
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught.message
          : "Retensi bukti belum dapat disimpan."
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={save} className="flex max-w-md flex-col gap-3">
      {saved !== null && !editing ? (
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-body">Masa simpan bukti {saved} hari.</p>
          <Button
            type="button"
            variant="outline"
            onClick={() => setEditing(true)}
          >
            Ubah retensi
          </Button>
        </div>
      ) : (
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="correction-retention-days">
              Masa simpan bukti (hari)
            </FieldLabel>
            <Input
              id="correction-retention-days"
              type="number"
              min={90}
              max={1825}
              step={1}
              required
              value={days}
              disabled={busy || saved === null}
              onChange={(event) => setDays(event.target.value)}
            />
            <p className="text-caption text-muted-foreground">
              90–1.825 hari. Perubahan berlaku untuk unggahan baru.
            </p>
          </Field>
        </FieldGroup>
      )}
      {error ? (
        <p role="alert" className="text-caption text-danger-strong">
          {error}
        </p>
      ) : null}
      <p role="status" className="text-caption">
        {notice}
      </p>
      {saved === null && error ? (
        <Button
          type="button"
          className="self-start"
          variant="outline"
          onClick={() => {
            setBusy(true)
            setError("")
            setReload((value) => value + 1)
          }}
        >
          Muat ulang pengaturan
        </Button>
      ) : editing ? (
        <div className="flex flex-wrap gap-2">
          <Button
            type="submit"
            variant="outline"
            disabled={busy || saved === null || Number(days) === saved}
          >
            Simpan retensi
          </Button>
          <Button
            type="button"
            variant="ghost"
            disabled={busy}
            onClick={() => {
              setDays(String(saved))
              setEditing(false)
              setError("")
            }}
          >
            Batal
          </Button>
        </div>
      ) : null}
    </form>
  )
}

export function HistoricalComparison({ day }: { day: EffectiveDay }) {
  const [revision, setRevision] = useState(
    String(day.finalization?.revision ?? 1)
  )
  const [result, setResult] = useState<{
    revision: number
    snapshot: {
      outcome?: string
      effective_duration_seconds?: number | null
      actual_duration_seconds?: number | null
    }
  } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const id = `compare-revision-${day.employee.id}-${day.work_date}`
  async function compare(event: React.FormEvent) {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    setError("")
    setResult(null)
    try {
      const query = new URLSearchParams({
        employee_id: String(day.employee.id),
        from: day.work_date,
        to: day.work_date,
        compare_revision: revision,
      })
      const payload = await apiRequest<{
        historical_comparison: NonNullable<typeof result>
      }>(`/management/attendance/effective?${query}`)
      setResult(payload.historical_comparison)
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught.message
          : "Perbandingan riwayat belum dapat dimuat."
      )
    } finally {
      setBusy(false)
    }
  }
  return (
    <details className="mb-3">
      <summary className="min-h-11 cursor-pointer text-label">
        Bandingkan riwayat penetapan hasil
      </summary>
      <form onSubmit={compare} className="mt-3 flex flex-col gap-3">
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor={id}>Revisi penetapan hasil</FieldLabel>
            <Input
              id={id}
              type="number"
              required
              min={1}
              max={day.finalization?.revision}
              step={1}
              value={revision}
              disabled={busy}
              onChange={(event) => setRevision(event.target.value)}
            />
          </Field>
        </FieldGroup>
        <Button
          type="submit"
          variant="outline"
          className="self-start"
          disabled={busy}
        >
          {busy ? "Memuat perbandingan…" : "Bandingkan revisi"}
        </Button>
      </form>
      {error ? (
        <p role="alert" className="text-caption text-danger-strong">
          {error}
        </p>
      ) : null}
      {result ? (
        <div role="status" className="mt-3 flex flex-col gap-2 text-caption">
          <p>
            Revisi {result.revision} ·{" "}
            {outcomeLabel(result.snapshot.outcome ?? "")}
          </p>
          <p>
            Durasi efektif saat ditetapkan{" "}
            {formatDuration(result.snapshot.effective_duration_seconds ?? null)}{" "}
            · saat ini {formatDuration(day.effective_duration_seconds)}
          </p>
          <p>
            Durasi aktual saat ditetapkan{" "}
            {formatDuration(result.snapshot.actual_duration_seconds ?? null)} ·
            saat ini {formatDuration(day.actual_duration_seconds)}
          </p>
        </div>
      ) : null}
    </details>
  )
}

function ProjectionPanel({
  projection,
  allowHistoricalComparison = false,
  detailLoading,
  busy,
  outcome,
  reason,
  onOutcome,
  onReason,
  onFinalize,
}: {
  projection: EffectiveDay[]
  allowHistoricalComparison?: boolean
  detailLoading: boolean
  busy: boolean
  outcome: string
  reason: string
  onOutcome: (value: string) => void
  onReason: (value: string) => void
  onFinalize: (day: EffectiveDay, outcome: string) => void
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Pratinjau hasil kehadiran</CardTitle>
        <CardDescription>
          Hasil merangkum sesi presensi, keputusan, jadwal, dan tinjauan.
          Penetapan sebelumnya tetap tercatat di riwayat.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {detailLoading ? (
          <p className="text-body text-muted-foreground">Memuat hasil kehadiran…</p>
        ) : null}
        {projection.map((day) => (
          <article className="rounded-2xl border p-4" key={day.work_date}>
            {allowHistoricalComparison && day.finalization ? (
              <HistoricalComparison key={day.finalization.id} day={day} />
            ) : null}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-label">
                {day.work_date} · {day.outlet?.name ?? "Tanpa Outlet"}
              </p>
              <Badge
                variant={
                  day.review.status === "pending" ? "outline" : "secondary"
                }
              >
                {day.review.status === "pending"
                  ? "Menunggu tinjauan"
                  : outcomeLabel(day.outcome)}
              </Badge>
            </div>
            <p className="mt-2 text-caption">
              Jadwal: {day.schedule.status}
              {day.schedule.scheduled_start
                ? ` · ${formatDate(day.schedule.scheduled_start, day.schedule.timezone ?? undefined)} – ${formatDate(day.schedule.scheduled_end, day.schedule.timezone ?? undefined)}`
                : ""}
            </p>
            {day.sessions.length ? (
              day.sessions.map((attendance) => (
                <div
                  className="mt-3 flex flex-col gap-2 border-t pt-3"
                  key={attendance.id}
                >
                  <p className="text-caption">
                    Sesi #{attendance.id} · Asli:{" "}
                    {formatDate(
                      attendance.original.check_in_at,
                      day.schedule.timezone ?? undefined
                    )}{" "}
                    —{" "}
                    {attendance.original.check_out_at
                      ? formatDate(
                          attendance.original.check_out_at,
                          day.schedule.timezone ?? undefined
                        )
                      : "presensi keluar belum dicatat"}
                  </p>
                  <p className="text-caption">
                    Efektif:{" "}
                    {formatDate(
                      attendance.effective.check_in_at,
                      day.schedule.timezone ?? undefined
                    )}{" "}
                    —{" "}
                    {attendance.effective.check_out_at
                      ? formatDate(
                          attendance.effective.check_out_at,
                          day.schedule.timezone ?? undefined
                        )
                      : "belum ditentukan"}{" "}
                    · {formatDuration(attendance.effective.duration_seconds)}
                  </p>
                  {attendance.original.events.some(
                    (event) => event.has_evidence
                  ) ? (
                    <EvidenceAccess
                      actions={
                        <div className="flex flex-wrap gap-2">
                          {attendance.original.events
                            .filter((event) => event.has_evidence)
                            .map((event) => (
                              <Button
                                key={event.id}
                                variant="outline"
                                render={
                                  <a
                                    href={apiUrl(`/management/attendance/events/${event.id}/evidence`)}
                                    referrerPolicy="strict-origin"
                                    rel="noopener"
                                    target="_blank"
                                  />
                                }
                              >
                                <ArrowUpRight
                                  aria-hidden="true"
                                  data-icon="inline-start"
                                />
                                Bukti peristiwa #{event.id}
                              </Button>
                            ))}
                        </div>
                      }
                    />
                  ) : null}
                </div>
              ))
            ) : (
              <p className="mt-2 text-caption text-muted-foreground">
                Tidak ada peristiwa presensi pada tanggal ini.
              </p>
            )}
            {day.conflicts.length ? (
              <p className="mt-3 text-caption text-danger-strong">
                Temuan: {day.conflicts.map(indicatorLabel).join(", ")}
              </p>
            ) : null}
            {day.overtime_requests.some(
              (request) => request.status === "approved"
            ) ? (
              <p className="mt-1 text-caption">
                Lembur disetujui dan tetap terpisah dari durasi aktual.
              </p>
            ) : null}
            {day.is_finalized ? (
              <p className="mt-2 text-caption text-muted-foreground">
                Penetapan hasil · revisi {day.finalization?.revision}:{" "}
                {outcomeLabel(day.finalization?.outcome ?? "")}.{" "}
                {day.finalization?.reason}
              </p>
            ) : day.unresolved_conflicts.length ? (
              <p className="mt-2 text-caption text-muted-foreground">
                Belum dapat ditetapkan:{" "}
                {day.unresolved_conflicts.map(indicatorLabel).join(", ")}
              </p>
            ) : (
              <FinalizationForm
                day={day}
                busy={busy}
                outcome={outcome}
                reason={reason}
                onOutcome={onOutcome}
                onReason={onReason}
                onSubmit={(selectedOutcome) => onFinalize(day, selectedOutcome)}
              />
            )}
          </article>
        ))}
        {!detailLoading && !projection.length ? (
          <p className="rounded-2xl border border-dashed p-5 text-center text-caption text-muted-foreground">
            Belum ada hasil kehadiran untuk tanggal kasus ini.
          </p>
        ) : null}
      </CardContent>
    </Card>
  )
}

function FinalizationForm({
  day,
  busy,
  outcome,
  reason,
  onOutcome,
  onReason,
  onSubmit,
}: {
  day: EffectiveDay
  busy: boolean
  outcome: string
  reason: string
  onOutcome: (value: string) => void
  onReason: (value: string) => void
  onSubmit: (value: string) => void
}) {
  const outcomes =
    day.outcome === "confirmed_absence_pending_finalization"
      ? ["absence"]
      : day.outcome === "present"
        ? ["present"]
        : day.outcome === "exceptional_attendance"
          ? ["exceptional_attendance"]
          : day.outcome === "leave"
            ? ["leave"]
            : day.outcome === "sick"
              ? ["sick"]
              : day.outcome === "permission"
                ? ["permission"]
                : []
  if (!outcomes.length || day.is_finalized || day.unresolved_conflicts.length)
    return null
  const selectedOutcome = outcomes.includes(outcome) ? outcome : outcomes[0]
  return (
    <form
      className="mt-4 flex flex-col gap-3 border-t pt-4"
      onSubmit={(event) => {
        event.preventDefault()
        onSubmit(selectedOutcome)
      }}
    >
      <p className="text-label">Tetapkan hasil</p>
      <Field>
        <FieldLabel htmlFor={`final-outcome-${day.work_date}`}>
          Hasil
        </FieldLabel>
        <NativeSelect
          id={`final-outcome-${day.work_date}`}
          onChange={(event) => onOutcome(event.target.value)}
          value={selectedOutcome}
        >
          {outcomes.map((item) => (
            <NativeSelectOption key={item} value={item}>
              {outcomeLabel(item)}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </Field>
      <Field>
        <FieldLabel htmlFor={`final-reason-${day.work_date}`}>
          Alasan penetapan hasil
        </FieldLabel>
        <Textarea
          id={`final-reason-${day.work_date}`}
          maxLength={1000}
          onChange={(event) => onReason(event.target.value)}
          required
          value={reason}
        />
      </Field>
      <Button disabled={busy || !reason.trim()} type="submit" variant="outline">
        Tetapkan hasil
      </Button>
    </form>
  )
}

function ReviewSchedule({ schedule }: { schedule: Record<string, unknown> }) {
  const status = String(schedule.status ?? "unscheduled")
  const start =
    typeof schedule.scheduled_start === "string"
      ? schedule.scheduled_start
      : null
  const end =
    typeof schedule.scheduled_end === "string" ? schedule.scheduled_end : null
  const shift =
    schedule.shift && typeof schedule.shift === "object"
      ? (schedule.shift as Record<string, unknown>)
      : null
  return (
    <div className="mt-2 rounded-lg bg-background/70 p-3 text-caption">
      <p>
        Jadwal:{" "}
        {status === "scheduled"
          ? "terjadwal"
          : status === "rest"
            ? "hari istirahat"
            : "tidak terjadwal"}
        {shift?.name ? ` · ${String(shift.name)}` : ""}
      </p>
      {start ? (
        <p className="text-muted-foreground">
          {formatDate(start)}
          {end ? ` – ${formatDate(end)}` : ""}
        </p>
      ) : null}
    </div>
  )
}

function CorrectionReview({
  item,
  projection,
  loading,
}: {
  item: ApprovalItem
  projection: EffectiveDay[]
  loading: boolean
}) {
  const originalValue =
    (item.details.original as Record<string, unknown> | undefined) ??
    item.correction?.original_values
  const original =
    (originalValue?.recorded as Record<string, unknown> | undefined) ??
    originalValue
  const proposed =
    (item.details.proposed as Record<string, unknown> | undefined) ??
    item.correction?.proposed_values
  const sourceDay = projection.find(
    (day) =>
      day.employee.id === item.employee.id &&
      day.sessions.some(
        (session) => session.id === Number(item.details.attendance_session_id)
      )
  )
  const timezone = sourceDay?.schedule.timezone ?? undefined
  const session = projection
    .filter((day) => day.employee.id === item.employee.id)
    .flatMap((day) => day.sessions)
    .find(
      (session) => session.id === Number(item.details.attendance_session_id)
    )
  const clock = (value: unknown) => {
    if (typeof value !== "string") return "—"
    const date = new Date(value)
    return Number.isNaN(date.valueOf())
      ? "—"
      : new Intl.DateTimeFormat("en-GB", {
          hour: "2-digit",
          minute: "2-digit",
          timeZone: timezone,
        }).format(date)
  }
  const range = (values: Record<string, unknown> | undefined) =>
    `${clock(values?.check_in_at)}–${clock(values?.check_out_at)}`
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <AttendanceProjection
        original={loading ? "Memuat konteks waktu…" : range(original)}
        effective={
          loading
            ? "Memuat hasil saat ini…"
            : session
              ? range(session.effective)
              : "Hasil saat ini belum tersedia"
        }
        proposed={loading ? "Memuat konteks waktu…" : range(proposed)}
        pending={item.status === "pending"}
      />
      <p className="text-caption">
        Asli: {String(original?.work_date ?? item.work_date ?? "—")} · Outlet #
        {String(original?.outlet_id ?? item.outlet?.id ?? "—")}. Usulan:{" "}
        {String(proposed?.work_date ?? item.work_date ?? "—")} · Outlet #
        {String(proposed?.outlet_id ?? item.outlet?.id ?? "—")} ·{" "}
        {item.classification === "sensitive"
          ? "Koreksi sensitif"
          : "Koreksi rutin"}
        . Jam: {timezone ?? "zona perangkat"}.
      </p>
    </div>
  )
}

function EvidenceLinks({ item }: { item: ApprovalItem }) {
  const events =
    (item.details.events as
      | Array<{ id: number; has_evidence?: boolean }>
      | undefined) ?? []
  if (!events.some((event) => event.has_evidence))
    return (
      <p className="text-caption text-muted-foreground">
        Tidak ada foto yang terkait dengan kasus ini. Bukti sesi tersedia pada
        rincian lengkap jika izin Anda mengizinkan.
      </p>
    )
  return (
    <div className="flex flex-wrap gap-3">
      {events
        .filter((event) => event.has_evidence)
        .map((event) => (
          <Button
            key={event.id}
            variant="outline"
            render={
              <a
                href={apiUrl(`/management/attendance/events/${event.id}/evidence`)}
                referrerPolicy="strict-origin"
                rel="noopener"
                target="_blank"
              />
            }
          >
            <ArrowUpRight aria-hidden="true" data-icon="inline-start" />
            Buka bukti peristiwa #{event.id}
          </Button>
        ))}
    </div>
  )
}

function requestReference(id: number) {
  return `REQ-${String(id).padStart(3, "0")}`
}

function requestTitle(item: ApprovalItem) {
  if (item.type === "attendance_correction") return "Koreksi presensi"
  if (item.type === "overtime") return "Permintaan lembur"
  if (item.type === "attendance_review")
    return `Tinjauan: ${caseLabel(String(item.details.case_type ?? "kehadiran"))}`
  return `Permintaan ${categoryLabel(String(item.details.category ?? "permission"))}`
}
function categoryLabel(category: string) {
  return (
    (
      { permission: "izin", sick: "sakit", annual: "cuti" } as Record<
        string,
        string
      >
    )[category] ?? category
  )
}
function caseLabel(type: string) {
  return (
    (
      {
        potential_absence: "potensi tidak hadir",
        missing_checkout: "presensi keluar belum tercatat",
        attendance_exception: "indikator kehadiran",
        leave_attendance_conflict: "izin berbenturan dengan kehadiran",
      } as Record<string, string>
    )[type] ?? type.replaceAll("_", " ")
  )
}
function statusLabel(item: ApprovalItem) {
  if (item.reversed) return "Dibalik"
  if (item.status === "pending") {
    return item.type === "attendance_review"
      ? "Menunggu tinjauan"
      : "Menunggu persetujuan"
  }
  return (
    {
      approved: "Disetujui",
      rejected: "Ditolak",
      cancelled: "Dibatalkan",
    } as const
  )[item.status]
}
function decisionLabel(action: string) {
  return (
    (
      {
        approved: "Disetujui",
        rejected: "Ditolak",
        cancelled: "Dibatalkan",
        routine_applied: "Koreksi rutin diterapkan",
        reversed: "Koreksi dibalik",
        review_accepted: "Tinjauan diterima",
        review_rejected: "Tinjauan ditolak",
      } as Record<string, string>
    )[action] ?? action
  )
}
function outcomeLabel(outcome: string) {
  return (
    (
      {
        present: "Hadir",
        leave: "Cuti",
        sick: "Sakit",
        permission: "Izin",
        absence: "Tidak hadir",
        exceptional_attendance: "Kehadiran khusus",
        potential_absence: "Potensi tidak hadir",
        confirmed_absence_pending_finalization:
          "Ketidakhadiran terkonfirmasi · menunggu penetapan hasil",
        no_recorded_outcome: "Belum ada hasil kehadiran",
      } as Record<string, string>
    )[outcome] ?? outcome
  )
}
function indicatorLabel(indicator: string) {
  return (
    (
      {
        potential_absence: "potensi tidak hadir",
        missing_checkout: "presensi keluar belum tercatat",
        unscheduled_work: "kerja di luar jadwal",
        rest_day_work: "kerja pada hari libur",
        outlet_closed: "outlet tutup",
        location_outside_range: "lokasi di luar area",
        approved_leave_with_recorded_attendance:
          "izin berbenturan dengan kehadiran",
        attendance_review_required: "perlu tinjauan",
        pending_attendance_correction: "koreksi menunggu",
      } as Record<string, string>
    )[indicator] ?? indicator.replaceAll("_", " ")
  )
}
function formatDate(value: string | null, timeZone?: string) {
  if (!value || value === "null") return "—"
  const date = new Date(value)
  return Number.isNaN(date.valueOf())
    ? "—"
    : date.toLocaleString("id-ID", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone,
      })
}
function formatDuration(seconds: number | null) {
  if (seconds === null) return "belum ditentukan"
  return `${Math.floor(seconds / 3600)}j ${Math.floor((seconds % 3600) / 60)}m`
}
