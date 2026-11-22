import { createFileRoute, notFound } from "@tanstack/react-router"
import { useState } from "react"
import { EmployeeAttendanceClock } from "@/components/employee-attendance-clock"
import { EmployeeShell } from "@/components/employee-shell"
import { OutletGeofenceMap } from "@/components/outlet-geofence-map"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"

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

function previewHref(state: PreviewState, operation = "check_in") {
  return `/dev-employee-attendance-states?state=${state}&operation=${operation}`
}

function StateAction({
  state,
  label,
  variant,
  operation = "check_in",
  disabled = false,
}: {
  state: PreviewState
  label: string
  variant: "default" | "outline" | "secondary"
  operation?: "check_in" | "check_out"
  disabled?: boolean
}) {
  return (
    <Button
      className="min-h-12 w-full"
      disabled={disabled}
      nativeButton={false}
      render={<a href={previewHref(state, operation)} />}
      variant={variant}
    >
      {label}
    </Button>
  )
}

function EmployeeAttendanceStatesPreview() {
  const { operation, state } = Route.useSearch()
  const navigate = Route.useNavigate()
  const [photoCaptured, setPhotoCaptured] = useState(false)
  const [photoAccepted, setPhotoAccepted] = useState(false)

  if (state.startsWith("home-") || state === "problem-banner") {
    const working = state === "home-working"
    const finished = state === "home-finished"
    const status = working
      ? "Sedang bekerja sejak 08.05"
      : finished
        ? "Selesai · 08.05–17.12"
        : state === "problem-banner"
          ? "Status kehadiran belum tersedia"
          : "Belum absen masuk"

    return (
      <div data-preview-state={state}>
        <EmployeeShell active="today" accountName="Rani">
          <div className="flex min-w-0 flex-col gap-5">
            <header className="text-center">
              <p className="text-caption text-muted-foreground">
                <time dateTime="2026-11-22">Minggu, 22 November</time>
              </p>
            </header>
            <section
              aria-labelledby="attendance-status-title"
              className="flex w-full flex-col items-center gap-6 text-center"
            >
              <EmployeeAttendanceClock showTimeZoneLabel={false} />
              <div className="flex max-w-xl flex-col items-center gap-1">
                <h1 className="text-caption" id="attendance-status-title">
                  Status kehadiran hari ini
                </h1>
                <p className="text-subtitle" role="status">
                  {status}
                </p>
              </div>
              <p className="text-caption text-muted-foreground">
                Outlet aktif · Outlet Contoh
              </p>
              <div className="grid w-full max-w-xl grid-cols-2 gap-2">
                <StateAction
                  state="loc-inside"
                  label="Absen Masuk"
                  operation="check_in"
                  variant={finished || working ? "outline" : "default"}
                  disabled={finished || working || state === "problem-banner"}
                />
                <StateAction
                  state="loc-inside"
                  label="Absen Keluar"
                  operation="check_out"
                  variant={
                    working ? "default" : finished ? "secondary" : "outline"
                  }
                  disabled={!working}
                />
              </div>
            </section>
            {state === "problem-banner" ? (
              <Alert variant="destructive">
                <AlertTitle>Status presensi belum dapat dimuat</AlertTitle>
                <AlertDescription>
                  Periksa koneksi, lalu muat ulang status sebelum mencatat
                  presensi.
                </AlertDescription>
              </Alert>
            ) : null}
          </div>
        </EmployeeShell>
      </div>
    )
  }

  if (state === "schedule-not-used") {
    return (
      <div data-preview-state={state}>
        <EmployeeShell active="schedule" accountName="Rani">
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
        <EmployeeShell active="today" accountName="Rani">
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
              Absen {checkIn ? "masuk" : "keluar"} tercatat ·{" "}
              {checkIn ? "08.05" : "17.12"}
            </h1>
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
  const refreshLabel = location.denied ? "Coba lagi" : "Perbarui lokasi"
  const submitDisabledPhoto = state === "submit-disabled-photo"
  const hasCapturedPhoto = photoCaptured || submitDisabledPhoto

  return (
    <div
      className="attendance-focus-view fixed inset-0 z-50 grid h-[100dvh] min-h-0 grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden bg-canvas text-foreground"
      data-preview-state={state}
    >
      <header className="shrink-0 border-b border-border bg-surface pt-[env(safe-area-inset-top)]">
        <div className="relative mx-auto flex min-h-14 w-full max-w-2xl items-center justify-center px-16">
          <Button
            aria-label="Kembali ke halaman presensi"
            className="absolute left-2 top-1/2 -translate-y-1/2"
            nativeButton={false}
            render={<a href={previewHref("home-not-checked-in")} />}
            variant="ghost"
          >
            Kembali
          </Button>
          <h1 className="text-subtitle text-center">
            {operation === "check_in" ? "Absen Masuk" : "Absen Keluar"}
          </h1>
        </div>
      </header>

      <main className="min-h-0 overflow-y-auto overscroll-contain">
        <div className="mx-auto flex w-full max-w-2xl flex-col px-4 pb-5 sm:px-5">
          <section aria-labelledby="preview-outlet-title" className="py-4">
            <h2 className="text-subtitle" id="preview-outlet-title">
              Outlet presensi
            </h2>
            <p className="mt-2 min-h-11 text-body font-medium">{outlet.name}</p>
          </section>

          <section aria-labelledby="preview-photo-title" className="py-4">
            <h2 className="text-subtitle" id="preview-photo-title">
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
                  <Button
                    aria-pressed={photoAccepted}
                    className="min-h-11"
                    onClick={() => setPhotoAccepted(true)}
                    variant={photoAccepted ? "secondary" : "default"}
                  >
                    Pakai foto ini
                  </Button>
                </div>
              ) : (
                <Button
                  className="min-h-11"
                  onClick={() => setPhotoCaptured(true)}
                >
                  Ambil foto
                </Button>
              )}
            </div>
          </section>

          <section aria-labelledby="preview-location-title" className="py-4">
            <h2 className="text-subtitle" id="preview-location-title">
              Lokasi
            </h2>
            <p className="mt-1 text-body text-muted-foreground" role="status">
              {location.denied
                ? "Izin lokasi ditolak. Periksa izin di setelan browser atau ponsel."
                : location.outside
                  ? `Di luar area · ${distance} m. Datang ke outlet, lalu`
                  : location.weak
                    ? `Sinyal lokasi lemah · akurasi ±${accuracy} m. Pindah dekat pintu atau jendela, lalu`
                    : `Di area outlet · ${distance} m · akurasi ±${accuracy} m`}
            </p>
            {location.outside || location.weak || location.denied ? (
              <Button
                className="mt-2 min-h-11"
                onClick={() =>
                  void navigate({
                    search: { operation, state: "loc-inside" },
                  })
                }
                variant="outline"
              >
                {refreshLabel}
              </Button>
            ) : null}
            <div className="mt-3">
              <OutletGeofenceMap
                outletName={outlet.name}
                latitude={outlet.latitude}
                longitude={outlet.longitude}
                radiusMeters={outlet.radius}
                position={position}
                onLocate={() =>
                  void navigate({
                    search: { operation, state: "loc-inside" },
                  })
                }
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
              location.denied ||
              (!photoAccepted && !submitDisabledPhoto)
            }
            onClick={() =>
              window.location.assign(
                previewHref(
                  operation === "check_in"
                    ? "success-check-in"
                    : "success-check-out",
                  operation
                )
              )
            }
          >
            {!hasCapturedPhoto
              ? "Ambil foto dulu"
              : submitDisabledPhoto
                ? "Pilih foto di atas"
                : !photoAccepted
                  ? "Pilih foto di atas"
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
