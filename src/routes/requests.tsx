import { CorrectionEvidencePanel } from "@/components/correction-evidence-panel"
import { createFileRoute } from "@tanstack/react-router"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import { EmployeeShell } from "@/components/employee-shell"
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
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty"
import { Input } from "@/components/ui/input"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { Separator } from "@/components/ui/separator"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { Textarea } from "@/components/ui/textarea"
import { ApiError, type AuthSession, apiRequest } from "@/lib/api"
import { notifications } from "@/lib/notifications"
import { getAuthRecoveryPath } from "@/lib/auth-navigation"
import {
  correctionSearch,
  matchingCorrection,
  correctionTypeLabel,
  type CorrectionOption,
  type CorrectionType,
  type PersonalCorrectionOptions,
} from "@/lib/attendance-correction-navigation"
import { formatAttendanceTime } from "@/lib/attendance-presentation"
import {
  canSubmitPersonalRequests,
  type RequestAccess,
  requestEligibilityCopy,
} from "@/lib/personal-eligibility"

export const Route = createFileRoute("/requests")({
  validateSearch: correctionSearch,
  component: RequestsPage,
})

type RequestType = "leave" | "overtime" | "attendance_correction"
type RequestFormType = RequestType | "reconstruction"
type ReconstructionOutlet = { id: number; name: string }
type RequestRecord = {
  id: number
  type: RequestType | "attendance_review"
  status: "pending" | "approved" | "rejected" | "cancelled"
  reversed?: boolean
  outlet?: { id: number; name: string } | null
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
  decision_history: Array<{
    action: string
    reason: string | null
    actor_user_id: number
    acted_at: string
  }>
}
type EffectiveSession = {
  id: number
  outlet?: { id: number; name: string | null }
  original: {
    check_in_at: string | null
    check_out_at: string | null
    work_date?: string
    events: Array<{ id: number }>
    outlet?: { id: number; name: string | null }
  }
  effective: {
    work_date?: string
    check_in_at: string | null
    check_out_at: string | null
    duration_seconds: number | null
    outlet_id?: number
  }
  correction: { request_id: number; reason: string | null } | null
}
type EffectiveDay = {
  work_date: string
  outcome: string
  sessions: EffectiveSession[]
  actual_duration_seconds: number | null
  effective_duration_seconds: number | null
  approved_leave: { category?: string } | null
  overtime_requests: Array<{ status: string; details: Record<string, unknown> }>
  review: { status: string; indicators: string[]; cases: RequestRecord[] }
  unresolved_conflicts: string[]
  is_finalized: boolean
}
type PageData = {
  session: AuthSession
  requestAccess: RequestAccess
  requests: RequestRecord[]
  attendance: EffectiveDay[]
  attendanceError: string | null
  reconstructionOutlets: ReconstructionOutlet[]
  correctionOptions?: PersonalCorrectionOptions
  contextKey: string
}

type RequestFilter = "all" | "processing" | "completed"
type ComposerStep = "closed" | "type" | "session" | "reconstruction" | "form"
type SubmissionAttempt = {
  payload: string
  body: Record<string, unknown>
  key: string
}

function localDate(daysAgo = 0) {
  const date = new Date()
  date.setDate(date.getDate() - daysAgo)
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-")
}

function shiftDate(value: string, days: number) {
  const [year, month, day] = value.split("-").map(Number)
  const date = new Date(year, month - 1, day)
  date.setDate(date.getDate() + days)
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-")
}

function RequestsPage() {
  const search = Route.useSearch()
  const contextKey = JSON.stringify(search)
  const navigate = Route.useNavigate()
  const appliedContext = useRef("")
  const refreshGeneration = useRef(0)
  const [data, setData] = useState<PageData | null>(null)
  const [loading, setLoading] = useState(true)
  const [isOwner, setIsOwner] = useState(false)
  const [composerStep, setComposerStep] = useState<ComposerStep>("closed")
  const [requestFilter, setRequestFilter] = useState<RequestFilter>("all")
  const [selectedRequestId, setSelectedRequestId] = useState<number | null>(null)
  const openedLinkedRequest = useRef(false)
  const requestOpener = useRef<HTMLButtonElement | null>(null)
  const detailOpener = useRef<HTMLButtonElement | null>(null)
  const composerTitle = useRef<HTMLHeadingElement | null>(null)
  const [wide, setWide] = useState(false)
  const [evidenceRequestId, setEvidenceRequestId] = useState<number | null>(null)
  const [projectionOpen, setProjectionOpen] = useState(false)
  const [uncertainSubmission, setUncertainSubmission] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")
  const [type, setType] = useState<RequestFormType>("leave")
  const [correctionKind, setCorrectionKind] = useState<CorrectionType>("session")
  const [category, setCategory] = useState("permission")
  const [startsOn, setStartsOn] = useState(localDate())
  const [endsOn, setEndsOn] = useState(localDate())
  const [workDate, setWorkDate] = useState(localDate())
  const [startsAt, setStartsAt] = useState("17:00")
  const [endsAt, setEndsAt] = useState("19:00")
  const [reconstructionOutletId, setReconstructionOutletId] = useState("")
  const [selectedReconstructionKey, setSelectedReconstructionKey] = useState("")
  const [sessionId, setSessionId] = useState("")
  const [effectiveCheckIn, setEffectiveCheckIn] = useState("")
  const [effectiveCheckOut, setEffectiveCheckOut] = useState("")
  const [reason, setReason] = useState("")
  const submissionAttempt = useRef<SubmissionAttempt | null>(null)

  const refresh = useCallback(async () => {
    const generation = ++refreshGeneration.current
    setError("")
    try {
      const session = await apiRequest<AuthSession>("/auth/me")
      if (!session.active_membership) {
        window.location.assign("/select-tenant")
        return
      }
      setIsOwner(session.active_membership.roles.includes("owner"))
      const requestPayload = await apiRequest<{
        requests: RequestRecord[]
        request_access: RequestAccess
        reconstruction_outlets?: ReconstructionOutlet[]
      }>("/attendance/me/requests")
      let attendance: EffectiveDay[] = []
      let attendanceError: string | null = null
      let correctionOptions: PersonalCorrectionOptions | undefined
      const outsideDefaultRange = search.workDate &&
        (search.workDate < localDate(13) || search.workDate > localDate())
      const from = outsideDefaultRange ? search.workDate : localDate(13)
      const to = outsideDefaultRange ? search.workDate : localDate()

      if (
        requestPayload.request_access.linked &&
        requestPayload.request_access.status !== "employee_unavailable"
      ) {
        try {
          const attendancePayload = await apiRequest<{
            attendance: EffectiveDay[]
            correction_options?: PersonalCorrectionOptions
          }>(`/attendance/me/effective?from=${from}&to=${to}`)
          attendance = attendancePayload.attendance
          correctionOptions = attendancePayload.correction_options
        } catch (caught) {
          const recoveryPath = getAuthRecoveryPath(caught)
          if (recoveryPath) {
            window.location.assign(recoveryPath)
            return
          }
          if (
            caught instanceof ApiError &&
            caught.code === "employee_link_required"
          ) {
            requestPayload.request_access = {
              status: "employee_link_required",
              linked: false,
              can_submit: false,
            }
          } else {
            attendanceError =
              "Riwayat kehadiran belum dapat dimuat. Anda tetap dapat mengajukan permintaan yang diizinkan."
          }
        }
      }

      if (generation !== refreshGeneration.current) return
      setData({
        session,
        requestAccess: requestPayload.request_access,
        requests: requestPayload.requests,
        attendance,
        attendanceError,
        reconstructionOutlets: requestPayload.reconstruction_outlets ?? [],
        correctionOptions,
        contextKey,
      })
      setSessionId(
        (current) =>
          current ||
          String(attendance.flatMap((day) => day.sessions)[0]?.id ?? "")
      )
    } catch (caught) {
      if (generation !== refreshGeneration.current) return
      const recoveryPath = getAuthRecoveryPath(caught)
      if (recoveryPath) {
        window.location.assign(recoveryPath)
        return
      }
      setError(
        caught instanceof ApiError
          ? requestErrorMessage(caught)
          : "Data permintaan belum dapat dimuat."
      )
    } finally {
      if (generation === refreshGeneration.current) setLoading(false)
    }
  }, [contextKey, search.workDate])

  useEffect(() => {
    void refresh()
    return () => { refreshGeneration.current++ }
  }, [refresh])

  useEffect(() => {
    if (!data || data.contextKey !== contextKey || !search.correction || appliedContext.current === contextKey) return
    appliedContext.current = contextKey
    const option = matchingCorrection(search, data.correctionOptions)
    if (!option || !canSubmitPersonalRequests(data.requestAccess) ||
      data.correctionOptions?.tenant_id !== data.session.active_membership?.tenant.id ||
      (search.employeeId !== undefined && data.correctionOptions?.employee_id !== search.employeeId)) {
      setError("Konteks koreksi tidak tersedia atau batas pengajuannya sudah lewat. Pilih kembali dari riwayat kehadiran.")
      return
    }
    setType(option.correction_type === "reconstruction" ? "reconstruction" : "attendance_correction")
    setCorrectionKind(option.correction_type)
    setWorkDate(option.work_date)
    setReconstructionOutletId(String(option.outlet.id))
    setSelectedReconstructionKey(`${option.work_date}:${option.outlet.id}`)
    setSessionId(option.session_id === undefined ? "" : String(option.session_id))
    setEffectiveCheckIn("")
    setEffectiveCheckOut("")
    setReason("")
    setError("")
    setComposerStep("form")
  }, [data, contextKey, search])

  useEffect(() => {
    if (!data || openedLinkedRequest.current) return
    openedLinkedRequest.current = true
    const match = /^#request-([1-9]\d*)$/.exec(window.location.hash)
    const request = data.requests.find((item) => String(item.id) === match?.[1])
    if (!request) return
    setRequestFilter("all")
    window.requestAnimationFrame(() => {
      const target = document.querySelector<HTMLButtonElement>(`[data-request-row-id="${request.id}"]`)
      if (!target) return
      detailOpener.current = target
      target.focus()
      target.scrollIntoView({ block: "start" })
      setSelectedRequestId(request.id)
    })
  }, [data])

  useEffect(() => {
    const media = window.matchMedia("(min-width: 768px)")
    const update = () => setWide(media.matches)
    update()
    media.addEventListener("change", update)
    return () => media.removeEventListener("change", update)
  }, [])

  useEffect(() => {
    if (composerStep === "form") {
      window.requestAnimationFrame(() => composerTitle.current?.focus())
    }
  }, [composerStep])

  useEffect(() => {
    if (selectedRequestId !== null || !detailOpener.current) return
    window.requestAnimationFrame(() => detailOpener.current?.focus())
  }, [selectedRequestId])

  useEffect(() => {
    if (composerStep !== "closed" || !requestOpener.current) return
    window.requestAnimationFrame(() => requestOpener.current?.focus())
  }, [composerStep])

  const sessions = useMemo(
    () =>
      data?.attendance.flatMap((day) =>
        day.sessions.map((session) => ({ ...session, workDate: day.work_date }))
      ) ?? [],
    [data?.attendance]
  )
  const canSubmitRequests = Boolean(
    data && canSubmitPersonalRequests(data.requestAccess)
  )
  const correctionOption: CorrectionOption | undefined = type === "reconstruction"
    ? data?.correctionOptions?.reconstructions.find((option) =>
        `${option.work_date}:${option.outlet.id}` === selectedReconstructionKey)
    : data?.correctionOptions?.sessions.find((option) => String(option.session_id) === sessionId)
  const selectedSessionOption = data?.correctionOptions?.sessions.find(
    (option) => String(option.session_id) === sessionId
  )
  const selectedReconstructionOption = data?.correctionOptions?.reconstructions.find(
    (option) => `${option.work_date}:${option.outlet.id}` === selectedReconstructionKey
  )
  const selectedRequest = data?.requests.find((request) => request.id === selectedRequestId) ?? null
  const filteredRequests = data?.requests.filter((request) => {
    if (requestFilter === "processing") return request.status === "pending"
    if (requestFilter === "completed") return request.status !== "pending"
    return true
  }) ?? []
  const requestAccessCopy =
    data && data.requestAccess.status !== "available"
      ? requestEligibilityCopy(data.requestAccess.status)
      : null

  function openRequestFlow(button: HTMLButtonElement) {
    if (uncertainSubmission) return
    requestOpener.current = button
    setError("")
    setNotice("")
    setType("leave")
    setSessionId("")
    setEffectiveCheckIn("")
    setEffectiveCheckOut("")
    setReason("")
    setComposerStep("type")
  }

  function backFromComposer() {
    if (search.correction) {
      setComposerStep("closed")
      void navigate({ to: "/requests", search: {}, replace: true })
      return
    }
    if (composerStep === "form") {
      if (type === "attendance_correction") setComposerStep("session")
      else if (type === "reconstruction") setComposerStep("reconstruction")
      else setComposerStep("type")
      return
    }
    if (composerStep === "session" || composerStep === "reconstruction") {
      setComposerStep("type")
      return
    }
    setComposerStep("closed")
  }

  function chooseRequestType(nextType: RequestFormType) {
    setType(nextType)
    setError("")
    if (nextType === "attendance_correction") {
      setSessionId("")
      setComposerStep("session")
      return
    }
    if (nextType === "reconstruction") {
      setSelectedReconstructionKey("")
      setComposerStep("reconstruction")
      return
    }
    setComposerStep("form")
  }

  function continueCorrection() {
    const option = selectedSessionOption
    if (!option?.can_start || option.session_id === undefined) return
    setType("attendance_correction")
    setCorrectionKind(option.correction_type)
    setWorkDate(option.work_date)
    setReconstructionOutletId(String(option.outlet.id))
    setEffectiveCheckIn("")
    setEffectiveCheckOut("")
    setReason("")
    setError("")
    setComposerStep("form")
  }

  function continueReconstruction() {
    const option = selectedReconstructionOption
    if (!option?.can_start) return
    setType("reconstruction")
    setWorkDate(option.work_date)
    setReconstructionOutletId(String(option.outlet.id))
    setEffectiveCheckIn("")
    setEffectiveCheckOut("")
    setReason("")
    setError("")
    setComposerStep("form")
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!data || !canSubmitPersonalRequests(data.requestAccess)) return
    if (uncertainSubmission) return
    if ((type === "attendance_correction" || type === "reconstruction") && !correctionOption?.can_start) {
      setError("Opsi koreksi tidak lagi tersedia. Muat ulang data sebelum melanjutkan.")
      return
    }

    let body: Record<string, unknown>
    try {
      if (type === "leave") {
        body = { type, category, starts_on: startsOn, ends_on: endsOn, reason }
      } else if (type === "overtime") {
        body = {
          type,
          work_date: workDate,
          starts_at: `${workDate}T${startsAt}`,
          ends_at: `${endsAt <= startsAt ? shiftDate(workDate, 1) : workDate}T${endsAt}`,
          reason,
          ...(sessionId ? { attendance_session_id: Number(sessionId) } : {}),
        }
      } else if (type === "reconstruction") {
        body = {
          type: "attendance_correction",
          correction_target: "reconstruction",
          work_date: workDate,
          effective_outlet_id: Number(reconstructionOutletId),
          effective_check_in_at: new Date(effectiveCheckIn).toISOString(),
          effective_check_out_at: new Date(effectiveCheckOut).toISOString(),
          reason,
        }
      } else {
        body = {
          type,
          attendance_session_id: Number(sessionId),
          ...(correctionKind !== "missing_checkout" && effectiveCheckIn
            ? { effective_check_in_at: new Date(effectiveCheckIn).toISOString() }
            : {}),
          ...(correctionKind !== "check_in" && effectiveCheckOut
            ? { effective_check_out_at: new Date(effectiveCheckOut).toISOString() }
            : {}),
          reason,
        }
      }
    } catch {
      setError("Periksa kembali tanggal dan waktu yang diajukan.")
      return
    }
    const payload = JSON.stringify(body)
    if (submissionAttempt.current?.payload !== payload) {
      submissionAttempt.current = { payload, body, key: crypto.randomUUID() }
    }
    await transmitSubmission(submissionAttempt.current)
  }

  async function transmitSubmission(attempt: SubmissionAttempt) {
    if (!data || !canSubmitPersonalRequests(data.requestAccess) || busy) return
    setBusy(true)
    setError("")
    setNotice("")
    try {
      const notificationId = `correction:${data.session.active_membership?.tenant.id}:${data.session.user.id}:${attempt.key}`
      const submitted = await apiRequest<{ request: RequestRecord }>("/attendance/me/requests", {
        method: "POST",
        headers: { "Idempotency-Key": attempt.key },
        body: attempt.body,
      })
      submissionAttempt.current = null
      setUncertainSubmission(false)
      setReason("")
      setEffectiveCheckIn("")
      setEffectiveCheckOut("")
      setNotice("Permintaan terkirim dan menunggu keputusan pengelola.")
      setComposerStep("closed")
      if (search.correction) void navigate({ to: "/requests", search: {}, replace: true })
      if (attempt.body.type === "attendance_correction") {
        notifications.success("Pengajuan koreksi terkirim dan menunggu keputusan pengelola.", { id: `${notificationId}:submitted` })
      }
      await refresh()
      if (attempt.body.type === "attendance_correction" && submitted?.request) {
        setSelectedRequestId(submitted.request.id)
        setEvidenceRequestId(submitted.request.id)
        setNotice("Permintaan koreksi terkirim. Lampiran opsional dapat ditambahkan di detail permintaan.")
      }
    } catch (caught) {
      const recoveryPath = getAuthRecoveryPath(caught)
      if (recoveryPath) {
        window.location.assign(recoveryPath)
        return
      }
      const message = caught instanceof ApiError ? requestErrorMessage(caught) : "Permintaan belum dapat dikirim."
      const outcomeUncertain = !(caught instanceof ApiError) || caught.status >= 500
      if (outcomeUncertain) {
        setUncertainSubmission(true)
        setError("Respons pengajuan belum dapat dipastikan. Tidak ada pengiriman ulang otomatis. Periksa status dengan mencoba kembali memakai kunci idempotensi yang sama.")
      } else {
        submissionAttempt.current = null
        setUncertainSubmission(false)
        setError(message)
        if (attempt.body.type === "attendance_correction") {
          notifications.error(message, { id: `correction:${data.session.active_membership?.tenant.id}:${data.session.user.id}:${attempt.key}:rejected` })
        }
      }
    } finally {
      setBusy(false)
    }
  }

  function retryUncertainSubmission() {
    if (!uncertainSubmission || !submissionAttempt.current) return
    void transmitSubmission(submissionAttempt.current)
  }

  async function cancelRequest(id: number) {
    const correction = data?.requests.find((request) => request.id === id && request.type === "attendance_correction")
    if (correction && !await notifications.confirm("Batalkan pengajuan koreksi ini? Catatan presensi asli tetap tersimpan.", "Batalkan pengajuan")) return
    setBusy(true)
    setError("")
    try {
      await apiRequest(`/attendance/me/requests/${id}/cancel`, {
        method: "POST",
        headers: { "Idempotency-Key": window.crypto.randomUUID() },
      })
      setNotice("Permintaan dibatalkan dan riwayatnya tetap tersimpan.")
      if (correction) notifications.success("Pengajuan koreksi dibatalkan.", { id: `correction:${data?.session.active_membership?.tenant.id}:${id}:cancelled` })
      await refresh()
    } catch (caught) {
      const recoveryPath = getAuthRecoveryPath(caught)
      if (recoveryPath) {
        window.location.assign(recoveryPath)
        return
      }
      setError(
        caught instanceof ApiError
          ? requestErrorMessage(caught)
          : "Permintaan belum dapat dibatalkan."
      )
    } finally {
      setBusy(false)
    }
  }

  if (loading && !data) {
    return (
      <main
        aria-live="polite"
        className="flex min-h-svh items-center justify-center text-body text-muted-foreground"
        role="status"
      >
        Memuat permintaan…
      </main>
    )
  }

  return (
    <EmployeeShell
      active="requests"
      accountName={data?.session.user.name ?? "Karyawan"}
    >
      {composerStep === "closed" ? (
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-4 pb-[max(2rem,env(safe-area-inset-bottom))] pt-4 sm:pt-6" data-employee-requests-home="true">
          <header className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex min-w-0 flex-col gap-1">
              <h1 className="text-title">Permintaan saya</h1>
              <p className="text-caption text-muted-foreground">Status terbaru dari organisasi aktif Anda.</p>
            </div>
            <Button
              className="min-h-11 shrink-0"
              disabled={!canSubmitRequests || uncertainSubmission}
              onClick={(event) => openRequestFlow(event.currentTarget)}
              size="sm"
              type="button"
            >
              <span aria-hidden="true">+</span> Ajukan permintaan
            </Button>
          </header>

          {error ? (
            <Alert variant="destructive" role="alert">
              <AlertTitle>Permintaan belum berhasil</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          {notice ? (
            <Alert role="status">
              <AlertTitle>Status permintaan</AlertTitle>
              <AlertDescription>{notice}</AlertDescription>
            </Alert>
          ) : null}
          {uncertainSubmission ? (
            <UncertainSubmissionNotice busy={busy} onRetry={retryUncertainSubmission} />
          ) : null}

          {requestAccessCopy ? (
            <Card>
              <CardHeader>
                <CardTitle>{requestAccessCopy.title}</CardTitle>
                <CardDescription>{requestAccessCopy.description}</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col items-start gap-3">
                {isOwner ? (
                  <Button render={<a href="/access" />} variant="outline">Atur akses karyawan</Button>
                ) : (
                  <p className="text-body text-muted-foreground">Hubungi Owner organisasi agar akun Anda ditautkan ke profil karyawan.</p>
                )}
              </CardContent>
            </Card>
          ) : null}

          {data?.attendanceError ? (
            <Alert>
              <AlertTitle>Opsi koreksi belum dapat diverifikasi</AlertTitle>
              <AlertDescription>{data.attendanceError}</AlertDescription>
            </Alert>
          ) : null}

          {!data && error ? (
            <Card>
              <CardHeader>
                <CardTitle>Data permintaan belum dapat dimuat</CardTitle>
                <CardDescription>Form tidak tersedia sampai akses dan data berhasil diperiksa.</CardDescription>
              </CardHeader>
              <CardContent>
                <Button onClick={() => { setLoading(true); void refresh() }} variant="outline">Coba lagi</Button>
              </CardContent>
            </Card>
          ) : null}

          {data ? (
            <section aria-labelledby="request-list-title" className="flex flex-col gap-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="text-subtitle" id="request-list-title">Riwayat permintaan</h2>
                <span className="text-caption text-muted-foreground">{filteredRequests.length} permintaan</span>
              </div>
              <ToggleGroup
                aria-label="Filter status permintaan"
                className="w-full"
                onValueChange={(values) => {
                  const value = values[0] as RequestFilter | undefined
                  if (value) setRequestFilter(value)
                }}
                value={[requestFilter]}
              >
                {([
                  ["all", "Semua"],
                  ["processing", "Diproses"],
                  ["completed", "Selesai"],
                ] as const).map(([value, label]) => (
                  <ToggleGroupItem className="min-h-11 flex-1 rounded-md" key={value} value={value} variant="outline">
                    {label}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>

              {filteredRequests.length ? (
                <ol aria-label="Daftar permintaan" className="flex flex-col" data-request-list="true">
                  {filteredRequests.map((request, index) => (
                    <li key={request.id}>
                      <button
                        aria-label={`${statusLabel(request)}. ${requestTitle(request)}. ${request.work_date ?? `${request.starts_on ?? ""} – ${request.ends_on ?? ""}`}. Lihat detail`}
                        className="flex min-h-[68px] w-full cursor-pointer items-center justify-between gap-3 rounded-md px-2 py-3 text-left outline-none hover:bg-muted/30 active:bg-muted/50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                        data-request-row-id={request.id}
                        id={`request-${request.id}`}
                        onClick={(event) => {
                          detailOpener.current = event.currentTarget
                          setSelectedRequestId(request.id)
                        }}
                        type="button"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="flex min-w-0 flex-wrap items-start gap-x-2 gap-y-1">
                            <Badge className="shrink-0" variant={statusVariant(request.status)}>{statusLabel(request)}</Badge>
                            <span className="min-w-0 flex-[1_1_8rem] whitespace-normal break-words text-label">{requestTitle(request)}</span>
                          </span>
                          <span className="mt-1 block truncate pl-1 text-caption text-muted-foreground">
                            {request.work_date ?? `${request.starts_on ?? ""} – ${request.ends_on ?? ""}`}
                            {request.outlet ? ` · ${request.outlet.name}` : ""}
                          </span>
                        </span>
                        <span aria-hidden="true" className="shrink-0 text-muted-foreground">›</span>
                      </button>
                      {index < filteredRequests.length - 1 ? <Separator className="opacity-70" /> : null}
                    </li>
                  ))}
                </ol>
              ) : (
                <Empty className="min-h-36 border-t border-border px-3 py-8">
                  <EmptyHeader>
                    <EmptyTitle>{emptyRequestFilterTitle(requestFilter)}</EmptyTitle>
                    <EmptyDescription>{emptyRequestFilterDescription(requestFilter)}</EmptyDescription>
                  </EmptyHeader>
                </Empty>
              )}
            </section>
          ) : null}

          {data?.requestAccess.linked && data.requestAccess.status !== "employee_unavailable" ? (
            <div className="employee-projection-panel">
              <p className="employee-previous-requests-note"><span aria-hidden="true">✓</span> Ringkasan kehadiran tetap tersedia di sini.</p>
              <Button
                aria-controls="employee-effective-projection"
                aria-expanded={projectionOpen}
                className="employee-projection-toggle"
                onClick={() => setProjectionOpen((open) => !open)}
                type="button"
                variant="outline"
              >
                {projectionOpen ? "Sembunyikan ringkasan kehadiran" : "Lihat ringkasan kehadiran"}
              </Button>
              <Card className={`employee-projection-card ${projectionOpen ? "is-open" : ""}`} id="employee-effective-projection">
                <CardHeader>
                  <CardTitle>Ringkasan kehadiran yang berlaku</CardTitle>
                  <CardDescription>Catatan asli, koreksi yang disetujui, tinjauan, dan penetapan hasil ditampilkan terpisah.</CardDescription>
                </CardHeader>
                <CardContent className="grid gap-3 sm:grid-cols-2">
                  {data.attendance.map((day) => (
                    <article className="rounded-2xl border p-4" key={day.work_date}>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-label">{day.work_date}</p>
                        <Badge variant={day.review.status === "pending" ? "outline" : "secondary"}>
                          {day.review.status === "pending" ? "Perlu ditinjau" : outcomeLabel(day.outcome)}
                        </Badge>
                      </div>
                      {day.sessions.length ? day.sessions.map((session) => (
                        <div className="mt-3 border-t pt-3" key={session.id}>
                          <p className="text-caption">Asli: {formatDate(session.original.check_in_at)} — {session.original.check_out_at ? formatDate(session.original.check_out_at) : "presensi keluar belum dicatat"}</p>
                          <p className="text-caption">Efektif: {formatDate(session.effective.check_in_at)} — {session.effective.check_out_at ? formatDate(session.effective.check_out_at) : "belum ditentukan"}</p>
                          {session.correction ? <p className="mt-1 text-caption text-muted-foreground">Koreksi dari keputusan #{session.correction.request_id}</p> : null}
                        </div>
                      )) : <p className="mt-2 text-caption text-muted-foreground">Belum ada sesi presensi.</p>}
                      {day.approved_leave ? <p className="mt-2 text-caption">Persetujuan: {categoryLabel(day.approved_leave.category ?? "permission")}</p> : null}
                      {day.overtime_requests.some((item) => item.status === "approved") ? <p className="mt-1 text-caption">Lembur disetujui · tidak menambah durasi aktual.</p> : null}
                      {day.review.indicators.length ? <p className="mt-2 text-caption text-muted-foreground">Indikator: {day.review.indicators.map(indicatorLabel).join(", ")}</p> : null}
                      <p className="mt-2 text-caption text-muted-foreground">Durasi aktual {formatDuration(day.actual_duration_seconds)} · efektif {formatDuration(day.effective_duration_seconds)} · {day.is_finalized ? "hasil ditetapkan" : "hasil belum ditetapkan"}</p>
                    </article>
                  ))}
                </CardContent>
              </Card>
            </div>
          ) : null}
        </div>
      ) : null}
      {selectedRequest ? (
        <RequestDetailOverlay
          busy={busy}
          evidenceOpen={evidenceRequestId === selectedRequest.id}
          onCancel={() => void cancelRequest(selectedRequest.id)}
          onClose={() => setSelectedRequestId(null)}
          onToggleEvidence={() => setEvidenceRequestId((current) => current === selectedRequest.id ? null : selectedRequest.id)}
          request={selectedRequest}
          wide={wide}
        />
      ) : null}
      {composerStep !== "closed" && data ? (
        <div className="mx-auto flex min-h-0 w-full max-w-2xl flex-col gap-5 px-4 pb-[max(2rem,env(safe-area-inset-bottom))] pt-3" data-request-composer="true">
          <header className="grid min-h-12 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 border-b border-border pb-3">
            <Button aria-label="Kembali ke Permintaan" className="min-h-11 min-w-11 px-2" onClick={backFromComposer} type="button" variant="ghost">‹</Button>
            <h1 className="min-w-0 truncate text-center text-subtitle" ref={composerTitle} tabIndex={-1}>
              {composerStep === "form" ? "Formulir permintaan" : composerStep === "session" ? "Pilih sesi koreksi" : composerStep === "reconstruction" ? "Pilih tanggal dan Outlet" : "Buat permintaan"}
            </h1>
            <span aria-hidden="true" />
          </header>

          {error ? <Alert role="alert" variant="destructive"><AlertTitle>Permintaan belum berhasil</AlertTitle><AlertDescription>{error}</AlertDescription></Alert> : null}
          {uncertainSubmission ? <UncertainSubmissionNotice busy={busy} onRetry={retryUncertainSubmission} /> : null}
          {requestAccessCopy ? <Alert><AlertTitle>{requestAccessCopy.title}</AlertTitle><AlertDescription>{requestAccessCopy.description}</AlertDescription></Alert> : null}

          {composerStep === "type" ? (
            <section aria-labelledby="request-type-title" className="flex flex-col gap-2">
              <h2 className="text-label" id="request-type-title">Pilih jenis permintaan</h2>
              <Button className="min-h-12 w-full justify-start" disabled={!canSubmitRequests || uncertainSubmission} onClick={() => chooseRequestType("leave")} type="button" variant="outline">Izin, sakit, atau cuti</Button>
              <Button className="min-h-12 w-full justify-start" disabled={!canSubmitRequests || uncertainSubmission} onClick={() => chooseRequestType("overtime")} type="button" variant="outline">Lembur</Button>
              <Button className="min-h-12 w-full justify-start" disabled={!canSubmitRequests || !data.correctionOptions || uncertainSubmission} onClick={() => chooseRequestType("attendance_correction")} type="button" variant="outline">Koreksi sesi presensi</Button>
              <Button className="min-h-12 w-full justify-start" disabled={!canSubmitRequests || !data.correctionOptions || uncertainSubmission} onClick={() => chooseRequestType("reconstruction")} type="button" variant="outline">Rekonstruksi presensi</Button>
              {!data.correctionOptions ? <p className="text-caption text-muted-foreground">Opsi koreksi belum tersedia dari server.</p> : null}
            </section>
          ) : null}

          {composerStep === "session" ? (
            <section aria-labelledby="correction-session-title" className="flex flex-col gap-3">
              <div>
                <h2 className="text-label" id="correction-session-title">Pilih sesi presensi</h2>
                <p className="text-caption text-muted-foreground">Jenis koreksi dan batas pengajuan mengikuti evaluasi server untuk sesi ini.</p>
              </div>
              {data.correctionOptions?.sessions.length ? (
                <ul className="flex flex-col divide-y divide-border border-y border-border">
                  {data.correctionOptions.sessions.map((option) => {
                    const session = sessions.find((item) => item.id === option.session_id)
                    const isSelected = String(option.session_id) === sessionId
                    const availability = correctionAvailabilityLabel(option, data.correctionOptions?.evaluated_at)
                    return (
                      <li key={`${option.session_id}:${option.work_date}:${option.outlet.id}`}>
                        <Button
                          aria-label={`${option.work_date}, ${option.outlet.name}, sesi ${option.session_id}, ${correctionTypeLabel(option.correction_type)}, ${option.can_start ? "dapat dipilih" : availability}`}
                          aria-pressed={isSelected}
                          className="min-h-16 w-full justify-between gap-3 rounded-none px-2 py-3 text-left"
                          disabled={!option.can_start || uncertainSubmission}
                          onClick={() => setSessionId(String(option.session_id ?? ""))}
                          type="button"
                          variant={isSelected ? "secondary" : "ghost"}
                        >
                          <span className="min-w-0 flex-1 whitespace-normal">
                            <span className="block text-label">{option.work_date} · {option.outlet.name} · sesi #{option.session_id}</span>
                            {session?.original.outlet?.name ? <span className="mt-0.5 block text-caption text-muted-foreground">Outlet rekaman: {session.original.outlet.name}</span> : null}
                            <span className="mt-0.5 block text-caption text-muted-foreground">{option.can_start ? `${correctionTypeLabel(option.correction_type)} · batas ${formatAttendanceTime(option.deadline.exclusive_at, option.deadline.historical_timezone)}` : availability}</span>
                          </span>
                          <span className="shrink-0 text-caption text-muted-foreground">{isSelected ? "Dipilih" : "Pilih"}</span>
                        </Button>
                      </li>
                    )
                  })}
                </ul>
              ) : (
                <Empty className="min-h-32 border-y border-border px-3 py-6">
                  <EmptyHeader><EmptyTitle>Koreksi sesi belum tersedia</EmptyTitle><EmptyDescription>Tidak ada opsi sesi koreksi yang dikembalikan server.</EmptyDescription></EmptyHeader>
                </Empty>
              )}
              {selectedSessionOption?.can_start ? (
                <div aria-live="polite" className="flex flex-col gap-2 border-t border-border pt-3">
                  <p className="text-body">Jenis koreksi yang tersedia: <span className="font-medium">{correctionTypeLabel(selectedSessionOption.correction_type)}</span></p>
                  <p className="text-caption text-muted-foreground">Batas pengajuan {formatAttendanceTime(selectedSessionOption.deadline.exclusive_at, selectedSessionOption.deadline.historical_timezone)}</p>
                  <Button className="min-h-11 w-full" disabled={uncertainSubmission} onClick={continueCorrection} type="button">Lanjutkan</Button>
                </div>
              ) : null}
            </section>
          ) : null}

          {composerStep === "reconstruction" ? (
            <section aria-labelledby="reconstruction-option-title" className="flex flex-col gap-3">
              <div>
                <h2 className="text-label" id="reconstruction-option-title">Pilih evaluasi tanggal dan Outlet</h2>
                <p className="text-caption text-muted-foreground">Rekonstruksi hanya tersedia untuk pasangan yang dinilai server.</p>
              </div>
              {data.correctionOptions?.reconstructions.length ? (
                <ul className="flex flex-col divide-y divide-border border-y border-border">
                  {data.correctionOptions.reconstructions.map((option) => {
                    const key = `${option.work_date}:${option.outlet.id}`
                    const selected = key === selectedReconstructionKey
                    const availability = correctionAvailabilityLabel(option, data.correctionOptions?.evaluated_at)
                    return (
                      <li key={key}>
                        <Button
                          aria-label={`${option.work_date}, ${option.outlet.name}, ${selected ? "dipilih" : "pilih"}, ${option.can_start ? "dapat diajukan" : availability}`}
                          aria-pressed={selected}
                          className="min-h-14 w-full justify-between gap-3 rounded-none px-2 py-3 text-left"
                          disabled={!option.can_start || uncertainSubmission}
                          onClick={() => setSelectedReconstructionKey(key)}
                          type="button"
                          variant={selected ? "secondary" : "ghost"}
                        >
                          <span className="min-w-0 whitespace-normal text-left">
                            <span className="block text-label">{option.work_date} · {option.outlet.name}</span>
                            <span className="mt-0.5 block text-caption text-muted-foreground">{option.can_start ? `Batas ${formatAttendanceTime(option.deadline.exclusive_at, option.deadline.historical_timezone)}` : availability}</span>
                          </span>
                          <span className="shrink-0 text-caption text-muted-foreground">{selected ? "Dipilih" : "Pilih"}</span>
                        </Button>
                      </li>
                    )
                  })}
                </ul>
              ) : (
                <Empty className="min-h-32 border-y border-border px-3 py-6">
                  <EmptyHeader><EmptyTitle>Rekonstruksi belum tersedia</EmptyTitle><EmptyDescription>Tidak ada evaluasi rekonstruksi dari server untuk tanggal yang dimuat.</EmptyDescription></EmptyHeader>
                </Empty>
              )}
              {selectedReconstructionOption?.can_start ? <Button className="min-h-11 w-full" disabled={uncertainSubmission} onClick={continueReconstruction} type="button">Lanjutkan</Button> : null}
            </section>
          ) : null}

          {composerStep === "form" ? (
            <form className="flex flex-col gap-5" id="employee-request-form" onSubmit={submit}>
              {type === "leave" ? (
                <>
                  <Field>
                    <FieldLabel htmlFor="leave-category">Kategori</FieldLabel>
                    <NativeSelect disabled={busy || uncertainSubmission} id="leave-category" onChange={(event) => setCategory(event.target.value)} value={category}>
                      <NativeSelectOption value="permission">Izin</NativeSelectOption>
                      <NativeSelectOption value="sick">Sakit</NativeSelectOption>
                      <NativeSelectOption value="annual">Cuti</NativeSelectOption>
                    </NativeSelect>
                  </Field>
                  <FieldGroup className="grid grid-cols-2 gap-3">
                    <Field><FieldLabel htmlFor="starts-on">Mulai</FieldLabel><Input disabled={busy || uncertainSubmission} id="starts-on" onChange={(event) => setStartsOn(event.target.value)} required type="date" value={startsOn} /></Field>
                    <Field><FieldLabel htmlFor="ends-on">Sampai</FieldLabel><Input disabled={busy || uncertainSubmission} id="ends-on" onChange={(event) => setEndsOn(event.target.value)} required type="date" value={endsOn} /></Field>
                  </FieldGroup>
                </>
              ) : null}

              {type === "overtime" ? (
                <>
                  <Field><FieldLabel htmlFor="overtime-date">Tanggal kerja</FieldLabel><Input disabled={busy || uncertainSubmission} id="overtime-date" onChange={(event) => setWorkDate(event.target.value)} required type="date" value={workDate} /></Field>
                  <FieldGroup className="grid grid-cols-2 gap-3">
                    <Field><FieldLabel htmlFor="overtime-start">Mulai lembur</FieldLabel><Input disabled={busy || uncertainSubmission} id="overtime-start" onChange={(event) => setStartsAt(event.target.value)} required type="time" value={startsAt} /></Field>
                    <Field><FieldLabel htmlFor="overtime-end">Selesai lembur</FieldLabel><Input disabled={busy || uncertainSubmission} id="overtime-end" onChange={(event) => setEndsAt(event.target.value)} required type="time" value={endsAt} /></Field>
                  </FieldGroup>
                  <Field>
                    <FieldLabel htmlFor="overtime-session">Sesi presensi (opsional)</FieldLabel>
                    <NativeSelect disabled={busy || uncertainSubmission} id="overtime-session" onChange={(event) => setSessionId(event.target.value)} value={sessionId}>
                      <NativeSelectOption value="">Tanpa sesi terkait</NativeSelectOption>
                      {sessions.map((session) => <NativeSelectOption key={session.id} value={String(session.id)}>{session.workDate} · sesi #{session.id}</NativeSelectOption>)}
                    </NativeSelect>
                  </Field>
                  <p className="text-caption text-muted-foreground">Persetujuan lembur dicatat terpisah dan tidak menambah durasi kerja aktual.</p>
                </>
              ) : null}

              {(type === "attendance_correction" || type === "reconstruction") && correctionOption ? (
              <CorrectionRequestFormFields
                  correctionKind={correctionKind}
                  effectiveCheckIn={effectiveCheckIn}
                  effectiveCheckOut={effectiveCheckOut}
                  onCheckInChange={setEffectiveCheckIn}
                  onCheckOutChange={setEffectiveCheckOut}
                  option={correctionOption}
                  session={type === "attendance_correction" ? sessions.find((session) => session.id === correctionOption.session_id) : undefined}
                  type={type}
                  disabled={busy || uncertainSubmission}
                />
              ) : null}

              <Field>
                <FieldLabel htmlFor="request-reason">Alasan</FieldLabel>
                <Textarea disabled={busy || uncertainSubmission} id="request-reason" maxLength={1000} onChange={(event) => setReason(event.target.value)} required value={reason} />
                <p className="text-caption text-muted-foreground">Hindari mengirim diagnosis atau informasi kesehatan yang tidak diperlukan.</p>
              </Field>
              <Button className="min-h-11 w-full" disabled={busy || uncertainSubmission || !canSubmitRequests || ((type === "attendance_correction" || type === "reconstruction") && !correctionOption?.can_start)} type="submit">
                {busy ? "Mengirim…" : "Ajukan permintaan"}
              </Button>
            </form>
          ) : null}
        </div>
      ) : null}
    </EmployeeShell>
  )
}

function emptyRequestFilterTitle(filter: RequestFilter) {
  if (filter === "processing") return "Tidak ada permintaan yang diproses"
  if (filter === "completed") return "Belum ada permintaan selesai"
  return "Belum ada permintaan"
}

function emptyRequestFilterDescription(filter: RequestFilter) {
  if (filter === "processing") return "Permintaan yang menunggu keputusan akan muncul di sini."
  if (filter === "completed") return "Permintaan yang disetujui, ditolak, atau dibatalkan akan muncul di sini."
  return "Permintaan yang Anda ajukan akan muncul di sini."
}

function correctionAvailabilityLabel(option: CorrectionOption, evaluatedAt?: string) {
  if (option.can_start) return "Dapat diajukan"
  if (option.deadline.owner_required) return "Memerlukan persetujuan Owner"
  const evaluated = evaluatedAt ? Date.parse(evaluatedAt) : Number.NaN
  const deadline = Date.parse(option.deadline.exclusive_at)
  if (Number.isFinite(evaluated) && Number.isFinite(deadline) && evaluated >= deadline) return "Batas waktu terlewati"
  return "Tidak tersedia menurut evaluasi server"
}

function UncertainSubmissionNotice({ busy, onRetry }: { busy: boolean; onRetry: () => void }) {
  return (
    <Alert role="alert">
      <AlertTitle>Status pengajuan belum pasti</AlertTitle>
      <AlertDescription>
        Sistem tidak mengirim ulang otomatis. Mencoba kembali memakai kunci idempotensi yang sama meminta server mengembalikan hasil sebelumnya tanpa membuat permintaan ganda.
      </AlertDescription>
      <Button className="mt-3 min-h-11" disabled={busy} onClick={onRetry} type="button" variant="outline">
        {busy ? "Memeriksa…" : "Coba lagi dengan kunci yang sama"}
      </Button>
    </Alert>
  )
}

function CorrectionRequestFormFields({
  correctionKind,
  effectiveCheckIn,
  effectiveCheckOut,
  onCheckInChange,
  onCheckOutChange,
  option,
  session,
  type,
  disabled,
}: {
  correctionKind: CorrectionType
  effectiveCheckIn: string
  effectiveCheckOut: string
  onCheckInChange: (value: string) => void
  onCheckOutChange: (value: string) => void
  option: CorrectionOption
  session?: EffectiveSession & { workDate: string }
  type: RequestFormType
  disabled: boolean
}) {
  const timezone = option.deadline.historical_timezone
  const recorded = session?.original
  const showCheckIn = type === "reconstruction" || correctionKind !== "missing_checkout"
  const showCheckOut = type === "reconstruction" || correctionKind !== "check_in"

  return (
    <div className="flex flex-col gap-4">
      <dl className="grid gap-x-4 gap-y-3 border-y border-border py-3 sm:grid-cols-2">
        {session ? (
          <>
            <SummaryField label="Work Date asal" value={recorded?.work_date ?? "Tidak tersedia pada data sesi"} />
            <SummaryField label="Outlet asal" value={recorded?.outlet?.name ?? "Tidak tersedia pada data sesi"} />
            <SummaryField label="Work Date pada opsi" value={option.work_date} />
            <SummaryField label="Outlet pada opsi" value={option.outlet.name} />
            <SummaryField label="Sesi presensi" value={`#${option.session_id}`} />
          </>
        ) : (
          <>
            <SummaryField label="Work Date" value={option.work_date} />
            <SummaryField label="Outlet" value={option.outlet.name} />
            <SummaryField label="Sesi presensi" value="Tidak ada sesi tercatat · rekonstruksi" />
          </>
        )}
        <SummaryField label="Jenis koreksi" value={correctionTypeLabel(option.correction_type)} />
        <SummaryField label="Batas pengajuan" value={formatAttendanceTime(option.deadline.exclusive_at, timezone)} />
      </dl>

      {session ? (
        <table className="w-full table-fixed border-y border-border text-left">
          <caption className="py-2 text-left text-label">Nilai asli dan usulan</caption>
          <thead>
            <tr className="border-b border-border text-caption text-muted-foreground">
              <th className="w-20 py-2 pr-2 font-normal" scope="col">Waktu</th>
              <th className="px-1 py-2 font-normal" scope="col">Asli</th>
              <th className="py-2 pl-1 font-normal" scope="col">Diajukan</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {showCheckIn ? (
              <tr>
                <th className="py-2 pr-2 text-caption font-normal" scope="row">Masuk</th>
                <td className="break-words px-1 py-2 text-caption tabular-nums">{formatAttendanceTime(recorded?.check_in_at ?? null, timezone)}</td>
                <td className="break-words py-2 pl-1 text-caption tabular-nums">{displayProposedTime(effectiveCheckIn, timezone)}</td>
              </tr>
            ) : null}
            {showCheckOut ? (
              <tr>
                <th className="py-2 pr-2 text-caption font-normal" scope="row">Keluar</th>
                <td className="break-words px-1 py-2 text-caption tabular-nums">{formatAttendanceTime(recorded?.check_out_at ?? null, timezone)}</td>
                <td className="break-words py-2 pl-1 text-caption tabular-nums">{displayProposedTime(effectiveCheckOut, timezone)}</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      ) : (
        <p className="border-y border-border py-3 text-caption text-muted-foreground">Catatan asli tidak tersedia karena rekonstruksi berlaku saat kedua presensi terlewat.</p>
      )}

      {showCheckIn ? (
        <Field>
          <FieldLabel htmlFor="correct-checkin">Waktu masuk efektif</FieldLabel>
          <Input aria-describedby="correction-timezone-hint" disabled={disabled} id="correct-checkin" onChange={(event) => onCheckInChange(event.target.value)} required={type === "reconstruction" || correctionKind === "check_in" || (correctionKind === "session" && !effectiveCheckOut)} type="datetime-local" value={effectiveCheckIn} />
        </Field>
      ) : null}
      {showCheckOut ? (
        <Field>
          <FieldLabel htmlFor="correct-checkout">Waktu keluar efektif</FieldLabel>
          <Input aria-describedby="correction-timezone-hint" disabled={disabled} id="correct-checkout" onChange={(event) => onCheckOutChange(event.target.value)} required={type === "reconstruction" || correctionKind === "missing_checkout"} type="datetime-local" value={effectiveCheckOut} />
        </Field>
      ) : null}
      <p className="text-caption text-muted-foreground" id="correction-timezone-hint">Waktu usulan diisi menurut zona waktu perangkat. Batas pengajuan memakai zona historis Outlet yang ditampilkan di atas.</p>
    </div>
  )
}

function displayProposedTime(value: string, timezone: string) {
  if (!value) return "Tidak diubah"
  const instant = new Date(value)
  return Number.isNaN(instant.valueOf()) ? "Waktu tidak valid" : formatAttendanceTime(instant.toISOString(), timezone)
}

function SummaryField({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-caption text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 break-words text-body">{value}</dd>
    </div>
  )
}

function RequestDetailOverlay({
  request,
  wide,
  busy,
  evidenceOpen,
  onClose,
  onCancel,
  onToggleEvidence,
}: {
  request: RequestRecord
  wide: boolean
  busy: boolean
  evidenceOpen: boolean
  onClose: () => void
  onCancel: () => void
  onToggleEvidence: () => void
}) {
  const content = <RequestDetails busy={busy} evidenceOpen={evidenceOpen} onCancel={onCancel} onToggleEvidence={onToggleEvidence} request={request} />
  if (wide) {
    return (
      <Sheet modal={false} open onOpenChange={(open) => !open && onClose()}>
        <SheetContent className="w-full overflow-hidden pb-[env(safe-area-inset-bottom)] sm:max-w-md" side="right">
          <SheetHeader className="gap-1 border-b border-border px-5 pb-3 pt-5 pr-14">
            <SheetTitle>{requestTitle(request)}</SheetTitle>
            <SheetDescription>{statusLabel(request)}</SheetDescription>
          </SheetHeader>
          {content}
        </SheetContent>
      </Sheet>
    )
  }
  return (
    <Drawer open onOpenChange={(open) => !open && onClose()}>
      <DrawerContent className="max-h-[88dvh] overflow-hidden rounded-t-lg pb-0 before:rounded-lg">
        <DrawerHeader className="px-5 pb-2 pt-1 text-left">
          <DrawerTitle>{requestTitle(request)}</DrawerTitle>
          <DrawerDescription>{statusLabel(request)}</DrawerDescription>
        </DrawerHeader>
        {content}
      </DrawerContent>
    </Drawer>
  )
}

function RequestDetails({
  request,
  busy,
  evidenceOpen,
  onCancel,
  onToggleEvidence,
}: {
  request: RequestRecord
  busy: boolean
  evidenceOpen: boolean
  onCancel: () => void
  onToggleEvidence: () => void
}) {
  const sessionId = Number(request.details.attendance_session_id)
  const hasSessionId = Number.isSafeInteger(sessionId) && sessionId > 0
  return (
    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-[calc(1rem+env(safe-area-inset-bottom))]" data-request-detail-scroll="true">
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 border-b border-border py-3">
        <SummaryField label="Status" value={statusLabel(request)} />
        <SummaryField label="Tanggal kerja" value={request.work_date ?? `${request.starts_on ?? ""} – ${request.ends_on ?? ""}`} />
        {request.outlet ? <SummaryField label="Outlet" value={request.outlet.name} /> : null}
        {hasSessionId ? <SummaryField label="Sesi presensi" value={`#${sessionId}`} /> : null}
        <SummaryField label="Jenis permintaan" value={requestTitle(request)} />
      </dl>
      <section className="border-b border-border py-3">
        <h3 className="text-label">Alasan</h3>
        <p className="mt-1 whitespace-pre-wrap text-body">{request.reason ?? "Tidak ada alasan pada data permintaan."}</p>
      </section>
      {request.type === "attendance_correction" ? (
        <section className="flex flex-col gap-3 border-b border-border py-3">
          <CorrectionComparison request={request} />
          <Button aria-expanded={evidenceOpen} className="min-h-11 self-start" onClick={onToggleEvidence} size="sm" type="button" variant="outline">
            {evidenceOpen ? "Sembunyikan bukti koreksi" : "Lihat bukti koreksi"}
          </Button>
          {evidenceOpen ? <CorrectionEvidencePanel key={request.id} requestId={request.id} /> : null}
        </section>
      ) : null}
      {request.type === "overtime" ? <p className="border-b border-border py-3 text-caption text-muted-foreground">Persetujuan ini tidak mengubah durasi kehadiran aktual.</p> : null}
      {request.decision_history.length ? (
        <section className="border-b border-border py-3">
          <h3 className="text-label">Riwayat keputusan</h3>
          <ol className="mt-2 flex flex-col divide-y divide-border">
            {request.decision_history.map((decision, index) => (
              <li className="py-2 text-caption" key={`${decision.acted_at}-${index}`}>
                <span className="font-medium">{decisionLabel(decision.action)}</span> · {formatDate(decision.acted_at)}
                {decision.reason ? <p className="mt-1 text-muted-foreground">{decision.reason}</p> : null}
              </li>
            ))}
          </ol>
        </section>
      ) : (
        <p className="border-b border-border py-3 text-caption text-muted-foreground">Belum ada keputusan. Permintaan masih menunggu pengelola.</p>
      )}
      {request.status === "pending" && request.type !== "attendance_review" ? (
        <Button className="my-3 min-h-11" disabled={busy} onClick={onCancel} type="button" variant="outline">Batalkan permintaan</Button>
      ) : null}
    </div>
  )
}

function requestErrorMessage(error: ApiError): string {
  if (error.code === "employee_link_required") {
    return "Akun ini belum terhubung ke identitas karyawan untuk mengajukan permintaan."
  }
  if (error.code === "employee_role_required") {
    return "Peran Karyawan diperlukan untuk mengajukan permintaan."
  }
  if (error.status >= 500) {
    return "Sistem sedang mengalami gangguan. Hasil permintaan belum dapat dipastikan. Periksa riwayat sebelum mencoba lagi."
  }
  if (error.status === 403) {
    return "Akses untuk tindakan ini tidak tersedia pada organisasi aktif. Periksa keanggotaan atau minta bantuan Owner."
  }
  if (error.status === 404) {
    return "Permintaan atau sesi presensi tidak ditemukan atau tidak dapat diakses."
  }
  if (error.status === 409) {
    return "Status permintaan berubah. Muat ulang riwayat sebelum mencoba lagi."
  }
  if (error.status === 422) {
    const fieldLabels: Record<string, string> = {
      type: "jenis permintaan",
      category: "kategori",
      starts_on: "tanggal mulai",
      ends_on: "tanggal selesai",
      work_date: "tanggal kerja",
      starts_at: "waktu mulai",
      ends_at: "waktu selesai",
      attendance_session_id: "sesi presensi",
      effective_check_in_at: "waktu masuk efektif",
      effective_check_out_at: "waktu keluar efektif",
      effective_work_date: "tanggal kerja efektif",
      effective_outlet_id: "outlet efektif",
      reason: "alasan",
      idempotency_key: "permintaan",
    }
    const first = Object.entries(error.errors ?? {}).find(
      ([field, messages]) => fieldLabels[field] && messages.length > 0
    )

    if (first) {
      const [field, messages] = first
      const message = messages[0]
      if (/^(the|this|must|has|is|was)\b/i.test(message)) {
        return `Periksa ${fieldLabels[field]}; format atau nilainya belum sesuai.`
      }
      return message
    }

    return "Data belum sesuai. Periksa jenis permintaan, tanggal, jam, sesi presensi, dan alasan."
  }

  return "Permintaan belum dapat diproses. Periksa data dan coba kembali."
}

function CorrectionComparison({ request }: { request: RequestRecord }) {
  const originalValue =
    (request.details.original as Record<string, unknown> | undefined) ??
    request.correction?.original_values
  const original =
    (originalValue?.recorded as Record<string, unknown> | undefined) ??
    originalValue
  const proposed =
    (request.details.proposed as Record<string, unknown> | undefined) ??
    request.correction?.proposed_values
  if (!original && !proposed) return null
  return (
    <table className="w-full table-fixed border-y border-border text-left">
      <caption className="py-2 text-left text-label">Nilai asli dan usulan</caption>
      <thead>
        <tr className="border-b border-border text-caption text-muted-foreground">
          <th className="w-20 py-2 pr-2 font-normal" scope="col">Waktu</th>
          <th className="px-1 py-2 font-normal" scope="col">Asli</th>
          <th className="py-2 pl-1 font-normal" scope="col">Diajukan</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-border">
        {(["check_in_at", "check_out_at"] as const).map((key) => (
          <tr key={key}>
            <th className="py-2 pr-2 text-caption font-normal" scope="row">{key === "check_in_at" ? "Masuk" : "Keluar"}</th>
            <td className="break-words px-1 py-2 text-caption tabular-nums">{formatRequestInstant(original?.[key])}</td>
            <td className="break-words py-2 pl-1 text-caption tabular-nums">{formatRequestInstant(proposed?.[key])}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function formatRequestInstant(value: unknown) {
  if (typeof value !== "string" || !value) return "Tidak tercatat"
  return formatDate(value)
}

function requestTitle(request: RequestRecord) {
  if (request.details.correction_target === "reconstruction") return "Rekonstruksi presensi"
  if (request.type === "attendance_correction") return "Koreksi presensi"
  if (request.type === "overtime") return "Permintaan lembur"
  if (request.type === "attendance_review") return "Tinjauan presensi"
  return `Permintaan ${categoryLabel(String(request.details.category ?? "permission"))}`
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
function statusLabel(request: RequestRecord) {
  if (request.reversed) return "Dibalik"
  if (request.status === "pending") {
    return request.type === "attendance_review"
      ? "Menunggu tinjauan"
      : "Menunggu persetujuan"
  }
  return (
    {
      approved: "Disetujui",
      rejected: "Ditolak",
      cancelled: "Dibatalkan",
    } as const
  )[request.status]
}
function statusVariant(
  status: RequestRecord["status"]
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
        missing_checkout: "presensi keluar belum tercatat",
        unscheduled_work: "kerja di luar jadwal",
        rest_day_work: "kerja pada hari libur",
        outlet_closed: "outlet tutup",
        location_outside_range: "lokasi di luar area",
        approved_leave_with_recorded_attendance:
          "izin berbenturan dengan kehadiran",
      } as Record<string, string>
    )[indicator] ?? indicator.replaceAll("_", " ")
  )
}
function formatDate(value: string | null) {
  if (!value) return "—"
  const date = new Date(value)
  return Number.isNaN(date.valueOf())
    ? "—"
    : date.toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" })
}
function formatDuration(seconds: number | null) {
  return seconds === null
    ? "belum ditentukan"
    : `${Math.floor(seconds / 3600)}j ${Math.floor((seconds % 3600) / 60)}m`
}
