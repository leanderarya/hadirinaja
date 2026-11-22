import { createFileRoute, notFound } from "@tanstack/react-router"
import { useState } from "react"
import { EmployeeAttendanceHistory } from "@/components/employee-attendance-history"
import { EmployeeAttendanceHomeCard } from "@/components/employee-attendance-home-card"
import { EmployeeAttendanceVerificationHeader } from "@/components/employee-attendance-verification-header"
import { EmployeeShell } from "@/components/employee-shell"
import { OutletGeofenceMap } from "@/components/outlet-geofence-map"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  attendanceDurationMinutes,
  attendanceGreeting,
  formatAttendanceDuration,
  formatAttendanceHeaderTime,
  weeklyAttendanceSummary,
} from "@/lib/attendance-presentation"

const previewStates = [
  "home-not-checked-in",
  "home-working",
  "home-finished",
  "problem-banner",
  "loc-inside",
  "loc-outside",
  "loc-weak",
  "loc-denied",
  "photo-step",
  "submit-disabled-photo",
  "success-check-in",
  "success-check-out",
  "schedule-not-used",
] as const

type PreviewState = (typeof previewStates)[number]

const outlet = {
  name: "Outlet Contoh",
  latitude: -6.2088,
  longitude: 106.8456,
  radius: 120,
}

function previewDay(workDate: string, start: string, end: string) {
  const checkIn = `${workDate}T${start}:00+07:00`
  const checkOut = `${workDate}T${end}:00+07:00`
  const id = Number(workDate.slice(-2))
  return {
    work_date: workDate,
    outcome: "present",
    schedule: { timezone: "Asia/Jakarta" },
    sessions: [
      {
        id,
        recording_status: "closed",
        outlet: { id: 4, name: outlet.name },
        original: {
          work_date: workDate,
          check_in_at: checkIn,
          check_out_at: checkOut,
        },
        effective: {
          work_date: workDate,
          check_in_at: checkIn,
          check_out_at: checkOut,
        },
        schedule_snapshot: { timezone: "Asia/Jakarta" },
        review_indicators: [],
        correction: null,
      },
    ],
    review: { status: "none", indicators: [] },
    unresolved_conflicts: [],
    is_finalized: false,
  }
}

const previewHistory = [
  previewDay("2026-11-19", "08:01", "16:55"),
  previewDay("2026-11-20", "08:02", "17:10"),
]

function previewHref(state: PreviewState, operation = "check_in") {
  return `/dev-employee-attendance-states?state=${state}&operation=${operation}`
}

function EmployeeAttendanceStatesPreview() {
  const { operation, state } = Route.useSearch()
  const navigate = Route.useNavigate()
  const [photoCaptured, setPhotoCaptured] = useState(false)
  const [photoAccepted, setPhotoAccepted] = useState(false)

  if (state.startsWith("home-") || state === "problem-banner") {
    const working = state === "home-working"
    const finished = state === "home-finished"
    const now = new Date(
      working ? "2026-11-22T06:28:00Z" : "2026-11-22T11:20:00Z"
    )
    const activeCheckIn = "2026-11-22T08:05:00+07:00"
    const activeSession = working
      ? {
          id: 900,
          work_date: "2026-11-22",
          check_in_at: activeCheckIn,
          timezone: "Asia/Jakarta",
        }
      : null
    const days = finished
      ? [...previewHistory, previewDay("2026-11-22", "08:05", "17:12")]
      : previewHistory
    const durationMinutes = working
      ? attendanceDurationMinutes(activeCheckIn, now)
      : finished
        ? attendanceDurationMinutes(
            "2026-11-22T08:05:00+07:00",
            "2026-11-22T17:12:00+07:00"
          )
        : null
    const summary = weeklyAttendanceSummary(days, activeSession, now)
    const homeState =
      state === "problem-banner"
        ? "unavailable"
        : working
          ? "working"
          : finished
            ? "finished"
            : "not-checked-in"

    return (
      <div data-preview-state={state}>
        <EmployeeShell
          active="today"
          accountName="Rani"
          outletContext={{
            outlets: [{ id: 4, name: outlet.name }],
            selectedOutletId: 4,
          }}
        >
          <div className="employee-attendance-home flex min-w-0 flex-col gap-5 [&_[data-slot=alert-title]]:text-body [&_[data-slot=alert-title]]:font-semibold [&_[data-slot=alert-description]]:text-body [&_button]:font-semibold">
            <header className="flex min-w-0 justify-end">
              <p className="text-caption text-muted-foreground tabular-nums">
                <time dateTime={now.toISOString()}>
                  {formatAttendanceHeaderTime(now, "Asia/Jakarta")}
                </time>
              </p>
            </header>
            <EmployeeAttendanceHomeCard
              state={homeState}
              greeting={attendanceGreeting("Rani Putri", now, "Asia/Jakarta")}
              duration={
                durationMinutes === null
                  ? null
                  : formatAttendanceDuration(durationMinutes)
              }
              checkInTime={working ? "08.05" : null}
              timeRange={finished ? "08.05 – 17.12" : null}
              canCheckIn={!working && !finished && state !== "problem-banner"}
              canCheckOut={working}
              onCheckIn={() =>
                void navigate({
                  search: { operation: "check_in", state: "loc-inside" },
                })
              }
              onCheckOut={() =>
                void navigate({
                  search: { operation: "check_out", state: "loc-inside" },
                })
              }
            />
            {state === "problem-banner" ? (
              <Alert variant="destructive">
                <AlertTitle>Status presensi belum dapat dimuat</AlertTitle>
                <AlertDescription>
                  Periksa koneksi, lalu muat ulang status sebelum mencatat
                  presensi.
                </AlertDescription>
              </Alert>
            ) : null}
            <EmployeeAttendanceHistory
              currentWorkDate="2026-11-22"
              days={days}
              activeSession={activeSession}
              now={now}
              summary={summary}
            />
          </div>
        </EmployeeShell>
      </div>
    )
  }

  if (state === "schedule-not-used") {
    return (
      <div data-preview-state={state}>
        <EmployeeShell
          active="schedule"
          accountName="Rani"
          outletContext={{
            outlets: [{ id: 4, name: outlet.name }],
            selectedOutletId: 4,
          }}
        >
          <main className="flex flex-col gap-4">
            <header>
              <h1 className="text-title">Jadwal pribadi</h1>
            </header>
            <section
              aria-label="Jadwal mingguan"
              className="flex flex-col gap-3"
            >
              <h2 className="text-subtitle">Jadwal mingguan</h2>
              <p className="text-body text-muted-foreground" role="status">
                Organisasi Contoh belum memakai jadwal di aplikasi. Absen tetap
                bisa dilakukan kapan saja.
              </p>
              <Button
                className="min-h-11 self-start"
                nativeButton={false}
                render={<a href="/attendance" />}
                variant="outline"
              >
                Ke halaman Absen
              </Button>
            </section>
          </main>
        </EmployeeShell>
      </div>
    )
  }

  if (state === "success-check-in" || state === "success-check-out") {
    const checkIn = state === "success-check-in"
    return (
      <div data-preview-state={state}>
        <EmployeeShell
          active="today"
          accountName="Rani"
          outletContext={{
            outlets: [{ id: 4, name: outlet.name }],
            selectedOutletId: 4,
          }}
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
            <h1
              className="text-display font-semibold"
              id="attendance-receipt-title"
            >
              Absen {checkIn ? "masuk" : "keluar"} tercatat
            </h1>
            <time className="text-subtitle tabular-nums">
              {checkIn ? "08.05" : "17.12"}
            </time>
            {!checkIn ? (
              <p className="text-body">Total hari ini 9 j 07 m</p>
            ) : null}
            <Button
              className="min-h-11"
              nativeButton={false}
              render={<a href="/attendance" />}
            >
              Kembali ke beranda
            </Button>
          </section>
        </EmployeeShell>
      </div>
    )
  }

  const location = {
    inside: state === "loc-inside",
    outside: state === "loc-outside",
    weak: state === "loc-weak",
    denied: state === "loc-denied",
  }
  const distance = location.outside ? 260 : 48
  const accuracy = location.weak ? 180 : 12
  const position = location.denied
    ? null
    : {
        latitude: location.outside ? -6.214 : outlet.latitude,
        longitude: outlet.longitude,
        accuracy_meters: accuracy,
      }
  const submitDisabledPhoto = state === "submit-disabled-photo"
  const hasCapturedPhoto = photoCaptured || submitDisabledPhoto
  const isPhotoAccepted = photoAccepted || submitDisabledPhoto

  return (
    <div
      className="attendance-focus-view fixed inset-0 z-50 grid h-[100dvh] min-h-0 grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden bg-canvas text-foreground [&_[data-slot=alert-title]]:text-label [&_[data-slot=alert-title]]:font-semibold [&_[data-slot=alert-description]]:text-body [&_button]:font-semibold"
      data-preview-state={state}
    >
      <EmployeeAttendanceVerificationHeader
        title={operation === "check_in" ? "Absen masuk" : "Absen keluar"}
        backHref={previewHref("home-not-checked-in")}
      />

      <main className="min-h-0 overflow-y-auto overscroll-contain">
        <div className="mx-auto flex w-full max-w-2xl flex-col px-4 pb-5 sm:px-5">
          <section aria-labelledby="preview-outlet-title" className="py-2">
            <h2 className="text-label" id="preview-outlet-title">
              Outlet presensi
            </h2>
            <p className="mt-1 text-body font-medium">{outlet.name}</p>
          </section>

          <section aria-labelledby="preview-photo-title" className="py-2">
            <h2 className="text-label" id="preview-photo-title">
              Foto
            </h2>
            <div className="mt-3 flex flex-col items-center gap-3 text-center">
              {hasCapturedPhoto ? (
                <div
                  aria-label="Pratinjau foto bukti presensi"
                  className="grid aspect-[3/4] max-h-[45dvh] w-full max-w-md place-items-center rounded-md bg-muted text-body text-muted-foreground"
                  role="img"
                >
                  Pratinjau foto
                </div>
              ) : (
                <div
                  aria-label="Pratinjau kamera karyawan"
                  className="grid aspect-[3/4] max-h-[45dvh] w-full max-w-md place-items-center rounded-md bg-black text-body text-white"
                  role="img"
                >
                  Kamera siap
                </div>
              )}
              {hasCapturedPhoto ? (
                <div className="flex flex-wrap justify-center gap-2">
                  <Button
                    className="min-h-11"
                    onClick={() => {
                      setPhotoCaptured(false)
                      setPhotoAccepted(false)
                    }}
                    variant="outline"
                  >
                    Ulangi
                  </Button>
                </div>
              ) : null}
            </div>
          </section>

          <section aria-labelledby="preview-location-title" className="py-2">
            <h2 className="text-label" id="preview-location-title">
              Lokasi
            </h2>
            <p className="mt-1 text-body" role="status">
              {location.denied
                ? "Izin lokasi ditolak. Izinkan di setelan perangkat, lalu kembali dan mulai ulang verifikasi."
                : location.outside
                  ? `Lokasi di luar area absen (${distance} m). Datang ke Outlet, lalu mulai ulang verifikasi.`
                  : location.weak
                    ? `Sinyal lokasi lemah (akurasi ±${accuracy} m). Pindah dekat pintu atau jendela, lalu mulai ulang verifikasi.`
                    : `Lokasi berada di area absen (${distance} m; akurasi ±${accuracy} m).`}
            </p>
            <div className="mt-2">
              <OutletGeofenceMap
                outletName={outlet.name}
                latitude={outlet.latitude}
                longitude={outlet.longitude}
                radiusMeters={outlet.radius}
                description="Lingkaran ungu: area absen · titik biru: lokasi Anda."
                compact
                position={position}
                locating={false}
              />
            </div>
          </section>
        </div>
      </main>

      <footer className="shrink-0 border-t border-border bg-surface px-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-3 sm:px-5">
        <div className="mx-auto w-full max-w-2xl">
          <Button
            className="min-h-12 w-full whitespace-normal"
            disabled={
              submitDisabledPhoto ||
              location.outside ||
              location.weak ||
              location.denied
            }
            onClick={() => {
              if (!hasCapturedPhoto) {
                setPhotoCaptured(true)
                return
              }
              if (!isPhotoAccepted) {
                setPhotoAccepted(true)
                return
              }
              if (submitDisabledPhoto) return
              window.location.assign(
                previewHref(
                  operation === "check_in"
                    ? "success-check-in"
                    : "success-check-out",
                  operation
                )
              )
            }}
          >
            {!hasCapturedPhoto
              ? "Ambil foto"
              : !isPhotoAccepted
                ? "Pakai foto ini"
                : `Kirim Absen ${operation === "check_in" ? "Masuk" : "Keluar"}`}
          </Button>
        </div>
      </footer>
    </div>
  )
}

export const Route = createFileRoute("/dev-employee-attendance-states")({
  validateSearch: (search: Record<string, unknown>) => ({
    state: previewStates.includes(search.state as PreviewState)
      ? (search.state as PreviewState)
      : previewStates[0],
    operation: search.operation === "check_out" ? "check_out" : "check_in",
  }),
  beforeLoad: () => {
    if (import.meta.env.PROD) throw notFound()
  },
  head: () => ({
    meta: [{ title: "Pratinjau state presensi | HadirinAja" }],
  }),
  component: EmployeeAttendanceStatesPreview,
})
