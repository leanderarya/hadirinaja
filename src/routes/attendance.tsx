import { createFileRoute } from "@tanstack/react-router"
import {
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  Camera,
  Check,
  CircleAlert,
  Clock3,
  History,
  LoaderCircle,
  LocateFixed,
  Lock,
  LogIn,
  LogOut,
  MapPin,
  RefreshCw,
  RotateCcw,
  Send,
  Store,
} from "lucide-react"
import { useCallback, useEffect, useRef, useState } from "react"
import { AttendanceCameraStep } from "@/components/attendance/attendance-camera-step"
import { AttendanceConfirmationSummary } from "@/components/attendance/attendance-confirmation-summary"
import { AttendanceLocationStep } from "@/components/attendance/attendance-location-step"
import { AttendanceResultStep } from "@/components/attendance/attendance-result-step"
import { AttendanceStepHeading } from "@/components/attendance/attendance-step-heading"
import { LocationMapPreview } from "@/components/attendance/location-map-preview"
import { EmployeeAttendanceHistory } from "@/components/employee-attendance-history"
import { EmployeeShell } from "@/components/employee-shell"
import { OutletGeofenceMap } from "@/components/outlet-geofence-map"
import { RoamButton } from "@/components/roam/roam-button"
import { RoamStepTrail } from "@/components/roam/roam-step-trail"
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
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { Spinner } from "@/components/ui/spinner"
import { ApiError, type AuthSession, apiRequest } from "@/lib/api"
import {
  correctionHref,
  type PersonalCorrectionOptions,
} from "@/lib/attendance-correction-navigation"
import {
  type AttendanceFlowStage,
  type AttendanceSummaryKey,
  attendanceFlowSteps,
  attendanceFlowTitle,
  attendanceResultCopy,
  attendanceTrailState,
  confirmationRows,
  operationNoun,
} from "@/lib/attendance-flow"
import {
  type AttendancePhotoIdentity,
  type AttendancePhotoOperation,
  attendanceIdentityChangeEventName,
  attendanceIdentityChangeSignalKey,
  captureLegacyPendingMetadata,
  loadPendingAttendanceMetadata,
  loadPendingAttendancePhoto,
  removePendingAttendanceMetadata,
  removePendingAttendancePhoto,
  removePhotosOutsideIdentity,
  removeStaleAttendancePhotos,
  savePendingAttendanceMetadata,
  savePendingAttendancePhoto,
} from "@/lib/attendance-photo-recovery"
import {
  attendanceConfirmation,
  attendanceOutcomeLabel,
  attendanceWorkDate,
  currentWeekAttendance,
  type EffectiveAttendanceDay,
  formatWorkDate,
} from "@/lib/attendance-presentation"
import { getAuthRecoveryPath } from "@/lib/auth-navigation"
import { cameraStageView } from "@/lib/camera-presentation"
import {
  distanceMeters,
  locationEligibility,
  validCoordinates,
} from "@/lib/geofence"
import {
  type LocationStageState,
  locationDeviceOffset,
  locationStageView,
} from "@/lib/location-presentation"
import { notifications } from "@/lib/notifications"
import {
  type AttendanceEligibilityStatus,
  attendanceEligibilityCopy,
} from "@/lib/personal-eligibility"

export const Route = createFileRoute("/attendance")({
  component: AttendancePage,
})

type ReviewableSession = {
  id: number
  status: "active" | "closed" | "administratively_resolved"
  work_date: string
  timezone: string
  check_in_at: string
  check_out_at: string | null
  outlet: { id: number; name: string | null }
  review_indicators: string[]
}

type Schedule = {
  work_date: string
  status: "scheduled" | "rest" | "unscheduled"
  outlet: { id: number; name: string } | null
  timezone: string
  shift: { name: string | null; start_time: string; end_time: string } | null
  scheduled_start: string | null
  scheduled_end: string | null
  outlet_operating: boolean | null
  conflicts: string[]
}

type AttendanceReady = {
  eligibility: {
    status: Exclude<
      AttendanceEligibilityStatus,
      | "employee_link_required"
      | "employee_unavailable"
      | "employee_role_required"
    >
  }
  require_personal_photo?: boolean
  server_time: string
  employee: { id: number; name: string }
  outlets: Array<{ id: number; name: string }>
  selected_outlet_id: number | null
  schedule: Schedule | null
  active_session: ReviewableSession | null
  allowed_next_operation: "check_in" | "check_out" | null
  personal_location: PersonalLocationPolicy
  checkout_destination: {
    id: number
    name: string
    timezone: string
    mode_allowed: boolean
    personal_location: PersonalLocationPolicy
  } | null
  effective_attendance?: EffectiveAttendanceDay[]
  correction_options?: PersonalCorrectionOptions
  recent_history: ReviewableSession[]
}

type PersonalLocationPolicy = {
  required: boolean
  radius_meters: number | null
  geofence_configured: boolean
  latitude?: number | null
  longitude?: number | null
  max_accuracy_meters?: number | null
}

type AttendanceIdentityUnavailable = {
  eligibility: {
    status:
      | "employee_link_required"
      | "employee_unavailable"
      | "employee_role_required"
  }
  employee: null
}

type AttendanceState = AttendanceReady | AttendanceIdentityUnavailable

type CheckoutDestination = NonNullable<AttendanceReady["checkout_destination"]>

type AttendanceHome = {
  attendance: AttendanceState
  selectedOutletId: string
  selectableOutlets: AttendanceReady["outlets"]
  checkoutDestinations: CheckoutDestination[]
}

type AttendanceRequestSummary = {
  id: number
  type: string
  status: "pending" | "approved" | "rejected" | "cancelled"
  details: Record<string, unknown>
}

type LocationEvidence = {
  status: "provided" | "unavailable" | "permission_denied"
  latitude?: number
  longitude?: number
  accuracy_meters?: number
}

type AttendanceOperation = "check_in" | "check_out"

type PendingOperation = {
  key: string
  operation: AttendanceOperation
  userId: number
  tenantId: number
  employeeId: number
  outletId: number | null
  checkoutSessionId?: number
  location: LocationEvidence | null
  needsRecovery: boolean
  photoUnavailable?: boolean
  photo?: Blob
  photoSkipped?: boolean
}

type CheckoutSelection = {
  outletId: number | null
  sessionId: number | null
  employeeId: number
}

type AttendanceDraft = {
  operation: AttendanceOperation
  userId: number
  tenantId: number
  employeeId: number
  outletId: number | null
  checkoutSessionId?: number
  outletName: string | null
  location: LocationEvidence
}

type OperationResult = {
  operation: {
    key: string
    type: AttendanceOperation
    state: "completed" | "pending"
  }
  event?: { id: number; type: AttendanceOperation; recorded_at: string }
  session?: ReviewableSession
  server_time?: string
}

function formatSummaryTime(
  value: string | null | undefined,
  timezone?: string
) {
  if (!value) return "Belum tercatat"

  if (/^\d{2}:\d{2}(?::\d{2})?$/.test(value))
    return value.slice(0, 5).replace(":", ".")

  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return "Waktu belum tersedia"

  try {
    return new Intl.DateTimeFormat("id-ID", {
      hour: "2-digit",
      hourCycle: "h23",
      minute: "2-digit",
      timeZone: timezone || "UTC",
    })
      .format(date)
      .replace(":", ".")
  } catch {
    return "Waktu belum tersedia"
  }
}

function attendanceSummaryTimestamps(day: EffectiveAttendanceDay | undefined) {
  const checkIns = (day?.sessions ?? [])
    .map(
      (session) => session.effective.check_in_at ?? session.original.check_in_at
    )
    .filter((value): value is string => Boolean(value))
  const checkOuts = (day?.sessions ?? [])
    .map(
      (session) =>
        session.effective.check_out_at ?? session.original.check_out_at
    )
    .filter((value): value is string => Boolean(value))

  for (const source of day?.sources ?? []) {
    if (source.source_kind === "reconstruction") {
      checkIns.push(source.effective.check_in_at)
      checkOuts.push(source.effective.check_out_at)
    }
  }

  const ordered = (values: string[], direction: "first" | "last") =>
    values
      .map((value, index) => ({ value, index, time: Date.parse(value) }))
      .sort((left, right) => {
        if (Number.isFinite(left.time) && Number.isFinite(right.time))
          return direction === "first"
            ? left.time - right.time
            : right.time - left.time
        if (Number.isFinite(left.time) !== Number.isFinite(right.time))
          return Number.isFinite(left.time) ? -1 : 1
        return left.index - right.index
      })[0]?.value ?? null

  return {
    checkIn: ordered(checkIns, "first"),
    checkOut: ordered(checkOuts, "last"),
  }
}

function AttendancePage() {
  const [attendance, setAttendance] = useState<AttendanceState | null>(null)
  const [requestSummary, setRequestSummary] = useState<
    AttendanceRequestSummary[] | null
  >(null)
  const [photoIdentity, setPhotoIdentity] =
    useState<AttendancePhotoIdentity | null>(null)
  const [isOwner, setIsOwner] = useState(false)
  const [accountName, setAccountName] = useState("Karyawan")
  const [selectableOutlets, setSelectableOutlets] = useState<
    AttendanceReady["outlets"]
  >([])
  const [checkoutDestinations, setCheckoutDestinations] = useState<
    CheckoutDestination[]
  >([])
  const [selectedOutletId, setSelectedOutletId] = useState("")
  const [currentLocation, setCurrentLocation] =
    useState<LocationEvidence | null>(null)
  const [locating, setLocating] = useState(false)
  // True while the browser's permission prompt is still unanswered. The frames
  // separate "waiting for the prompt" (TE8Jj) from "acquiring a fix" (JKJG0),
  // and only the Permissions API can tell us which one we are in.
  const [permissionPending, setPermissionPending] = useState(false)
  const locationIdentity = `${photoIdentity?.userId}.${photoIdentity?.tenantId}.${photoIdentity?.employeeId}.${attendance?.employee ? attendance.active_session?.id : ""}.${selectedOutletId}`
  const locationContext = useRef(locationIdentity)
  useEffect(() => {
    if (locationContext.current !== locationIdentity) {
      locationContext.current = locationIdentity
      setCurrentLocation(null)
    }
  }, [locationIdentity])
  const [pending, setPending] = useState<PendingOperation | null>(null)
  const [operationState, setOperationState] = useState<
    "idle" | "sending" | "checking" | "pending" | "not_found" | "cleanup_failed"
  >("idle")
  const [loading, setLoading] = useState(true)
  const [photoStorageReady, setPhotoStorageReady] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")
  const [stateFresh, setStateFresh] = useState(true)
  const [cameraOpen, setCameraOpen] = useState(false)
  const [verificationStage, setVerificationStage] = useState<
    "destination" | "location" | "photo" | "confirm"
  >("location")
  const [flowOutcome, setFlowOutcome] = useState<
    "idle" | "sending" | "checking" | "success" | "lost"
  >("idle")
  // Snapshot of what was actually sent, so the result screen can report it after
  // the captured blob has been released.
  const [submittedEvidence, setSubmittedEvidence] = useState<{
    hasPhoto: boolean
    skipped: boolean
  } | null>(null)
  const [locationError, setLocationError] = useState("")
  const [cameraMode, setCameraMode] = useState<"capture" | "preview">("capture")
  const [cameraAttempt, setCameraAttempt] = useState(0)
  const [cameraError, setCameraError] = useState("")
  const [cameraReady, setCameraReady] = useState(false)
  const [photoBlob, setPhotoBlob] = useState<Blob | null>(null)
  const [photoUrl, setPhotoUrl] = useState("")
  const [draft, setDraft] = useState<AttendanceDraft | null>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const cameraRef = useRef<MediaStream | null>(null)
  const submissionInFlight = useRef(false)
  const statusCheckInFlight = useRef(false)
  const identityChangeInProgress = useRef(false)
  const verificationAttempt = useRef(0)

  const stopCamera = useCallback(() => {
    cameraRef.current?.getTracks().forEach((track) => {
      track.stop()
    })
    cameraRef.current = null
    if (videoRef.current) videoRef.current.srcObject = null
  }, [])

  const updateCameraReadiness = useCallback(() => {
    const video = videoRef.current
    setCameraReady(
      Boolean(
        video &&
          video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
          video.videoWidth >= 320 &&
          video.videoHeight >= 240
      )
    )
  }, [])

  const refresh = useCallback(
    async (
      outletId?: number,
      checkout = false,
      expectedCheckout?: CheckoutSelection
    ) => {
      const home = await loadAttendanceHome(outletId, checkout)
      const result = home.attendance
      if (identityChangeInProgress.current) return result
      setAttendance(result)
      setStateFresh(true)
      const sameCheckout =
        !expectedCheckout ||
        (result.employee !== null &&
          result.employee.id === expectedCheckout.employeeId &&
          result.active_session?.id === expectedCheckout.sessionId)
      setSelectedOutletId(sameCheckout ? home.selectedOutletId : "")
      setSelectableOutlets(home.selectableOutlets)
      if (checkout && outletId !== undefined && sameCheckout) {
        setCheckoutDestinations((current) => [
          ...current.filter((destination) => destination.id !== outletId),
          ...home.checkoutDestinations,
        ])
      } else {
        setCheckoutDestinations(sameCheckout ? home.checkoutDestinations : [])
      }
      return result
    },
    []
  )

  useEffect(() => {
    let cancelled = false

    async function bootstrap() {
      let storageReady = true
      try {
        const session = await apiRequest<AuthSession>("/auth/me")
        if (!session.active_membership) {
          captureLegacyPendingMetadata()
          await removePhotosOutsideIdentity(null)
          window.location.assign("/select-tenant")
          return
        }
        setAccountName(session.user.name)
        setIsOwner(session.active_membership.roles.includes("owner"))
        const home = await loadAttendanceHome()
        const result = home.attendance
        if (cancelled || identityChangeInProgress.current) return
        setAttendance(result)
        setCheckoutDestinations(home.checkoutDestinations)
        if (result.employee) {
          void apiRequest<{ requests: AttendanceRequestSummary[] }>(
            "/attendance/me/requests"
          )
            .then(({ requests }) => {
              if (!cancelled && !identityChangeInProgress.current)
                setRequestSummary(requests)
            })
            .catch((caught) => {
              if (cancelled) return
              const recoveryPath = getAuthRecoveryPath(caught)
              if (recoveryPath) {
                window.location.assign(recoveryPath)
              }
            })
          const identity: AttendancePhotoIdentity = {
            userId: session.user.id,
            tenantId: session.active_membership.tenant.id,
            employeeId: result.employee.id,
          }
          setPhotoIdentity(identity)
          setSelectedOutletId(home.selectedOutletId)
          setSelectableOutlets(home.selectableOutlets)
          captureLegacyPendingMetadata()
          const metadata = loadPendingAttendanceMetadata(identity)
          try {
            await removePhotosOutsideIdentity(identity, metadata?.key ?? null)
            await removeStaleAttendancePhotos(Date.now(), metadata?.key ?? null)
          } catch {
            storageReady = false
            setError(
              "Foto lokal belum dapat dibersihkan. Status operasi tetap diperiksa; presensi baru diblokir."
            )
          }
          if (metadata) {
            let stored: AttendancePhotoOperation | null = null
            try {
              stored = await loadPendingAttendancePhoto(metadata.key, identity)
            } catch {
              storageReady = false
              setError(
                "Foto pemulihan tidak dapat dibaca. Status operasi tetap diperiksa; pengiriman ulang diblokir."
              )
            }
            const matchesStoredPayload =
              stored?.operation === metadata.operation &&
              stored.outletId === metadata.outletId &&
              stored.checkoutSessionId === metadata.checkoutSessionId
            setPending({
              ...metadata,
              location: matchesStoredPayload
                ? (stored?.location ?? null)
                : null,
              photo: matchesStoredPayload ? stored?.photo : undefined,
              photoSkipped: matchesStoredPayload
                ? stored?.photoSkipped
                : undefined,
              photoUnavailable: !matchesStoredPayload,
              needsRecovery: true,
            })
          }
        } else {
          setPhotoIdentity(null)
          captureLegacyPendingMetadata()
          await removePhotosOutsideIdentity(null)
        }
        if (!cancelled) setPhotoStorageReady(storageReady)
      } catch (caught) {
        const recoveryPath = getAuthRecoveryPath(caught)
        if (recoveryPath) {
          await removePhotosOutsideIdentity(null).catch(() => undefined)
          if (!cancelled) window.location.assign(recoveryPath)
          return
        }
        if (!cancelled) {
          if (
            caught instanceof ApiError &&
            (caught.code === "employee_link_required" ||
              caught.code === "employee_unavailable" ||
              caught.code === "employee_role_required")
          ) {
            setAttendance({
              eligibility: { status: caught.code },
              employee: null,
            })
            return
          }
          setError(
            caught instanceof ApiError && caught.status === 403
              ? "Akses presensi tidak tersedia untuk organisasi aktif. Minta Owner organisasi memeriksa akses Anda."
              : "Status kehadiran atau penyimpanan foto pemulihan belum dapat disiapkan. Presensi dinonaktifkan sampai dapat diperiksa dengan aman."
          )
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void bootstrap()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const onIdentityChanging = () => {
      identityChangeInProgress.current = true
      verificationAttempt.current += 1
      setAttendance(null)
      setRequestSummary(null)
      stopCamera()
      setCameraOpen(false)
      setLocationError("")
      setPhotoBlob(null)
      setDraft(null)
      setPending((current) =>
        current
          ? {
              ...current,
              location: null,
              photo: undefined,
              photoUnavailable: true,
              needsRecovery: false,
            }
          : null
      )
    }
    const onStorage = (event: StorageEvent) => {
      if (event.key === attendanceIdentityChangeSignalKey()) {
        onIdentityChanging()
      }
    }
    const eventName = attendanceIdentityChangeEventName()
    window.addEventListener(eventName, onIdentityChanging)
    window.addEventListener("storage", onStorage)
    return () => {
      window.removeEventListener(eventName, onIdentityChanging)
      window.removeEventListener("storage", onStorage)
    }
  }, [stopCamera])

  useEffect(() => {
    if (
      !cameraOpen ||
      verificationStage !== "photo" ||
      cameraMode !== "capture"
    )
      return
    let cancelled = false

    async function startCamera() {
      setCameraError("")
      setCameraReady(false)
      if (!window.isSecureContext) {
        setCameraError(
          "Kamera memerlukan koneksi aman. Buka HadirinAja melalui HTTPS atau localhost."
        )
        return
      }
      if (!navigator.mediaDevices?.getUserMedia) {
        setCameraError(
          "Browser ini tidak mendukung kamera langsung. Gunakan browser modern pada perangkat berkamera."
        )
        return
      }

      try {
        if (cameraAttempt > 0) {
          await new Promise((resolve) =>
            window.setTimeout(resolve, Math.min(cameraAttempt * 150, 600))
          )
          if (cancelled) return
        }
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            facingMode: "user",
            width: { ideal: 1280 },
            height: { ideal: 960 },
          },
        })
        if (cancelled) {
          stream.getTracks().forEach((track) => {
            track.stop()
          })
          return
        }
        cameraRef.current = stream
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          await videoRef.current.play()
          updateCameraReadiness()
        }
      } catch (caught) {
        const failure = caught as DOMException
        stopCamera()
        setCameraReady(false)
        setCameraError(
          failure.name === "NotAllowedError" || failure.name === "SecurityError"
            ? "Izin kamera ditolak. Izinkan kamera untuk situs ini di pengaturan browser, lalu coba lagi."
            : failure.name === "NotFoundError"
              ? "Kamera tidak ditemukan pada perangkat ini. Gunakan perangkat berkamera atau minta penyelesaian administratif."
              : "Kamera tidak dapat dibuka. Periksa izin dan perangkat, lalu coba lagi."
        )
      }
    }

    void startCamera()
    return () => {
      cancelled = true
      stopCamera()
    }
  }, [
    cameraAttempt,
    cameraMode,
    cameraOpen,
    stopCamera,
    updateCameraReadiness,
    verificationStage,
  ])

  useEffect(() => {
    if (!photoBlob) {
      setPhotoUrl("")
      return
    }
    const url = URL.createObjectURL(photoBlob)
    setPhotoUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [photoBlob])

  useEffect(() => {
    function onVisibilityChange() {
      if (document.visibilityState === "hidden") {
        stopCamera()
        if (
          cameraOpen &&
          verificationStage === "photo" &&
          cameraMode === "capture"
        ) {
          setCameraReady(false)
          setCameraError(
            "Kamera dijeda saat halaman tidak aktif. Aktifkan kembali untuk melanjutkan."
          )
        }
        return
      }
      if (
        cameraOpen &&
        verificationStage === "photo" &&
        cameraMode === "capture"
      ) {
        setCameraAttempt((attempt) => attempt + 1)
      }
      if (pending) {
        setPending((current) => current && { ...current, needsRecovery: true })
        setOperationState("checking")
      }
    }

    document.addEventListener("visibilitychange", onVisibilityChange)
    window.addEventListener("pageshow", onVisibilityChange)
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange)
      window.removeEventListener("pageshow", onVisibilityChange)
    }
  }, [cameraMode, cameraOpen, pending, stopCamera, verificationStage])

  useEffect(() => {
    if (loading || window.location.hash !== "#history") return
    const frame = window.requestAnimationFrame(() => {
      const history = document.getElementById("history")
      history?.focus()
      history?.scrollIntoView()
    })
    return () => window.cancelAnimationFrame(frame)
  }, [loading])

  const refreshLatestState = useCallback(
    async (checkout?: CheckoutSelection, rejection = "") => {
      setStateFresh(false)
      setError(rejection)
      try {
        if (checkout?.outletId != null) {
          try {
            await refresh(checkout.outletId, true, checkout)
          } catch (caught) {
            setSelectedOutletId("")
            if (getAuthRecoveryPath(caught)) throw caught
            // Refresh the available choices without accepting the server's default destination.
            await refresh(undefined, true, checkout)
          }
        } else {
          await refresh(undefined, Boolean(checkout), checkout)
        }
      } catch (caught) {
        if (checkout) setSelectedOutletId("")
        const recovery = getAuthRecoveryPath(caught)
        if (recovery) window.location.assign(recovery)
        else {
          const message =
            "Status terbaru belum dapat dimuat. Muat ulang status sebelum mencatat lagi."
          setError(rejection ? `${rejection} ${message}` : message)
        }
      }
    },
    [refresh]
  )

  const clearPendingOperation = useCallback(
    async (operation: PendingOperation): Promise<boolean> => {
      try {
        await removePendingAttendancePhoto(operation.key)
        removePendingAttendanceMetadata(operation)
        return true
      } catch {
        setPending({
          ...operation,
          location: null,
          photo: undefined,
          photoUnavailable: true,
          needsRecovery: false,
        })
        setOperationState("cleanup_failed")
        setError(
          "Status server sudah diketahui, tetapi data foto lokal belum dapat dibersihkan. Operasi baru diblokir sampai pembersihan berhasil."
        )
        notifications.warning("Foto sementara belum berhasil dibersihkan", {
          id: `attendance:${operation.tenantId}:${operation.employeeId}:${operation.key}:cleanup`,
        })
        return false
      }
    },
    []
  )

  const recoverStatus = useCallback(
    async (
      operation: PendingOperation
    ): Promise<
      "completed" | "rejected" | "pending" | "not_found" | "unknown"
    > => {
      if (statusCheckInFlight.current) return "unknown"
      statusCheckInFlight.current = true
      setOperationState("checking")
      try {
        const result = await apiRequest<{
          state: "not_found" | "pending" | "completed" | "rejected"
          contract_version?: number
          checkout_outlet_id?: number | null
          checkout_session_id?: number | null
          result?: OperationResult | { message?: string; code?: string }
        }>(`/attendance/me/operations/${operation.operation}/${operation.key}`)

        if (
          operation.checkoutSessionId !== undefined &&
          result.state !== "not_found" &&
          (result.contract_version !== 3 ||
            result.checkout_outlet_id !== operation.outletId ||
            (result.checkout_session_id !== operation.checkoutSessionId &&
              !(
                result.state === "rejected" &&
                result.checkout_session_id === null
              )))
        ) {
          setOperationState("pending")
          setPending(
            (current) => current && { ...current, needsRecovery: false }
          )
          setError(
            "Tujuan atau sesi dari server berbeda. Presensi diblokir sampai status diperiksa kembali."
          )
          return "unknown"
        }

        if (result.state === "completed" && result.result) {
          setNotice(attendanceConfirmation(result.result as OperationResult))
          setError("")
          notifications.success("Presensi terkonfirmasi oleh server", {
            id: `attendance:${operation.tenantId}:${operation.employeeId}:${operation.key}:completed`,
          })
          if (await clearPendingOperation(operation)) {
            setPending(null)
            setOperationState("idle")
          }
          await refreshLatestState()
          return "completed"
        } else if (result.state === "rejected") {
          const message =
            (result.result as { message?: string } | undefined)?.message ??
            "Server menolak permintaan kehadiran. Periksa status sebelum memulai operasi baru."
          notifications.error(message, {
            id: `attendance:${operation.tenantId}:${operation.employeeId}:${operation.key}:rejected`,
          })
          if (await clearPendingOperation(operation)) {
            setPending(null)
            setOperationState("idle")
            await refreshLatestState(checkoutSelectionFor(operation), message)
          }
          return "rejected"
        } else if (result.state === "pending") {
          setOperationState("pending")
          setPending(
            (current) => current && { ...current, needsRecovery: false }
          )
          setError("Status server masih diproses. Jangan mulai presensi lain.")
          return "pending"
        } else if (result.state === "not_found") {
          setOperationState("not_found")
          setPending(
            (current) => current && { ...current, needsRecovery: false }
          )
          setError(
            operation.photo || operation.photoSkipped
              ? "Server belum menemukan operasi ini. Periksa status lagi; pengiriman ulang hanya memakai data dan kunci yang sama."
              : "Server belum menemukan operasi ini, tetapi foto lokal sudah dibersihkan. Jangan buat operasi baru; minta penyelesaian administratif yang diaudit."
          )
          return "not_found"
        }
        throw new Error("Status presensi tidak lengkap.")
      } catch (caught) {
        const recoveryPath = getAuthRecoveryPath(caught)
        if (recoveryPath) {
          window.location.assign(recoveryPath)
          return "unknown"
        }
        setOperationState("pending")
        setPending((current) => current && { ...current, needsRecovery: false })
        setError(
          "Status kehadiran belum dapat diperiksa. Hasil tetap belum pasti; periksa kembali sebelum mengirim ulang."
        )
        return "unknown"
      } finally {
        statusCheckInFlight.current = false
      }
    },
    [clearPendingOperation, refreshLatestState]
  )

  useEffect(() => {
    if (pending?.needsRecovery) void recoverStatus(pending)
  }, [pending, recoverStatus])

  async function submitOperation(next: PendingOperation) {
    if (submissionInFlight.current) return
    if (
      (!next.photo && !next.photoSkipped) ||
      !next.location ||
      !photoIdentity ||
      !samePhotoIdentity(next, photoIdentity) ||
      !photoStorageReady ||
      identityChangeInProgress.current
    ) {
      setError(
        "Identitas atau penyimpanan foto berubah. Presensi diblokir sampai status dimuat ulang dengan aman."
      )
      return
    }
    submissionInFlight.current = true
    let requestStarted = false
    setBusy(true)
    setError("")
    setNotice("")
    setOperationState("sending")
    setFlowOutcome("sending")
    setSubmittedEvidence({
      hasPhoto: Boolean(next.photo),
      skipped: Boolean(next.photoSkipped),
    })

    try {
      const identity: AttendancePhotoIdentity = {
        userId: next.userId,
        tenantId: next.tenantId,
        employeeId: next.employeeId,
      }
      await savePendingAttendancePhoto({
        key: next.key,
        operation: next.operation,
        userId: next.userId,
        tenantId: next.tenantId,
        employeeId: next.employeeId,
        outletId: next.outletId,
        checkoutSessionId: next.checkoutSessionId,
        location: next.location,
        photo: next.photo,
        photoSkipped: next.photoSkipped,
        savedAt: Date.now(),
      })
      savePendingAttendanceMetadata({
        ...identity,
        key: next.key,
        operation: next.operation,
        outletId: next.outletId,
        checkoutSessionId: next.checkoutSessionId,
        savedAt: Date.now(),
      })
      setPending(next)
      setPhotoBlob(null)

      const body = new FormData()
      if (next.operation === "check_in" && next.outletId !== null) {
        body.set("outlet_id", String(next.outletId))
      }
      if (
        next.operation === "check_out" &&
        next.checkoutSessionId !== undefined
      ) {
        body.set("checkout_outlet_id", String(next.outletId))
        body.set("checkout_session_id", String(next.checkoutSessionId))
      }
      body.set("location[status]", next.location.status)
      if (next.location.status === "provided") {
        body.set("location[latitude]", String(next.location.latitude))
        body.set("location[longitude]", String(next.location.longitude))
        body.set(
          "location[accuracy_meters]",
          String(next.location.accuracy_meters)
        )
      }
      if (next.photo)
        body.set("photo", next.photo, `attendance-${next.operation}.jpg`)

      const currentSession = await apiRequest<AuthSession>("/auth/me")
      const currentAttendance =
        await apiRequest<AttendanceState>("/attendance/me")
      if (
        currentSession.user.id !== identity.userId ||
        currentSession.active_membership?.tenant.id !== identity.tenantId ||
        currentAttendance.employee?.id !== identity.employeeId ||
        identityChangeInProgress.current
      ) {
        throw new Error("Identitas akun berubah sebelum operasi dikirim.")
      }

      const controller = new AbortController()
      const timeout = window.setTimeout(() => controller.abort(), 30_000)
      requestStarted = true
      let result: OperationResult
      try {
        result = await apiRequest<OperationResult>(
          `/attendance/me/${next.operation === "check_in" ? "check-in" : "check-out"}`,
          {
            method: "POST",
            headers: { "Idempotency-Key": next.key },
            body,
            signal: controller.signal,
          }
        )
      } finally {
        window.clearTimeout(timeout)
      }

      if (result.operation?.state !== "completed") {
        setOperationState("pending")
        setPending({ ...next, needsRecovery: true })
        setError("Status server belum pasti. Memeriksa hasil operasi…")
        setFlowOutcome("checking")
        return
      }

      setNotice(attendanceConfirmation(result))
      notifications.success("Presensi terkonfirmasi oleh server", {
        id: `attendance:${next.tenantId}:${next.employeeId}:${next.key}:completed`,
      })
      setFlowOutcome("success")
      if (await clearPendingOperation(next)) {
        setPending(null)
        setOperationState("idle")
        await refreshLatestState()
      } else {
        setStateFresh(false)
      }
    } catch (caught) {
      if (!requestStarted) {
        if (await clearPendingOperation(next)) {
          setPending(null)
          setOperationState("idle")
        }
        const message =
          caught instanceof Error &&
          caught.message.includes("Identitas akun berubah")
            ? "Identitas akun berubah. Presensi belum dikirim; muat ulang halaman dan periksa kembali status."
            : "Data sementara tidak dapat disiapkan dengan aman. Presensi belum dikirim."
        setError(message)
        notifications.error(message, {
          id: `attendance:${next.tenantId}:${next.employeeId}:${next.key}:preparation`,
        })
        setFlowOutcome("lost")
        return
      }
      const recoveryPath = getAuthRecoveryPath(caught)
      if (recoveryPath) {
        window.location.assign(recoveryPath)
        return
      }
      if (
        caught instanceof ApiError &&
        (caught.code === "employee_link_required" ||
          caught.code === "employee_unavailable")
      ) {
        setAttendance({ eligibility: { status: caught.code }, employee: null })
        if (await clearPendingOperation(next)) {
          setPending(null)
          setOperationState("idle")
        }
        return
      }
      if (
        !(caught instanceof ApiError) ||
        caught.status >= 500 ||
        caught.code === "idempotency_key_conflict"
      ) {
        setOperationState("pending")
        setPending({ ...next, needsRecovery: true })
        setError(
          "Hasil permintaan belum pasti. Periksa status sebelum mengulang."
        )
        setFlowOutcome("lost")
      } else {
        notifications.error(caught.message, {
          id: `attendance:${next.tenantId}:${next.employeeId}:${next.key}:rejected`,
        })
        // A definitive rejection is not an uncertain result: return to Home so the
        // refreshed state is visible, instead of offering a "check status" retry.
        setFlowOutcome("idle")
        setVerificationStage("location")
        setCameraOpen(false)
        setCameraError("")
        setCameraReady(false)
        setPhotoBlob(null)
        if (await clearPendingOperation(next)) {
          setPending(null)
          setOperationState("idle")
          if (next.operation === "check_out") {
            await refreshLatestState(checkoutSelectionFor(next), caught.message)
          } else {
            setError(caught.message)
            await refresh().catch(() => undefined)
          }
        }
      }
    } finally {
      submissionInFlight.current = false
      setBusy(false)
    }
  }

  async function captureLocation(
    policy: PersonalLocationPolicy | null | undefined = locationPolicy
  ): Promise<LocationEvidence> {
    if (!policy?.required) {
      return { status: "unavailable" }
    }
    if (!navigator.geolocation) {
      setCurrentLocation({ status: "unavailable" })
      return { status: "unavailable" }
    }

    const context = locationContext.current
    setLocating(true)
    // Only an "ask on next use" permission state means the prompt is pending; a
    // granted or already-denied permission is never reported as pending.
    void (async () => {
      try {
        const status = await navigator.permissions?.query({
          name: "geolocation",
        })
        if (context === locationContext.current && status?.state === "prompt") {
          setPermissionPending(true)
        }
      } catch {
        // Permissions API unavailable or unsupported name: stay silent and let
        // the locating state stand on its own.
      }
    })()
    try {
      const location = await new Promise<LocationEvidence>((resolve) => {
        navigator.geolocation.getCurrentPosition(
          (position) =>
            resolve({
              status: "provided",
              latitude: position.coords.latitude,
              longitude: position.coords.longitude,
              accuracy_meters: position.coords.accuracy,
            }),
          (failure) =>
            resolve({
              status:
                failure.code === failure.PERMISSION_DENIED
                  ? "permission_denied"
                  : "unavailable",
            }),
          { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 }
        )
      })
      if (context === locationContext.current) setCurrentLocation(location)
      return location
    } finally {
      setLocating(false)
      setPermissionPending(false)
    }
  }

  async function startAttendance(operation: AttendanceOperation) {
    if (
      !attendance?.employee ||
      !photoIdentity ||
      busy ||
      pending ||
      !stateFresh ||
      !photoStorageReady ||
      identityChangeInProgress.current ||
      (operation === "check_in" ? !canCheckIn : !canCheckOut)
    )
      return
    const attempt = ++verificationAttempt.current

    if (operation === "check_out") {
      if (!openSession || !checkoutDestinations.length) return
      const retainedDestination = checkoutDestinations.find(
        (destination) => String(destination.id) === selectedOutletId
      )
      if (!retainedDestination) setSelectedOutletId("")
      setCurrentLocation(null)
      setError("")
      setLocationError("")
      setDraft({
        operation,
        userId: photoIdentity.userId,
        tenantId: photoIdentity.tenantId,
        employeeId: photoIdentity.employeeId,
        outletId: null,
        checkoutSessionId: openSession.id,
        outletName: null,
        location: { status: "unavailable" },
      })
      setVerificationStage("destination")
      setCameraMode("capture")
      setCameraError("")
      setCameraReady(false)
      setPhotoBlob(null)
      setFlowOutcome("idle")
      setCameraOpen(true)
      if (retainedDestination) {
        void changeCheckoutDestination(String(retainedDestination.id))
      }
      return
    }

    if (!locationPolicy || !selectedOutletId || attendance.active_session)
      return
    const context = locationContext.current
    const nextDraft: AttendanceDraft = {
      operation,
      userId: photoIdentity.userId,
      tenantId: photoIdentity.tenantId,
      employeeId: photoIdentity.employeeId,
      outletId: Number(selectedOutletId),
      checkoutSessionId: openSession?.id,
      outletName: checkoutDestination?.name ?? selectedOutlet,
      location: { status: "unavailable" },
    }
    setBusy(true)
    setError("")
    setLocationError("")
    setCurrentLocation(null)
    setDraft(nextDraft)
    setVerificationStage("location")
    setFlowOutcome("idle")
    setCameraMode("capture")
    setCameraError("")
    setCameraReady(false)
    setPhotoBlob(null)
    setCameraOpen(true)
    try {
      const location = await captureLocation()
      if (
        attempt !== verificationAttempt.current ||
        identityChangeInProgress.current ||
        context !== locationContext.current
      )
        return
      const eligibility = locationEligibility(locationPolicy, location)
      setCurrentLocation(location)
      if (!eligibility.eligible) {
        setLocationError(eligibility.message)
        setError(eligibility.message)
        return
      }
      // The compact design (Slicing Index §9.2) makes "Lokasi ditemukan" a real
      // screen with its own primary action, so the flow waits for the tap.
      setDraft({ ...nextDraft, location })
    } catch {
      if (attempt === verificationAttempt.current) {
        const message = "Lokasi belum dapat diperiksa. Coba perbarui lokasi."
        setLocationError(message)
        setError(message)
      }
    } finally {
      if (attempt === verificationAttempt.current) setBusy(false)
    }
  }

  async function refreshVerificationLocation() {
    if (!draft || !locationPolicy || busy || operationState === "sending")
      return
    const attempt = ++verificationAttempt.current
    const context = locationContext.current
    setBusy(true)
    setLocationError("")
    setError("")
    setCurrentLocation(null)
    setVerificationStage("location")
    try {
      const location = await captureLocation()
      if (
        attempt !== verificationAttempt.current ||
        identityChangeInProgress.current ||
        context !== locationContext.current
      )
        return
      const eligibility = locationEligibility(locationPolicy, location)
      setCurrentLocation(location)
      setDraft((current) => (current ? { ...current, location } : current))
      if (!eligibility.eligible) {
        setLocationError(eligibility.message)
        setError(eligibility.message)
        return
      }
    } catch {
      if (attempt === verificationAttempt.current) {
        const message = "Lokasi belum dapat diperiksa. Coba perbarui lokasi."
        setLocationError(message)
        setError(message)
      }
    } finally {
      if (attempt === verificationAttempt.current) setBusy(false)
    }
  }

  function submitVerifiedAttendance() {
    if (!draft || !readyAttendance?.employee) return
    if (verificationStage !== "confirm") {
      if (!canSubmitVerification) return
      setVerificationStage("confirm")
      return
    }
    if (!canSubmitVerification) return
    const next: PendingOperation = {
      ...draft,
      key: window.crypto.randomUUID(),
      needsRecovery: false,
    }
    if (cameraMode === "preview" && photoBlob) {
      void submitOperation({ ...next, photo: photoBlob })
      return
    }
    if (
      readyAttendance.require_personal_photo === false &&
      cameraMode === "capture"
    ) {
      stopCamera()
      void submitOperation({ ...next, photoSkipped: true })
    }
  }

  async function retrySameOperation() {
    if (!pending?.location || (!pending.photo && !pending.photoSkipped)) {
      setError(
        "Foto atau data lokasi sementara tidak tersedia. Periksa status server; jangan mulai operasi baru jika hasil belum pasti."
      )
      return
    }
    setBusy(true)
    try {
      const state = await recoverStatus(pending)
      if (state === "not_found") await submitOperation(pending)
    } finally {
      setBusy(false)
    }
  }

  async function checkPendingAgain() {
    if (!pending) return
    setBusy(true)
    try {
      await recoverStatus(pending)
    } finally {
      setBusy(false)
    }
  }

  function closeCamera() {
    if (operationState === "sending") return
    if (draft?.operation === "check_out") setSelectedOutletId("")
    verificationAttempt.current += 1
    setCameraOpen(false)
    setVerificationStage("location")
    setLocationError("")
    setCameraError("")
    setCameraReady(false)
    setPhotoBlob(null)
    setDraft(null)
    setBusy(false)
    setFlowOutcome("idle")
    setSubmittedEvidence(null)
  }

  // "Ambil ulang foto" from the confirm step goes back one stage. It must not
  // close the dialog, which would reset the whole flow to the location step.
  function returnToPhoto() {
    setVerificationStage("photo")
    retakePhoto()
  }

  function retakePhoto() {
    setPhotoBlob(null)
    setCameraError("")
    setCameraReady(false)
    setCameraMode("capture")
    setCameraAttempt((attempt) => attempt + 1)
  }

  async function capturePhoto() {
    const video = videoRef.current
    if (
      !cameraReady ||
      !video ||
      video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA ||
      video.videoWidth < 320 ||
      video.videoHeight < 240
    ) {
      setCameraError(
        "Kamera belum siap. Tunggu pratinjau tampil, lalu coba lagi."
      )
      return
    }

    const scale = Math.min(1, 1920 / video.videoWidth, 1920 / video.videoHeight)
    const width = Math.round(video.videoWidth * scale)
    const height = Math.round(video.videoHeight * scale)
    if (width < 320 || height < 240) {
      setCameraError("Resolusi kamera terlalu kecil untuk bukti presensi.")
      return
    }

    const canvas = document.createElement("canvas")
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext("2d")
    if (!context) {
      setCameraError("Foto belum dapat diproses oleh browser.")
      return
    }
    context.drawImage(video, 0, 0, width, height)

    let captured: Blob | null = null
    for (const quality of [0.88, 0.78, 0.68, 0.58]) {
      captured = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/jpeg", quality)
      )
      if (captured && captured.size <= 5 * 1024 * 1024) break
    }
    if (!captured || captured.size > 5 * 1024 * 1024) {
      setCameraError("Foto tidak dapat diproses atau melebihi batas 5 MB.")
      return
    }

    stopCamera()
    setPhotoBlob(captured)
    setCameraError("")
    setCameraMode("preview")
  }

  async function reloadHome() {
    if (busy || pending) return
    setBusy(true)
    try {
      await refreshLatestState(
        openSession && readyAttendance
          ? {
              outletId: selectedOutletId ? Number(selectedOutletId) : null,
              sessionId: openSession.id,
              employeeId: readyAttendance.employee.id,
            }
          : undefined
      )
    } finally {
      setBusy(false)
    }
  }

  async function changeOutlet(value: string) {
    setBusy(true)
    setSelectedOutletId(value)
    setStateFresh(false)
    setError("")
    try {
      const outletId = Number(value)
      await refresh(
        outletId,
        Boolean(openSession),
        openSession && readyAttendance
          ? {
              outletId,
              sessionId: openSession.id,
              employeeId: readyAttendance.employee.id,
            }
          : undefined
      )
    } catch (caught) {
      if (openSession) setSelectedOutletId("")
      const recoveryPath = getAuthRecoveryPath(caught)
      if (recoveryPath) {
        window.location.assign(recoveryPath)
        return
      }
      setError(
        caught instanceof ApiError && caught.status === 403
          ? "Outlet tersebut tidak tersedia untuk kehadiran personal Anda."
          : "Jadwal outlet tersebut belum dapat dimuat."
      )
    } finally {
      setBusy(false)
    }
  }

  async function changeCheckoutDestination(value: string) {
    const outletId = Number(value)
    const candidate = checkoutDestinations.find(
      (destination) => destination.id === outletId
    )
    if (
      !candidate ||
      !openSession ||
      !readyAttendance?.employee ||
      busy ||
      pending
    )
      return

    const expected = {
      outletId,
      sessionId: openSession.id,
      employeeId: readyAttendance.employee.id,
    }
    const attempt = ++verificationAttempt.current
    setBusy(true)
    setStateFresh(false)
    setSelectedOutletId(String(outletId))
    setCurrentLocation(null)
    setLocationError("")
    setError("")
    setCameraError("")
    setCameraReady(false)
    setPhotoBlob(null)
    stopCamera()
    setDraft((current) =>
      current
        ? {
            ...current,
            outletId: null,
            outletName: null,
            location: { status: "unavailable" },
          }
        : current
    )
    setVerificationStage("destination")

    try {
      const result = await refresh(outletId, true, expected)
      if (
        attempt !== verificationAttempt.current ||
        identityChangeInProgress.current
      )
        return

      const destination = eligibleCheckoutDestination(
        result,
        readyAttendance.employee.id,
        openSession.id,
        outletId
      )
      if (!destination) {
        setSelectedOutletId("")
        setCheckoutDestinations((current) =>
          current.filter((item) => item.id !== outletId)
        )
        setError(
          "active_session" in result &&
            result.employee?.id === expected.employeeId &&
            result.active_session?.id === expected.sessionId
            ? "Outlet tujuan tidak lagi memenuhi syarat checkout. Pilih Outlet lain."
            : "Sesi aktif berubah. Muat ulang status sebelum melanjutkan."
        )
        return
      }

      locationContext.current = `${photoIdentity?.userId}.${photoIdentity?.tenantId}.${photoIdentity?.employeeId}.${openSession.id}.${outletId}`
      setDraft((current) =>
        current
          ? {
              ...current,
              outletId,
              outletName: destination.name,
              location: { status: "unavailable" },
            }
          : current
      )
      setVerificationStage("location")

      const location = await captureLocation(destination.personal_location)
      if (
        attempt !== verificationAttempt.current ||
        identityChangeInProgress.current ||
        locationContext.current !==
          `${photoIdentity?.userId}.${photoIdentity?.tenantId}.${photoIdentity?.employeeId}.${openSession.id}.${outletId}`
      )
        return

      const eligibility = locationEligibility(
        destination.personal_location,
        location
      )
      setCurrentLocation(location)
      setDraft((current) => (current ? { ...current, location } : current))
      if (!eligibility.eligible) {
        setLocationError(eligibility.message)
        setError(eligibility.message)
        return
      }
    } catch (caught) {
      if (
        attempt !== verificationAttempt.current ||
        identityChangeInProgress.current
      )
        return
      const recoveryPath = getAuthRecoveryPath(caught)
      if (recoveryPath) {
        window.location.assign(recoveryPath)
        return
      }
      if (caught instanceof ApiError && caught.status === 403) {
        setCheckoutDestinations((current) =>
          current.filter((destination) => destination.id !== outletId)
        )
      }
      setSelectedOutletId("")
      setStateFresh(false)
      setVerificationStage("destination")
      setError(
        caught instanceof ApiError && caught.status === 403
          ? "Outlet tujuan checkout tidak lagi tersedia. Pilih Outlet lain."
          : "Eligibility Outlet tujuan belum dapat diverifikasi. Muat ulang status sebelum melanjutkan."
      )
    } finally {
      if (attempt === verificationAttempt.current) setBusy(false)
    }
  }

  const readyAttendance = attendance?.employee ? attendance : null
  const identityStatus =
    attendance && !attendance.employee ? attendance.eligibility.status : null
  const identityCopy = identityStatus
    ? attendanceEligibilityCopy(identityStatus)
    : null
  const openSession = readyAttendance?.active_session ?? null
  const checkoutDestination =
    readyAttendance?.checkout_destination &&
    String(readyAttendance.checkout_destination.id) === selectedOutletId
      ? readyAttendance.checkout_destination
      : null
  const locationPolicy = openSession
    ? checkoutDestination?.personal_location
    : readyAttendance?.personal_location
  const currentOperation = openSession
    ? checkoutDestination?.mode_allowed
      ? "check_out"
      : null
    : (readyAttendance?.allowed_next_operation ?? null)
  const selectedOutlet =
    openSession?.outlet.name ??
    readyAttendance?.outlets.find(
      (outlet) => String(outlet.id) === selectedOutletId
    )?.name ??
    null
  const today = readyAttendance
    ? attendanceWorkDate(
        readyAttendance.server_time,
        readyAttendance.schedule?.timezone ?? "Asia/Jakarta"
      )
    : null
  const week = today
    ? currentWeekAttendance(readyAttendance?.effective_attendance, today)
    : undefined
  const serverHistory = readyAttendance?.effective_attendance
  const historyWorkDate = serverHistory?.length
    ? serverHistory[serverHistory.length - 1].work_date
    : today
  const historyWeek = historyWorkDate
    ? currentWeekAttendance(serverHistory, historyWorkDate)
    : undefined
  const todayResult = week?.find((day) => day.work_date === today)
  const attendanceTimestamps = attendanceSummaryTimestamps(todayResult)
  const todayCheckInAt =
    openSession?.work_date === today
      ? openSession.check_in_at
      : attendanceTimestamps.checkIn
  const todayCheckOutAt =
    openSession?.work_date === today ? null : attendanceTimestamps.checkOut
  const unresolvedSession =
    openSession &&
    today &&
    (openSession.work_date < today ||
      openSession.review_indicators.includes("missing_checkout"))
      ? openSession
      : null
  const pendingCorrection =
    unresolvedSession &&
    requestSummary?.find(
      (request) =>
        request.type === "attendance_correction" &&
        request.status === "pending" &&
        request.details.attendance_session_id === unresolvedSession.id
    )
  const unresolvedCorrection =
    readyAttendance?.correction_options?.sessions.find(
      (option) =>
        option.session_id === unresolvedSession?.id && option.can_start
    )
  const outletNames = new Map([
    ...(readyAttendance?.recent_history ?? []).map(
      ({ outlet }) => [outlet.id, outlet.name] as const
    ),
    ...(readyAttendance?.outlets ?? []).map(
      (outlet) => [outlet.id, outlet.name] as const
    ),
  ])
  const actionsUnavailable =
    loading ||
    !photoIdentity ||
    Boolean(pending) ||
    busy ||
    !stateFresh ||
    !photoStorageReady ||
    identityChangeInProgress.current
  const canCheckIn =
    !actionsUnavailable &&
    !openSession &&
    Boolean(selectedOutletId) &&
    currentOperation === "check_in"
  const canCheckOut =
    !actionsUnavailable &&
    Boolean(openSession) &&
    checkoutDestinations.length > 0
  const schedule = readyAttendance?.schedule ?? null
  const workingToday = Boolean(openSession && openSession.work_date === today)
  const completedToday = !workingToday && Boolean(todayCheckOutAt)
  const statusCardClass =
    !readyAttendance && !loading && error
      ? "attendance-card--error"
      : completedToday || (!workingToday && schedule?.status === "rest")
        ? "attendance-card--muted"
        : "attendance-card--status"
  const todayStatus =
    loading && !attendance
      ? "Memuat presensi…"
      : !stateFresh
        ? "Status terbaru belum tersedia"
        : !readyAttendance
          ? (identityCopy?.title ?? "Data belum termuat")
          : workingToday
            ? "Sudah Check-in"
            : completedToday
              ? "Sudah Check-out"
              : todayResult
                ? attendanceOutcomeLabel(todayResult.outcome)
                : schedule?.status === "rest"
                  ? "Hari libur"
                  : "Belum Check-in"
  const todayStatusDescription =
    loading && !attendance
      ? "Memuat status presensi, jadwal, dan outlet."
      : !stateFresh
        ? "Status belum dapat dipastikan. Muat ulang sebelum memulai presensi."
        : !readyAttendance
          ? (identityCopy?.description ??
            (error
              ? "Status presensi, jadwal, dan outlet gagal dimuat."
              : "Status kehadiran belum tersedia."))
          : workingToday
            ? "Kamu sudah masuk. Check-out saat selesai bekerja."
            : completedToday
              ? "Presensi hari ini sudah lengkap."
              : todayCheckInAt
                ? "Check-in tercatat. Check-out belum tercatat."
                : schedule?.status === "rest"
                  ? "Hari libur. Tidak ada shift yang dijadwalkan hari ini."
                  : schedule?.status === "unscheduled"
                    ? "Jadwal belum tersedia. Hubungi admin untuk memastikan jadwal hari ini."
                    : schedule?.status === "scheduled"
                      ? "Mulai presensi saat kamu tiba di outlet."
                      : "Jadwal dan outlet hari ini belum tersedia."
  const scheduleStatusLabel =
    loading && !attendance
      ? "Memuat"
      : !readyAttendance
        ? "Belum tersedia"
        : schedule?.status === "scheduled"
          ? "Hari kerja"
          : schedule?.status === "rest"
            ? "Hari libur"
            : schedule?.status === "unscheduled"
              ? "Belum dijadwalkan"
              : "Jadwal belum tersedia"
  const scheduleNote =
    loading && !attendance
      ? "Memuat jadwal hari ini."
      : !readyAttendance
        ? (identityCopy?.description ?? "Jadwal belum dapat dimuat.")
        : schedule?.status === "rest"
          ? "Tidak ada jadwal presensi hari ini."
          : schedule?.status === "unscheduled"
            ? "Hubungi admin untuk memastikan jadwal hari ini."
            : schedule?.status === "scheduled"
              ? schedule.shift
                ? ""
                : "Jam shift hari ini belum tersedia."
              : "Jadwal hari ini belum tersedia."
  const outletSummaryName =
    openSession?.outlet.name ??
    (schedule?.status === "scheduled" ? schedule.outlet?.name : null) ??
    selectedOutlet ??
    schedule?.outlet?.name ??
    (!readyAttendance && !loading && error
      ? "Belum dapat dimuat"
      : schedule?.status === "rest"
        ? "Tanpa penugasan"
        : schedule?.status === "unscheduled"
          ? "Belum ditentukan"
          : "Outlet belum ditentukan")
  const outletSummaryCopy =
    loading && !attendance
      ? "Memuat outlet hari ini."
      : !readyAttendance
        ? error
          ? "Silakan muat ulang data hari ini."
          : "Outlet belum tersedia untuk presensi."
        : openSession
          ? "Outlet asal sesi presensi"
          : schedule?.status === "scheduled" &&
              schedule.outlet?.name === selectedOutlet
            ? "Outlet untuk shift hari ini"
            : selectedOutlet
              ? `Outlet aktif · ${selectedOutlet}`
              : schedule?.outlet
                ? "Outlet untuk shift hari ini"
                : schedule?.status === "rest"
                  ? "Tidak ada outlet untuk hari libur."
                  : schedule?.status === "unscheduled"
                    ? "Outlet tampil setelah jadwal tersedia."
                    : "Outlet belum tersedia untuk presensi."
  const showOutletSelect = Boolean(
    readyAttendance &&
      !openSession &&
      selectableOutlets.length &&
      (selectableOutlets.length > 1 || !selectedOutletId)
  )
  const retryVisible =
    !loading && ((Boolean(error) && !readyAttendance) || !stateFresh)
  const attendanceActionLabel = openSession
    ? "Absen Keluar"
    : completedToday
      ? "Presensi selesai"
      : canCheckIn
        ? "Absen Masuk"
        : canCheckOut
          ? "Absen Keluar"
          : schedule?.status === "rest"
            ? "Hari libur"
            : "Absen Masuk"
  const attendanceActionHint =
    loading && !attendance
      ? "Aksi presensi tersedia setelah data selesai dimuat."
      : !readyAttendance
        ? "Periksa koneksi internet, lalu coba lagi."
        : completedToday
          ? "Tidak ada aksi presensi berikutnya hari ini."
          : schedule?.status === "unscheduled"
            ? "Check-in tersedia setelah jadwal dan outlet ditentukan."
            : "Pastikan jadwal dan outlet sesuai."
  const clockTimeZone =
    checkoutDestination?.timezone ??
    openSession?.timezone ??
    readyAttendance?.schedule?.timezone
  const acceptedPhoto = cameraMode === "preview" && Boolean(photoBlob)
  const canSkipOptionalPhoto =
    readyAttendance?.require_personal_photo === false &&
    cameraMode === "capture"
  const canSubmitVerification = Boolean(
    cameraOpen &&
      draft &&
      (draft.operation !== "check_out" || draft.outletId !== null) &&
      (verificationStage === "photo" || verificationStage === "confirm") &&
      !busy &&
      !pending &&
      stateFresh &&
      photoStorageReady &&
      !identityChangeInProgress.current &&
      (acceptedPhoto || canSkipOptionalPhoto)
  )
  const verificationSubmitLabel =
    draft?.operation === "check_out" && draft.outletId === null
      ? "Pilih Outlet tujuan"
      : locating
        ? "Memeriksa lokasi…"
        : acceptedPhoto
          ? "Lanjut ke konfirmasi"
          : canSkipOptionalPhoto
            ? "Lewati foto dan lanjut"
            : "Lanjut ke konfirmasi"
  const verificationOutletName =
    draft?.operation === "check_out"
      ? (draft.outletName ??
        checkoutDestination?.name ??
        "Pilih Outlet tujuan checkout")
      : (draft?.outletName ?? selectedOutlet)
  const verificationLocation = currentLocation ?? draft?.location ?? null
  const outletPoint =
    locationPolicy?.latitude != null && locationPolicy.longitude != null
      ? {
          latitude: locationPolicy.latitude,
          longitude: locationPolicy.longitude,
        }
      : null
  const employeePoint =
    verificationLocation?.status === "provided" &&
    verificationLocation.latitude != null &&
    verificationLocation.longitude != null
      ? {
          latitude: verificationLocation.latitude,
          longitude: verificationLocation.longitude,
        }
      : null
  const verificationDistanceMeters =
    outletPoint &&
    employeePoint &&
    validCoordinates(outletPoint) &&
    validCoordinates(employeePoint)
      ? Math.ceil(distanceMeters(outletPoint, employeePoint))
      : null
  // Device-reported accuracy, used only for display. Eligibility stays owned by
  // locationEligibility(), which applies the policy's own accuracy rule.
  const verificationAccuracyMeters =
    verificationLocation?.status === "provided" &&
    verificationLocation.accuracy_meters != null &&
    Number.isFinite(verificationLocation.accuracy_meters) &&
    verificationLocation.accuracy_meters > 0
      ? Math.ceil(verificationLocation.accuracy_meters)
      : null

  const activeOperation: AttendanceOperation = draft?.operation ?? "check_in"
  const operationNounValue = operationNoun(activeOperation)
  const operationCaption = `${operationNounValue} belum dikirim.`

  const currentLocationEligibility = locationPolicy
    ? locationEligibility(locationPolicy, verificationLocation)
    : { eligible: false, message: "Outlet tujuan belum dapat diverifikasi." }
  // The location step always reports real eligibility: once the flow advances to
  // photo/confirm the earlier check already passed, so it must not re-report a
  // stale "not eligible" while the user is past it.
  const locationView = locationStageView({
    operation: activeOperation,
    required: Boolean(locationPolicy?.required),
    eligible:
      currentLocationEligibility.eligible ||
      verificationStage === "photo" ||
      verificationStage === "confirm",
    message: locationError || currentLocationEligibility.message,
    locating,
    permissionPending,
    location: verificationLocation,
    radiusMeters: locationPolicy?.radius_meters ?? null,
    outletName: verificationOutletName ?? null,
    distanceMeters: verificationDistanceMeters,
    accuracyMeters: verificationAccuracyMeters,
  })

  const cameraView = cameraStageView({
    secureContext:
      typeof window === "undefined" ? true : window.isSecureContext,
    supported:
      typeof navigator === "undefined"
        ? true
        : Boolean(navigator.mediaDevices?.getUserMedia),
    mode: cameraMode,
    ready: cameraReady,
    error: cameraError,
    hasPhoto: Boolean(photoBlob) && cameraMode === "preview",
  })
  const cameraCaption = operationCaption

  // A result screen replaces the whole staged body; it is shown only once the
  // submission leaves the idle state, so no step screen is ever faked as a result.
  const showingResult = flowOutcome !== "idle"
  const flowStage: AttendanceFlowStage = showingResult
    ? "result"
    : verificationStage

  const flowTitle = attendanceFlowTitle({
    stage: flowStage,
    operation: activeOperation,
    submission: flowOutcome,
  })
  const trail = attendanceTrailState({
    stage: flowStage,
    submission: flowOutcome,
  })

  // Waktu comes from the schedule the server assigned, never from the device
  // clock. Lokasi states the measured position; no API contract exposes a
  // street address, so none is invented.
  const scheduleWindow =
    readyAttendance?.schedule?.status === "scheduled" &&
    readyAttendance.schedule.shift
      ? `${formatSummaryTime(
          readyAttendance.schedule.scheduled_start ??
            readyAttendance.schedule.shift.start_time,
          readyAttendance.schedule.timezone
        )}–${formatSummaryTime(
          readyAttendance.schedule.scheduled_end ??
            readyAttendance.schedule.shift.end_time,
          readyAttendance.schedule.timezone
        )}`
      : null
  const locationCopy =
    verificationDistanceMeters == null
      ? null
      : verificationDistanceMeters <= 0
        ? "Di titik outlet"
        : verificationDistanceMeters < 1000
          ? `${Math.ceil(verificationDistanceMeters)} m dari Outlet`
          : // Kilometres keep a four-digit metre value from reading like a decimal.
            `${new Intl.NumberFormat("id-ID", {
              maximumFractionDigits: 1,
            }).format(verificationDistanceMeters / 1000)} km dari Outlet`

  const summaryRows = confirmationRows({
    operation: activeOperation,
    outletName: verificationOutletName ?? null,
    scheduleWindow,
    locationCopy,
    distanceMeters: verificationDistanceMeters,
    hasPhoto: submittedEvidence ? submittedEvidence.hasPhoto : acceptedPhoto,
    photoRequired: readyAttendance?.require_personal_photo !== false,
  })
  const confirmRows = summaryRows.map((row) => ({
    ...row,
    icon: summaryRowIcon(row.key, activeOperation),
  }))

  // "Di luar area" is reported by the location step itself (it carries the same
  // headline and recovery steps as DBvSR); it is never presented as a submitted
  // result, because nothing was submitted.
  const resultCopy = showingResult
    ? attendanceResultCopy({
        submission: flowOutcome,
        operation: activeOperation,
        message: error,
      })
    : null

  const footerAction = {
    label:
      verificationStage === "confirm"
        ? `Konfirmasi ${operationNounValue}`
        : verificationSubmitLabel,
    enabled: canSubmitVerification,
    onClick: submitVerifiedAttendance,
  }

  const resultPrimary = resultCopy
    ? resultCopy.variant === "progress" || resultCopy.variant === "checking"
      ? {
          disabled: true,
          label: resultCopy.headline,
          loading: true,
          loadingLabel: `${resultCopy.headline}…`,
          onClick: () => {},
        }
      : {
          icon:
            resultCopy.variant === "success" ? (
              <ArrowRight aria-hidden="true" size={18} />
            ) : resultCopy.variant === "out_of_range" ? (
              <LocateFixed aria-hidden="true" size={18} />
            ) : (
              <RotateCcw aria-hidden="true" size={18} />
            ),
          label: resultCopy.primaryLabel ?? "",
          loading: busy,
          onClick:
            resultCopy.variant === "success" ? closeCamera : retrySameOperation,
        }
    : null

  const resultSecondary = resultCopy
    ? resultCopy.variant === "success"
      ? {
          href: "#history",
          icon: <History aria-hidden="true" size={18} />,
          label: resultCopy.secondaryLabel ?? "Lihat riwayat absensi",
          onClick: closeCamera,
        }
      : resultCopy.secondaryLabel
        ? {
            icon: <ArrowLeft aria-hidden="true" size={18} />,
            label: resultCopy.secondaryLabel,
            onClick: closeCamera,
          }
        : null
    : null

  // Compact Location step (Slicing Index §9). Every state names exactly one
  // primary action; the failure frames add a secondary exit to Home.
  const locationIsFailure =
    locationView.state === "permission_denied" ||
    locationView.state === "unavailable" ||
    locationView.state === "out_of_range"
  const locationAdvances =
    locationView.state === "acquired" || locationView.state === "not_required"

  const locationPrimary = {
    disabled:
      locationView.primaryDisabled ||
      busy ||
      Boolean(pending) ||
      (!locationIsFailure && !locationAdvances),
    label: locationView.primaryLabel,
    loading:
      locationView.state === "acquiring" ||
      locationView.state === "permission_requested",
    loadingLabel: locationView.primaryLabel,
    onClick: locationIsFailure
      ? () => void refreshVerificationLocation()
      : locationAdvances
        ? () => setVerificationStage("photo")
        : () => {},
  }

  // The compact frames mark step 1 done as soon as the position resolves, and
  // red on any failure, without naming a current step.
  const locationTrailDone =
    flowStage === "location" && locationView.state === "acquired"
      ? 1
      : undefined
  const locationSecondary = locationView.secondaryLabel
    ? { label: locationView.secondaryLabel, onClick: closeCamera }
    : null

  // "unsupported" names no action at all. Preview advances from the sticky
  // footer so the advancing action never moves between renders.
  // Preview advances from inside the camera step, as TA4fH draws it, so the
  // photo stage never shows two primary actions side by side.
  const cameraPrimary =
    cameraView.actionLabel === ""
      ? null
      : cameraMode === "preview"
        ? {
            disabled: !footerAction.enabled,
            icon: <ArrowRight aria-hidden="true" size={18} />,
            label: footerAction.label,
            onClick: footerAction.onClick,
          }
        : cameraView.state === "permission_denied" ||
            cameraView.state === "failed"
          ? {
              disabled: busy,
              icon: <RotateCcw aria-hidden="true" size={18} />,
              label: cameraView.actionLabel,
              onClick: () => setCameraAttempt((attempt) => attempt + 1),
            }
          : {
              disabled: cameraView.state !== "ready" || busy,
              icon: <Camera aria-hidden="true" size={18} />,
              label: cameraView.actionLabel,
              onClick: () => void capturePhoto(),
            }

  return (
    <EmployeeShell
      active="today"
      appearance="attendance"
      accountName={accountName}
      outletContext={{
        outlets: readyAttendance?.outlets ?? [],
        selectedOutletId: null,
        selectedOutletName: "Semua Outlet",
      }}
    >
      <div className="attendance-page">
        <div className="attendance-context">
          <p className="attendance-context-title">Ringkasan hari ini</p>
          {today ? (
            <time className="text-roam-meta" dateTime={today}>
              {formatWorkDate(today)}
            </time>
          ) : loading ? (
            <span className="text-roam-meta">Memuat tanggal…</span>
          ) : null}
        </div>

        {notice && (
          <p className="attendance-notice text-roam-caption" role="status">
            <Check aria-hidden="true" size={16} />
            <span>{notice}</span>
          </p>
        )}

        <section aria-label="Status kehadiran hari ini" className="min-w-0">
          <Card
            aria-busy={loading}
            className={`attendance-card ${statusCardClass}`}
          >
            <CardHeader className="attendance-status-header">
              <div className="attendance-status-eyebrow">
                <p className="text-roam-meta">Presensi hari ini</p>
                {loading ? (
                  <Spinner
                    aria-label="Memuat status presensi"
                    className="size-5"
                  />
                ) : !readyAttendance && error ? (
                  <CircleAlert aria-hidden="true" size={20} />
                ) : openSession?.work_date === today ? (
                  <Clock3 aria-hidden="true" size={20} />
                ) : todayCheckOutAt ? (
                  <Check aria-hidden="true" size={20} />
                ) : (
                  <Clock3 aria-hidden="true" size={20} />
                )}
              </div>
              <CardTitle
                aria-level={2}
                className="attendance-status-card-title text-roam-status"
                id="attendance-status-title"
                role="heading"
              >
                {todayStatus}
              </CardTitle>
              <CardDescription
                className="attendance-status-copy text-roam-body"
                role={
                  loading || (!readyAttendance && error) ? "status" : undefined
                }
              >
                {todayStatusDescription}
              </CardDescription>
            </CardHeader>
            {(readyAttendance || loading) && (
              <CardContent className="attendance-status-times">
                <div className="attendance-time-cell">
                  <p className="text-roam-meta text-roam-secondary">Check-in</p>
                  <p className="attendance-time-value">
                    {loading && !attendance
                      ? "Memuat…"
                      : formatSummaryTime(todayCheckInAt, clockTimeZone)}
                  </p>
                </div>
                <div className="attendance-time-cell">
                  <p className="text-roam-meta text-roam-secondary">
                    Check-out
                  </p>
                  <p className="attendance-time-value">
                    {loading && !attendance
                      ? "Memuat…"
                      : formatSummaryTime(todayCheckOutAt, clockTimeZone)}
                  </p>
                </div>
              </CardContent>
            )}
          </Card>
        </section>

        <Card
          aria-busy={loading}
          className={`attendance-card ${schedule?.status === "scheduled" ? "attendance-card--schedule" : "attendance-card--muted"}`}
        >
          <CardHeader className="attendance-schedule-header">
            <CardTitle
              aria-level={2}
              className="text-roam-section"
              role="heading"
            >
              Shift hari ini
            </CardTitle>
            <Badge variant="secondary">
              <CalendarDays aria-hidden="true" data-icon="inline-start" />
              {scheduleStatusLabel}
            </Badge>
          </CardHeader>
          {schedule?.status === "scheduled" && schedule.shift ? (
            <CardContent className="attendance-schedule-times">
              <div>
                <p className="text-roam-meta">Jam masuk</p>
                <p className="attendance-schedule-time">
                  {formatSummaryTime(
                    schedule.scheduled_start ?? schedule.shift.start_time,
                    schedule.timezone
                  )}
                </p>
              </div>
              <div>
                <p className="text-roam-meta">Jam keluar</p>
                <p className="attendance-schedule-time">
                  {formatSummaryTime(
                    schedule.scheduled_end ?? schedule.shift.end_time,
                    schedule.timezone
                  )}
                </p>
              </div>
            </CardContent>
          ) : (
            <p
              className={`attendance-schedule-note ${schedule?.status === "scheduled" || loading ? "text-roam-caption" : "text-roam-body"}`}
            >
              {scheduleNote}
            </p>
          )}
        </Card>

        <Card
          className={`attendance-card ${schedule?.status === "scheduled" ? "attendance-card--outlet" : "attendance-card--outlet-muted"}`}
        >
          <CardContent className="attendance-outlet-content">
            <span aria-hidden="true" className="attendance-outlet-icon">
              <Store size={20} />
            </span>
            <div className="attendance-outlet-copy">
              <p className="text-roam-meta">Outlet bertugas</p>
              <p className="attendance-outlet-name">{outletSummaryName}</p>
              <p className="text-roam-caption">{outletSummaryCopy}</p>
            </div>
          </CardContent>
          {showOutletSelect && (
            <CardContent className="attendance-outlet-select">
              <FieldGroup>
                <Field data-disabled={pending || busy ? true : undefined}>
                  <FieldLabel htmlFor="attendance-outlet">
                    Outlet presensi
                  </FieldLabel>
                  <NativeSelect
                    disabled={Boolean(pending) || busy}
                    id="attendance-outlet"
                    onChange={(event) => void changeOutlet(event.target.value)}
                    value={selectedOutletId}
                  >
                    <NativeSelectOption value="" disabled>
                      Pilih Outlet
                    </NativeSelectOption>
                    {selectableOutlets.map((outlet) => (
                      <NativeSelectOption
                        key={outlet.id}
                        value={String(outlet.id)}
                      >
                        {outlet.name}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                </Field>
              </FieldGroup>
            </CardContent>
          )}
        </Card>

        <div className="attendance-action-stack">
          {retryVisible ? (
            <Button
              className="w-full"
              disabled={busy || Boolean(pending)}
              isLoading={busy}
              loadingText="Memuat status…"
              onClick={() => void reloadHome()}
              variant="attendance"
            >
              <RefreshCw aria-hidden="true" data-icon="inline-start" />
              {readyAttendance ? "Muat Ulang Status" : "Coba lagi"}
            </Button>
          ) : (
            <Button
              aria-describedby="attendance-action-help"
              className="w-full"
              disabled={!canCheckIn && !canCheckOut}
              isLoading={loading || busy}
              loadingText="Memuat data…"
              onClick={() => {
                if (openSession) void startAttendance("check_out")
                else void startAttendance("check_in")
              }}
              variant="attendance"
            >
              {attendanceActionLabel}
            </Button>
          )}
          {readyAttendance && (
            <Button
              className="attendance-history-link"
              nativeButton={false}
              render={<a href="#history" />}
              variant="outline"
            >
              <History aria-hidden="true" data-icon="inline-start" />
              Lihat riwayat absensi
            </Button>
          )}
          <p
            className="attendance-inline-status text-roam-caption"
            id="attendance-action-help"
          >
            {attendanceActionHint}
          </p>
        </div>

        {identityCopy && (
          <Alert variant="destructive">
            <AlertTitle>{identityCopy.title}</AlertTitle>
            <AlertDescription>{identityCopy.description}</AlertDescription>
            {isOwner && (
              <Button
                className="mt-2 min-h-11 self-start"
                nativeButton={false}
                render={<a href="/access" />}
                variant="outline"
              >
                Atur akses karyawan
              </Button>
            )}
          </Alert>
        )}

        {error && !cameraOpen && (readyAttendance || pending) && (
          <Alert variant={pending ? "default" : "destructive"}>
            <AlertTitle>
              {pending
                ? "Hasil presensi belum dapat dipastikan"
                : "Status presensi"}
            </AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        {readyAttendance && !readyAttendance.effective_attendance && (
          <Button
            className="self-start"
            disabled={busy || Boolean(pending)}
            onClick={() => void reloadHome()}
            variant="outline"
          >
            Muat Ulang Status
          </Button>
        )}

        {unresolvedSession && (
          <Alert
            className="rounded-none border-0 border-l-2 border-border bg-transparent p-0 pl-3"
            variant="neutral"
          >
            <AlertTitle className="text-label">
              Sesi sebelumnya masih terbuka
            </AlertTitle>
            <AlertDescription className="text-caption">
              <div className="flex flex-col gap-1">
                <span>
                  {formatWorkDate(unresolvedSession.work_date)} ·{" "}
                  {unresolvedSession.outlet.name ??
                    "Outlet asal belum tersedia"}
                </span>
                <span>
                  {pendingCorrection
                    ? "Koreksi menunggu keputusan. Sesi tetap terbuka."
                    : "Jika pekerjaan masih berlangsung, selesaikan melalui alur Absen Keluar. Jika sudah berakhir, ajukan koreksi. Sesi tidak ditutup otomatis."}
                </span>
              </div>
            </AlertDescription>
            <Button
              className="min-h-11 justify-self-start px-0"
              nativeButton={false}
              render={
                <a
                  href={
                    pendingCorrection
                      ? `/requests#request-${pendingCorrection.id}`
                      : unresolvedCorrection &&
                          readyAttendance?.correction_options
                        ? correctionHref(
                            readyAttendance.correction_options,
                            unresolvedCorrection
                          )
                        : "/requests"
                  }
                />
              }
              variant="link"
            >
              {pendingCorrection
                ? "Lihat koreksi yang menunggu"
                : unresolvedCorrection
                  ? "Ajukan koreksi sesi sebelumnya"
                  : "Buka Permintaan"}
            </Button>
          </Alert>
        )}

        {readyAttendance && (
          <>
            {pending ? (
              <Alert className="employee-operation-pending" role="status">
                <AlertTitle>Hasil presensi belum dapat dipastikan</AlertTitle>
                <AlertDescription>
                  {pending.checkoutSessionId !== undefined ? (
                    <>
                      Outlet tujuan:{" "}
                      {readyAttendance.outlets.find(
                        (outlet) => outlet.id === pending.outletId
                      )?.name ?? `#${pending.outletId}`}
                      .{" "}
                    </>
                  ) : null}
                  {operationState === "cleanup_failed"
                    ? "Status server diketahui; pembersihan foto lokal gagal. Operasi baru diblokir."
                    : operationState === "checking"
                      ? "Memeriksa status operasi ke server…"
                      : operationState === "pending"
                        ? "Server belum mengonfirmasi hasil. Jangan mulai operasi baru."
                        : operationState === "not_found"
                          ? pending.photo
                            ? "Belum ada catatan untuk permintaan ini. Foto dan kunci operasi tetap disimpan sementara."
                            : "Belum ada catatan dan foto lokal tidak tersedia. Jangan kirim operasi baru; minta penyelesaian administratif yang diaudit."
                          : "Memeriksa status permintaan…"}
                </AlertDescription>
                <div className="employee-pending-actions">
                  <Button
                    disabled={busy}
                    onClick={() => void checkPendingAgain()}
                    variant="outline"
                  >
                    Periksa status lagi
                  </Button>
                  {operationState === "not_found" &&
                  pending.location &&
                  (pending.photo || pending.photoSkipped) ? (
                    <Button
                      disabled={busy}
                      onClick={() => void retrySameOperation()}
                    >
                      Periksa lalu kirim ulang
                    </Button>
                  ) : null}
                </div>
              </Alert>
            ) : null}

            <EmployeeAttendanceHistory
              id="history"
              days={historyWeek}
              currentWorkDate={historyWorkDate}
              outletNames={outletNames}
              correctionOptions={readyAttendance.correction_options}
            />

            {stateFresh && locationPolicy?.required && selectedOutletId && (
              <p className="text-caption" role="status">
                {locating
                  ? "Memeriksa lokasi…"
                  : currentLocation?.status === "provided"
                    ? locationEligibility(locationPolicy, currentLocation)
                        .eligible
                      ? "Lokasi terverifikasi di perangkat."
                      : "Lokasi perlu diperiksa kembali."
                    : currentLocation?.status === "permission_denied"
                      ? "Izin lokasi ditolak."
                      : "Lokasi diperiksa saat memulai presensi."}
              </p>
            )}
            {stateFresh && locationPolicy?.required && selectedOutletId && (
              <Collapsible>
                <CollapsibleTrigger
                  render={<Button className="min-h-11" variant="outline" />}
                >
                  Detail lokasi presensi
                </CollapsibleTrigger>
                <CollapsibleContent className="flex flex-col gap-3 pt-3">
                  <p className="text-label">
                    {checkoutDestination?.name ?? selectedOutlet}
                  </p>
                  <p className="text-caption text-muted-foreground">
                    Radius yang diizinkan ·{" "}
                    {locationPolicy.radius_meters ?? "Belum tersedia"} m
                  </p>
                  <OutletGeofenceMap
                    outletName={
                      checkoutDestination?.name ?? selectedOutlet ?? "Outlet"
                    }
                    latitude={locationPolicy.latitude ?? null}
                    longitude={locationPolicy.longitude ?? null}
                    radiusMeters={locationPolicy.radius_meters}
                    position={
                      currentLocation?.status === "provided" &&
                      currentLocation.latitude != null &&
                      currentLocation.longitude != null &&
                      currentLocation.accuracy_meters != null
                        ? {
                            latitude: currentLocation.latitude,
                            longitude: currentLocation.longitude,
                            accuracy_meters: currentLocation.accuracy_meters,
                          }
                        : null
                    }
                    onLocate={() => {
                      void captureLocation()
                    }}
                    locating={locating || busy || Boolean(pending)}
                  />
                  <p className="text-caption" role="status">
                    {
                      locationEligibility(locationPolicy, currentLocation)
                        .message
                    }
                  </p>
                </CollapsibleContent>
              </Collapsible>
            )}
          </>
        )}
      </div>

      <Dialog
        open={cameraOpen}
        onOpenChange={(open) => {
          if (!open) closeCamera()
        }}
      >
        <DialogContent
          className="attendance-focus-dialog fixed bottom-0 left-0 right-0 top-0 grid h-[100dvh] min-h-0 w-full max-w-none translate-x-0 translate-y-0 grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden rounded-none border-0 bg-canvas p-0 text-foreground shadow-none sm:max-w-none"
          showCloseButton={false}
        >
          {/* Slicing Index §9.10: the 24px design clearance below the status bar,
              replaced by the real safe-area inset on notched devices. Back then
              sits exactly 24px down on a device with no inset. */}
          <DialogHeader
            className="shrink-0 bg-canvas"
            style={{
              // §9.10: 24px of design clearance below the status bar, extended by
              // the real inset on notched devices. `calc` with a 0px fallback is
              // required — a `24px` fallback inside `env()` computes to 0.
              paddingTop: "calc(env(safe-area-inset-top, 0px) + 24px)",
            }}
          >
            <div className="relative mx-auto flex min-h-11 w-full max-w-2xl items-center justify-center px-16">
              <button
                aria-label="Kembali ke halaman presensi"
                className="absolute left-4 top-1/2 flex size-11 -translate-y-1/2 items-center justify-center rounded-full border border-[#E5E7EB] bg-[#FBFBFD] text-[#0E0E10] disabled:opacity-40"
                disabled={operationState === "sending"}
                onClick={closeCamera}
                type="button"
              >
                <ArrowLeft aria-hidden="true" size={20} strokeWidth={2} />
              </button>
              <DialogTitle style={{ fontSize: 16, fontWeight: 700 }}>
                {flowTitle}
              </DialogTitle>
            </div>
            <DialogDescription className="sr-only">
              Verifikasi Outlet, lokasi, dan foto sebelum presensi dikirim.
            </DialogDescription>
          </DialogHeader>

          <main className="min-h-0 overflow-y-auto overscroll-contain">
            <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-5 pb-6 pt-4">
              <RoamStepTrail
                activeIndex={trail.activeIndex}
                complete={trail.complete}
                doneCount={locationTrailDone}
                filledCurrent={
                  flowStage === "location" &&
                  (locationView.state === "acquiring" ||
                    locationView.state === "permission_requested")
                }
                errorIndex={
                  trail.errorIndex ??
                  (flowStage === "location" && locationIsFailure
                    ? 0
                    : undefined)
                }
                steps={attendanceFlowSteps()}
              />
              {draft?.operation === "check_out" && openSession ? (
                <section
                  aria-label="Sesi asal checkout"
                  className="attendance-flow-provenance"
                >
                  <h2 className="text-label">Sesi asal</h2>
                  <dl className="mt-2 grid grid-cols-2 gap-3 text-body">
                    <div>
                      <dt className="text-caption text-muted-foreground">
                        Work Date asal
                      </dt>
                      <dd>
                        <time dateTime={openSession.work_date}>
                          {formatWorkDate(openSession.work_date)}
                        </time>
                      </dd>
                    </div>
                    <div className="min-w-0">
                      <dt className="text-caption text-muted-foreground">
                        Outlet asal
                      </dt>
                      <dd
                        className="truncate"
                        title={openSession.outlet.name ?? undefined}
                      >
                        {openSession.outlet.name ??
                          "Outlet asal belum tersedia"}
                      </dd>
                    </div>
                  </dl>
                </section>
              ) : null}
              {resultCopy ? (
                <AttendanceResultStep
                  caption={resultCopy.caption}
                  description={resultCopy.description}
                  details={
                    resultCopy.variant === "progress" ||
                    resultCopy.variant === "checking"
                      ? confirmRows
                      : summaryRows
                  }
                  detailsTitle={resultCopy.detailsTitle}
                  headline={resultCopy.headline}
                  help={resultCopy.help}
                  primary={resultPrimary ?? undefined}
                  recoverySteps={resultCopy.recoverySteps}
                  recoveryTitle={resultCopy.recoveryTitle}
                  secondary={resultSecondary ?? undefined}
                  variant={resultCopy.variant}
                />
              ) : (
                <>
                  {verificationStage === "confirm" ? (
                    <section
                      aria-labelledby="confirmation-title"
                      className="attendance-flow-stage"
                    >
                      <AttendanceStepHeading
                        description="Periksa ringkasan ini sebelum mengirim absensi."
                        id="confirmation-title"
                        title={`Periksa data ${operationNounValue}`}
                      />
                      <AttendanceConfirmationSummary
                        photoCaption={
                          acceptedPhoto && photoUrl
                            ? "Diambil pada perangkat ini."
                            : undefined
                        }
                        photoUrl={
                          acceptedPhoto && photoUrl ? photoUrl : undefined
                        }
                        rows={confirmRows}
                      />
                      {acceptedPhoto ? (
                        <RoamButton
                          disabled={busy}
                          fullWidth
                          icon={<Camera aria-hidden="true" size={18} />}
                          onClick={returnToPhoto}
                          variant="secondary"
                        >
                          Ambil ulang foto
                        </RoamButton>
                      ) : null}
                      <p className="attendance-flow-caption">
                        Absensi belum dikirim. Konfirmasi untuk mengirim.
                      </p>
                    </section>
                  ) : null}

                  {verificationStage === "destination" ? (
                    <section
                      aria-labelledby="verification-outlet-title"
                      className="attendance-flow-stage"
                    >
                      <AttendanceStepHeading
                        description="Pilih Outlet tujuan untuk melanjutkan pemeriksaan."
                        id="verification-outlet-title"
                        title="Outlet tujuan checkout"
                      />
                    </section>
                  ) : null}

                  {draft?.operation === "check_out" ? (
                    <section
                      aria-label="Outlet tujuan checkout"
                      className="attendance-flow-stage"
                      role="region"
                    >
                      <FieldGroup>
                        <Field
                          data-disabled={busy || pending ? true : undefined}
                        >
                          <FieldLabel htmlFor="checkout-destination">
                            Pilih Outlet tujuan checkout
                          </FieldLabel>
                          <NativeSelect
                            disabled={Boolean(pending) || busy}
                            id="checkout-destination"
                            onChange={(event) =>
                              void changeCheckoutDestination(event.target.value)
                            }
                            value={selectedOutletId}
                          >
                            <NativeSelectOption value="" disabled>
                              Pilih Outlet tujuan
                            </NativeSelectOption>
                            {checkoutDestinations.map((destination) => (
                              <NativeSelectOption
                                key={destination.id}
                                value={String(destination.id)}
                              >
                                {destination.name}
                              </NativeSelectOption>
                            ))}
                          </NativeSelect>
                        </Field>
                        {error && !locationError ? (
                          <p
                            className="text-caption text-destructive"
                            role="alert"
                          >
                            {error}
                          </p>
                        ) : null}
                      </FieldGroup>
                    </section>
                  ) : null}

                  {verificationStage === "location" ? (
                    <div className="attendance-flow-stage">
                      <AttendanceLocationStep
                        caption={locationView.caption}
                        facts={locationView.facts}
                        map={
                          <LocationMapPreview
                            deviceOffset={
                              locationView.mapVariant === "resolved"
                                ? locationDeviceOffset({
                                    distanceMeters: verificationDistanceMeters,
                                    radiusMeters:
                                      locationPolicy?.radius_meters ?? null,
                                  })
                                : null
                            }
                            outletName={
                              locationView.mapVariant === "resolved"
                                ? verificationOutletName
                                : null
                            }
                            variant={locationView.mapVariant}
                          />
                        }
                        operation={activeOperation}
                        primary={locationPrimary}
                        recovery={
                          locationView.recoveryTitle
                            ? {
                                steps: locationView.recoverySteps,
                                title: locationView.recoveryTitle,
                              }
                            : null
                        }
                        secondary={locationSecondary}
                        statusIcon={locationStatusIcon(locationView.state)}
                        title={locationView.title}
                        tone={locationView.tone}
                      />
                    </div>
                  ) : null}

                  {verificationStage === "photo" ? (
                    <div className="attendance-flow-stage">
                      <AttendanceCameraStep
                        caption={cameraCaption}
                        description={cameraView.description}
                        headline={cameraView.headline}
                        help={cameraView.help}
                        note={cameraView.note}
                        noteTitle={cameraView.noteTitle}
                        onVideoReady={updateCameraReadiness}
                        overlayCaption={
                          cameraMode === "preview" || cameraReady
                            ? null
                            : "Menyiapkan kamera…"
                        }
                        photoCaption={
                          cameraMode === "preview"
                            ? "Diambil pada perangkat ini."
                            : null
                        }
                        photoUrl={cameraMode === "preview" ? photoUrl : ""}
                        primary={cameraPrimary}
                        recoverySteps={cameraView.recoverySteps}
                        recoveryTitle={cameraView.recoveryTitle}
                        secondary={
                          cameraMode === "preview"
                            ? {
                                icon: (
                                  <RotateCcw aria-hidden="true" size={18} />
                                ),
                                label:
                                  cameraView.secondaryLabel ??
                                  "Ambil ulang foto",
                                onClick: retakePhoto,
                              }
                            : // When the photo is optional, the skip must stay
                              // reachable: the sticky bar is hidden on this stage.
                              canSkipOptionalPhoto && !acceptedPhoto
                              ? {
                                  label: "Lewati foto dan lanjut",
                                  onClick: footerAction.onClick,
                                }
                              : null
                        }
                        tone={statusTone(cameraView.tone)}
                        videoRef={videoRef}
                      />
                    </div>
                  ) : null}

                  {/* The compact Location design carries its own 132px preview
                      (Slicing Index §9.3) and the camera/confirm/result frames
                      have no map, so the interactive Leaflet surface is not part
                      of the focused flow. It stays on Home's location detail. */}
                </>
              )}
            </div>
          </main>

          {resultCopy || verificationStage !== "confirm" ? null : (
            <footer
              aria-busy={busy}
              className="shrink-0 border-t border-border bg-surface px-5 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-3"
            >
              <div className="mx-auto w-full max-w-2xl">
                <RoamButton
                  disabled={!footerAction.enabled}
                  fullWidth
                  icon={
                    verificationStage === "confirm" ? (
                      <Send aria-hidden="true" size={18} />
                    ) : (
                      <ArrowRight aria-hidden="true" size={18} />
                    )
                  }
                  loading={busy}
                  loadingLabel={loadingLabelFor(footerAction.label)}
                  onClick={footerAction.onClick}
                  variant="primary"
                >
                  {footerAction.label}
                </RoamButton>
              </div>
            </footer>
          )}
        </DialogContent>
      </Dialog>
    </EmployeeShell>
  )
}

/** "Lanjut ke konfirmasi" -> "Lanjut ke konfirmasi…", never "… …". */
function loadingLabelFor(label: string) {
  const trimmed = label.replace(/…+$/, "")
  return `${trimmed}…`
}

function statusTone(
  tone: "accent" | "error" | "neutral"
): "info" | "error" | "neutral" {
  return tone === "accent" ? "info" : tone
}

/**
 * 18px glyph for the compact status line (`FLXF8`). The frames draw a check for a
 * found position, a spinner while working, and an alert for any failure.
 */
function locationStatusIcon(state: LocationStageState) {
  // `TE8Jj` draws a padlock while the browser prompt is unanswered; only the
  // actual fix attempt gets a spinner.
  if (state === "permission_requested")
    return <Lock aria-hidden="true" size={18} />
  if (state === "acquiring")
    return (
      <LoaderCircle aria-hidden="true" className="animate-spin" size={18} />
    )
  if (state === "acquired")
    return <Check aria-hidden="true" size={18} strokeWidth={2.5} />
  if (
    state === "out_of_range" ||
    state === "permission_denied" ||
    state === "unavailable"
  )
    return <CircleAlert aria-hidden="true" size={18} />
  return <MapPin aria-hidden="true" size={18} />
}

function summaryRowIcon(
  key: AttendanceSummaryKey,
  operation: AttendanceOperation
) {
  switch (key) {
    case "operation":
      return operation === "check_in" ? (
        <LogIn aria-hidden="true" size={18} />
      ) : (
        <LogOut aria-hidden="true" size={18} />
      )
    case "time":
      return <Clock3 aria-hidden="true" size={18} />
    case "location":
    case "distance":
      return <MapPin aria-hidden="true" size={18} />
    case "outlet":
      return <Store aria-hidden="true" size={18} />
    case "photo":
      return <Camera aria-hidden="true" size={18} />
  }
}

function eligibleCheckoutDestination(
  state: AttendanceState,
  employeeId: number,
  sessionId: number,
  outletId: number
): CheckoutDestination | null {
  if (!state.employee || state.employee.id !== employeeId) return null
  const destination = state.checkout_destination
  if (
    state.active_session?.id !== sessionId ||
    destination?.id !== outletId ||
    !destination.mode_allowed ||
    !destination.personal_location.geofence_configured
  )
    return null
  return destination
}

async function loadAttendanceHome(
  outletId?: number,
  checkout = false
): Promise<AttendanceHome> {
  const query = outletId
    ? `?${checkout ? "checkout_outlet_id" : "outlet_id"}=${outletId}`
    : ""
  const attendance = await apiRequest<AttendanceState>(`/attendance/me${query}`)
  if (!attendance.employee) {
    return {
      attendance,
      selectedOutletId: "",
      selectableOutlets: [],
      checkoutDestinations: [],
    }
  }
  if (attendance.active_session) {
    const activeSessionId = attendance.active_session.id
    if (checkout && outletId !== undefined) {
      const destination = eligibleCheckoutDestination(
        attendance,
        attendance.employee.id,
        activeSessionId,
        outletId
      )
      return {
        attendance,
        selectedOutletId: destination ? String(destination.id) : "",
        selectableOutlets: attendance.outlets,
        checkoutDestinations: destination ? [destination] : [],
      }
    }

    const previews = await Promise.all(
      attendance.outlets.map(async (outlet) => {
        if (attendance.checkout_destination?.id === outlet.id) {
          return { outlet, state: attendance }
        }
        try {
          return {
            outlet,
            state: await apiRequest<AttendanceState>(
              `/attendance/me?checkout_outlet_id=${outlet.id}`
            ),
          }
        } catch (caught) {
          if (caught instanceof ApiError && caught.status === 403) {
            return { outlet, state: null }
          }
          throw caught
        }
      })
    )
    const changed = previews.find(
      ({ state }) =>
        state &&
        (!state.employee ||
          state.employee.id !== attendance.employee.id ||
          state.active_session?.id !== activeSessionId)
    )
    if (changed?.state) {
      return {
        attendance: changed.state,
        selectedOutletId: "",
        selectableOutlets: changed.state.employee ? changed.state.outlets : [],
        checkoutDestinations: [],
      }
    }
    const checkoutDestinations = previews.flatMap(({ outlet, state }) => {
      const destination = state
        ? eligibleCheckoutDestination(
            state,
            attendance.employee.id,
            activeSessionId,
            outlet.id
          )
        : null
      return destination ? [destination] : []
    })
    return {
      attendance,
      selectedOutletId: "",
      selectableOutlets: attendance.outlets,
      checkoutDestinations,
    }
  }
  const previews = await Promise.all(
    attendance.outlets.map((outlet) =>
      outlet.id === attendance.selected_outlet_id
        ? attendance
        : apiRequest<AttendanceState>(`/attendance/me?outlet_id=${outlet.id}`)
    )
  )
  const changed = previews.find(
    (preview) =>
      !preview.employee ||
      preview.employee.id !== attendance.employee.id ||
      preview.active_session
  )
  if (changed) {
    return {
      attendance: changed,
      selectedOutletId: "",
      selectableOutlets: changed.employee ? changed.outlets : [],
      checkoutDestinations: [],
    }
  }
  const eligible = previews.filter(
    (preview): preview is AttendanceReady =>
      preview.employee !== null &&
      preview.employee.id === attendance.employee.id &&
      !preview.active_session &&
      preview.allowed_next_operation === "check_in"
  )
  const scheduled = eligible.filter(
    (preview) =>
      preview.schedule?.status === "scheduled" &&
      preview.schedule.outlet?.id === preview.selected_outlet_id &&
      !preview.schedule.conflicts.includes("contradictory_schedule_rules")
  )
  const chosen = outletId
    ? eligible.find((preview) => preview.selected_outlet_id === outletId)
    : eligible.length === 1
      ? eligible[0]
      : scheduled.length === 1
        ? scheduled[0]
        : undefined
  return {
    attendance: chosen ?? attendance,
    selectedOutletId: chosen?.selected_outlet_id
      ? String(chosen.selected_outlet_id)
      : "",
    selectableOutlets: attendance.outlets.filter((outlet) =>
      eligible.some((preview) => preview.selected_outlet_id === outlet.id)
    ),
    checkoutDestinations: [],
  }
}

function checkoutSelectionFor(
  operation: PendingOperation
): CheckoutSelection | undefined {
  if (operation.operation !== "check_out") return undefined
  return {
    outletId:
      operation.checkoutSessionId === undefined ? null : operation.outletId,
    sessionId: operation.checkoutSessionId ?? null,
    employeeId: operation.employeeId,
  }
}

function samePhotoIdentity(
  left: AttendancePhotoIdentity,
  right: AttendancePhotoIdentity
): boolean {
  return (
    left.userId === right.userId &&
    left.tenantId === right.tenantId &&
    left.employeeId === right.employeeId
  )
}
