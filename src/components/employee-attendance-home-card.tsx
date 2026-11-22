import { Tick02Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"

export type EmployeeAttendanceHomeState =
  | "not-checked-in"
  | "working"
  | "finished"
  | "unavailable"

export function EmployeeAttendanceHomeCard({
  state,
  greeting,
  duration,
  checkInTime,
  timeRange,
  canCheckIn,
  canCheckOut,
  onCheckIn,
  onCheckOut,
}: {
  state: EmployeeAttendanceHomeState
  greeting: string
  duration: string | null
  checkInTime: string | null
  timeRange: string | null
  canCheckIn: boolean
  canCheckOut: boolean
  onCheckIn: () => void
  onCheckOut: () => void
}) {
  const status =
    state === "working"
      ? "Sedang bekerja"
      : state === "finished"
        ? "Selesai hari ini"
        : state === "not-checked-in"
          ? "Belum masuk"
          : "Status belum tersedia"

  return (
    <section
      aria-label="Hari ini"
      className="flex min-w-0 flex-col items-stretch gap-4 rounded-xl border border-border bg-card p-4 text-center shadow-sm sm:p-5"
    >
      <Badge
        className="mx-auto"
        role="status"
        variant={state === "working" ? "success" : "neutral"}
      >
        {state === "finished" ? (
          <HugeiconsIcon aria-hidden="true" icon={Tick02Icon} />
        ) : null}
        {status}
      </Badge>

      {state === "not-checked-in" ? (
        <>
          <h1 className="text-body font-semibold" id="attendance-home-title">
            {greeting}
          </h1>
          <p className="text-body">Tekan tombol di bawah saat mulai kerja.</p>
          <Button
            className="min-h-12 w-full"
            disabled={!canCheckIn}
            onClick={onCheckIn}
          >
            Absen masuk
          </Button>
        </>
      ) : state === "working" ? (
        <>
          <h1 className="sr-only" id="attendance-home-title">
            Hari ini
          </h1>
          <p
            aria-live="off"
            className="text-display font-semibold tabular-nums leading-tight"
          >
            {duration ?? "Durasi belum tersedia"}
          </p>
          <p className="text-body">
            Masuk <time>{checkInTime ?? "Belum tercatat"}</time>
          </p>
          <Button
            className="min-h-12 w-full"
            disabled={!canCheckOut}
            onClick={onCheckOut}
          >
            Absen keluar
          </Button>
        </>
      ) : state === "finished" ? (
        <>
          <h1 className="sr-only" id="attendance-home-title">
            Hari ini
          </h1>
          <p className="text-display font-semibold tabular-nums leading-tight">
            {duration ?? "Durasi belum tersedia"}
          </p>
          <p className="text-body tabular-nums">
            {timeRange ?? "Waktu belum tersedia"}
          </p>
        </>
      ) : (
        <>
          <h1 className="text-body font-semibold" id="attendance-home-title">
            Kehadiran hari ini
          </h1>
          <p className="text-body">Muat ulang status untuk mencoba lagi.</p>
        </>
      )}
    </section>
  )
}
