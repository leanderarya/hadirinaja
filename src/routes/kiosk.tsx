import { createFileRoute } from "@tanstack/react-router"
import { useCallback, useEffect, useRef, useState } from "react"

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
import { Input } from "@/components/ui/input"
import { ApiError, apiRequest } from "@/lib/api"
import { type LocationEvidence, locationEligibility } from "@/lib/geofence"

export const Route = createFileRoute("/kiosk")({ component: KioskPage })

type KioskStatus = {
  status: "ready"
  credential_expires_at: string
  device: { id: number; name: string }
  tenant: { id: number; name: string }
  outlet: { id: number; name: string }
}

type KioskEmployee = { id: number; name: string }
type AttendanceOperation = "check_in" | "check_out"
type KioskNextOperation = {
  eligible: boolean
  next_operation: AttendanceOperation | null
  reason: string | null
  checkout_session_id?: number
  checkout_outlet_id?: number
  checkout_location?: Parameters<typeof locationEligibility>[0]
}
type KioskCheckoutTarget = { tenantId: number; outletId: number; sessionId: number }
type PendingKioskOperation = {
  key: string
  operation: AttendanceOperation
  employeeId: number
  deviceId: number
  checkout?: KioskCheckoutTarget
}

const pendingStorageKey = "hadirinaja.kiosk.attendance.pending"

function KioskPage() {
  const [status, setStatus] = useState<KioskStatus | null>(null)
  const [state, setState] = useState<
    "loading" | "disabled" | "unpaired" | "ready" | "revoked"
  >("loading")
  const [employees, setEmployees] = useState<KioskEmployee[]>([])
  const [pairingCode, setPairingCode] = useState("")
  const [enrollmentCode, setEnrollmentCode] = useState("")
  const [newPin, setNewPin] = useState("")
  const [pinConfirmation, setPinConfirmation] = useState("")
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<number | null>(
    null
  )
  const [attendancePin, setAttendancePin] = useState("")
  const [operation, setOperation] = useState<AttendanceOperation | null>(null)
  const [workflow, setWorkflow] = useState<
    "select" | "camera" | "confirm" | "sending" | "recovery" | "success"
  >("select")
  const [pending, setPending] = useState<PendingKioskOperation | null>(null)
  const [recoveryState, setRecoveryState] = useState<
    "checking" | "pending" | "not_found"
  >("checking")
  const [photoBlob, setPhotoBlob] = useState<Blob | null>(null)
  const [checkoutCapture, setCheckoutCapture] = useState<{
    target: KioskCheckoutTarget
    location: LocationEvidence
  } | null>(null)
  const [photoUrl, setPhotoUrl] = useState("")
  const [cameraError, setCameraError] = useState("")
  const [cameraRetry, setCameraRetry] = useState(0)
  const [message, setMessage] = useState("")
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const videoRef = useRef<HTMLVideoElement>(null)
  const cameraRef = useRef<MediaStream | null>(null)
  const checkingOperation = useRef(false)

  const stopCamera = useCallback(() => {
    cameraRef.current?.getTracks().forEach((track) => {
      track.stop()
    })
    cameraRef.current = null
    if (videoRef.current) videoRef.current.srcObject = null
  }, [])

  const loadEmployees = useCallback(async () => {
    const result = await apiRequest<{ employees: KioskEmployee[] }>(
      "/kiosk/attendance/employees"
    )
    setEmployees(result.employees)
  }, [])

  const loadStatus = useCallback(async () => {
    try {
      const result = await apiRequest<KioskStatus>("/kiosk/status")
      setStatus(result)
      setState("ready")
      await loadEmployees()
    } catch (caught) {
      setStatus(null)
      setEmployees([])
      if (caught instanceof ApiError && caught.code === "kiosk_revoked") {
        setState("revoked")
      } else if (caught instanceof ApiError && caught.code === "kiosk_disabled") {
        setState("disabled")
      } else {
        if (caught instanceof ApiError && caught.code === "kiosk_expired")
          setError(
            "Akses perangkat kedaluwarsa. Minta Owner membuat kode pembaruan lalu masukkan di bawah."
          )
        setState("unpaired")
      }
    }
  }, [loadEmployees])

  const finishSuccess = useCallback(
    (action: AttendanceOperation, recordedAt?: string) => {
      window.sessionStorage.removeItem(pendingStorageKey)
      setPending(null)
      setAttendancePin("")
      setPhotoBlob(null)
      setCheckoutCapture(null)
      setSelectedEmployeeId(null)
      setOperation(null)
      setMessage(
        `${action === "check_in" ? "Presensi masuk" : "Presensi keluar"} dikonfirmasi oleh server${recordedAt ? ` · ${new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Jakarta" }).format(new Date(recordedAt))}` : ""}.`
      )
      setError("")
      setWorkflow("success")
    },
    []
  )

  const recoverOperation = useCallback(
    async (target: PendingKioskOperation) => {
      if (target.checkout && !matchesPairedKiosk(target, status)) {
        setError("Operasi sebelumnya tersimpan untuk pemasangan kiosk lain. Pulihkan pemasangan tersebut untuk memeriksa hasilnya.")
        return "unknown"
      }
      if (checkingOperation.current) return "unknown"
      checkingOperation.current = true
      setRecoveryState("checking")
      try {
        const result = await apiRequest<{
          state: "not_found" | "pending" | "completed" | "rejected"
          contract_version?: number
          checkout_session_id?: number | null
          checkout_outlet_id?: number | null
          result?: { event?: { recorded_at?: string }; message?: string }
        }>(
          `/kiosk/attendance/operations/${target.operation}/${target.key}?employee_id=${target.employeeId}${target.checkout ? `&expected_kiosk_device_id=${target.deviceId}` : ""}`
        )
        if (result.state !== "not_found" && !matchesCheckoutTarget(target, result)) {
          setRecoveryState("pending")
          setError("Sesi atau Outlet pada hasil server berbeda. Periksa kembali status operasi ini.")
          return "unknown"
        }
        if (result.state === "completed") {
          window.sessionStorage.removeItem(pendingStorageKey)
          finishSuccess(target.operation, result.result?.event?.recorded_at)
        } else if (result.state === "rejected") {
          window.sessionStorage.removeItem(pendingStorageKey)
          setPending(null)
          setAttendancePin("")
          setPhotoBlob(null)
          setCheckoutCapture(null)
          setWorkflow("select")
          setError(
            result.result?.message ??
              "Presensi ditolak. Periksa status sebelum mencoba lagi."
          )
        } else {
          setRecoveryState(
            result.state === "not_found" ? "not_found" : "pending"
          )
        }
        return result.state
      } catch (caught) {
        setRecoveryState("pending")
        if (caught instanceof ApiError && kioskPairingError(caught)) {
          setError(caught.message)
          void loadStatus()
        }
        return "unknown"
      } finally {
        checkingOperation.current = false
      }
    },
    [finishSuccess, loadStatus, status]
  )

  useEffect(() => {
    void loadStatus()
  }, [loadStatus])

  useEffect(() => {
    if (workflow !== "camera") return
    let cancelled = false

    async function startCamera() {
      setCameraError("")
      if (!navigator.mediaDevices?.getUserMedia) {
        setCameraError(
          "Browser ini tidak mendukung akses kamera. Gunakan perangkat dengan kamera yang diizinkan."
        )
        return
      }

      try {
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
          await videoRef.current.play().catch(() => undefined)
        }
      } catch (caught) {
        const cameraFailure = caught as DOMException
        setCameraError(
          cameraFailure.name === "NotAllowedError" ||
            cameraFailure.name === "SecurityError"
            ? "Izin kamera ditolak. Izinkan kamera browser untuk melanjutkan pencatatan."
            : "Kamera tidak tersedia. Periksa perangkat lalu coba lagi."
        )
      }
    }

    void startCamera()
    return () => {
      cancelled = true
      stopCamera()
    }
  }, [workflow, stopCamera, cameraRetry])

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
    if (state !== "ready" || workflow !== "select") return
    const serialized = window.sessionStorage.getItem(pendingStorageKey)
    if (!serialized) return
    try {
      const saved: unknown = JSON.parse(serialized)
      if (isPendingKioskOperation(saved)) {
        if (saved.checkout && !matchesPairedKiosk(saved, status)) {
          setPending(saved)
          setRecoveryState("pending")
          setWorkflow("recovery")
          setError("Operasi sebelumnya tersimpan untuk pemasangan kiosk lain. Pulihkan pemasangan tersebut untuk memeriksa hasilnya.")
          return
        }
        if (saved.deviceId !== status?.device.id) {
          window.sessionStorage.removeItem(pendingStorageKey)
          return
        }
        setPending(saved)
        setSelectedEmployeeId(saved.employeeId)
        setOperation(saved.operation)
        setRecoveryState("checking")
        setWorkflow("recovery")
        void recoverOperation(saved)
      } else {
        window.sessionStorage.removeItem(pendingStorageKey)
      }
    } catch {
      window.sessionStorage.removeItem(pendingStorageKey)
    }
  }, [state, status, workflow, recoverOperation])

  useEffect(() => {
    if (workflow !== "success") return
    const timeout = window.setTimeout(() => {
      setWorkflow("select")
      setMessage("")
    }, 5000)
    return () => window.clearTimeout(timeout)
  }, [workflow])

  async function submitPairing(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setError("")
    setMessage("")
    try {
      await apiRequest("/kiosk/pair", {
        method: "POST",
        body: { code: pairingCode },
      })
      setPairingCode("")
      setMessage("Perangkat berhasil dipasangkan.")
      await loadStatus()
    } catch (caught) {
      setError(
        caught instanceof ApiError && caught.code === "kiosk_renewal_required"
          ? "Perangkat masih terdaftar. Minta Owner membuat kode pembaruan untuk perangkat ini atau mencabut akses lama sebelum memasangkan ulang."
          : "Kode pemasangan tidak valid atau sudah kedaluwarsa."
      )
    } finally {
      setBusy(false)
    }
  }

  async function submitEnrollment(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setError("")
    setMessage("")
    try {
      await apiRequest("/kiosk/pin/enroll", {
        method: "POST",
        body: {
          code: enrollmentCode,
          pin: newPin,
          pin_confirmation: pinConfirmation,
        },
      })
      setEnrollmentCode("")
      setNewPin("")
      setPinConfirmation("")
      setMessage("PIN berhasil dibuat. Anda dapat menutup halaman ini.")
      await loadEmployees()
    } catch {
      setError(
        "PIN belum dapat dibuat. Periksa kode pendaftaran, format PIN, dan kecocokan kedua PIN."
      )
    } finally {
      setBusy(false)
    }
  }

  async function beginAttendance(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (selectedEmployeeId === null || attendancePin.length < 6) return
    setBusy(true)
    setError("")
    setMessage("")
    try {
      const next = await apiRequest<KioskNextOperation>(
        "/kiosk/attendance/next-operation",
        {
          method: "POST",
          body: { employee_id: selectedEmployeeId, pin: attendancePin },
        }
      )
      if (!next.eligible || !next.next_operation) {
        setAttendancePin("")
        setError(
          next.reason === "location_geofence_unconfigured"
            ? "Titik atau radius Outlet belum valid. Hubungi pengelola sebelum mencatat presensi keluar."
            : "Presensi belum dapat dilakukan untuk karyawan ini di Outlet ini."
        )
        return
      }
      if (next.next_operation === "check_out") {
        if (!status || !next.checkout_session_id || next.checkout_outlet_id !== status.outlet.id || !next.checkout_location?.required) {
          setError("Sesi atau lokasi Outlet belum dapat dipastikan. Periksa status kiosk kembali.")
          return
        }
        const location = await captureCheckoutLocation()
        const eligibility = locationEligibility(next.checkout_location, location)
        if (!eligibility.eligible) {
          setError(location.status === "permission_denied"
            ? 'Izin lokasi ditolak. Izinkan lokasi untuk situs ini di pengaturan browser, lalu pilih "Lanjutkan ke kamera".'
            : eligibility.message)
          return
        }
        setCheckoutCapture({
          target: { tenantId: status.tenant.id, outletId: status.outlet.id, sessionId: next.checkout_session_id },
          location,
        })
      } else {
        setCheckoutCapture(null)
      }
      setOperation(next.next_operation)
      setWorkflow("camera")
    } catch (caught) {
      setAttendancePin("")
      setError(
        caught instanceof ApiError && caught.status === 403
          ? "Akses kiosk tidak tersedia atau telah dicabut."
          : "Status presensi belum dapat diperiksa."
      )
    } finally {
      setBusy(false)
    }
  }

  async function capturePhoto() {
    setError("")
    const video = videoRef.current
    if (
      !video ||
      video.readyState < 2 ||
      video.currentTime <= 0 ||
      video.videoWidth < 320 ||
      video.videoHeight < 240
    ) {
      setError("Kamera belum siap. Tunggu gambar tampil, lalu coba lagi.")
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
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.88)
    )
    if (!blob || blob.size > 5 * 1024 * 1024) {
      setCameraError(
        "Foto tidak dapat diproses atau melebihi batas ukuran 5 MB."
      )
      return
    }

    if (blob.size < 10 * 1024) {
      setError(
        "Foto terlalu kecil. Arahkan kamera ke objek yang jelas, lalu ambil ulang (minimum 10 KB)."
      )
      return
    }

    stopCamera()
    setPhotoBlob(blob)
    setCameraError("")
    setWorkflow("confirm")
  }

  async function submitAttendance(retry = false) {
    if (
      selectedEmployeeId === null ||
      !operation ||
      !photoBlob ||
      attendancePin.length < 6 ||
      !status ||
      (operation === "check_out" && !checkoutCapture)
    )
      return
    const nextPending: PendingKioskOperation =
      retry && pending
        ? pending
        : {
            key: window.crypto.randomUUID(),
            operation,
            employeeId: selectedEmployeeId,
            deviceId: status.device.id,
            checkout: checkoutCapture?.target,
          }
    if (retry && await recoverOperation(nextPending) !== "not_found") return

    const body = new FormData()
    body.set("employee_id", String(nextPending.employeeId))
    body.set("pin", attendancePin)
    body.set("photo", photoBlob, "kiosk-capture.jpg")
    if (nextPending.checkout && checkoutCapture) {
      const location = checkoutCapture.location
      body.set("expected_kiosk_device_id", String(nextPending.deviceId))
      body.set("checkout_session_id", String(nextPending.checkout.sessionId))
      body.set("location[status]", location.status)
      body.set("location[latitude]", String(location.latitude))
      body.set("location[longitude]", String(location.longitude))
      body.set("location[accuracy_meters]", String(location.accuracy_meters))
    }

    try {
      window.sessionStorage.setItem(pendingStorageKey, JSON.stringify(nextPending))
    } catch {
      setError("Status pemulihan tidak dapat disimpan. Presensi belum dikirim.")
      return
    }

    setBusy(true)
    setError("")
    setMessage("")
    setPending(nextPending)
    setWorkflow("sending")
    try {
      const result = await apiRequest<{
        operation?: {
          state: "completed" | "pending"
          contract_version?: number
          checkout_session_id?: number | null
          checkout_outlet_id?: number | null
        }
        event?: { recorded_at: string }
      }>(
        `/kiosk/attendance/${nextPending.operation === "check_in" ? "check-in" : "check-out"}`,
        {
          method: "POST",
          headers: { "Idempotency-Key": nextPending.key },
          body,
        }
      )
      if (result.operation?.state !== "completed" || !matchesCheckoutTarget(nextPending, result.operation)) {
        setRecoveryState("pending")
        setWorkflow("recovery")
        void recoverOperation(nextPending)
      } else {
        finishSuccess(nextPending.operation, result.event?.recorded_at)
      }
    } catch (caught) {
      if (
        caught instanceof ApiError &&
        caught.status < 500 &&
        (!nextPending.checkout || caught.code === "kiosk_pairing_changed") &&
        !retry &&
        caught.code !== "idempotency_key_conflict"
      ) {
        window.sessionStorage.removeItem(pendingStorageKey)
        setPending(null)
        setAttendancePin("")
        setPhotoBlob(null)
        setCheckoutCapture(null)
        setOperation(null)
        setWorkflow("select")
        setError(
          caught.message ||
            "Kehadiran ditolak. Coba lagi setelah memeriksa status."
        )
        if (kioskPairingError(caught)) void loadStatus()
      } else {
        setAttendancePin("")
        setRecoveryState("checking")
        setWorkflow("recovery")
        setError(
          caught instanceof ApiError
            ? caught.message
            : "Respons belum diterima. Status akan diperiksa menggunakan kunci yang sama."
        )
        if (caught instanceof ApiError && kioskPairingError(caught)) {
          setRecoveryState("pending")
          void loadStatus()
        } else {
          void recoverOperation(nextPending)
        }
      }
    } finally {
      setBusy(false)
    }
  }

  function resetAttendance() {
    stopCamera()
    setSelectedEmployeeId(null)
    setAttendancePin("")
    setOperation(null)
    setPending(null)
    setPhotoBlob(null)
    setCheckoutCapture(null)
    setCameraError("")
    setError("")
    setWorkflow("select")
  }

  async function restartMissingOperation(target: PendingKioskOperation) {
    if (await recoverOperation(target) === "not_found") {
      window.sessionStorage.removeItem(pendingStorageKey)
      resetAttendance()
    }
  }

  const selectedEmployee = employees.find(
    (employee) => employee.id === selectedEmployeeId
  )

  return (
    <main className="mx-auto flex min-h-svh w-full max-w-5xl flex-col gap-5 bg-muted/20 px-4 py-6 sm:px-8 sm:py-10">
      <header className="space-y-2 text-center">
        <p className="text-label text-muted-foreground">HadirinAja · Kiosk</p>
        <h1 className="text-title">Presensi di Outlet</h1>
        <p className="text-body text-muted-foreground">
          Waktu dicatat oleh server. Setiap presensi memerlukan PIN karyawan dan
          foto baru.
        </p>
      </header>

      {error ? (
        <Alert variant="destructive">
          <AlertTitle>Belum selesai</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {message ? (
        <Alert>
          <AlertTitle>
            {workflow === "success" ? "Berhasil" : "Informasi"}
          </AlertTitle>
          <AlertDescription>{message}</AlertDescription>
        </Alert>
      ) : null}

      {state === "loading" ? (
        <p
          className="py-10 text-center text-body text-muted-foreground"
          role="status"
        >
          Memeriksa perangkat…
        </p>
      ) : null}
      {state === "revoked" ? (
        <Card>
          <CardHeader>
            <CardTitle>Akses perangkat dicabut</CardTitle>
            <CardDescription>
              Hubungi Owner untuk mendaftarkan perangkat ini kembali.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : null}
      {state === "disabled" ? (
        <Card>
          <CardHeader>
            <CardTitle>Kiosk belum diaktifkan</CardTitle>
            <CardDescription>
              Perangkat ini belum dapat digunakan. Hubungi Owner organisasi.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : null}
      {state === "unpaired" || state === "revoked" ? (
        <Card>
          <CardHeader>
            <CardTitle>Pasangkan perangkat</CardTitle>
            <CardDescription>
              Minta Owner membuat kode pemasangan atau pembaruan sekali pakai
              untuk Outlet. Kode berlaku lima menit.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form className="space-y-5" onSubmit={submitPairing}>
              <Field>
                <FieldLabel htmlFor="pairing-code">Kode pemasangan</FieldLabel>
                <Input
                  autoComplete="one-time-code"
                  autoCapitalize="characters"
                  className="h-12 text-center font-mono text-title tracking-widest"
                  id="pairing-code"
                  maxLength={12}
                  onChange={(event) =>
                    setPairingCode(event.target.value.toUpperCase())
                  }
                  required
                  value={pairingCode}
                />
              </Field>
              <Button
                className="h-12 w-full"
                disabled={busy}
                isLoading={busy}
                size="lg"
                type="submit"
              >
                Pasangkan kiosk
              </Button>
            </form>
          </CardContent>
        </Card>
      ) : null}

      {state === "ready" &&
      status &&
      (workflow === "select" || workflow === "success") ? (
        <div className="flex flex-col gap-2">
          <p className="text-caption">
            Akses berlaku sampai{" "}
            {new Date(status.credential_expires_at).toLocaleString("id-ID")}.
          </p>
          <Button
            variant="outline"
            disabled={busy || pending !== null}
            onClick={() => {
              setState("unpaired")
              setPairingCode("")
              setMessage("")
              setError("")
            }}
          >
            Perbarui akses perangkat
          </Button>
        </div>
      ) : null}
      {state === "ready" && status ? (
        <div className="space-y-5">
          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="space-y-1">
                  <CardTitle>{status.outlet.name}</CardTitle>
                  <CardDescription>
                    {status.device.name} · {status.tenant.name}
                  </CardDescription>
                </div>
                <Badge variant="secondary">Perangkat terdaftar</Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {workflow === "select" ? (
                <>
                  <p className="text-body text-muted-foreground">
                    Pilih nama Anda, masukkan PIN pribadi, lalu ikuti petunjuk
                    kamera.
                  </p>
                  {employees.length === 0 ? (
                    <p className="rounded-xl border p-4 text-body">
                      Belum ada karyawan dengan PIN dan penugasan yang berlaku
                      di Outlet ini.
                    </p>
                  ) : null}
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {employees.map((employee) => (
                      <Button
                        key={employee.id}
                        className="h-14 justify-start text-label"
                        disabled={busy}
                        onClick={() => {
                          setSelectedEmployeeId(employee.id)
                          setError("")
                          setMessage("")
                        }}
                        variant={
                          selectedEmployeeId === employee.id
                            ? "default"
                            : "outline"
                        }
                      >
                        {employee.name}
                      </Button>
                    ))}
                  </div>
                  {selectedEmployee ? (
                    <form
                      className="mx-auto w-full max-w-md space-y-4 rounded-2xl border bg-background p-4"
                      onSubmit={beginAttendance}
                    >
                      <p className="text-label">{selectedEmployee.name}</p>
                      <Field>
                        <FieldLabel htmlFor="attendance-pin">
                          PIN pribadi
                        </FieldLabel>
                        <Input
                          autoComplete="off"
                          className="h-12 text-center font-mono text-title tracking-[0.35em]"
                          disabled={busy}
                          id="attendance-pin"
                          inputMode="numeric"
                          maxLength={8}
                          onChange={(event) =>
                            setAttendancePin(event.target.value)
                          }
                          pattern="[0-9]{6,8}"
                          required
                          type="password"
                          value={attendancePin}
                        />
                      </Field>
                      <Button
                        className="h-12 w-full"
                        disabled={busy || attendancePin.length < 6}
                        isLoading={busy}
                        size="lg"
                        type="submit"
                      >
                        {busy ? "Memeriksa presensi…" : "Lanjutkan ke kamera"}
                      </Button>
                    </form>
                  ) : null}
                </>
              ) : null}

              {workflow === "camera" ? (
                <div className="mx-auto w-full max-w-2xl space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-label">
                      {operation === "check_in"
                        ? "Foto baru untuk presensi masuk"
                        : "Foto baru untuk presensi keluar"}
                    </p>
                    <Badge>{selectedEmployee?.name ?? "Karyawan"}</Badge>
                  </div>
                  {cameraError ? (
                    <Alert variant="destructive">
                      <AlertTitle>Kamera belum siap</AlertTitle>
                      <AlertDescription>{cameraError}</AlertDescription>
                      <Button type="button" variant="outline" onClick={() => {
                        setCameraError("")
                        setCameraRetry((value) => value + 1)
                      }}>Coba kamera lagi</Button>
                    </Alert>
                  ) : null}
                  <video
                    aria-label="Pratinjau kamera kiosk"
                    autoPlay
                    className="aspect-[4/3] w-full rounded-2xl bg-black object-cover"
                    muted
                    playsInline
                    ref={videoRef}
                  />
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Button
                      className="h-12"
                      disabled={Boolean(cameraError)}
                      onClick={() => void capturePhoto()}
                      size="lg"
                    >
                      Ambil foto baru
                    </Button>
                    <Button
                      className="h-12"
                      onClick={resetAttendance}
                      variant="outline"
                    >
                      Batal
                    </Button>
                  </div>
                </div>
              ) : null}

              {workflow === "confirm" && photoUrl ? (
                <div className="mx-auto w-full max-w-2xl space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-label">
                      Konfirmasi presensi{" "}
                      {operation === "check_in" ? "masuk" : "keluar"}
                    </p>
                    <Badge>{selectedEmployee?.name ?? "Karyawan"}</Badge>
                  </div>
                  <img
                    alt="Foto baru sebagai bukti presensi"
                    className="aspect-[4/3] w-full rounded-2xl bg-black object-contain"
                    src={photoUrl}
                  />
                  <p className="text-caption text-muted-foreground">
                    PIN akan diverifikasi oleh server saat operasi ini dikirim.
                  </p>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Button
                      className="h-12"
                      disabled={busy || attendancePin.length < 6}
                      isLoading={busy}
                      onClick={() => void submitAttendance()}
                      size="lg"
                    >
                      Konfirmasi dan catat
                    </Button>
                    <Button
                      className="h-12"
                      disabled={busy}
                      onClick={() => {
                        setPhotoBlob(null)
                        setAttendancePin("")
                        setWorkflow("camera")
                      }}
                      variant="outline"
                    >
                      Ambil ulang
                    </Button>
                  </div>
                </div>
              ) : null}

              {workflow === "sending" ? (
                <p className="py-8 text-center text-body" role="status">
                  Mengirim bukti dan menunggu konfirmasi server…
                </p>
              ) : null}

              {workflow === "recovery" && pending ? (
                <div className="mx-auto w-full max-w-xl space-y-4 rounded-2xl border p-5">
                  <p className="text-label">
                    Status{" "}
                    {pending.operation === "check_in"
                      ? "presensi masuk"
                      : "presensi keluar"}{" "}
                    belum pasti
                  </p>
                  <p className="text-body text-muted-foreground">
                    {recoveryState === "checking"
                      ? "Memeriksa status operasi…"
                      : recoveryState === "pending"
                        ? "Server masih memproses operasi ini. Jangan mulai operasi baru."
                        : photoBlob
                          ? "Belum ada hasil tersimpan. Anda dapat mengirim ulang operasi yang sama dengan foto yang sama."
                          : "Belum ada hasil tersimpan. Foto percobaan sebelumnya tidak tersedia setelah halaman dibuka ulang. Periksa status lagi sebelum melakukan presensi baru."}
                  </p>
                  {pending.checkout && matchesPairedKiosk(pending, status) ? (
                    <p className="text-caption text-muted-foreground">Outlet tujuan: {status?.outlet.name}</p>
                  ) : null}
                  {photoBlob && recoveryState === "not_found" ? (
                    <Field>
                      <FieldLabel htmlFor="retry-attendance-pin">
                        PIN pribadi untuk pengiriman ulang
                      </FieldLabel>
                      <Input
                        autoComplete="off"
                        className="h-12 text-center font-mono text-title tracking-[0.35em]"
                        id="retry-attendance-pin"
                        inputMode="numeric"
                        maxLength={8}
                        onChange={(event) =>
                          setAttendancePin(event.target.value)
                        }
                        pattern="[0-9]{6,8}"
                        type="password"
                        value={attendancePin}
                      />
                    </Field>
                  ) : null}
                  <div className="flex flex-wrap gap-3">
                    <Button
                      disabled={busy || recoveryState === "checking" || !matchesPairedKiosk(pending, status)}
                      isLoading={busy && recoveryState === "checking"}
                      onClick={() => {
                        if (pending) void recoverOperation(pending)
                      }}
                      variant="outline"
                    >
                      Periksa status lagi
                    </Button>
                    {photoBlob && recoveryState === "not_found" ? (
                      <Button
                        disabled={busy || attendancePin.length < 6}
                        onClick={() => void submitAttendance(true)}
                      >
                        Kirim ulang operasi yang sama
                      </Button>
                    ) : null}
                    {pending.checkout && recoveryState === "not_found" ? (
                      <Button onClick={() => void restartMissingOperation(pending)}>
                        Periksa lalu mulai ulang
                      </Button>
                    ) : null}
                  </div>
                </div>
              ) : null}

              {workflow === "success" ? (
                <div className="space-y-4 text-center">
                  <p className="text-body">
                    Kiosk kembali siap untuk karyawan berikutnya.
                  </p>
                  <Button onClick={resetAttendance} variant="outline">
                    Kembali ke daftar karyawan
                  </Button>
                </div>
              ) : null}
            </CardContent>
          </Card>

          {workflow === "select" ? (
            <Card>
              <CardHeader>
                <CardTitle>Buat PIN pribadi</CardTitle>
                <CardDescription>
                  Gunakan kode pendaftaran sekali pakai dari Owner untuk membuat
                  PIN pribadi.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <form className="space-y-4" onSubmit={submitEnrollment}>
                  <FieldGroup className="gap-4">
                    <Field>
                      <FieldLabel htmlFor="enrollment-code">
                        Kode pendaftaran PIN
                      </FieldLabel>
                      <Input
                        autoComplete="one-time-code"
                        className="h-11 font-mono tracking-widest"
                        id="enrollment-code"
                        maxLength={12}
                        onChange={(event) =>
                          setEnrollmentCode(event.target.value.toUpperCase())
                        }
                        required
                        value={enrollmentCode}
                      />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="new-pin">
                        PIN baru · 6–8 angka
                      </FieldLabel>
                      <Input
                        autoComplete="new-password"
                        className="h-11"
                        id="new-pin"
                        inputMode="numeric"
                        maxLength={8}
                        onChange={(event) => setNewPin(event.target.value)}
                        pattern="[0-9]{6,8}"
                        required
                        type="password"
                        value={newPin}
                      />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="pin-confirmation">
                        Ulangi PIN
                      </FieldLabel>
                      <Input
                        autoComplete="new-password"
                        className="h-11"
                        id="pin-confirmation"
                        inputMode="numeric"
                        maxLength={8}
                        onChange={(event) =>
                          setPinConfirmation(event.target.value)
                        }
                        pattern="[0-9]{6,8}"
                        required
                        type="password"
                        value={pinConfirmation}
                      />
                    </Field>
                  </FieldGroup>
                  <Button
                    className="h-11 w-full"
                    disabled={busy}
                    isLoading={busy}
                    type="submit"
                    variant="outline"
                  >
                    Simpan PIN
                  </Button>
                </form>
              </CardContent>
            </Card>
          ) : null}
        </div>
      ) : null}
    </main>
  )
}

function isPendingKioskOperation(
  value: unknown
): value is PendingKioskOperation {
  if (typeof value !== "object" || value === null) return false
  const pending = value as Record<string, unknown>
  return (
    typeof pending.employeeId === "number" &&
    Number.isInteger(pending.employeeId) &&
    typeof pending.deviceId === "number" &&
    Number.isInteger(pending.deviceId) &&
    (pending.operation === "check_in" || pending.operation === "check_out") &&
    (pending.checkout === undefined ||
      (pending.operation === "check_out" && isKioskCheckoutTarget(pending.checkout))) &&
    typeof pending.key === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      pending.key
    )
  )
}

function isKioskCheckoutTarget(value: unknown): value is KioskCheckoutTarget {
  if (typeof value !== "object" || value === null) return false
  const target = value as Record<string, unknown>
  return [target.tenantId, target.outletId, target.sessionId].every(
    (id) => typeof id === "number" && Number.isSafeInteger(id) && id > 0
  )
}

function kioskPairingError(error: ApiError) {
  return ["kiosk_revoked", "kiosk_expired", "kiosk_not_paired", "kiosk_pairing_changed"].includes(error.code ?? "")
}

function matchesPairedKiosk(operation: PendingKioskOperation, status: KioskStatus | null) {
  return status !== null && operation.deviceId === status.device.id &&
    (!operation.checkout || (
      operation.checkout.tenantId === status.tenant.id &&
      operation.checkout.outletId === status.outlet.id
    ))
}

function matchesCheckoutTarget(
  operation: PendingKioskOperation,
  result?: { state: string; contract_version?: number; checkout_session_id?: number | null; checkout_outlet_id?: number | null }
) {
  return !operation.checkout || (
    result?.contract_version === 4 &&
    result.checkout_outlet_id === operation.checkout.outletId &&
    (result.checkout_session_id === operation.checkout.sessionId ||
      (result.state === "rejected" && result.checkout_session_id === null))
  )
}

function captureCheckoutLocation(): Promise<LocationEvidence> {
  if (!navigator.geolocation) return Promise.resolve({ status: "unavailable" })

  return new Promise((resolve) => navigator.geolocation.getCurrentPosition(
    ({ coords }) => resolve({
      status: "provided",
      latitude: coords.latitude,
      longitude: coords.longitude,
      accuracy_meters: coords.accuracy,
    }),
    (error) => resolve({ status: error.code === error.PERMISSION_DENIED ? "permission_denied" : "unavailable" }),
    { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 }
  ))
}
