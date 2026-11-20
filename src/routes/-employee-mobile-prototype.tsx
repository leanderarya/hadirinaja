import {
  AlertCircleIcon,
  ArrowLeft01Icon,
  ArrowDown01Icon,
  Building01Icon,
  Camera01Icon,
  Calendar03Icon,
  ClipboardListIcon,
  Home01Icon,
  Logout03Icon,
  Notification03Icon,
  Tick02Icon,
  UserCircleIcon,
  UserGroupIcon,
} from "@hugeicons/core-free-icons"
import type { IconSvgElement } from "@hugeicons/react"
import { HugeiconsIcon } from "@hugeicons/react"
import { type ReactElement, useEffect, useRef, useState } from "react"
import { EmployeeAttendanceClock } from "@/components/employee-attendance-clock"
import { Button } from "@/components/ui/button"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Separator } from "@/components/ui/separator"

type Scenario =
  | "empty"
  | "not_checked_in"
  | "working"
  | "completed"
  | "multiple_sessions"
  | "unresolved"

type VerificationAction = "checkIn" | "checkOut"
type VerificationScenario =
  | "ready"
  | "optional_photo"
  | "no_eligible_outlet"
  | "ambiguous_outlet"
  | "cross_outlet_checkout"
  | "gps_denied"
  | "required_camera_denied"
  | "optional_camera_denied"
  | "submitting"
  | "uncertain"
type PhotoState = "empty" | "preview" | "accepted" | "skipped"
type SubmissionState = "idle" | "submitting" | "uncertain" | "success"

type VerificationConfig = {
  eligibleOutlets: readonly string[]
  initialOutlet: string
  requiredPhoto: boolean
  gpsDenied?: boolean
  cameraDenied?: boolean
  originalOutlet?: string
  originalWorkDate?: string
  uncertainResponse?: boolean
  startsSubmitting?: boolean
}

type Session = {
  id: string
  status: "Selesai" | "Sedang bekerja" | "Belum checkout"
  checkIn: string
  checkOut?: string
  outlet: string
  checkoutOutlet?: string
  note?: string
  photoEvidence?: string
  correctionAvailable?: boolean
}

type WorkDay = {
  date: string
  weekday: string
  status: string
  sessions: Session[]
}

type PrototypeData = {
  todayStatus: string
  checkInWindow: string
  previewAction?: "checkIn" | "checkOut"
  guidance?: string
  days: WorkDay[]
}

const scenarioLabels: Record<Scenario, string> = {
  empty: "Kosong",
  not_checked_in: "Belum absen masuk",
  working: "Sedang bekerja",
  completed: "Selesai",
  multiple_sessions: "Beberapa sesi",
  unresolved: "Sesi belum selesai",
}

const verificationScenarioLabels: Record<VerificationScenario, string> = {
  ready: "Siap · foto wajib",
  optional_photo: "Foto opsional",
  no_eligible_outlet: "Tidak ada Outlet tersedia",
  ambiguous_outlet: "Outlet perlu dipilih",
  cross_outlet_checkout: "Checkout beda Outlet",
  gps_denied: "Izin lokasi ditolak",
  required_camera_denied: "Kamera wajib gagal",
  optional_camera_denied: "Kamera opsional gagal",
  submitting: "Sedang mengirim",
  uncertain: "Hasil belum pasti",
}

function getVerificationConfig(
  scenario: VerificationScenario,
  action: VerificationAction
): VerificationConfig {
  if (scenario === "ambiguous_outlet") {
    return {
      eligibleOutlets: ["Outlet Menteng", "Outlet Kemang"],
      initialOutlet: "",
      requiredPhoto: true,
    }
  }
  if (scenario === "no_eligible_outlet") {
    return {
      eligibleOutlets: [],
      initialOutlet: "",
      requiredPhoto: true,
    }
  }
  if (scenario === "cross_outlet_checkout" && action === "checkOut") {
    return {
      eligibleOutlets: ["Outlet Kemang", "Outlet Kuningan"],
      initialOutlet: "",
      requiredPhoto: true,
      originalOutlet: "Outlet Menteng",
      originalWorkDate: "7 November 2026",
    }
  }
  if (scenario === "gps_denied") {
    return {
      eligibleOutlets: ["Outlet Menteng"],
      initialOutlet: "Outlet Menteng",
      requiredPhoto: true,
      gpsDenied: true,
    }
  }
  if (scenario === "required_camera_denied") {
    return {
      eligibleOutlets: ["Outlet Menteng"],
      initialOutlet: "Outlet Menteng",
      requiredPhoto: true,
      cameraDenied: true,
    }
  }
  if (scenario === "optional_camera_denied") {
    return {
      eligibleOutlets: ["Outlet Menteng"],
      initialOutlet: "Outlet Menteng",
      requiredPhoto: false,
      cameraDenied: true,
    }
  }
  return {
    eligibleOutlets: ["Outlet Menteng"],
    initialOutlet: "Outlet Menteng",
    requiredPhoto: scenario !== "optional_photo" && scenario !== "uncertain",
    uncertainResponse: scenario === "uncertain",
    startsSubmitting: scenario === "submitting",
    ...(action === "checkOut"
      ? {
          originalOutlet: "Outlet Menteng",
          originalWorkDate: "7 November 2026",
        }
      : {}),
  }
}

const finishedSession = (
  id: string,
  checkIn: string,
  checkOut: string,
  outlet: string,
  checkoutOutlet = outlet
): Session => ({
  id,
  status: "Selesai",
  checkIn,
  checkOut,
  outlet,
  checkoutOutlet,
})

const sampleData: Record<Scenario, PrototypeData> = {
  empty: {
    todayStatus: "Belum ada presensi",
    checkInWindow: "Jam masuk 08.00–09.00",
    days: [],
  },
  not_checked_in: {
    todayStatus: "Belum absen masuk",
    checkInWindow: "Jam masuk 08.00–09.00",
    previewAction: "checkIn",
    days: [
      {
        date: "2026-11-07",
        weekday: "Sabtu",
        status: "Belum absen masuk",
        sessions: [],
      },
      {
        date: "2026-11-06",
        weekday: "Jumat",
        status: "1 sesi selesai",
        sessions: [
          finishedSession("fri-1", "08.02", "16.03", "Outlet Menteng"),
        ],
      },
      {
        date: "2026-11-05",
        weekday: "Kamis",
        status: "1 sesi selesai",
        sessions: [
          finishedSession("thu-1", "08.05", "16.01", "Outlet Menteng"),
        ],
      },
      {
        date: "2026-11-04",
        weekday: "Rabu",
        status: "1 sesi selesai",
        sessions: [finishedSession("wed-1", "08.01", "16.10", "Outlet Kemang")],
      },
      {
        date: "2026-11-03",
        weekday: "Selasa",
        status: "1 sesi selesai",
        sessions: [finishedSession("tue-1", "08.10", "16.05", "Outlet Kemang")],
      },
      {
        date: "2026-11-02",
        weekday: "Senin",
        status: "Belum ada presensi",
        sessions: [],
      },
    ],
  },
  working: {
    todayStatus: "Sedang bekerja",
    checkInWindow: "Masuk pukul 08.04",
    previewAction: "checkOut",
    days: [
      {
        date: "2026-11-07",
        weekday: "Sabtu",
        status: "Sedang bekerja",
        sessions: [
          {
            id: "sat-active",
            status: "Sedang bekerja",
            checkIn: "08.04",
            outlet: "Outlet Menteng",
          },
        ],
      },
      {
        date: "2026-11-06",
        weekday: "Jumat",
        status: "1 sesi selesai",
        sessions: [
          finishedSession("fri-2", "08.02", "16.03", "Outlet Menteng"),
        ],
      },
      {
        date: "2026-11-05",
        weekday: "Kamis",
        status: "1 sesi selesai",
        sessions: [
          finishedSession("thu-2", "08.05", "16.01", "Outlet Menteng"),
        ],
      },
      {
        date: "2026-11-04",
        weekday: "Rabu",
        status: "1 sesi selesai",
        sessions: [finishedSession("wed-2", "08.01", "16.10", "Outlet Kemang")],
      },
      {
        date: "2026-11-03",
        weekday: "Selasa",
        status: "1 sesi selesai",
        sessions: [finishedSession("tue-2", "08.10", "16.05", "Outlet Kemang")],
      },
      {
        date: "2026-11-02",
        weekday: "Senin",
        status: "Belum ada presensi",
        sessions: [],
      },
    ],
  },
  completed: {
    todayStatus: "Sesi hari ini selesai",
    checkInWindow: "08.03–16.12 · 1 sesi",
    days: [
      {
        date: "2026-11-07",
        weekday: "Sabtu",
        status: "1 sesi selesai",
        sessions: [
          finishedSession("sat-done", "08.03", "16.12", "Outlet Menteng"),
        ],
      },
      {
        date: "2026-11-06",
        weekday: "Jumat",
        status: "1 sesi selesai",
        sessions: [
          finishedSession("fri-3", "08.02", "16.03", "Outlet Menteng"),
        ],
      },
      {
        date: "2026-11-05",
        weekday: "Kamis",
        status: "1 sesi selesai",
        sessions: [
          finishedSession("thu-3", "08.05", "16.01", "Outlet Menteng"),
        ],
      },
      {
        date: "2026-11-04",
        weekday: "Rabu",
        status: "1 sesi selesai",
        sessions: [finishedSession("wed-3", "08.01", "16.10", "Outlet Kemang")],
      },
      {
        date: "2026-11-03",
        weekday: "Selasa",
        status: "1 sesi selesai",
        sessions: [finishedSession("tue-3", "08.10", "16.05", "Outlet Kemang")],
      },
      {
        date: "2026-11-02",
        weekday: "Senin",
        status: "Belum ada presensi",
        sessions: [],
      },
    ],
  },
  multiple_sessions: {
    todayStatus: "2 sesi selesai",
    checkInWindow: "08.00–12.10 · 12.42–16.05",
    previewAction: "checkIn",
    days: [
      {
        date: "2026-11-07",
        weekday: "Sabtu",
        status: "2 sesi selesai",
        sessions: [
          finishedSession("sat-morning", "08.00", "12.10", "Outlet Menteng"),
          {
            ...finishedSession(
              "sat-afternoon",
              "12.42",
              "16.05",
              "Outlet Kemang",
              "Outlet Kuningan"
            ),
            photoEvidence: "Tersedia · data sintetis",
            correctionAvailable: true,
          },
        ],
      },
      {
        date: "2026-11-06",
        weekday: "Jumat",
        status: "1 sesi selesai",
        sessions: [
          finishedSession("fri-4", "08.02", "16.03", "Outlet Menteng"),
        ],
      },
      {
        date: "2026-11-05",
        weekday: "Kamis",
        status: "1 sesi selesai",
        sessions: [
          finishedSession("thu-4", "08.05", "16.01", "Outlet Menteng"),
        ],
      },
      {
        date: "2026-11-04",
        weekday: "Rabu",
        status: "1 sesi selesai",
        sessions: [finishedSession("wed-4", "08.01", "16.10", "Outlet Kemang")],
      },
      {
        date: "2026-11-03",
        weekday: "Selasa",
        status: "1 sesi selesai",
        sessions: [finishedSession("tue-4", "08.10", "16.05", "Outlet Kemang")],
      },
      {
        date: "2026-11-02",
        weekday: "Senin",
        status: "Belum ada presensi",
        sessions: [],
      },
    ],
  },
  unresolved: {
    todayStatus: "Ada sesi sebelumnya yang belum selesai",
    checkInWindow: "Sesi Rabu · masuk 08.06",
    guidance:
      "Sesi Rabu belum memiliki waktu checkout. Selesaikan melalui proses yang tersedia di aplikasi; sesi ini tidak ditutup otomatis.",
    days: [
      {
        date: "2026-11-07",
        weekday: "Sabtu",
        status: "Belum ada presensi",
        sessions: [],
      },
      {
        date: "2026-11-06",
        weekday: "Jumat",
        status: "1 sesi selesai",
        sessions: [
          finishedSession("fri-5", "08.02", "16.03", "Outlet Menteng"),
        ],
      },
      {
        date: "2026-11-05",
        weekday: "Kamis",
        status: "1 sesi selesai",
        sessions: [
          finishedSession("thu-5", "08.05", "16.01", "Outlet Menteng"),
        ],
      },
      {
        date: "2026-11-04",
        weekday: "Rabu",
        status: "Sesi belum selesai",
        sessions: [
          {
            id: "wed-open",
            status: "Belum checkout",
            checkIn: "08.06",
            outlet: "Outlet Kemang",
            note: "Sesi belum memiliki waktu checkout.",
          },
        ],
      },
      {
        date: "2026-11-03",
        weekday: "Selasa",
        status: "1 sesi selesai",
        sessions: [finishedSession("tue-5", "08.10", "16.05", "Outlet Kemang")],
      },
      {
        date: "2026-11-02",
        weekday: "Senin",
        status: "Belum ada presensi",
        sessions: [],
      },
    ],
  },
}

const sampleOutlets = [
  { name: "Outlet Menteng", timeZone: "Asia/Jakarta" },
  { name: "Outlet Kemang", timeZone: "Asia/Jakarta" },
  { name: "Outlet Kuningan", timeZone: "Asia/Jakarta" },
  {
    name: "Outlet Pusat Operasional Cilandak Barat",
    timeZone: "Asia/Jakarta",
  },
] as const
const navigation = [
  { label: "Beranda", href: "/attendance", icon: Home01Icon, active: true },
  { label: "Jadwal", href: "/scheduling", icon: Calendar03Icon, active: false },
  {
    label: "Permintaan",
    href: "/requests",
    icon: ClipboardListIcon,
    active: false,
  },
] as const

function Icon({ icon }: { icon: IconSvgElement }) {
  return <HugeiconsIcon aria-hidden="true" className="size-5" icon={icon} />
}

function SampleNotice() {
  return (
    <p className="text-caption text-muted-foreground">
      Pratinjau visual · seluruh data sintetis · tidak memakai kamera, GPS, API,
      atau membuat presensi.
    </p>
  )
}

function OutletSelector({
  selected,
  onSelect,
}: {
  selected: string
  onSelect: (outlet: string) => void
}) {
  const [query, setQuery] = useState("")
  const [open, setOpen] = useState(false)
  const filteredOutlets = sampleOutlets.filter(({ name }) =>
    name.toLocaleLowerCase("id").includes(query.trim().toLocaleLowerCase("id"))
  )

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            aria-label={`Outlet aktif: ${selected}. Pilih konteks Outlet`}
            className="h-14 w-full min-w-0 justify-start gap-2 px-2 text-left active:bg-accent aria-expanded:bg-accent"
            title={selected}
            variant="ghost"
          />
        }
      >
        <span className="shrink-0 text-muted-foreground">
          <Icon icon={Building01Icon} />
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-0 leading-tight">
          <span className="text-caption text-muted-foreground">Outlet</span>
          <span className="truncate text-label">{selected}</span>
        </span>
        <Icon icon={ArrowDown01Icon} />
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[min(20rem,calc(100vw-1.5rem))] gap-3 p-3"
      >
        <PopoverHeader>
          <PopoverTitle>Pilih Outlet</PopoverTitle>
          <PopoverDescription>
            Konteks tampilan contoh untuk Beranda, Jadwal, dan Permintaan.
          </PopoverDescription>
        </PopoverHeader>
        <label className="flex flex-col gap-1 text-label">
          Cari Outlet
          <input
            autoComplete="off"
            className="min-h-11 rounded-md border border-input bg-background px-3 text-body outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Nama Outlet"
            type="search"
            value={query}
          />
        </label>
        <div
          aria-label="Outlet contoh yang tersedia"
          className="max-h-52 overflow-y-auto overscroll-contain"
          role="group"
        >
          {filteredOutlets.map((outlet) => (
            <Button
              aria-pressed={outlet.name === selected}
              className="min-h-11 w-full justify-start gap-2 px-2 text-left"
              key={outlet.name}
              title={outlet.name}
              onClick={() => {
                onSelect(outlet.name)
                setOpen(false)
                setQuery("")
              }}
              variant="ghost"
            >
              <span className="min-w-0 flex-1 truncate">{outlet.name}</span>
              {outlet.name === selected && <Icon icon={Tick02Icon} />}
            </Button>
          ))}
          {filteredOutlets.length === 0 && (
            <p className="px-2 py-3 text-body text-muted-foreground">
              Outlet tidak ditemukan.
            </p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}

function AccountMenu({ trigger }: { trigger: ReactElement }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={trigger} />
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="flex flex-col gap-1">
            <span>Karyawan Contoh</span>
            <span className="text-caption font-normal">
              akun.sintetis@example.test
            </span>
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem disabled>
            <Icon icon={UserCircleIcon} /> Profil · belum tersedia di prototype
          </DropdownMenuItem>
          <DropdownMenuItem disabled>
            <Icon icon={Logout03Icon} /> Keluar · dinonaktifkan di prototype
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function TopBar({
  outlet,
  onOutletChange,
}: {
  outlet: string
  onOutletChange: (outlet: string) => void
}) {
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-surface pt-[env(safe-area-inset-top)]">
      <div className="mx-auto flex h-14 max-w-5xl items-center gap-2 px-2 sm:h-16 sm:px-5">
        <div className="min-w-0 flex-1 sm:max-w-md">
          <OutletSelector selected={outlet} onSelect={onOutletChange} />
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-0.5">
          <Popover>
            <PopoverTrigger
              render={
                <Button
                  aria-label="Notifikasi"
                  className="size-11 shrink-0"
                  size="icon"
                  variant="ghost"
                />
              }
            >
              <Icon icon={Notification03Icon} />
            </PopoverTrigger>
            <PopoverContent align="end" className="w-64 gap-2">
              <PopoverTitle>Notifikasi</PopoverTitle>
              <p className="text-body text-muted-foreground">
                Notifikasi belum tersedia.
              </p>
            </PopoverContent>
          </Popover>
          <AccountMenu
            trigger={
              <Button
                aria-label="Menu akun Karyawan Contoh"
                className="size-11 shrink-0"
                size="icon"
                variant="ghost"
              >
                <Icon icon={UserCircleIcon} />
              </Button>
            }
          />
        </div>
      </div>
    </header>
  )
}

function AttendanceStatus({
  data,
  outletTimeZone,
}: {
  data: PrototypeData
  outletTimeZone?: string
}) {
  return (
    <div className="flex w-full flex-col items-center gap-6">
      <EmployeeAttendanceClock outletTimeZone={outletTimeZone} />
      <div className="flex max-w-xl flex-col items-center gap-1 text-center">
        <p className="text-caption">Status kehadiran hari ini</p>
        <h2 className="text-subtitle">{data.todayStatus}</h2>
        <p className="mt-1 text-body text-muted-foreground">
          {data.checkInWindow}
        </p>
      </div>
      <div className="grid w-full max-w-xl grid-cols-2 gap-2">
        <Button
          className="min-h-12 w-full"
          disabled
          variant={data.previewAction === "checkIn" ? "default" : "outline"}
        >
          Absen Masuk
        </Button>
        <Button
          className="min-h-12 w-full"
          disabled
          variant={data.previewAction === "checkOut" ? "default" : "outline"}
        >
          Absen Keluar
        </Button>
      </div>
    </div>
  )
}

function WeekHistory({
  days,
  onOpenDay,
}: {
  days: WorkDay[]
  onOpenDay: (day: WorkDay, opener: HTMLButtonElement) => void
}) {
  if (days.length === 0) {
    return (
      <div className="py-6 text-center">
        <p className="text-body font-medium">Belum ada riwayat minggu ini</p>
        <p className="mt-1 text-caption">
          Tanggal kerja akan tampil di sini saat tersedia.
        </p>
      </div>
    )
  }

  return (
    <ol
      aria-label="Riwayat minggu ini, terbaru lebih dulu"
      className="divide-y divide-border"
    >
      {days.map((day) => (
        <li key={day.date}>
          <button
            className="flex min-h-[68px] w-full items-center gap-3 px-2 py-3 text-left outline-none transition-colors hover:bg-muted/40 focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
            onClick={(event) => onOpenDay(day, event.currentTarget)}
            type="button"
          >
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="text-label">
                {day.weekday}, {day.date.slice(8)} November
              </span>
              <span className="truncate text-caption">
                {day.status}
                {day.sessions.length > 0 &&
                  ` · ${day.sessions.map((session) => `${session.checkIn}${session.checkOut ? `–${session.checkOut}` : ""}`).join(" · ")}`}
              </span>
            </span>
            {day.sessions.length > 0 && (
              <span className="shrink-0 text-caption">
                {day.sessions.length} sesi
              </span>
            )}
            <Icon icon={ArrowDown01Icon} />
          </button>
        </li>
      ))}
    </ol>
  )
}

function SessionSummary({
  session,
  workDate,
  sessionNumber,
}: {
  session: Session
  workDate: string
  sessionNumber: number
}) {
  return (
    <section
      className="flex flex-col gap-3 py-4"
      aria-label={`Sesi ${sessionNumber} · ${session.status}`}
    >
      <div className="flex min-w-0 flex-col gap-1">
        <p className="text-label">Sesi {sessionNumber}</p>
        <p className="text-body font-medium">{session.status}</p>
        <p className="text-caption text-muted-foreground">{session.outlet}</p>
      </div>
      <dl className="grid grid-cols-2 gap-3">
        <div>
          <dt className="text-caption">Masuk</dt>
          <dd className="mt-1 text-title font-semibold tabular-nums">
            {session.checkIn}
          </dd>
        </div>
        <div>
          <dt className="text-caption">Keluar</dt>
          <dd
            className={`mt-1 ${session.checkOut ? "text-title font-semibold" : "text-body font-medium"} tabular-nums`}
          >
            {session.checkOut ?? "Belum tercatat"}
          </dd>
        </div>
      </dl>
      {session.note && (
        <p className="text-body text-warning-strong">{session.note}</p>
      )}
      <details className="group">
        <summary className="flex min-h-11 w-full cursor-pointer list-none items-center justify-between gap-3 rounded-md px-2 text-label outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
          <span className="group-open:hidden">Lihat detail</span>
          <span className="hidden group-open:inline">Sembunyikan detail</span>
          <span
            aria-hidden="true"
            className="text-muted-foreground transition-transform group-open:rotate-180"
          >
            <Icon icon={ArrowDown01Icon} />
          </span>
        </summary>
        <dl className="mt-2 grid gap-3 text-body sm:grid-cols-2">
          <div>
            <dt className="text-caption">Work Date asal</dt>
            <dd>{workDate.slice(8)} November 2026 · data contoh</dd>
          </div>
          <div>
            <dt className="text-caption">Outlet asal</dt>
            <dd>{session.outlet}</dd>
          </div>
          <div>
            <dt className="text-caption">Work Date efektif</dt>
            <dd>{workDate.slice(8)} November 2026</dd>
          </div>
          {session.checkoutOutlet &&
            session.checkoutOutlet !== session.outlet && (
              <div>
                <dt className="text-caption">Tujuan checkout</dt>
                <dd>{session.checkoutOutlet}</dd>
              </div>
            )}
          {session.photoEvidence && (
            <div>
              <dt className="text-caption">Bukti foto</dt>
              <dd>{session.photoEvidence}</dd>
            </div>
          )}
        </dl>
        {session.correctionAvailable && (
          <div className="mt-3">
            <Button
              className="min-h-11 w-full sm:w-auto"
              disabled
              variant="outline"
            >
              Ajukan koreksi
            </Button>
            <p className="mt-1 text-caption">
              Akses koreksi tidak diperiksa pada prototype visual.
            </p>
          </div>
        )}
      </details>
    </section>
  )
}

function DetailContent({ day }: { day: WorkDay }) {
  return (
    <div className="flex min-h-0 flex-col gap-4 overflow-y-auto overscroll-contain px-4 pb-[calc(1.25rem+env(safe-area-inset-bottom))]">
      {day.sessions.length === 0 ? (
        <p className="rounded-lg bg-muted/50 p-4 text-body">
          Tidak ada sesi pada tanggal kerja ini.
        </p>
      ) : (
        <ol
          aria-label="Sesi berurutan berdasarkan waktu masuk"
          className="flex flex-col divide-y divide-border"
        >
          {day.sessions.map((session, index) => (
            <li key={session.id}>
              <SessionSummary
                session={session}
                sessionNumber={index + 1}
                workDate={day.date}
              />
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}

function SessionDetails({
  day,
  wide,
  onClose,
}: {
  day: WorkDay
  wide: boolean
  onClose: () => void
}) {
  const description = `${day.sessions.length} sesi · data sintetis`
  if (wide) {
    return (
      <Sheet open onOpenChange={(open) => !open && onClose()}>
        <SheetContent
          aria-describedby="prototype-session-description"
          className="w-full overflow-y-auto pb-[env(safe-area-inset-bottom)] sm:max-w-md"
          side="right"
        >
          <SheetHeader className="gap-1 px-5 pb-3 pt-5 pr-14">
            <SheetTitle>
              Presensi · {day.weekday}, {day.date.slice(8)} November
            </SheetTitle>
            <SheetDescription id="prototype-session-description">
              {description}
            </SheetDescription>
          </SheetHeader>
          <DetailContent day={day} />
        </SheetContent>
      </Sheet>
    )
  }

  return (
    <Drawer open onOpenChange={(open) => !open && onClose()}>
      <DrawerContent
        aria-describedby="prototype-session-description"
        className="max-h-[85dvh] overflow-hidden pb-0"
      >
        <DrawerHeader className="px-5 pb-2 pt-1 text-left">
          <DrawerTitle>
            Presensi · {day.weekday}, {day.date.slice(8)} November
          </DrawerTitle>
          <DrawerDescription id="prototype-session-description">
            {description}
          </DrawerDescription>
        </DrawerHeader>
        <DetailContent day={day} />
      </DrawerContent>
    </Drawer>
  )
}

function BottomNavigation() {
  return (
    <nav
      aria-label="Navigasi karyawan"
      className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface pb-[env(safe-area-inset-bottom)]"
    >
      <div className="mx-auto grid h-[72px] max-w-5xl grid-cols-4 items-center px-1">
        {navigation.map((item) => (
          <a
            aria-current={item.active ? "page" : undefined}
            className={`flex min-h-14 min-w-0 flex-col items-center justify-center gap-1 rounded-lg px-1 text-caption outline-none focus-visible:ring-2 focus-visible:ring-ring ${item.active ? "font-medium text-primary" : "hover:bg-muted/40"}`}
            href={item.href}
            key={item.label}
          >
            <Icon icon={item.icon} />
            <span className="truncate">{item.label}</span>
          </a>
        ))}
        <AccountMenu
          trigger={
            <Button
              aria-label="Profil dan menu akun"
              className="flex h-14 min-w-0 flex-col gap-1 rounded-lg px-1 text-caption text-muted-foreground hover:bg-muted/40"
              variant="ghost"
            >
              <Icon icon={UserGroupIcon} />
              <span className="truncate">Profil</span>
            </Button>
          }
        />
      </div>
    </nav>
  )
}

function VerificationView({
  action,
  scenario,
  onBack,
}: {
  action: VerificationAction
  scenario: VerificationScenario
  onBack: () => void
}) {
  const config = getVerificationConfig(scenario, action)
  const headingRef = useRef<HTMLHeadingElement | null>(null)
  const submissionTimer = useRef<number | null>(null)
  const [selectedOutlet, setSelectedOutlet] = useState(config.initialOutlet)
  const [gpsDenied, setGpsDenied] = useState(Boolean(config.gpsDenied))
  const [gpsReadyFeedback, setGpsReadyFeedback] = useState(false)
  const [cameraDenied, setCameraDenied] = useState(Boolean(config.cameraDenied))
  const [photoState, setPhotoState] = useState<PhotoState>("empty")
  const [submission, setSubmission] = useState<SubmissionState>(
    config.startsSubmitting ? "submitting" : "idle"
  )

  useEffect(() => {
    headingRef.current?.focus()
  }, [])
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault()
        onBack()
      }
    }
    document.addEventListener("keydown", handleKeyDown)
    return () => document.removeEventListener("keydown", handleKeyDown)
  }, [onBack])
  useEffect(() => {
    if (!config.startsSubmitting) return
    const timer = window.setTimeout(() => setSubmission("success"), 1200)
    return () => window.clearTimeout(timer)
  }, [config.startsSubmitting])
  useEffect(
    () => () => {
      if (submissionTimer.current !== null) {
        window.clearTimeout(submissionTimer.current)
      }
    },
    []
  )

  const eligibleOutletCount = config.eligibleOutlets.length
  const outletSelected = config.eligibleOutlets.includes(selectedOutlet)
  const photoAccepted =
    photoState === "accepted" ||
    photoState === "skipped" ||
    (!config.requiredPhoto && photoState === "empty" && !cameraDenied)
  const canSubmit =
    !gpsDenied && outletSelected && photoAccepted && submission === "idle"
  const actionTitle = action === "checkIn" ? "Absen Masuk" : "Absen Keluar"
  const submitLabel =
    action === "checkIn"
      ? "Simulasikan Absen Masuk"
      : "Simulasikan Absen Keluar"
  const submitPendingLabel =
    action === "checkIn" ? "Memproses Absen Masuk…" : "Memproses Absen Keluar…"
  const submit = () => {
    if (!canSubmit) return
    setSubmission("submitting")
    submissionTimer.current = window.setTimeout(
      () => setSubmission(config.uncertainResponse ? "uncertain" : "success"),
      700
    )
  }

  return (
    <div
      className="fixed inset-0 z-50 flex min-h-svh flex-col overflow-hidden bg-canvas text-foreground"
      data-verification-mode="focus"
    >
      <header className="shrink-0 border-b border-border bg-surface pt-[env(safe-area-inset-top)]">
        <div className="relative mx-auto flex min-h-14 w-full max-w-2xl items-center justify-center px-3 sm:px-5">
          <Button
            aria-label="Kembali ke Beranda prototype"
            className="absolute left-3 top-1/2 -translate-y-1/2"
            onClick={onBack}
            variant="ghost"
          >
            <Icon icon={ArrowLeft01Icon} />
          </Button>
          <h1
            className="text-subtitle text-center outline-none focus-visible:ring-2 focus-visible:ring-ring"
            id="verification-title"
            ref={headingRef}
            tabIndex={-1}
          >
            {actionTitle}
          </h1>
        </div>
        <p className="pb-2 text-center text-caption text-muted-foreground">
          Simulasi · tanpa kamera/GPS/server
        </p>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div className="mx-auto flex w-full max-w-2xl flex-col px-4 pb-6 sm:px-5">
          {action === "checkOut" && config.originalOutlet && (
            <section
              aria-label="Sesi asal checkout"
              className="border-y border-border py-3"
            >
              <h2 className="text-label">Sesi asal</h2>
              <dl className="mt-2 grid grid-cols-2 gap-3 text-body">
                <div>
                  <dt className="text-caption text-muted-foreground">
                    Work Date asal
                  </dt>
                  <dd>{config.originalWorkDate}</dd>
                </div>
                <div className="min-w-0">
                  <dt className="text-caption text-muted-foreground">
                    Outlet asal
                  </dt>
                  <dd className="truncate" title={config.originalOutlet}>
                    {config.originalOutlet}
                  </dd>
                </div>
              </dl>
            </section>
          )}

          <section aria-labelledby="verification-outlet-title" className="py-4">
            <h2 className="text-subtitle" id="verification-outlet-title">
              {action === "checkOut"
                ? "Outlet tujuan checkout"
                : "Outlet presensi"}
            </h2>
            {eligibleOutletCount === 0 ? (
              <Alert
                className="mt-3 rounded-none border-0 border-l-2 bg-transparent p-0 pl-3 shadow-none"
                variant="warning"
              >
                <AlertTitle>Tidak ada Outlet yang memenuhi skenario</AlertTitle>
                <AlertDescription>
                  Tindakan simulasi dinonaktifkan sampai Outlet tersedia.
                </AlertDescription>
              </Alert>
            ) : eligibleOutletCount === 1 ? (
              <p className="mt-2 flex min-h-11 items-center gap-2 text-body font-medium">
                <Icon icon={Building01Icon} />
                {config.eligibleOutlets[0]}
                <span className="text-caption font-normal text-muted-foreground">
                  · dipilih otomatis
                </span>
              </p>
            ) : (
              <RadioGroup
                aria-label={
                  action === "checkOut"
                    ? "Pilih Outlet tujuan checkout"
                    : "Pilih Outlet presensi"
                }
                className="mt-2 gap-1"
                onValueChange={(value) => setSelectedOutlet(String(value))}
                value={selectedOutlet}
              >
                {config.eligibleOutlets.map((name, index) => {
                  const id = [
                    "verification-outlet-",
                    action,
                    "-",
                    String(index),
                  ].join("")
                  return (
                    <label
                      className="flex min-h-12 cursor-pointer items-center gap-3 border-b border-border/60 py-2 text-body outline-none last:border-0 focus-within:ring-2 focus-within:ring-ring"
                      htmlFor={id}
                      key={name}
                    >
                      <RadioGroupItem id={id} value={name} />
                      <span className="min-w-0 flex-1">{name}</span>
                    </label>
                  )
                })}
              </RadioGroup>
            )}
          </section>

          <Separator className="bg-border/70" />

          <section aria-labelledby="verification-photo-title" className="py-4">
            <div className="flex min-h-8 items-center gap-2">
              <h2
                className="flex items-center gap-2 text-subtitle"
                id="verification-photo-title"
              >
                <Icon icon={Camera01Icon} />
                Foto personal
              </h2>
            </div>
            {cameraDenied && (
              <Alert
                className="mt-3 rounded-none border-0 border-l-2 bg-transparent p-0 pl-3 shadow-none"
                variant="destructive"
              >
                <Icon icon={AlertCircleIcon} />
                <AlertTitle>Izin kamera tidak tersedia</AlertTitle>
                <AlertDescription>
                  {config.requiredPhoto
                    ? "Foto wajib belum dapat diambil. Coba lagi untuk melanjutkan."
                    : "Foto opsional tidak tersedia. Coba lagi atau lewati foto."}
                </AlertDescription>
              </Alert>
            )}
            <div className="mt-3 flex min-h-9 flex-col items-center gap-3 text-center">
              {photoState === "preview" ? (
                <div
                  aria-label="Pratinjau foto simulasi"
                  className="flex min-h-28 w-full flex-col items-center justify-center gap-2 border-y border-dashed border-border bg-muted/20 p-4 text-center"
                  role="img"
                >
                  <Icon icon={Camera01Icon} />
                  <span className="text-body">Pratinjau foto simulasi</span>
                </div>
              ) : photoState === "accepted" ? (
                <p className="text-body text-success-strong" role="status">
                  Foto diterima untuk simulasi.
                </p>
              ) : photoState === "skipped" ? (
                <p className="text-body text-muted-foreground" role="status">
                  Foto dilewati · kebijakan opsional pada simulasi.
                </p>
              ) : null}
              {cameraDenied ? (
                <div className="flex w-full flex-wrap items-center justify-center gap-2">
                  <Button
                    onClick={() => setCameraDenied(false)}
                    variant="outline"
                  >
                    Coba lagi
                  </Button>
                  {!config.requiredPhoto && (
                    <Button
                      onClick={() => setPhotoState("skipped")}
                      variant="ghost"
                    >
                      Lewati foto
                    </Button>
                  )}
                </div>
              ) : photoState === "preview" ? (
                <div className="flex w-full flex-wrap items-center justify-center gap-2">
                  <Button onClick={() => setPhotoState("accepted")}>
                    Gunakan Foto
                  </Button>
                  <Button
                    onClick={() => setPhotoState("empty")}
                    variant="outline"
                  >
                    Ambil ulang
                  </Button>
                </div>
              ) : photoState === "empty" ? (
                <div className="flex w-full flex-wrap items-center justify-center gap-2">
                  <Button onClick={() => setPhotoState("preview")}>
                    Ambil foto
                  </Button>
                  {!config.requiredPhoto && (
                    <Button
                      onClick={() => setPhotoState("skipped")}
                      variant="outline"
                    >
                      Lewati foto
                    </Button>
                  )}
                </div>
              ) : photoState === "accepted" ? (
                <Button
                  onClick={() => setPhotoState("empty")}
                  variant="outline"
                >
                  Ambil ulang
                </Button>
              ) : photoState === "skipped" ? (
                <Button
                  onClick={() => setPhotoState("empty")}
                  variant="outline"
                >
                  Pilih foto
                </Button>
              ) : null}
            </div>
          </section>

          <Separator className="bg-border/70" />

          <section
            aria-labelledby="verification-location-title"
            className="flex flex-col py-4"
          >
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-subtitle" id="verification-location-title">
                Lokasi
              </h2>
              {!gpsDenied && gpsReadyFeedback && (
                <p
                  className="flex min-h-11 items-center gap-2 text-caption text-success-strong"
                  role="status"
                >
                  Lokasi siap.
                </p>
              )}
            </div>
            {gpsDenied && (
              <Alert
                className="mt-2 rounded-none border-0 border-l-2 bg-transparent p-0 pl-3 shadow-none"
                variant="destructive"
              >
                <Icon icon={AlertCircleIcon} />
                <AlertTitle>Izin lokasi ditolak</AlertTitle>
                <AlertDescription>
                  Validasi lokasi belum selesai. Coba lagi untuk memperbarui
                  status simulasi.
                </AlertDescription>
                <Button
                  className="mt-2 w-fit"
                  onClick={() => {
                    setGpsDenied(false)
                    setGpsReadyFeedback(true)
                  }}
                  variant="outline"
                >
                  Coba lagi
                </Button>
              </Alert>
            )}
            <div
              aria-label="Peta lokasi simulasi"
              className="mt-3 flex min-h-28 items-center justify-center border-y border-border bg-muted/20 px-4 text-center text-body text-muted-foreground"
              role="img"
            >
              Peta tidak tersedia pada pratinjau.
            </div>
            <dl className="mt-2 grid grid-cols-2 gap-3 text-body">
              <div>
                <dt className="text-caption text-muted-foreground">Jarak</dt>
                <dd>{gpsDenied ? "Belum tersedia" : "48 m · contoh"}</dd>
              </div>
              <div>
                <dt className="text-caption text-muted-foreground">Akurasi</dt>
                <dd>{gpsDenied ? "Belum tersedia" : "±12 m · contoh"}</dd>
              </div>
            </dl>
          </section>

          {submission === "submitting" && (
            <p className="py-2 text-body text-muted-foreground" role="status">
              {submitPendingLabel}
            </p>
          )}
          {submission === "uncertain" && (
            <Alert
              aria-live="polite"
              className="rounded-none border-0 border-l-2 bg-transparent p-0 pl-3 shadow-none"
              variant="warning"
            >
              <Icon icon={AlertCircleIcon} />
              <AlertTitle>Hasil simulasi belum pasti</AlertTitle>
              <AlertDescription>
                Jangan kirim ulang. Periksa status simulasi untuk melihat hasil
                rekonsiliasi.
              </AlertDescription>
              <Button
                className="mt-2 w-fit"
                onClick={() => setSubmission("success")}
                variant="outline"
              >
                Periksa status simulasi
              </Button>
            </Alert>
          )}
          {submission === "success" && (
            <Alert
              className="rounded-none border-0 border-l-2 bg-transparent p-0 pl-3 shadow-none"
              variant="success"
            >
              <AlertTitle>Simulasi berhasil</AlertTitle>
              <AlertDescription>
                Tidak ada presensi yang dikirim atau disimpan.
              </AlertDescription>
            </Alert>
          )}
        </div>
      </main>

      <footer className="shrink-0 border-t border-border bg-surface px-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-3 sm:px-5">
        <div className="mx-auto w-full max-w-2xl">
          <Button
            className="min-h-12 w-full"
            disabled={!canSubmit}
            onClick={submit}
          >
            {submission === "submitting" ? submitPendingLabel : submitLabel}
          </Button>
        </div>
      </footer>
    </div>
  )
}

export function EmployeeMobilePrototype() {
  const [scenario, setScenario] = useState<Scenario>("multiple_sessions")
  const [verificationScenario, setVerificationScenario] =
    useState<VerificationScenario>("ready")
  const [verificationAction, setVerificationAction] =
    useState<VerificationAction | null>(null)
  const [outlet, setOutlet] = useState<string>(sampleOutlets[0].name)
  const [selectedDay, setSelectedDay] = useState<WorkDay | null>(null)
  const [wide, setWide] = useState(false)
  const [devPanelOpen, setDevPanelOpen] = useState(false)
  const opener = useRef<HTMLButtonElement | null>(null)
  const verificationOpener = useRef<VerificationAction | null>(null)
  const data = sampleData[scenario]
  const selectedOutlet = sampleOutlets.find(({ name }) => name === outlet)

  useEffect(() => {
    const media = window.matchMedia("(min-width: 768px)")
    const update = () => setWide(media.matches)
    update()
    media.addEventListener("change", update)
    return () => media.removeEventListener("change", update)
  }, [])

  useEffect(() => {
    if (verificationAction !== null) return
    const action = verificationOpener.current
    if (!action) return
    const selector =
      action === "checkIn"
        ? '[data-prototype-verification-launcher="checkIn"]'
        : '[data-prototype-verification-launcher="checkOut"]'
    window.requestAnimationFrame(() => {
      document.querySelector<HTMLButtonElement>(selector)?.focus()
    })
    verificationOpener.current = null
  }, [verificationAction])

  const openDay = (day: WorkDay, trigger: HTMLButtonElement) => {
    opener.current = trigger
    setSelectedDay(day)
  }
  const closeDay = () => {
    setSelectedDay(null)
    window.requestAnimationFrame(() => opener.current?.focus())
  }
  const openVerification = (action: VerificationAction) => {
    verificationOpener.current = action
    setVerificationAction(action)
  }
  const closeVerification = () => {
    setVerificationAction(null)
  }

  if (verificationAction) {
    return (
      <VerificationView
        action={verificationAction}
        onBack={closeVerification}
        scenario={verificationScenario}
      />
    )
  }

  return (
    <div className="min-h-svh bg-canvas text-foreground">
      <TopBar outlet={outlet} onOutletChange={setOutlet} />
      <main className="mx-auto flex min-h-[calc(100svh-64px)] w-full max-w-5xl flex-col items-center gap-8 px-3 pb-[calc(6rem+env(safe-area-inset-bottom))] pt-6 sm:px-5 sm:pt-8">
        <section
          aria-labelledby="prototype-title"
          className="flex w-full flex-col items-center gap-7 text-center"
        >
          <div>
            <h1 className="text-title" id="prototype-title">
              Presensi
            </h1>
            <p className="mt-1 text-body text-muted-foreground">
              Sabtu, 7 November 2026
            </p>
          </div>
          <AttendanceStatus
            data={data}
            outletTimeZone={selectedOutlet?.timeZone}
          />
          {data.guidance && (
            <aside
              aria-label="Panduan sesi belum selesai"
              className="w-full max-w-xl rounded-lg border border-warning/40 bg-warning-soft px-4 py-3 text-left"
            >
              <p className="text-label">Perlu ditindaklanjuti</p>
              <p className="mt-1 text-body">{data.guidance}</p>
            </aside>
          )}
        </section>
        <section
          aria-labelledby="week-history-title"
          className="w-full max-w-2xl border-t border-border pt-4"
        >
          <h2 className="text-subtitle" id="week-history-title">
            Riwayat minggu ini
          </h2>
          <p className="mt-1 text-caption">2–7 November</p>
          <WeekHistory days={data.days} onOpenDay={openDay} />
        </section>
        <section className="w-full max-w-2xl border-t border-border pt-3">
          <button
            aria-controls="prototype-dev-panel"
            aria-expanded={devPanelOpen}
            className="flex min-h-11 w-full cursor-pointer items-center justify-between gap-3 rounded-md text-left text-label outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={() => setDevPanelOpen((open) => !open)}
            type="button"
          >
            <span>Panel pengembangan · data contoh</span>
            <Icon icon={ArrowDown01Icon} />
          </button>
          <div
            className="flex flex-col gap-3 py-3"
            hidden={!devPanelOpen}
            id="prototype-dev-panel"
          >
            <SampleNotice />
            <label className="flex max-w-sm flex-col gap-1 text-caption">
              Skenario contoh
              <select
                className="min-h-11 max-w-full rounded-md border border-input bg-card px-3 text-body text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onChange={(event) =>
                  setScenario(event.target.value as Scenario)
                }
                value={scenario}
              >
                {Object.entries(scenarioLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex max-w-sm flex-col gap-1 text-caption">
              Skenario verifikasi sintetis
              <select
                className="min-h-11 max-w-full rounded-md border border-input bg-card px-3 text-body text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onChange={(event) =>
                  setVerificationScenario(
                    event.target.value as VerificationScenario
                  )
                }
                value={verificationScenario}
              >
                {Object.entries(verificationScenarioLabels).map(
                  ([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  )
                )}
              </select>
            </label>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <Button
                className="min-h-11"
                data-prototype-verification-launcher="checkIn"
                onClick={() => openVerification("checkIn")}
                variant="outline"
              >
                Buka simulasi Absen Masuk
              </Button>
              <Button
                className="min-h-11"
                data-prototype-verification-launcher="checkOut"
                onClick={() => openVerification("checkOut")}
                variant="outline"
              >
                Buka simulasi Absen Keluar
              </Button>
            </div>
          </div>
        </section>
      </main>
      <BottomNavigation />
      {selectedDay && (
        <SessionDetails day={selectedDay} wide={wide} onClose={closeDay} />
      )}
    </div>
  )
}
