import { createFileRoute } from "@tanstack/react-router"
import { useCallback, useEffect, useState } from "react"

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
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { ApiError, type AuthSession, apiRequest } from "@/lib/api"

export const Route = createFileRoute("/attendance")({
  component: AttendancePage,
})

type ReviewableSession = {
  id: number
  status: "active" | "closed"
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

type AttendanceState = {
  server_time: string
  employee: { id: number; name: string }
  outlets: Array<{ id: number; name: string }>
  selected_outlet_id: number | null
  schedule: Schedule | null
  active_session: ReviewableSession | null
  allowed_next_operation: "check_in" | "check_out" | null
  personal_location: {
    required: boolean
    radius_meters: number | null
    geofence_configured: boolean
  }
  recent_history: ReviewableSession[]
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
  employeeId: number
  outletId: number | null
  location: LocationEvidence | null
  needsRecovery: boolean
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

const pendingStorageKey = "hadirinaja.attendance.pending"

function AttendancePage() {
  const [attendance, setAttendance] = useState<AttendanceState | null>(null)
  const [selectedOutletId, setSelectedOutletId] = useState("")
  const [pending, setPending] = useState<PendingOperation | null>(null)
  const [operationState, setOperationState] = useState<
    "idle" | "sending" | "pending" | "not_found"
  >("idle")
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")

  const refresh = useCallback(async (outletId?: number) => {
    const query = outletId ? `?outlet_id=${outletId}` : ""
    const result = await apiRequest<AttendanceState>(`/attendance/me${query}`)
    setAttendance(result)
    setSelectedOutletId(
      result.active_session
        ? String(result.active_session.outlet.id)
        : result.selected_outlet_id
          ? String(result.selected_outlet_id)
          : ""
    )
    return result
  }, [])

  useEffect(() => {
    let cancelled = false

    async function bootstrap() {
      try {
        const session = await apiRequest<AuthSession>("/auth/me")
        if (!session.active_membership) {
          window.location.assign("/select-tenant")
          return
        }
        const result = await apiRequest<AttendanceState>("/attendance/me")
        if (cancelled) return
        setAttendance(result)
        setSelectedOutletId(
          result.active_session
            ? String(result.active_session.outlet.id)
            : result.selected_outlet_id
              ? String(result.selected_outlet_id)
              : ""
        )

        const serialized = window.sessionStorage.getItem(pendingStorageKey)
        if (serialized) {
          try {
            const saved: unknown = JSON.parse(serialized)
            if (isStoredPendingOperation(saved, result.employee.id)) {
              setPending({ ...saved, location: null, needsRecovery: true })
            } else {
              window.sessionStorage.removeItem(pendingStorageKey)
            }
          } catch {
            window.sessionStorage.removeItem(pendingStorageKey)
          }
        }
      } catch (caught) {
        if (
          caught instanceof ApiError &&
          (caught.status === 401 || caught.status === 419)
        ) {
          window.location.assign("/login?expired=1")
          return
        }
        if (!cancelled) {
          setError(
            caught instanceof ApiError && caught.status === 403
              ? "Akun ini belum terhubung ke identitas karyawan aktif."
              : "Status kehadiran belum dapat dimuat."
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

  const recoverStatus = useCallback(
    async (operation: PendingOperation) => {
      try {
        const result = await apiRequest<{
          state: "not_found" | "pending" | "completed" | "rejected"
          result?: OperationResult | { message?: string; code?: string }
        }>(`/attendance/me/operations/${operation.operation}/${operation.key}`)

        if (result.state === "completed" && result.result) {
          window.sessionStorage.removeItem(pendingStorageKey)
          setPending(null)
          setOperationState("idle")
          setNotice("Kehadiran berhasil dikonfirmasi oleh server.")
          setError("")
          await refresh()
        } else if (result.state === "rejected") {
          window.sessionStorage.removeItem(pendingStorageKey)
          setPending(null)
          setOperationState("idle")
          setError(
            (result.result as { message?: string } | undefined)?.message ??
              "Permintaan kehadiran ditolak. Periksa status dan coba kembali."
          )
        } else if (result.state === "pending") {
          setOperationState("pending")
          setPending(
            (current) => current && { ...current, needsRecovery: false }
          )
        } else {
          setOperationState("not_found")
          setPending(
            (current) => current && { ...current, needsRecovery: false }
          )
        }
      } catch {
        setOperationState("pending")
        setPending((current) => current && { ...current, needsRecovery: false })
      }
    },
    [refresh]
  )

  useEffect(() => {
    if (pending?.needsRecovery) void recoverStatus(pending)
  }, [pending, recoverStatus])

  async function submitOperation(
    operation: AttendanceOperation,
    location: LocationEvidence,
    existingKey?: string
  ) {
    if (!attendance) return
    const outletId = operation === "check_in" ? Number(selectedOutletId) : null
    const next: PendingOperation = {
      key: existingKey ?? window.crypto.randomUUID(),
      operation,
      employeeId: attendance.employee.id,
      outletId,
      location,
      needsRecovery: false,
    }
    setBusy(true)
    setError("")
    setNotice("")
    setOperationState("sending")
    setPending(next)
    window.sessionStorage.setItem(
      pendingStorageKey,
      JSON.stringify({
        key: next.key,
        operation: next.operation,
        employeeId: next.employeeId,
        outletId: next.outletId,
      })
    )

    try {
      const result = await apiRequest<OperationResult>(
        `/attendance/me/${operation === "check_in" ? "check-in" : "check-out"}`,
        {
          method: "POST",
          headers: { "Idempotency-Key": next.key },
          body: {
            ...(operation === "check_in" ? { outlet_id: outletId } : {}),
            location,
          },
        }
      )

      if (result.operation?.state === "pending") {
        setOperationState("pending")
        setPending({ ...next, needsRecovery: true })
        return
      }

      window.sessionStorage.removeItem(pendingStorageKey)
      setPending(null)
      setOperationState("idle")
      setNotice(
        operation === "check_in"
          ? "Check-in tercatat pada waktu server."
          : "Check-out tercatat pada waktu server."
      )
      await refresh()
    } catch (caught) {
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
        window.sessionStorage.removeItem(pendingStorageKey)
        setPending(null)
        setOperationState("idle")
        setError(caught.message)
        await refresh().catch(() => undefined)
      }
    } finally {
      setBusy(false)
    }
  }

  async function captureLocation(): Promise<LocationEvidence> {
    if (!attendance?.personal_location.required) {
      return { status: "unavailable" }
    }
    if (!navigator.geolocation) {
      return { status: "unavailable" }
    }

    return new Promise((resolve) => {
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
  }

  async function startAttendance(operation: AttendanceOperation) {
    if (!attendance || (!selectedOutletId && operation === "check_in")) return
    setBusy(true)
    try {
      const location = await captureLocation()
      await submitOperation(operation, location)
    } catch {
      setError("Permintaan kehadiran belum dapat dikirim.")
    } finally {
      setBusy(false)
    }
  }

  async function retrySameOperation() {
    if (!pending?.location) {
      setError(
        "Lokasi awal tidak tersedia setelah halaman dibuka ulang. Mulai percobaan baru setelah status tetap belum ditemukan."
      )
      return
    }
    await submitOperation(pending.operation, pending.location, pending.key)
  }

  async function changeOutlet(value: string) {
    setSelectedOutletId(value)
    setError("")
    try {
      await refresh(Number(value))
    } catch {
      setError("Jadwal outlet tersebut belum dapat dimuat.")
    }
  }

  const openSession = attendance?.active_session ?? null
  const timezone =
    openSession?.timezone ?? attendance?.schedule?.timezone ?? "Asia/Jakarta"
  const currentOperation = attendance?.allowed_next_operation ?? null

  if (loading) {
    return (
      <main className="flex min-h-svh items-center justify-center px-4 text-body text-muted-foreground">
        Memuat kehadiran…
      </main>
    )
  }

  return (
    <main className="mx-auto flex min-h-svh w-full max-w-3xl flex-col gap-5 px-4 py-8 sm:px-6">
      <header className="flex flex-col gap-2">
        <p className="text-label text-muted-foreground">
          HadirinAja · Karyawan
        </p>
        <h1 className="text-title">Kehadiran saya</h1>
        <p className="text-body text-muted-foreground">
          Waktu pencatatan ditentukan server. Lokasi browser dapat ditinjau dan
          bukan bukti lokasi yang tahan manipulasi.
        </p>
      </header>

      {error ? (
        <Alert variant="destructive">
          <AlertTitle>Permintaan belum selesai</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {notice ? (
        <Alert>
          <AlertTitle>Berhasil</AlertTitle>
          <AlertDescription>{notice}</AlertDescription>
        </Alert>
      ) : null}

      {attendance ? (
        <>
          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-col gap-1">
                  <CardTitle>{attendance.employee.name}</CardTitle>
                  <CardDescription>
                    {openSession
                      ? "Sesi sedang berlangsung"
                      : "Belum ada sesi aktif"}
                  </CardDescription>
                </div>
                <Badge variant={openSession ? "default" : "secondary"}>
                  {openSession ? "Sedang bekerja" : "Belum check-in"}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="flex flex-col gap-5">
              {openSession ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  <Info
                    label="Outlet sesi"
                    value={openSession.outlet.name ?? "Outlet"}
                  />
                  <Info label="Tanggal kerja" value={openSession.work_date} />
                  <Info
                    label="Check-in tercatat"
                    value={formatTimestamp(openSession.check_in_at, timezone)}
                  />
                  <Info
                    label="Check-out tercatat"
                    value={
                      openSession.check_out_at
                        ? formatTimestamp(openSession.check_out_at, timezone)
                        : "Belum dicatat"
                    }
                  />
                </div>
              ) : (
                <>
                  <Field>
                    <FieldLabel htmlFor="attendance-outlet">Outlet</FieldLabel>
                    <NativeSelect
                      disabled={
                        attendance.outlets.length === 0 || Boolean(pending)
                      }
                      id="attendance-outlet"
                      onChange={(event) =>
                        void changeOutlet(event.target.value)
                      }
                      value={selectedOutletId}
                    >
                      <NativeSelectOption value="" disabled>
                        Pilih outlet
                      </NativeSelectOption>
                      {attendance.outlets.map((outlet) => (
                        <NativeSelectOption
                          key={outlet.id}
                          value={String(outlet.id)}
                        >
                          {outlet.name}
                        </NativeSelectOption>
                      ))}
                    </NativeSelect>
                  </Field>
                  <ScheduleSummary
                    schedule={attendance.schedule}
                    timezone={timezone}
                  />
                </>
              )}

              {attendance.personal_location.required ? (
                <p className="text-caption text-muted-foreground">
                  Lokasi diperlukan oleh kebijakan. Radius{" "}
                  {attendance.personal_location.radius_meters ?? "—"} m.
                  {attendance.personal_location.geofence_configured
                    ? " Hasil penilaian lokasi disimpan bersama indikator peninjauan."
                    : " Titik geofence belum disetel; rekaman akan ditandai perlu ditinjau."}
                </p>
              ) : null}

              {openSession?.review_indicators.length ? (
                <ReviewIndicators indicators={openSession.review_indicators} />
              ) : null}

              {pending ? (
                <div className="flex flex-col gap-3 rounded-xl border p-4">
                  <p className="text-body">
                    {operationState === "pending"
                      ? "Status server masih diproses atau belum dapat dipastikan."
                      : operationState === "not_found"
                        ? "Belum ada catatan untuk permintaan ini. Periksa lagi sebelum mencoba operasi baru; aplikasi tidak membuat kunci baru otomatis."
                        : "Memeriksa status permintaan…"}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      disabled={busy}
                      onClick={() => {
                        setPending({ ...pending, needsRecovery: true })
                        setOperationState("pending")
                      }}
                      variant="outline"
                    >
                      Periksa status lagi
                    </Button>
                    {operationState === "not_found" && pending.location ? (
                      <Button
                        disabled={busy}
                        onClick={() => void retrySameOperation()}
                      >
                        Kirim ulang dengan kunci yang sama
                      </Button>
                    ) : null}
                  </div>
                </div>
              ) : currentOperation ? (
                <Button
                  className="h-12 w-full"
                  disabled={busy || (!openSession && !selectedOutletId)}
                  onClick={() => void startAttendance(currentOperation)}
                  size="lg"
                >
                  {busy
                    ? "Mengirim…"
                    : currentOperation === "check_in"
                      ? "Check-in sekarang"
                      : "Check-out sekarang"}
                </Button>
              ) : (
                <Alert>
                  <AlertTitle>Mode personal belum tersedia</AlertTitle>
                  <AlertDescription>
                    Kebijakan outlet saat ini belum mengizinkan pencatatan
                    melalui perangkat pribadi.
                  </AlertDescription>
                </Alert>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Riwayat terbaru</CardTitle>
              <CardDescription>
                Catatan kehadiran pribadi, tanpa alur persetujuan.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {attendance.recent_history.length ? (
                <ul className="flex flex-col divide-y">
                  {attendance.recent_history.map((item) => (
                    <li
                      className="flex flex-col gap-2 py-4 sm:flex-row sm:items-center sm:justify-between"
                      key={item.id}
                    >
                      <div className="flex flex-col gap-1">
                        <span className="text-label">
                          {item.work_date} · {item.outlet.name ?? "Outlet"}
                        </span>
                        <span className="text-caption text-muted-foreground">
                          {formatTimestamp(item.check_in_at, item.timezone)}
                          {item.check_out_at
                            ? ` — ${formatTimestamp(item.check_out_at, item.timezone)}`
                            : " — belum check-out"}
                        </span>
                      </div>
                      <Badge
                        variant={
                          item.status === "active" ? "default" : "secondary"
                        }
                      >
                        {item.status === "active" ? "Aktif" : "Selesai"}
                      </Badge>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-body text-muted-foreground">
                  Belum ada riwayat kehadiran.
                </p>
              )}
            </CardContent>
          </Card>
        </>
      ) : null}
    </main>
  )
}

function ScheduleSummary({
  schedule,
  timezone,
}: {
  schedule: Schedule | null
  timezone: string
}) {
  if (!schedule) {
    return (
      <p className="text-body text-muted-foreground">
        Pilih outlet untuk melihat jadwal.
      </p>
    )
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Info label="Tanggal kerja" value={schedule.work_date} />
      <Info
        label="Jadwal"
        value={schedule.shift?.name ?? statusLabel(schedule.status)}
      />
      <Info
        label="Jam kerja"
        value={
          schedule.scheduled_start && schedule.scheduled_end
            ? `${formatTimestamp(schedule.scheduled_start, timezone)} — ${formatTimestamp(schedule.scheduled_end, timezone)}`
            : "Tidak ada shift terjadwal"
        }
      />
      <Info
        label="Kalender outlet"
        value={
          schedule.outlet_operating === false
            ? "Tutup · akan ditandai untuk ditinjau"
            : "Terbuka"
        }
      />
    </div>
  )
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-xl border bg-muted/20 p-3">
      <span className="text-caption text-muted-foreground">{label}</span>
      <span className="text-label">{value}</span>
    </div>
  )
}

function ReviewIndicators({ indicators }: { indicators: string[] }) {
  return (
    <Alert>
      <AlertTitle>Perlu ditinjau</AlertTitle>
      <AlertDescription>
        {indicators.map(indicatorLabel).join(" · ")}
      </AlertDescription>
    </Alert>
  )
}

function formatTimestamp(value: string, timezone: string): string {
  try {
    return new Intl.DateTimeFormat("id-ID", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: timezone,
    }).format(new Date(value))
  } catch {
    return value
  }
}

function statusLabel(status: Schedule["status"]): string {
  return status === "scheduled"
    ? "Terjadwal"
    : status === "rest"
      ? "Hari istirahat"
      : "Belum terjadwal"
}

function indicatorLabel(value: string): string {
  const labels: Record<string, string> = {
    unscheduled_work: "Kerja tanpa jadwal",
    rest_day_work: "Kerja pada hari istirahat",
    check_in_outside_window: "Check-in di luar jendela jadwal",
    late_arrival: "Datang terlambat",
    early_departure: "Pulang lebih awal",
    late_checkout: "Check-out setelah jadwal",
    missing_checkout: "Belum check-out setelah jadwal",
    location_outside_range: "Lokasi di luar radius",
    location_low_accuracy: "Akurasi lokasi rendah",
    location_unavailable: "Lokasi tidak tersedia",
    location_permission_denied: "Izin lokasi ditolak",
    location_geofence_unconfigured: "Titik geofence belum disetel",
    outlet_closed: "Outlet tercatat tutup",
    schedule_conflict: "Ada konflik pada data jadwal",
  }

  return labels[value] ?? value
}

function isStoredPendingOperation(
  value: unknown,
  employeeId: number
): value is Omit<PendingOperation, "location" | "needsRecovery"> {
  if (typeof value !== "object" || value === null) return false
  const pendingValue = value as Record<string, unknown>

  return (
    pendingValue.employeeId === employeeId &&
    (pendingValue.operation === "check_in" ||
      pendingValue.operation === "check_out") &&
    typeof pendingValue.key === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      pendingValue.key
    ) &&
    (pendingValue.outletId === null || Number.isInteger(pendingValue.outletId))
  )
}
