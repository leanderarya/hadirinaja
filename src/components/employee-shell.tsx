import {
  ArrowDown01Icon,
  Building01Icon,
  Calendar03Icon,
  ClipboardListIcon,
  Home01Icon,
  Notification03Icon,
  UserCircleIcon,
  UserGroupIcon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { Calendar, ClipboardList, House, UserRound } from "lucide-react"
import { type ReactNode, useEffect, useState } from "react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button, buttonVariants } from "@/components/ui/button"
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover"
import { apiRequest } from "@/lib/api"
import { getAuthRecoveryPath } from "@/lib/auth-navigation"
import { cn } from "@/lib/utils"

const destinations = [
  { id: "today", label: "Beranda", href: "/attendance", icon: Home01Icon },
  {
    id: "schedule",
    label: "Jadwal",
    href: "/scheduling",
    icon: Calendar03Icon,
  },
  {
    id: "requests",
    label: "Permintaan",
    href: "/requests",
    icon: ClipboardListIcon,
  },
  { id: "profile", label: "Profil", href: "/profile", icon: UserGroupIcon },
] as const

type Destination = (typeof destinations)[number]["id"]

export function EmployeeNavigation({
  active,
  appearance = "default",
}: {
  active: Destination
  appearance?: "default" | "r2c"
}) {
  const renderDestination = (item: (typeof destinations)[number]) => {
    const selected = active === item.id

    const r2cLabels = {
      today: "Presensi",
      schedule: "Jadwal",
      requests: "Permintaan",
      profile: "Profil",
    }
    const r2cIcons = {
      today: House,
      schedule: Calendar,
      requests: ClipboardList,
      profile: UserRound,
    }
    const Icon = r2cIcons[item.id]
    const label = appearance === "r2c" ? r2cLabels[item.id] : item.label
    const content =
      appearance === "r2c" ? (
        <>
          <span
            className={cn(
              "flex size-[30px] items-center justify-center rounded-[11px]",
              selected ? "bg-brand-50 text-primary" : "text-muted-foreground"
            )}
          >
            <Icon aria-hidden="true" size={17} />
          </span>
          <span
            className={cn(
              "text-caption text-[11px] font-normal text-muted-foreground",
              selected && "font-semibold text-brand-700"
            )}
          >
            {label}
          </span>
        </>
      ) : (
        <>
          <HugeiconsIcon
            aria-hidden="true"
            className="employee-nav-icon"
            icon={item.icon}
          />
          <span className="employee-nav-label">{item.label}</span>
        </>
      )

    const className = cn(
      buttonVariants({ variant: "ghost" }),
      appearance === "r2c"
        ? "flex h-[60px] min-w-0 flex-1 flex-col items-center justify-start gap-[3px] rounded-xl p-0"
        : "employee-nav-link",
      appearance === "default" && selected && "is-active"
    )

    return (
      <a
        aria-current={selected ? "page" : undefined}
        className={className}
        href={item.href}
        key={item.id}
      >
        {content}
      </a>
    )
  }

  return (
    <nav
      aria-label="Navigasi karyawan"
      data-pen-origin={appearance === "r2c" ? "Hy9HX" : undefined}
      className={
        appearance === "r2c"
          ? "flex h-20 w-full items-center justify-between gap-2 rounded-[20px] border border-border bg-surface px-3 py-2"
          : "employee-navigation-dock"
      }
    >
      {destinations.map(renderDestination)}
    </nav>
  )
}

export type EmployeeOutletOption = { id: number; name: string }

export type EmployeeOutletContext = {
  outlets: EmployeeOutletOption[]
  selectedOutletId: number | null
  selectedOutletName?: string | null
  onChange?: (outletId: number | null) => void
}

export function EmployeeTopbar({
  accountName,
  outletContext,
  onLogout,
  logoutBusy = false,
}: {
  accountName: string
  outletContext?: EmployeeOutletContext
  onLogout?: () => void
  logoutBusy?: boolean
}) {
  const [outletOpen, setOutletOpen] = useState(false)
  const [accountOpen, setAccountOpen] = useState(false)
  const [query, setQuery] = useState("")
  const outlets = outletContext?.outlets ?? []
  const selectedOutlet = outlets.find(
    (outlet) => outlet.id === outletContext?.selectedOutletId
  )
  const outletName =
    outletContext?.selectedOutletName?.trim() ||
    selectedOutlet?.name ||
    (outletContext ? "Semua Outlet" : "Outlet belum tersedia")
  const filteredOutlets = outlets.filter((outlet) =>
    outlet.name
      .toLocaleLowerCase("id")
      .includes(query.trim().toLocaleLowerCase("id"))
  )
  const canChangeContext = Boolean(outletContext?.onChange)

  function selectOutlet(outletId: number | null) {
    outletContext?.onChange?.(outletId)
    setQuery("")
    setOutletOpen(false)
  }

  return (
    <header className="employee-topbar">
      <div className="employee-topbar-inner">
        <div className="employee-outlet-context">
          {outlets.length <= 1 ? (
            <div className="flex min-h-14 w-full min-w-0 items-center gap-2 px-2">
              <span className="shrink-0 text-muted-foreground">
                <HugeiconsIcon aria-hidden="true" icon={Building01Icon} />
              </span>
              <span className="flex min-w-0 flex-1 flex-col gap-0 leading-tight">
                <span className="text-body text-muted-foreground">Outlet</span>
                <span className="break-words text-label">{outletName}</span>
              </span>
            </div>
          ) : (
            <Popover
              open={outletOpen}
              onOpenChange={(open) => {
                setOutletOpen(open)
                if (!open) setQuery("")
              }}
            >
              <PopoverTrigger
                render={
                  <Button
                    aria-label={`Outlet aktif: ${outletName}. Pilih konteks Outlet`}
                    className="employee-outlet-trigger h-auto min-h-14 w-full min-w-0 justify-start gap-2 px-2 py-2 text-left active:bg-accent aria-expanded:bg-accent"
                    title={outletName}
                    variant="ghost"
                  />
                }
              >
                <span className="shrink-0 text-muted-foreground">
                  <HugeiconsIcon aria-hidden="true" icon={Building01Icon} />
                </span>
                <span className="flex min-w-0 flex-1 flex-col gap-0 leading-tight">
                  <span className="text-body text-muted-foreground">
                    Outlet
                  </span>
                  <span className="break-words text-label">{outletName}</span>
                </span>
                <HugeiconsIcon aria-hidden="true" icon={ArrowDown01Icon} />
              </PopoverTrigger>
              <PopoverContent
                align="start"
                className="max-h-[min(70svh,32rem)] w-[min(20rem,calc(100vw-1.5rem))] gap-3 overflow-y-auto p-3"
              >
                <PopoverHeader>
                  <PopoverTitle>Pilih Outlet</PopoverTitle>
                  <PopoverDescription>
                    {canChangeContext
                      ? "Pilih Outlet untuk tampilan halaman ini. Pilihan ini tidak mengubah tujuan Absen Keluar."
                      : "Konteks Outlet bersama belum didukung pada halaman ini. Daftar ini hanya menunjukkan Outlet yang diizinkan."}
                  </PopoverDescription>
                </PopoverHeader>
                {outlets.length > 4 && (
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
                )}
                {outletContext ? (
                  <div
                    aria-label="Daftar Outlet yang diizinkan"
                    className="flex max-h-72 flex-col gap-1 overflow-y-auto"
                    role="group"
                  >
                    {canChangeContext && (
                      <Button
                        aria-pressed={outletContext.selectedOutletId === null}
                        className="min-h-11 w-full justify-between px-3 text-left"
                        onClick={() => selectOutlet(null)}
                        variant={
                          outletContext.selectedOutletId === null
                            ? "secondary"
                            : "ghost"
                        }
                      >
                        Semua Outlet
                        {outletContext.selectedOutletId === null && (
                          <span>Dipilih</span>
                        )}
                      </Button>
                    )}
                    {filteredOutlets.map((outlet) => {
                      const selected =
                        outlet.id === outletContext.selectedOutletId
                      return (
                        <Button
                          aria-pressed={selected}
                          className="min-h-11 w-full justify-between px-3 text-left"
                          disabled={!canChangeContext}
                          key={outlet.id}
                          onClick={() => selectOutlet(outlet.id)}
                          title={outlet.name}
                          variant={selected ? "secondary" : "ghost"}
                        >
                          <span className="truncate">{outlet.name}</span>
                          {selected && (
                            <span className="shrink-0">Dipilih</span>
                          )}
                        </Button>
                      )
                    })}
                    {!filteredOutlets.length && (
                      <p className="px-3 py-2 text-caption text-muted-foreground">
                        {outlets.length
                          ? "Outlet tidak ditemukan."
                          : "Belum ada Outlet yang tersedia untuk konteks halaman ini."}
                      </p>
                    )}
                  </div>
                ) : (
                  <p className="text-caption text-muted-foreground">
                    Daftar Outlet belum tersedia pada halaman ini.
                  </p>
                )}
              </PopoverContent>
            </Popover>
          )}
        </div>
        <div className="employee-topbar-utilities">
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
              <HugeiconsIcon aria-hidden="true" icon={Notification03Icon} />
            </PopoverTrigger>
            <PopoverContent align="end" className="w-64 gap-2">
              <PopoverTitle>Notifikasi</PopoverTitle>
              <PopoverDescription>
                Notifikasi belum tersedia.
              </PopoverDescription>
            </PopoverContent>
          </Popover>
          <Popover open={accountOpen} onOpenChange={setAccountOpen}>
            <PopoverTrigger
              render={
                <Button
                  aria-label={`Menu akun ${accountName}`}
                  className="size-11 shrink-0"
                  size="icon"
                  variant="ghost"
                />
              }
            >
              <HugeiconsIcon aria-hidden="true" icon={UserCircleIcon} />
            </PopoverTrigger>
            <PopoverContent
              align="end"
              className="w-[min(20rem,calc(100vw-1.5rem))] gap-3"
            >
              <PopoverHeader>
                <PopoverTitle>Profil karyawan</PopoverTitle>
                <PopoverDescription>{accountName}</PopoverDescription>
              </PopoverHeader>
              <Button
                className="w-full justify-start"
                nativeButton={false}
                render={<a href="/profile" />}
                variant="ghost"
              >
                Buka profil
              </Button>
              <Button
                className="w-full justify-start"
                disabled={logoutBusy || !onLogout}
                onClick={() => onLogout?.()}
                variant="ghost"
              >
                {logoutBusy ? "Keluar dari akun…" : "Keluar dari akun"}
              </Button>
            </PopoverContent>
          </Popover>
        </div>
      </div>
    </header>
  )
}

export function useEmployeeLogout() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")

  async function logout() {
    setBusy(true)
    setError("")
    try {
      await apiRequest("/auth/logout", { method: "POST" })
      window.location.assign("/login")
    } catch (caught) {
      const recovery = getAuthRecoveryPath(caught)
      if (recovery) window.location.assign(recovery)
      else
        setError(
          "Belum berhasil keluar dari akun. Periksa koneksi, lalu coba lagi."
        )
    } finally {
      setBusy(false)
    }
  }

  return { busy, error, logout }
}

export function EmployeeShell({
  active,
  children,
  accountName = "Karyawan",
  outletContext,
}: {
  active: Destination
  children: ReactNode
  accountName?: string
  outletContext?: EmployeeOutletContext
}) {
  const [keyboardOpen, setKeyboardOpen] = useState(false)
  const { busy, error, logout } = useEmployeeLogout()

  useEffect(() => {
    const viewport = window.visualViewport
    const updateKeyboard = () =>
      setKeyboardOpen(
        Boolean(viewport && window.innerHeight - viewport.height > 150)
      )
    viewport?.addEventListener("resize", updateKeyboard)
    return () => {
      viewport?.removeEventListener("resize", updateKeyboard)
    }
  }, [])

  return (
    <div className="employee-shell min-h-svh bg-background">
      <a
        href="#employee-content"
        className="sr-only focus:not-sr-only focus:block focus:p-4"
      >
        Lewati navigasi
      </a>
      <EmployeeTopbar
        accountName={accountName}
        onLogout={() => void logout()}
        outletContext={outletContext}
        logoutBusy={busy}
      />
      <div
        className={cn(
          "employee-navigation",
          keyboardOpen && "employee-navigation-keyboard"
        )}
      >
        <EmployeeNavigation active={active} />
      </div>
      <main id="employee-content" tabIndex={-1} className="employee-content">
        {error && (
          <Alert variant="destructive">
            <AlertTitle>Belum berhasil keluar dari akun</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        {children}
      </main>
    </div>
  )
}
