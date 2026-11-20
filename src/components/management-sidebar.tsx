import { Link } from "@tanstack/react-router"
import { Dialog } from "@base-ui/react/dialog"
import {
  ArrowLeft,
  CalendarCheck,
  ChevronDown,
  ChevronRight,
  LogOut,
  Menu,
  Repeat2,
  UserRound,
  X,
} from "lucide-react"
import { useEffect, useState } from "react"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button, buttonVariants } from "@/components/ui/button"
import { useSidebar } from "@/components/ui/sidebar"
import { apiRequest } from "@/lib/api"
import { getAuthRecoveryPath } from "@/lib/auth-navigation"
import {
  getActiveManagementDestination,
  getManagementNavigation,
  type ManagementNavigationContext,
  type ManagementNavigationItem,
  type ManagementPage,
} from "@/lib/management-navigation"
import { cn } from "@/lib/utils"

export type OwnerMobilePage = "overview" | "team" | "schedule" | "requests"
const navLink =
  "flex min-h-11 w-full min-w-0 items-center gap-3 rounded-[11px] px-3 text-body text-muted-foreground hover:bg-brand-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary [&_svg]:size-[18px] [&_svg]:shrink-0"

function useLogout() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  async function logout() {
    if (busy) return
    setBusy(true)
    setError("")
    try {
      await apiRequest("/auth/logout", { method: "POST" })
      window.location.assign("/login")
    } catch (caught) {
      const recovery = getAuthRecoveryPath(caught)
      if (recovery) window.location.assign(recovery)
      else setError("Belum berhasil keluar dari akun. Periksa koneksi, lalu coba lagi.")
    } finally {
      setBusy(false)
    }
  }
  return { busy, error, logout }
}

function roleLabel(roles: readonly string[]) {
  const labels: Record<string, string> = {
    owner: "Owner",
    supervisor: "Supervisor",
    employee: "Karyawan",
  }
  return roles.map((role) => labels[role] ?? role).join(" · ")
}

function NavigationBrand() {
  return (
    <div className="flex items-center gap-2.5">
      <span className="flex size-[34px] shrink-0 items-center justify-center rounded-[11px] bg-primary text-primary-foreground">
        <CalendarCheck aria-hidden="true" size={18} />
      </span>
      <div className="flex min-w-0 flex-col gap-0.5">
        <p className="text-label font-bold leading-[1.2]">HadirinAja</p>
        <p className="text-caption">Ruang kerja</p>
      </div>
    </div>
  )
}

export function OrganizationSwitcher({ tenantName }: { tenantName: string }) {
  return (
    <a
      href="/select-tenant"
      className="flex min-w-0 items-center gap-2 rounded-[12px] bg-canvas px-[11px] py-2.5 focus-visible:outline-2 focus-visible:outline-primary"
      data-pen-origin="Dl2p0"
    >
      <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
        <span className="text-caption font-bold tracking-[0.5px]">
          Organisasi aktif
        </span>
        <span className="break-words text-label leading-[1.2]">
          {tenantName}
        </span>
      </div>
      <ChevronDown aria-hidden="true" size={14} />
    </a>
  )
}

function NavigationLinks({
  activePage,
  activeDestination,
  currentHash,
  context,
  onNavigate,
  initialSection,
  preview = false,
}: {
  activePage: ManagementPage
  activeDestination: string
  currentHash: string
  context: ManagementNavigationContext
  onNavigate?: () => void
  initialSection?: string
  preview?: boolean
}) {
  const [expanded, setExpanded] = useState<string | null>(
    initialSection ??
      (["reporting", "settings"].includes(activeDestination)
        ? activeDestination === "settings"
          ? null
          : activeDestination
        : null)
  )
  const { busy, error, logout } = useLogout()
  const items = getManagementNavigation(context.roles)
  const groups = [
    { label: "Pantau", items: items.slice(0, 1) },
    { label: "Operasional", items: items.slice(1, 4) },
    { label: "Data dan sistem", items: items.slice(4) },
  ]
  useEffect(() => {
    if (initialSection) setExpanded(initialSection)
    else if (activeDestination === "reporting") setExpanded(activeDestination)
  }, [initialSection, activeDestination])

  const renderItem = (item: ManagementNavigationItem, child = false) => {
    const Icon = item.icon
    const selected = child
      ? activePage === item.id ||
        (currentHash === `#${item.id}` && activeDestination === "settings")
      : activeDestination === item.id
    const content = (
      <>
        <Icon aria-hidden="true" />
        <span className="min-w-0 flex-1 break-words text-start">
          {item.label}
        </span>
      </>
    )
    if (item.children) {
      const open = expanded === item.id
      return (
        <div key={item.id}>
          {item.href ? (
            <div className="flex min-w-0 items-center">
              <a
                href={item.href}
                onClick={onNavigate}
                aria-current={selected ? "page" : undefined}
                className={cn(
                  navLink,
                  selected && "bg-brand-50 font-semibold text-brand-700"
                )}
              >
                {content}
              </a>
              <button
                type="button"
                aria-label={`Submenu ${item.label}`}
                aria-expanded={open}
                onClick={() => setExpanded(open ? null : item.id)}
                className="flex size-11 shrink-0 items-center justify-center rounded-[11px] focus-visible:outline-2 focus-visible:outline-primary"
              >
                {open ? (
                  <ChevronDown aria-hidden="true" size={18} />
                ) : (
                  <ChevronRight aria-hidden="true" size={18} />
                )}
              </button>
            </div>
          ) : (
            <button
              type="button"
              className={cn(
                navLink,
                selected && "bg-brand-50 font-semibold text-brand-700"
              )}
              aria-expanded={open}
              onClick={() => setExpanded(open ? null : item.id)}
            >
              {content}
              {open ? (
                <ChevronDown aria-hidden="true" />
              ) : (
                <ChevronRight aria-hidden="true" />
              )}
            </button>
          )}
          {open ? (
            <div className="ps-5">
              {item.children.map((entry) => renderItem(entry, true))}
            </div>
          ) : null}
        </div>
      )
    }
    return (
      <a
        key={item.id}
        href={item.href}
        onClick={onNavigate}
        aria-current={selected ? "page" : undefined}
        className={cn(
          navLink,
          selected && "bg-brand-50 font-semibold text-brand-700"
        )}
      >
        {content}
      </a>
    )
  }
  return (
    <div className="flex min-w-0 flex-col gap-[18px] p-4">
      <NavigationBrand />
      <OrganizationSwitcher tenantName={context.tenantName} />
      <nav aria-label="Navigasi manajemen" className="flex flex-col gap-[18px]">
        {groups.map((group) => (
          <div key={group.label} className="flex flex-col gap-1">
            <p className="text-caption text-[11px] font-semibold">
              {group.label}
            </p>
            {group.items.map((item) => renderItem(item))}
          </div>
        ))}
      </nav>
      <div className="flex flex-col gap-1.5 pt-2">
        <p className="text-caption font-semibold text-foreground">
          {context.roles.includes("owner")
            ? "Owner · seluruh Outlet"
            : "Supervisor · Outlet yang dapat diakses"}
        </p>
        <p className="text-caption">Hak akses diperiksa oleh sistem.</p>
        <a href="/select-tenant" className={navLink} onClick={onNavigate}>
          <Repeat2 aria-hidden="true" />
          <span>Ganti organisasi</span>
        </a>
        <details>
          <summary className={cn(navLink, "cursor-pointer list-none")}>
            <UserRound aria-hidden="true" />
            <span>Akun dan peran</span>
          </summary>
          <div className="flex flex-col gap-1 rounded-[12px] bg-canvas p-3">
            {context.userName ? (
              <p className="break-words text-body">{context.userName}</p>
            ) : null}
            <p className="text-caption">{roleLabel(context.roles)}</p>
            <p className="text-caption">Peran mengikuti akses ke organisasi aktif.</p>
          </div>
        </details>
        <button
          type="button"
          className={navLink}
          disabled={busy}
          onClick={() => {
            if (!preview) void logout()
          }}
        >
          <LogOut aria-hidden="true" />
          <span>{busy ? "Keluar dari akun…" : "Keluar dari akun"}</span>
        </button>
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
      </div>
    </div>
  )
}

export function OwnerMobileNavigation({
  active,
  preview = false,
}: {
  active: OwnerMobilePage | null
  preview?: boolean
}) {
  return (
    <nav
      aria-label="Shortcut manajemen"
      data-pen-origin="F93YV"
      data-r2c-owner-dock={!preview || undefined}
      className={cn(
        "flex h-20 w-full items-center rounded-t-[20px] border border-border bg-surface p-2",
        preview
          ? "relative"
          : "fixed inset-x-0 bottom-0 z-40 h-[calc(80px+env(safe-area-inset-bottom))] pb-[calc(8px+env(safe-area-inset-bottom))] md:hidden"
      )}
    >
      {getManagementNavigation(["owner"])
        .slice(0, 4)
        .map((item) => {
          const Icon = item.icon
          const selected = active === item.id
          return (
            <a
              href={item.href}
              key={item.id}
              aria-current={selected ? "page" : undefined}
              className="flex h-[60px] min-w-0 flex-1 flex-col items-center justify-start gap-1 rounded-[12px] focus-visible:outline-2 focus-visible:outline-primary"
            >
              <span
                className={cn(
                  "flex h-[30px] w-[34px] items-center justify-center rounded-[11px]",
                  selected
                    ? "bg-brand-50 text-primary"
                    : "text-muted-foreground"
                )}
              >
                <Icon aria-hidden="true" size={18} />
              </span>
              <span
                className={cn(
                  "text-caption text-[11px] font-normal text-muted-foreground",
                  selected && "font-semibold text-brand-700"
                )}
              >
                {item.label}
              </span>
            </a>
          )
        })}
    </nav>
  )
}

export function ManagementTopbar({
  context,
  onLogout,
  busy: externalBusy = false,
  settingsBack = false,
}: {
  context?: ManagementNavigationContext | null
  onLogout?: () => void
  busy?: boolean
  settingsBack?: boolean
}) {
  const { openMobile, setOpenMobile } = useSidebar()
  const { busy, error, logout } = useLogout()
  const manager = Boolean(
    context?.roles.some((role) => role === "owner" || role === "supervisor")
  )
  return (
    <header
      data-pen-origin="wJiZF"
      className="r2c-management-topbar sticky top-0 z-30 flex h-16 min-w-0 shrink-0 flex-nowrap items-center gap-2 border-b border-border bg-surface px-3 md:h-[72px] md:gap-4 md:px-6"
    >
      <div className="flex min-w-0 flex-1 items-center gap-2.5">
        <Button
          variant="outline"
          size="icon-xl"
          className="hidden md:inline-flex xl:hidden"
          aria-label="Buka menu lengkap"
          aria-haspopup="dialog"
          aria-expanded={openMobile}
          disabled={!manager}
          onClick={() => setOpenMobile(true)}
        >
          <Menu aria-hidden="true" />
        </Button>
        {settingsBack ? (
          <Link
            to="/settings"
            aria-label="Kembali ke Pengaturan"
            title="Kembali ke Pengaturan"
            className={cn(
              buttonVariants({ variant: "ghost", size: "icon" }),
              "rounded-[10px]"
            )}
          >
            <ArrowLeft aria-hidden="true" />
          </Link>
        ) : null}
        <span className="min-w-0 truncate text-label font-semibold">
          HadirinAja
        </span>
      </div>
      <Button
        variant="secondary"
        className="md:hidden"
        disabled={!manager}
        aria-haspopup="dialog"
        aria-expanded={openMobile}
        onClick={() => setOpenMobile(true)}
      >
        <Menu aria-hidden="true" data-icon="inline-start" />
        Menu
      </Button>
      <Button
        variant="outline"
        className="hidden md:inline-flex"
        render={<a href="/select-tenant" />}
      >
        Ganti organisasi
        <ChevronDown aria-hidden="true" data-icon="inline-end" />
      </Button>
      <Button
        variant="ghost"
        className="hidden md:inline-flex"
        disabled={busy || externalBusy}
        onClick={onLogout ?? (() => void logout())}
      >
        Keluar dari akun
      </Button>
      {error ? (
        <span role="alert" className="text-caption text-danger-strong">
          {error}
        </span>
      ) : null}
    </header>
  )
}

export function ManagementSidebar({
  activePage,
  context,
  preview = false,
}: {
  activePage: ManagementPage
  context?: ManagementNavigationContext | null
  preview?: boolean
}) {
  const { openMobile, setOpenMobile } = useSidebar()
  const [hash, setHash] = useState("")
  const [menuSection, setMenuSection] = useState<string>()
  useEffect(() => {
    const update = () => setHash(window.location.hash)
    update()
    window.addEventListener("hashchange", update)
    return () => window.removeEventListener("hashchange", update)
  }, [])
  if (!context || !getManagementNavigation(context.roles).length) return null
  const active = getActiveManagementDestination(activePage, hash)
  const body = (onNavigate?: () => void) => (
    <NavigationLinks
      activePage={activePage}
      activeDestination={active}
      currentHash={hash}
      context={context}
      initialSection={menuSection}
      preview={preview}
      onNavigate={onNavigate}
    />
  )
  if (preview) return <aside className="w-[248px] bg-surface">{body()}</aside>
  return (
    <>
      <div
        className="hidden w-[100px] shrink-0 lg:block xl:w-[248px]"
        aria-hidden="true"
      />
      <aside
        data-r2c-sidebar
        data-pen-origin="KPrbP"
        className="fixed inset-y-0 start-0 z-40 hidden w-[248px] overflow-y-auto border-e border-border bg-surface xl:block"
      >
        {body()}
      </aside>
      <nav
        data-r2c-rail
        data-pen-origin="u2s8MD"
        aria-label="Navigasi manajemen ringkas"
        className="fixed inset-y-0 start-0 z-40 hidden w-[100px] flex-col items-center gap-3.5 overflow-y-auto border-e border-border bg-surface px-2 py-4 lg:flex xl:hidden"
      >
        <span className="flex size-[34px] shrink-0 items-center justify-center rounded-[11px] bg-primary text-primary-foreground">
          <CalendarCheck aria-hidden="true" size={18} />
        </span>
        {getManagementNavigation(context.roles).map((item) => {
          const Icon = item.icon
          const classes = cn(
            "flex min-h-14 w-full shrink-0 flex-col items-center gap-1 rounded-[12px] px-0 py-2 text-muted-foreground focus-visible:outline-2 focus-visible:outline-primary",
            active === item.id && "bg-brand-50 text-brand-700"
          )
          const content = (
            <>
              <Icon aria-hidden="true" size={18} />
              <span className="text-caption text-[11px] text-inherit">
                {item.label}
              </span>
            </>
          )
          return item.href ? (
            <a
              key={item.id}
              href={item.href}
              className={classes}
              aria-current={active === item.id ? "page" : undefined}
            >
              {content}
            </a>
          ) : (
            <button
              key={item.id}
              type="button"
              className={classes}
              aria-haspopup="dialog"
              onClick={() => {
                setMenuSection(item.id)
                setOpenMobile(true)
              }}
            >
              {content}
            </button>
          )
        })}
        <button
          type="button"
          className="flex min-h-14 w-full shrink-0 flex-col items-center gap-1 rounded-[12px] py-2 text-muted-foreground focus-visible:outline-2 focus-visible:outline-primary"
          aria-haspopup="dialog"
          onClick={() => {
            setMenuSection(undefined)
            setOpenMobile(true)
          }}
        >
          <Menu aria-hidden="true" size={18} />
          <span className="text-caption text-[11px]">Menu lengkap</span>
        </button>
      </nav>
      <Dialog.Root open={openMobile} onOpenChange={setOpenMobile}>
        <Dialog.Portal>
          <Dialog.Backdrop className="fixed inset-0 z-50 bg-[var(--owner-drawer-scrim)]" />
          <Dialog.Popup
            data-pen-origin="YI0zC"
            className="fixed inset-y-0 start-0 z-50 flex w-full max-w-[390px] flex-col overflow-hidden bg-surface text-foreground shadow-[var(--shadow-overlay)] outline-none"
          >
            <div className="flex h-[54px] shrink-0 items-center gap-3 border-b border-border px-4">
              <Dialog.Title className="flex-1 text-subtitle">
                Menu lengkap
              </Dialog.Title>
              <Dialog.Close render={<Button variant="outline" />}>
                <X aria-hidden="true" data-icon="inline-start" />
                Tutup
              </Dialog.Close>
              <Dialog.Description className="sr-only">
                Navigasi dan tindakan mengikuti hak akses organisasi aktif.
              </Dialog.Description>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto pb-[env(safe-area-inset-bottom)]">
              {body(() => setOpenMobile(false))}
            </div>
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
      <OwnerMobileNavigation
        active={
          ["overview", "team", "schedule", "requests"].includes(active)
            ? (active as OwnerMobilePage)
            : null
        }
      />
    </>
  )
}
