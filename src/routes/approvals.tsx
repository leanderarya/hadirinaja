import { createFileRoute } from "@tanstack/react-router"
import { useCallback, useEffect, useMemo, useState } from "react"

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
import { Textarea } from "@/components/ui/textarea"
import {
  ApiError,
  type AuthSession,
  apiRequest,
  type OrganizationSummary,
} from "@/lib/api"

export const Route = createFileRoute("/approvals")({ component: ApprovalsPage })

type ApprovalItem = {
  id: number
  type: "leave" | "overtime" | "attendance_correction" | "attendance_review"
  status: "pending" | "approved" | "rejected" | "cancelled"
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
  const [employees, setEmployees] = useState<
    Array<{ id: number; name: string }>
  >([])
  const [queue, setQueue] = useState<QueueData | null>(null)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [projection, setProjection] = useState<EffectiveDay[]>([])
  const [loading, setLoading] = useState(true)
  const [detailLoading, setDetailLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")
  const [statusFilter, setStatusFilter] = useState("pending")
  const [typeFilter, setTypeFilter] = useState("")
  const [outletFilter, setOutletFilter] = useState("")
  const [employeeFilter, setEmployeeFilter] = useState("")
  const [from, setFrom] = useState(dateAgo(13))
  const [to, setTo] = useState(today())
  const [decisionReason, setDecisionReason] = useState("")
  const [finalizationOutcome, setFinalizationOutcome] = useState("present")
  const [finalizationReason, setFinalizationReason] = useState("")

  const selected = useMemo(
    () => queue?.requests.find((item) => item.id === selectedId) ?? null,
    [queue, selectedId]
  )

  async function loadSelectedEmployeeProjection() {
    if (!employeeFilter) {
      setError("Pilih karyawan untuk menampilkan proyeksi kehadiran.")
      return
    }
    setSelectedId(null)
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
          : "Proyeksi efektif belum dapat dimuat."
      )
      setProjection([])
    } finally {
      setDetailLoading(false)
    }
  }

  const refreshQueue = useCallback(async () => {
    const params = new URLSearchParams()
    if (statusFilter) params.set("status", statusFilter)
    if (typeFilter) params.set("type", typeFilter)
    if (outletFilter) params.set("outlet_id", outletFilter)
    if (employeeFilter) params.set("employee_id", employeeFilter)
    if (from) params.set("from", from)
    if (to) params.set("to", to)
    const result = await apiRequest<QueueData>(
      `/management/approvals?${params.toString()}`
    )
    setQueue(result)
    setSelectedId((current) =>
      current && result.requests.some((item) => item.id === current)
        ? current
        : (result.requests[0]?.id ?? null)
    )
  }, [employeeFilter, from, outletFilter, statusFilter, to, typeFilter])

  const refresh = useCallback(async () => {
    setError("")
    try {
      const currentSession = await apiRequest<AuthSession>("/auth/me")
      if (!currentSession.active_membership) {
        window.location.assign("/select-tenant")
        return
      }
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
          : "Approval Center belum dapat dimuat."
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
      return
    }
    const first = selected.work_date ?? selected.starts_on
    const last = selected.ends_on ?? selected.work_date ?? selected.starts_on
    if (!first || !last) {
      setProjection([])
      return
    }
    let cancelled = false
    setDetailLoading(true)
    setError("")
    apiRequest<{ attendance: EffectiveDay[] }>(
      `/management/attendance/effective?employee_id=${selected.employee.id}&from=${first}&to=${last}`
    )
      .then((result) => {
        if (!cancelled) setProjection(result.attendance)
      })
      .catch((caught: unknown) => {
        if (!cancelled)
          setError(
            caught instanceof ApiError
              ? caught.message
              : "Proyeksi efektif belum dapat dimuat."
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
    if (!selected) return
    setBusy(true)
    setError("")
    setNotice("")
    try {
      const result = await apiRequest<{ request: ApprovalItem }>(
        `/management/approvals/${selected.id}/decision`,
        {
          method: "POST",
          headers: { "Idempotency-Key": window.crypto.randomUUID() },
          body: { decision, reason: decisionReason || undefined },
        }
      )
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
          "Review diterima. Hasil tetap menunggu finalisasi yang eksplisit."
        )
      }
    } catch (caught) {
      setError(
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
    setError("")
    setNotice("")
    try {
      await apiRequest("/management/attendance/finalizations", {
        method: "POST",
        body: {
          employee_id: day.employee.id,
          work_date: day.work_date,
          outcome,
          reason: finalizationReason,
        },
      })
      setNotice(
        `Kehadiran ${day.work_date} difinalisasi dengan jejak sumber dan keputusan.`
      )
      setFinalizationReason("")
      await refreshQueue()
      const result = await apiRequest<{ attendance: EffectiveDay[] }>(
        `/management/attendance/effective?employee_id=${day.employee.id}&from=${day.work_date}&to=${day.work_date}`
      )
      setProjection(result.attendance)
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught.message
          : "Hasil belum dapat difinalisasi."
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
        Memuat Approval Center…
      </main>
    )
  }

  return (
    <SidebarProvider>
      <div className="flex min-h-svh w-full bg-muted/20">
        <ManagementSidebar activePage="approvals" />
        <div className="min-w-0 flex-1">
          <header className="flex min-h-14 flex-wrap items-center gap-3 border-b bg-background px-4 py-2 lg:min-h-[60px] lg:px-6">
            <SidebarTrigger className="-ml-1" />
            <Breadcrumb className="min-w-0 flex-1">
              <BreadcrumbList>
                <BreadcrumbItem>
                  <BreadcrumbPage className="truncate font-semibold">
                    {organization?.tenant.name ?? "Organisasi"}
                  </BreadcrumbPage>
                </BreadcrumbItem>
              </BreadcrumbList>
            </Breadcrumb>
            <Button
              onClick={() => window.location.assign("/select-tenant")}
              variant="outline"
            >
              Ganti organisasi
            </Button>
            <Button onClick={logout} variant="ghost">
              Keluar
            </Button>
          </header>

          <main className="space-y-5 p-4 lg:p-6">
            <section className="flex flex-wrap items-end justify-between gap-3">
              <div className="space-y-1">
                <p className="text-label text-muted-foreground">Operasional</p>
                <h1 className="text-title">Approval Center</h1>
                <p className="text-body text-muted-foreground">
                  Kasus hanya menampilkan karyawan dan Outlet dalam cakupan akun
                  aktif.
                </p>
              </div>
              <Card className="min-w-36">
                <CardContent className="flex flex-col gap-1 p-4">
                  <span className="text-caption text-muted-foreground">
                    Menunggu keputusan
                  </span>
                  <span className="text-title">
                    {queue?.pending_count ?? 0}
                  </span>
                </CardContent>
              </Card>
            </section>

            {error ? (
              <Alert variant="destructive">
                <AlertTitle>Belum berhasil</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}
            {notice ? (
              <Alert>
                <AlertTitle>Perubahan tersimpan</AlertTitle>
                <AlertDescription>{notice}</AlertDescription>
              </Alert>
            ) : null}

            <Card>
              <CardHeader>
                <CardTitle>Filter kasus</CardTitle>
                <CardDescription>
                  Supervisor hanya dapat memilih Outlet yang ditugaskan secara
                  eksplisit.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <form
                  className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6"
                  onSubmit={(event) => {
                    event.preventDefault()
                    void refreshQueue()
                  }}
                >
                  <Field>
                    <FieldLabel htmlFor="approval-status">Status</FieldLabel>
                    <NativeSelect
                      id="approval-status"
                      onChange={(event) => setStatusFilter(event.target.value)}
                      value={statusFilter}
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
                      <NativeSelectOption value="">Semua</NativeSelectOption>
                    </NativeSelect>
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="approval-type">Kategori</FieldLabel>
                    <NativeSelect
                      id="approval-type"
                      onChange={(event) => setTypeFilter(event.target.value)}
                      value={typeFilter}
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
                        Review kehadiran
                      </NativeSelectOption>
                    </NativeSelect>
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="approval-outlet">Outlet</FieldLabel>
                    <NativeSelect
                      id="approval-outlet"
                      onChange={(event) => setOutletFilter(event.target.value)}
                      value={outletFilter}
                    >
                      <NativeSelectOption value="">
                        Semua Outlet
                      </NativeSelectOption>
                      {organization?.outlets.map((outlet) => (
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
                    <FieldLabel htmlFor="approval-employee">
                      Karyawan
                    </FieldLabel>
                    <NativeSelect
                      id="approval-employee"
                      onChange={(event) =>
                        setEmployeeFilter(event.target.value)
                      }
                      value={employeeFilter}
                    >
                      <NativeSelectOption value="">
                        Semua karyawan
                      </NativeSelectOption>
                      {employees.map((employee) => (
                        <NativeSelectOption
                          key={employee.id}
                          value={String(employee.id)}
                        >
                          {employee.name}
                        </NativeSelectOption>
                      ))}
                    </NativeSelect>
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="approval-from">
                      Dari tanggal
                    </FieldLabel>
                    <Input
                      id="approval-from"
                      onChange={(event) => setFrom(event.target.value)}
                      type="date"
                      value={from}
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="approval-to">
                      Sampai tanggal
                    </FieldLabel>
                    <Input
                      id="approval-to"
                      onChange={(event) => setTo(event.target.value)}
                      type="date"
                      value={to}
                    />
                  </Field>
                  <div className="flex flex-wrap gap-2 sm:col-span-2 xl:col-span-6">
                    <Button disabled={busy} type="submit" variant="outline">
                      Terapkan filter
                    </Button>
                    <Button
                      disabled={busy || !employeeFilter}
                      onClick={() => void loadSelectedEmployeeProjection()}
                      type="button"
                      variant="secondary"
                    >
                      Muat proyeksi karyawan
                    </Button>
                  </div>
                </form>
              </CardContent>
            </Card>

            <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(17rem,0.7fr)_minmax(0,1.3fr)]">
              <Card className="min-w-0">
                <CardHeader>
                  <CardTitle>Antrean terpadu</CardTitle>
                  <CardDescription>
                    {queue?.requests.length ?? 0} kasus pada cakupan filter.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-2">
                  {queue?.requests.length ? (
                    queue.requests.map((item) => (
                      <button
                        aria-pressed={selectedId === item.id}
                        className={`w-full rounded-2xl border p-4 text-left transition-colors hover:bg-muted/50 ${selectedId === item.id ? "border-primary bg-primary/5" : "bg-background"}`}
                        key={item.id}
                        onClick={() => {
                          setSelectedId(item.id)
                          setDecisionReason("")
                        }}
                        type="button"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <span className="text-label">
                            {requestTitle(item)}
                          </span>
                          <Badge variant={statusVariant(item.status)}>
                            {statusLabel(item.status)}
                          </Badge>
                        </div>
                        <p className="mt-2 text-body">{item.employee.name}</p>
                        <p className="text-caption text-muted-foreground">
                          {item.outlet?.name ?? "Cakupan tenant"} ·{" "}
                          {item.work_date ??
                            `${item.starts_on ?? ""} – ${item.ends_on ?? ""}`}
                        </p>
                      </button>
                    ))
                  ) : (
                    <p className="rounded-2xl border border-dashed p-6 text-center text-body text-muted-foreground">
                      Tidak ada kasus pada filter ini.
                    </p>
                  )}
                </CardContent>
              </Card>

              <div className="min-w-0 space-y-5">
                {selected ? (
                  <>
                    <Card>
                      <CardHeader>
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <CardTitle>{requestTitle(selected)}</CardTitle>
                            <CardDescription>
                              {selected.employee.name} ·{" "}
                              {selected.outlet?.name ?? "Tenant"} ·{" "}
                              {selected.work_date ??
                                `${selected.starts_on ?? ""} – ${selected.ends_on ?? ""}`}
                            </CardDescription>
                          </div>
                          <Badge variant={statusVariant(selected.status)}>
                            {statusLabel(selected.status)}
                          </Badge>
                        </div>
                      </CardHeader>
                      <CardContent className="space-y-4">
                        <p className="whitespace-pre-wrap text-body">
                          {selected.reason}
                        </p>
                        {selected.type === "leave" ? (
                          <p className="text-caption">
                            Kategori:{" "}
                            {categoryLabel(
                              String(selected.details.category ?? "permission")
                            )}
                          </p>
                        ) : null}
                        {selected.type === "overtime" ? (
                          <div className="rounded-xl bg-muted/40 p-3">
                            <p className="text-caption">
                              {String(selected.details.starts_at ?? "")} —{" "}
                              {String(selected.details.ends_at ?? "")}
                            </p>
                            <p className="text-caption text-muted-foreground">
                              Durasi yang diminta{" "}
                              {String(selected.details.requested_minutes ?? 0)}{" "}
                              menit. Persetujuan tidak mengubah jam kerja
                              aktual.
                            </p>
                          </div>
                        ) : null}
                        {selected.type === "attendance_correction" ? (
                          <CorrectionReview item={selected} />
                        ) : null}
                        {selected.type === "attendance_review" ? (
                          <div className="rounded-xl border border-primary/20 bg-primary/5 p-3">
                            <p className="text-label">Kasus review</p>
                            <p className="text-body">
                              {caseLabel(
                                String(
                                  selected.details.case_type ??
                                    "attendance_exception"
                                )
                              )}
                            </p>
                            <p className="text-caption text-muted-foreground">
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
                          </div>
                        ) : null}
                        <EvidenceLinks item={selected} />
                        {selected.status === "pending" ? (
                          <div className="space-y-3 border-t pt-4">
                            <Field>
                              <FieldLabel htmlFor="decision-reason">
                                Alasan keputusan
                              </FieldLabel>
                              <Textarea
                                id="decision-reason"
                                maxLength={1000}
                                onChange={(event) =>
                                  setDecisionReason(event.target.value)
                                }
                                placeholder={
                                  selected.type === "attendance_review" ||
                                  selected.type === "attendance_correction"
                                    ? "Wajib untuk review dan koreksi"
                                    : "Wajib saat menolak"
                                }
                                value={decisionReason}
                              />
                            </Field>
                            {selected.can_decide ? (
                              <div className="flex flex-wrap gap-2">
                                <Button
                                  disabled={
                                    busy ||
                                    ((selected.type === "attendance_review" ||
                                      selected.type ===
                                        "attendance_correction") &&
                                      !decisionReason.trim())
                                  }
                                  onClick={() => void applyDecision("approved")}
                                >
                                  {busy ? "Menyimpan…" : "Setujui"}
                                </Button>
                                <Button
                                  disabled={busy || !decisionReason.trim()}
                                  onClick={() => void applyDecision("rejected")}
                                  variant="destructive-outline"
                                >
                                  Tolak
                                </Button>
                              </div>
                            ) : (
                              <p className="rounded-xl border border-dashed p-3 text-caption text-muted-foreground">
                                {selected.eligibility_reason ??
                                  "Akun ini tidak dapat memutuskan kasus ini."}
                              </p>
                            )}
                          </div>
                        ) : null}
                        {selected.decision_history.length ? (
                          <div className="border-t pt-4">
                            <p className="text-label">Riwayat keputusan</p>
                            <ol className="mt-2 space-y-2">
                              {selected.decision_history.map((decision) => (
                                <li
                                  className="rounded-xl bg-muted/40 p-3 text-caption"
                                  key={decision.id}
                                >
                                  <span className="font-medium">
                                    {decisionLabel(decision.action)}
                                  </span>{" "}
                                  · User #{decision.actor_user_id} ·{" "}
                                  {formatDate(decision.acted_at)}
                                  {decision.reason ? (
                                    <p className="mt-1 text-muted-foreground">
                                      {decision.reason}
                                    </p>
                                  ) : null}
                                </li>
                              ))}
                            </ol>
                          </div>
                        ) : null}
                      </CardContent>
                    </Card>

                    <ProjectionPanel
                      projection={projection}
                      detailLoading={detailLoading}
                      busy={busy}
                      outcome={finalizationOutcome}
                      reason={finalizationReason}
                      onOutcome={setFinalizationOutcome}
                      onReason={setFinalizationReason}
                      onFinalize={(day, outcome) => void finalize(day, outcome)}
                    />
                  </>
                ) : (
                  <Card>
                    <CardContent className="p-8 text-center text-body text-muted-foreground">
                      Pilih satu kasus untuk melihat detail, keputusan, dan
                      hasil efektif.
                    </CardContent>
                  </Card>
                )}
                {!selected && projection.length ? (
                  <ProjectionPanel
                    projection={projection}
                    detailLoading={detailLoading}
                    busy={busy}
                    outcome={finalizationOutcome}
                    reason={finalizationReason}
                    onOutcome={setFinalizationOutcome}
                    onReason={setFinalizationReason}
                    onFinalize={(day, outcome) => void finalize(day, outcome)}
                  />
                ) : null}
              </div>
            </div>
          </main>
        </div>
      </div>
    </SidebarProvider>
  )
}

function ProjectionPanel({
  projection,
  detailLoading,
  busy,
  outcome,
  reason,
  onOutcome,
  onReason,
  onFinalize,
}: {
  projection: EffectiveDay[]
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
        <CardTitle>Proyeksi efektif</CardTitle>
        <CardDescription>
          Hasil berasal dari sesi dan event S4, keputusan approval, jadwal,
          review, dan finalisasi.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {detailLoading ? (
          <p className="text-body text-muted-foreground">Memuat proyeksi…</p>
        ) : null}
        {projection.map((day) => (
          <article className="rounded-2xl border p-4" key={day.work_date}>
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
                  ? "Review menunggu"
                  : outcomeLabel(day.outcome)}
              </Badge>
            </div>
            <p className="mt-2 text-caption">
              Jadwal: {day.schedule.status}
              {day.schedule.scheduled_start
                ? ` · ${formatDate(day.schedule.scheduled_start)} – ${formatDate(day.schedule.scheduled_end)}`
                : ""}
            </p>
            {day.sessions.length ? (
              day.sessions.map((attendance) => (
                <div
                  className="mt-3 space-y-2 border-t pt-3"
                  key={attendance.id}
                >
                  <p className="text-caption">
                    Sesi #{attendance.id} · Asli:{" "}
                    {formatDate(attendance.original.check_in_at)} —{" "}
                    {attendance.original.check_out_at
                      ? formatDate(attendance.original.check_out_at)
                      : "checkout belum dicatat"}
                  </p>
                  <p className="text-caption">
                    Efektif: {formatDate(attendance.effective.check_in_at)} —{" "}
                    {attendance.effective.check_out_at
                      ? formatDate(attendance.effective.check_out_at)
                      : "belum ditentukan"}{" "}
                    · {formatDuration(attendance.effective.duration_seconds)}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {attendance.original.events
                      .filter((event) => event.has_evidence)
                      .map((event) => (
                        <a
                          className="text-caption text-primary underline underline-offset-2"
                          href={`/api/v1/management/attendance/events/${event.id}/evidence`}
                          key={event.id}
                          rel="noreferrer"
                          target="_blank"
                        >
                          Bukti event #{event.id}
                        </a>
                      ))}
                  </div>
                </div>
              ))
            ) : (
              <p className="mt-2 text-caption text-muted-foreground">
                Tidak ada event attendance pada tanggal ini.
              </p>
            )}
            {day.conflicts.length ? (
              <p className="mt-3 text-caption text-destructive">
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
                Finalisasi revisi {day.finalization?.revision}:{" "}
                {outcomeLabel(day.finalization?.outcome ?? "")}.{" "}
                {day.finalization?.reason}
              </p>
            ) : day.unresolved_conflicts.length ? (
              <p className="mt-2 text-caption text-muted-foreground">
                Belum dapat difinalisasi:{" "}
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
            Tanggal kasus tidak memiliki proyeksi yang bisa ditampilkan.
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
      className="mt-4 space-y-3 border-t pt-4"
      onSubmit={(event) => {
        event.preventDefault()
        onSubmit(selectedOutcome)
      }}
    >
      <p className="text-label">Finalisasi hasil</p>
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
          Alasan finalisasi
        </FieldLabel>
        <Textarea
          id={`final-reason-${day.work_date}`}
          maxLength={1000}
          onChange={(event) => onReason(event.target.value)}
          required
          value={reason}
        />
      </Field>
      <Button
        disabled={busy || !reason.trim()}
        size="sm"
        type="submit"
        variant="outline"
      >
        Finalisasi hasil
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

function CorrectionReview({ item }: { item: ApprovalItem }) {
  const originalValue =
    (item.details.original as Record<string, unknown> | undefined) ??
    item.correction?.original_values
  const original =
    (originalValue?.recorded as Record<string, unknown> | undefined) ??
    originalValue
  const proposed =
    (item.details.proposed as Record<string, unknown> | undefined) ??
    item.correction?.proposed_values
  return (
    <div className="grid gap-3 rounded-2xl border p-4 sm:grid-cols-2">
      <div>
        <p className="text-label">Catatan asli</p>
        <p className="mt-2 text-caption">
          Check-in: {formatDate(String(original?.check_in_at ?? ""))}
        </p>
        <p className="text-caption">
          Check-out: {formatDate(String(original?.check_out_at ?? ""))}
        </p>
        <p className="text-caption">
          Tanggal: {String(original?.work_date ?? item.work_date ?? "—")}
        </p>
      </div>
      <div>
        <p className="text-label">
          Usulan efektif ·{" "}
          {item.classification === "sensitive" ? "sensitif" : "rutin"}
        </p>
        <p className="mt-2 text-caption">
          Check-in: {formatDate(String(proposed?.check_in_at ?? ""))}
        </p>
        <p className="text-caption">
          Check-out: {formatDate(String(proposed?.check_out_at ?? ""))}
        </p>
        <p className="text-caption">
          Tanggal: {String(proposed?.work_date ?? item.work_date ?? "—")}
        </p>
      </div>
      <p className="text-caption text-muted-foreground sm:col-span-2">
        Fakta dan event awal tidak diubah. Keputusan hanya memengaruhi proyeksi
        efektif.
      </p>
    </div>
  )
}

function EvidenceLinks({ item }: { item: ApprovalItem }) {
  const events =
    (item.details.events as
      | Array<{ id: number; has_evidence?: boolean }>
      | undefined) ?? []
  if (!events.some((event) => event.has_evidence)) return null
  return (
    <div className="flex flex-wrap gap-3">
      {events
        .filter((event) => event.has_evidence)
        .map((event) => (
          <a
            className="text-caption text-primary underline underline-offset-2"
            href={`/api/v1/management/attendance/events/${event.id}/evidence`}
            key={event.id}
            rel="noreferrer"
            target="_blank"
          >
            Buka bukti event #{event.id}
          </a>
        ))}
    </div>
  )
}

function requestTitle(item: ApprovalItem) {
  if (item.type === "attendance_correction") return "Koreksi kehadiran"
  if (item.type === "overtime") return "Permintaan lembur"
  if (item.type === "attendance_review")
    return `Review: ${caseLabel(String(item.details.case_type ?? "kehadiran"))}`
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
        missing_checkout: "checkout belum tercatat",
        attendance_exception: "indikator kehadiran",
        leave_attendance_conflict: "izin berbenturan dengan kehadiran",
      } as Record<string, string>
    )[type] ?? type.replaceAll("_", " ")
  )
}
function statusLabel(status: ApprovalItem["status"]) {
  return (
    {
      pending: "Menunggu",
      approved: "Disetujui",
      rejected: "Ditolak",
      cancelled: "Dibatalkan",
    } as const
  )[status]
}
function statusVariant(
  status: ApprovalItem["status"]
): "default" | "destructive" | "outline" | "secondary" {
  return status === "approved"
    ? "default"
    : status === "rejected"
      ? "destructive"
      : status === "pending"
        ? "outline"
        : "secondary"
}
function decisionLabel(action: string) {
  return (
    (
      {
        approved: "Disetujui",
        rejected: "Ditolak",
        cancelled: "Dibatalkan",
        routine_applied: "Koreksi rutin diterapkan",
        review_accepted: "Review diterima",
        review_rejected: "Review ditolak",
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
        confirmed_absence_pending_finalization: "Ketidakhadiran terkonfirmasi",
        no_recorded_outcome: "Belum ada hasil",
      } as Record<string, string>
    )[outcome] ?? outcome
  )
}
function indicatorLabel(indicator: string) {
  return (
    (
      {
        potential_absence: "potensi tidak hadir",
        missing_checkout: "checkout belum tercatat",
        unscheduled_work: "kerja di luar jadwal",
        rest_day_work: "kerja pada hari libur",
        outlet_closed: "outlet tutup",
        location_outside_range: "lokasi di luar area",
        approved_leave_with_recorded_attendance:
          "izin berbenturan dengan kehadiran",
        attendance_review_required: "perlu review",
        pending_attendance_correction: "koreksi menunggu",
      } as Record<string, string>
    )[indicator] ?? indicator.replaceAll("_", " ")
  )
}
function formatDate(value: string | null) {
  if (!value || value === "null") return "—"
  const date = new Date(value)
  return Number.isNaN(date.valueOf())
    ? "—"
    : date.toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" })
}
function formatDuration(seconds: number | null) {
  if (seconds === null) return "belum ditentukan"
  return `${Math.floor(seconds / 3600)}j ${Math.floor((seconds % 3600) / 60)}m`
}
