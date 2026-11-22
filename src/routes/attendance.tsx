import { createFileRoute } from "@tanstack/react-router"
import { useCallback, useEffect, useRef, useState } from "react"
import { EmployeeAttendanceClock } from "@/components/employee-attendance-clock"
import { EmployeeAttendanceHistory } from "@/components/employee-attendance-history"
import { EmployeeShell } from "@/components/employee-shell"
import { OutletGeofenceMap } from "@/components/outlet-geofence-map"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { Separator } from "@/components/ui/separator"
import { ApiError, type AuthSession, apiRequest } from "@/lib/api"
import {
  correctionHref,
  type PersonalCorrectionOptions,
} from "@/lib/attendance-correction-navigation"
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
import {
  distanceMeters,
  locationEligibility,
  validCoordinates,
} from "@/lib/geofence"
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

type AttendanceReceipt = {
  operation: AttendanceOperation
  time: string | null
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
  const [photoAccepted, setPhotoAccepted] = useState(false)
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
  const [attendanceReceipt, setAttendanceReceipt] =
    useState<AttendanceReceipt | null>(null)
  const [stateFresh, setStateFresh] = useState(true)
  const [cameraOpen, setCameraOpen] = useState(false)
  const [verificationStage, setVerificationStage] = useState<
    "destination" | "location" | "photo"
  >("location")
  const [locationError, setLocationError] = useState("")
  const [cameraMode, setCameraMode] = useState<"capture" | "preview">("capture")
  const [cameraAttempt, setCameraAttempt] = useState(0)
  const [cameraError, setCameraError] = useState("")
  const [cameraReady, setCameraReady] = useState(false)
  const [photoBlob, setPhotoBlob] = useState<Blob | null>(null)
  const [photoUrl, setPhotoUrl] = useState("")
  const [draft, setDraft] = useState<AttendanceDraft | null>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const verificationHeadingRef = useRef<HTMLHeadingElement>(null)
  const verificationTriggerRef = useRef<HTMLElement | null>(null)
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

  const leaveVerificationAfterSuccess = useCallback(() => {
    if (draft?.operation === "check_out") setSelectedOutletId("")
    stopCamera()
    setCameraOpen(false)
    setVerificationStage("location")
    setLocationError("")
    setCameraError("")
    setCameraReady(false)
    setPhotoBlob(null)
    setPhotoAccepted(false)
    setDraft(null)
  }, [draft?.operation, stopCamera])

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
          const completed = result.result as OperationResult
          setNotice(attendanceConfirmation(completed))
          setError("")
          notifications.success("Absen tercatat", {
            id: `attendance:${operation.tenantId}:${operation.employeeId}:${operation.key}:completed`,
          })
          if (await clearPendingOperation(operation)) {
            setPending(null)
            setOperationState("idle")
            setAttendanceReceipt(
              attendanceReceiptFrom(completed, operation.operation)
            )
            leaveVerificationAfterSuccess()
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
    [clearPendingOperation, leaveVerificationAfterSuccess, refreshLatestState]
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
      setCameraOpen(false)
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
        return
      }

      const receipt = attendanceReceiptFrom(result, next.operation)
      setNotice(attendanceConfirmation(result))
      notifications.success("Absen tercatat", {
        id: `attendance:${next.tenantId}:${next.employeeId}:${next.key}:completed`,
      })
      if (await clearPendingOperation(next)) {
        setPending(null)
        setOperationState("idle")
        setAttendanceReceipt(receipt)
        leaveVerificationAfterSuccess()
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
      } else {
        notifications.error(caught.message, {
          id: `attendance:${next.tenantId}:${next.employeeId}:${next.key}:rejected`,
        })
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
    verificationTriggerRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null
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
      setPhotoAccepted(false)
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
    setCameraMode("capture")
    setCameraError("")
    setCameraReady(false)
    setPhotoBlob(null)
    setPhotoAccepted(false)
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
      setDraft({ ...nextDraft, location })
      setVerificationStage("photo")
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
      setVerificationStage("photo")
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
    if (!draft || !readyAttendance?.employee || !canSubmitVerification) return
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

  const closeCamera = useCallback(() => {
    if (operationState === "sending") return
    if (draft?.operation === "check_out") setSelectedOutletId("")
    verificationAttempt.current += 1
    setCameraOpen(false)
    setVerificationStage("location")
    setLocationError("")
    setCameraError("")
    setCameraReady(false)
    setPhotoBlob(null)
    setPhotoAccepted(false)
    setDraft(null)
    setBusy(false)
  }, [draft?.operation, operationState])

  function retakePhoto() {
    setPhotoBlob(null)
    setPhotoAccepted(false)
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
    setPhotoAccepted(false)
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
    setPhotoAccepted(false)
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
      setVerificationStage("photo")
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
  const todaySession = todayResult?.sessions.at(-1) ?? null
  const todayTimezone =
    todaySession?.schedule_snapshot?.timezone ??
    todayResult?.schedule?.timezone ??
    readyAttendance?.schedule?.timezone ??
    openSession?.timezone
  const todayCheckIn =
    todaySession?.effective.check_in_at ?? todaySession?.original.check_in_at
  const todayCheckOut =
    todaySession?.effective.check_out_at ?? todaySession?.original.check_out_at
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
  const todayStatus = !stateFresh
    ? "Status terbaru belum tersedia"
    : openSession
      ? `Sedang bekerja sejak ${formatLocalClockTime(openSession.check_in_at, openSession.timezone) ?? "--.--"}`
      : todayCheckIn && todayCheckOut
        ? `Selesai hari ini · ${formatLocalClockTime(todayCheckIn, todayTimezone) ?? "--.--"}–${formatLocalClockTime(todayCheckOut, todayTimezone) ?? "--.--"}`
        : todayResult &&
            ![
              "no_recorded_outcome",
              "no_attendance",
              "potential_absence",
            ].includes(todayResult.outcome)
          ? attendanceOutcomeLabel(todayResult.outcome)
          : "Belum absen masuk"
  const homeActionState = openSession
    ? "working"
    : todayCheckIn && todayCheckOut
      ? "finished"
      : "not-checked-in"
  const clockTimeZone =
    checkoutDestination?.timezone ??
    openSession?.timezone ??
    readyAttendance?.schedule?.timezone
  const headerOutlets = openSession
    ? [
        {
          id: openSession.outlet.id,
          name: openSession.outlet.name ?? "Outlet asal belum tersedia",
        },
      ]
    : selectableOutlets
  const attendanceOutletContext = {
    outlets: headerOutlets,
    selectedOutletId: openSession
      ? openSession.outlet.id
      : selectedOutletId
        ? Number(selectedOutletId)
        : null,
    selectedOutletName:
      selectedOutlet ??
      (headerOutlets.length === 1 ? headerOutlets[0].name : "Semua Outlet"),
  }
  const verificationActionLabel =
    draft?.operation === "check_out" ? "Absen Keluar" : "Absen Masuk"
  const acceptedPhoto =
    cameraMode === "preview" && Boolean(photoBlob) && photoAccepted
  const canSkipOptionalPhoto =
    readyAttendance?.require_personal_photo === false &&
    cameraMode === "capture"
  const canSubmitVerification = Boolean(
    cameraOpen &&
      draft &&
      (draft.operation !== "check_out" || draft.outletId !== null) &&
      verificationStage === "photo" &&
      !busy &&
      !pending &&
      stateFresh &&
      photoStorageReady &&
      !identityChangeInProgress.current &&
      (acceptedPhoto || canSkipOptionalPhoto)
  )
  const verificationSubmitLabel =
    !stateFresh || pending
      ? "Memeriksa status"
      : draft?.operation === "check_out" && draft.outletId === null
        ? "Pilih Outlet tujuan"
        : busy || locating
          ? "Tunggu lokasi"
          : verificationStage !== "photo"
            ? "Tunggu lokasi"
            : cameraMode === "capture" && !canSkipOptionalPhoto
              ? cameraReady
                ? "Ambil foto dulu"
                : "Tunggu kamera"
              : cameraMode === "preview" && !acceptedPhoto
                ? "Pilih foto di atas"
                : `Kirim ${verificationActionLabel}`
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
  const verificationAccuracyMeters =
    verificationLocation?.status === "provided" &&
    verificationLocation.accuracy_meters != null &&
    Number.isFinite(verificationLocation.accuracy_meters) &&
    verificationLocation.accuracy_meters > 0
      ? Math.ceil(verificationLocation.accuracy_meters)
      : null
  const locationState =
    verificationLocation?.status === "permission_denied"
      ? "denied"
      : verificationAccuracyMeters !== null &&
          locationPolicy?.max_accuracy_meters != null &&
          verificationAccuracyMeters > locationPolicy.max_accuracy_meters
        ? "weak"
        : verificationAccuracyMeters !== null &&
            locationPolicy?.radius_meters != null &&
            verificationAccuracyMeters > locationPolicy.radius_meters
          ? "weak"
          : verificationDistanceMeters !== null &&
              locationPolicy?.radius_meters != null &&
              verificationDistanceMeters > locationPolicy.radius_meters
            ? "outside"
            : verificationLocation?.status === "provided" &&
                verificationDistanceMeters !== null &&
                verificationAccuracyMeters !== null
              ? "inside"
              : "unavailable"

  useEffect(() => {
    if (cameraOpen) {
      const frame = window.requestAnimationFrame(() =>
        verificationHeadingRef.current?.focus()
      )
      return () => window.cancelAnimationFrame(frame)
    }

    const trigger = verificationTriggerRef.current
    if (trigger) {
      const frame = window.requestAnimationFrame(() => trigger.focus())
      verificationTriggerRef.current = null
      return () => window.cancelAnimationFrame(frame)
    }
  }, [cameraOpen])

  useEffect(() => {
    if (!cameraOpen) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault()
        closeCamera()
      }
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [cameraOpen, closeCamera])

  const homePage = (
    <EmployeeShell
      active="today"
      accountName={accountName}
      outletContext={attendanceOutletContext}
    >
      <div className="flex min-w-0 flex-col gap-5 [&_.text-caption]:text-body [&_[aria-label='Riwayat minggu ini, terbaru lebih dulu']_.text-muted-foreground]:text-foreground [&_[aria-label='Riwayat minggu ini, terbaru lebih dulu']_.text-caption]:text-body [&_[data-slot=alert-title]]:text-body [&_[data-slot=alert-title]]:font-semibold [&_[data-slot=alert-description]]:text-body [&_[id=history-title]]:text-label [&_button]:font-semibold">
        <header className="text-center">
          {today && (
            <p className="text-caption text-muted-foreground">
              <time dateTime={today}>{formatWorkDate(today)}</time>
            </p>
          )}
        </header>

        <section
          aria-labelledby="attendance-status-title"
          className="flex w-full flex-col items-center gap-6 text-center"
        >
          <EmployeeAttendanceClock
            outletTimeZone={clockTimeZone}
            showTimeZoneLabel={false}
          />
          <div className="flex max-w-xl flex-col items-center gap-1">
            <h2
              className="text-body font-semibold"
              id="attendance-status-title"
            >
              Status kehadiran hari ini
            </h2>
            <p
              className="text-display font-semibold leading-tight"
              role="status"
            >
              {loading ? "Memuat kehadiran…" : todayStatus}
            </p>
          </div>
          {readyAttendance && !openSession && (
            <div className="flex w-full max-w-xl flex-col items-center gap-3">
              {(selectableOutlets.length > 1 || !selectedOutletId) &&
                selectableOutlets.length > 0 && (
                  <FieldGroup className="w-full text-left">
                    <Field data-disabled={pending || busy ? true : undefined}>
                      <FieldLabel htmlFor="attendance-outlet">
                        Outlet presensi
                      </FieldLabel>
                      <NativeSelect
                        disabled={Boolean(pending) || busy}
                        id="attendance-outlet"
                        onChange={(event) =>
                          void changeOutlet(event.target.value)
                        }
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
                )}
            </div>
          )}
          {openSession && (
            <p className="max-w-xl text-body">
              Sesi asal · {formatWorkDate(openSession.work_date)} ·{" "}
              {openSession.outlet.name ?? "Outlet asal belum tersedia"}
            </p>
          )}
          <div className="grid w-full max-w-xl grid-cols-2 gap-2">
            <Button
              className="min-h-12 w-full"
              disabled={!canCheckIn}
              onClick={() => void startAttendance("check_in")}
              variant={
                homeActionState === "not-checked-in"
                  ? "default"
                  : homeActionState === "working"
                    ? "outline"
                    : "secondary"
              }
            >
              Absen Masuk
            </Button>
            <Button
              className="min-h-12 w-full"
              disabled={!canCheckOut}
              onClick={() => void startAttendance("check_out")}
              variant={
                homeActionState === "working"
                  ? "default"
                  : homeActionState === "not-checked-in"
                    ? "outline"
                    : "secondary"
              }
            >
              Absen Keluar
            </Button>
          </div>
        </section>

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

        {error && !cameraOpen && (
          <Alert variant={pending ? "default" : "destructive"}>
            <AlertTitle>
              {pending
                ? "Hasil presensi belum dapat dipastikan"
                : "Status presensi"}
            </AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        {(!stateFresh ||
          (!loading && !attendance) ||
          (readyAttendance && !readyAttendance.effective_attendance)) && (
          <Button
            className="min-h-11 self-start"
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

            <div className="border-t border-border pt-4">
              <EmployeeAttendanceHistory
                days={historyWeek}
                currentWorkDate={historyWorkDate}
                outletNames={outletNames}
                correctionOptions={readyAttendance.correction_options}
              />
            </div>

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
    </EmployeeShell>
  )

  const verificationPage = (
    <div
      className="attendance-focus-view fixed inset-0 z-50 grid h-[100dvh] min-h-0 grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden bg-canvas text-foreground [&_[data-slot=alert-title]]:text-label [&_[data-slot=alert-title]]:font-semibold [&_[data-slot=alert-description]]:text-body [&_button]:font-semibold"
      data-verification-mode="focus"
    >
      <header className="shrink-0 border-b border-border bg-surface pt-[env(safe-area-inset-top)]">
        <div className="relative mx-auto flex min-h-14 w-full max-w-2xl items-center justify-center px-16">
          <Button
            aria-label="Kembali ke halaman presensi"
            className="absolute left-2 top-1/2 -translate-y-1/2"
            disabled={operationState === "sending"}
            onClick={closeCamera}
            variant="ghost"
          >
            Kembali
          </Button>
          <h1
            className="text-title text-center outline-none focus-visible:ring-2 focus-visible:ring-ring"
            ref={verificationHeadingRef}
            tabIndex={-1}
          >
            {verificationActionLabel}
          </h1>
        </div>
        {draft?.operation === "check_in" && today ? (
          <p className="pb-2 text-center text-caption text-muted-foreground">
            Work Date · <time dateTime={today}>{formatWorkDate(today)}</time>
          </p>
        ) : null}
        <p className="sr-only">
          Verifikasi Outlet, lokasi, dan foto sebelum presensi dikirim.
        </p>
      </header>

      <main className="min-h-0 overflow-y-auto overscroll-contain">
        <div className="mx-auto flex w-full max-w-2xl flex-col px-4 pb-5 sm:px-5">
          {draft?.operation === "check_out" && openSession && (
            <section
              aria-label="Sesi asal checkout"
              className="border-b border-border py-3"
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
                  <dd className="break-words">
                    {openSession.outlet.name ?? "Outlet asal belum tersedia"}
                  </dd>
                </div>
              </dl>
            </section>
          )}

          <section aria-labelledby="verification-outlet-title" className="py-4">
            <h2 className="text-label" id="verification-outlet-title">
              {draft?.operation === "check_out"
                ? "Outlet tujuan checkout"
                : "Outlet presensi"}
            </h2>
            {draft?.operation === "check_out" ? (
              <FieldGroup className="mt-2">
                <Field data-disabled={busy || pending ? true : undefined}>
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
                {error && verificationStage === "destination" && (
                  <p className="text-body text-destructive" role="alert">
                    {error}
                  </p>
                )}
              </FieldGroup>
            ) : (
              <p className="mt-2 min-h-11 break-words text-body font-medium">
                {verificationOutletName ?? "Outlet belum tersedia"}
              </p>
            )}
          </section>

          <Separator className="bg-border/70" />

          <section
            aria-labelledby="verification-location-title"
            className="flex flex-col py-4"
          >
            <h2 className="text-label" id="verification-location-title">
              Lokasi
            </h2>
            <p className="mt-1 text-body" role="status">
              {locating
                ? "Mendapatkan lokasi…"
                : locationState === "inside"
                  ? `Di area outlet · ${verificationDistanceMeters} m · akurasi ±${verificationAccuracyMeters} m`
                  : locationState === "outside"
                    ? `Di luar area · ${verificationDistanceMeters} m. Datang ke outlet, lalu`
                    : locationState === "weak"
                      ? `Sinyal lokasi lemah · akurasi ±${verificationAccuracyMeters} m. Pindah dekat pintu atau jendela, lalu`
                      : locationState === "denied"
                        ? "Izin lokasi ditolak. Periksa izin di setelan browser atau ponsel."
                        : verificationStage === "destination"
                          ? "Pilih Outlet tujuan checkout."
                          : locationPolicy
                            ? locationError ||
                              "Lokasi belum tersedia. Perbarui lokasi untuk melanjutkan."
                            : "Outlet tujuan belum dapat diverifikasi."}
            </p>
            {locationState === "outside" || locationState === "weak" ? (
              <Button
                className="mt-2 min-h-11 self-start"
                disabled={busy || locating || Boolean(pending)}
                onClick={() => void refreshVerificationLocation()}
                variant="outline"
              >
                Perbarui lokasi
              </Button>
            ) : locationState === "denied" ? (
              <Button
                className="mt-2 min-h-11 self-start"
                disabled={busy || locating || Boolean(pending)}
                onClick={() => void refreshVerificationLocation()}
                variant="outline"
              >
                Coba lagi
              </Button>
            ) : locationState === "unavailable" &&
              verificationStage !== "destination" &&
              locationPolicy?.required ? (
              <Button
                className="mt-2 min-h-11 self-start"
                disabled={busy || locating || Boolean(pending)}
                onClick={() => void refreshVerificationLocation()}
                variant="outline"
              >
                Perbarui lokasi
              </Button>
            ) : null}
            <div className="mt-3 grid grid-cols-2 gap-3 text-body">
              <p>
                <span className="block text-caption">Jarak ke Outlet</span>
                {verificationDistanceMeters == null
                  ? "Belum tersedia"
                  : `${verificationDistanceMeters} m`}
              </p>
              <p>
                <span className="block text-caption">Akurasi</span>
                {verificationAccuracyMeters == null
                  ? "Belum tersedia"
                  : `±${verificationAccuracyMeters} m`}
              </p>
            </div>
            <div className="mt-3">
              <OutletGeofenceMap
                outletName={verificationOutletName ?? "Outlet"}
                latitude={locationPolicy?.latitude ?? null}
                longitude={locationPolicy?.longitude ?? null}
                radiusMeters={locationPolicy?.radius_meters ?? null}
                position={
                  verificationLocation?.status === "provided" &&
                  verificationLocation.latitude != null &&
                  verificationLocation.longitude != null &&
                  verificationLocation.accuracy_meters != null
                    ? {
                        latitude: verificationLocation.latitude,
                        longitude: verificationLocation.longitude,
                        accuracy_meters: verificationLocation.accuracy_meters,
                      }
                    : null
                }
                onLocate={
                  locationPolicy?.required && locationPolicy.geofence_configured
                    ? () => void refreshVerificationLocation()
                    : undefined
                }
                locating={locating || busy || Boolean(pending)}
              />
            </div>
          </section>

          <Separator className="bg-border/70" />

          <section aria-labelledby="verification-photo-title" className="py-4">
            <h2 className="text-label" id="verification-photo-title">
              Foto
            </h2>
            {cameraError ? (
              <Alert
                className="mt-3 rounded-none border-0 border-l-2 bg-transparent p-0 pl-3 shadow-none"
                variant="destructive"
              >
                <AlertTitle>Kamera belum siap</AlertTitle>
                <AlertDescription>{cameraError}</AlertDescription>
              </Alert>
            ) : null}

            <div className="mt-3 flex flex-col items-center gap-3 text-center">
              {verificationStage === "destination" ? (
                <p className="text-body" role="status">
                  Pilih Outlet tujuan checkout untuk melanjutkan.
                </p>
              ) : verificationStage === "location" ? (
                <p className="text-body" role="status">
                  Kamera dibuka setelah lokasi lolos pemeriksaan.
                </p>
              ) : cameraMode === "preview" && photoUrl ? (
                <img
                  alt="Pratinjau foto bukti presensi"
                  className="mx-auto aspect-[3/4] max-h-[45dvh] w-full max-w-md rounded-md bg-black object-contain"
                  src={photoUrl}
                />
              ) : cameraMode === "capture" ? (
                <div className="relative w-full max-w-md">
                  <video
                    aria-label="Pratinjau kamera karyawan"
                    aria-busy={!cameraReady && !cameraError}
                    autoPlay
                    className="mx-auto aspect-[3/4] max-h-[45dvh] w-full rounded-md bg-black object-cover"
                    muted
                    onCanPlay={updateCameraReadiness}
                    onLoadedData={updateCameraReadiness}
                    onPlaying={updateCameraReadiness}
                    playsInline
                    ref={videoRef}
                  />
                  {!cameraReady && !cameraError ? (
                    <div
                      className="absolute inset-0 grid place-items-center rounded-md bg-black/60 text-center text-white"
                      role="status"
                    >
                      Menyiapkan kamera…
                    </div>
                  ) : null}
                </div>
              ) : null}

              {verificationStage === "photo" && cameraError ? (
                <Button
                  className="min-h-11"
                  disabled={busy}
                  onClick={() => setCameraAttempt((attempt) => attempt + 1)}
                  variant="outline"
                >
                  Coba buka kamera lagi
                </Button>
              ) : verificationStage === "photo" && cameraMode === "capture" ? (
                <Button
                  className="min-h-11"
                  disabled={!cameraReady || busy}
                  onClick={() => void capturePhoto()}
                >
                  Ambil foto
                </Button>
              ) : verificationStage === "photo" && cameraMode === "preview" ? (
                <div className="flex w-full flex-wrap justify-center gap-2">
                  <Button
                    className="min-h-11"
                    disabled={busy}
                    onClick={retakePhoto}
                    variant="outline"
                  >
                    Ulangi
                  </Button>
                  <Button
                    aria-pressed={photoAccepted}
                    className="min-h-11"
                    disabled={busy}
                    onClick={() => setPhotoAccepted(true)}
                    variant={photoAccepted ? "secondary" : "default"}
                  >
                    Pakai foto ini
                  </Button>
                </div>
              ) : null}
            </div>
          </section>
        </div>
      </main>

      <footer
        aria-busy={busy}
        className="shrink-0 border-t border-border bg-surface px-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-3 sm:px-5"
      >
        <div className="mx-auto w-full max-w-2xl">
          <Button
            className="min-h-12 w-full whitespace-normal"
            disabled={!canSubmitVerification}
            onClick={submitVerifiedAttendance}
          >
            {verificationSubmitLabel}
          </Button>
        </div>
      </footer>
    </div>
  )

  const successPage = attendanceReceipt ? (
    <EmployeeShell
      active="today"
      accountName={accountName}
      outletContext={attendanceOutletContext}
    >
      <section
        aria-labelledby="attendance-receipt-title"
        className="flex min-h-[65svh] flex-col items-center justify-center gap-5 text-center"
        role="status"
      >
        <span
          aria-hidden="true"
          className="text-6xl font-semibold text-primary"
        >
          ✓
        </span>
        <h1 className="text-title" id="attendance-receipt-title">
          Absen{" "}
          {attendanceReceipt.operation === "check_in" ? "masuk" : "keluar"}{" "}
          tercatat
          <span className="block text-lead font-normal tabular-nums">
            {attendanceReceipt.time ?? "--.--"}
          </span>
        </h1>
        <p className="sr-only">{notice}</p>
        <Button className="min-h-11" onClick={() => setAttendanceReceipt(null)}>
          Kembali ke beranda
        </Button>
      </section>
    </EmployeeShell>
  ) : null

  return attendanceReceipt ? (
    successPage
  ) : (
    <>
      <div aria-hidden={cameraOpen} hidden={cameraOpen} inert={cameraOpen}>
        {homePage}
      </div>
      {cameraOpen ? verificationPage : null}
    </>
  )
}

function attendanceReceiptFrom(
  result: OperationResult,
  operation: AttendanceOperation
): AttendanceReceipt {
  const recordedAt =
    result.event?.recorded_at ??
    (operation === "check_in"
      ? result.session?.check_in_at
      : result.session?.check_out_at) ??
    result.server_time
  return {
    operation,
    time: formatLocalClockTime(recordedAt ?? null, result.session?.timezone),
  }
}

function formatLocalClockTime(
  value: string | null,
  timezone: string | null | undefined
): string | null {
  if (!value) return null
  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      hour: "2-digit",
      hourCycle: "h23",
      minute: "2-digit",
      timeZone: timezone || undefined,
    }).formatToParts(new Date(value))
    const hour = parts.find((part) => part.type === "hour")?.value
    const minute = parts.find((part) => part.type === "minute")?.value
    return hour && minute ? `${hour}.${minute}` : null
  } catch {
    return null
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
