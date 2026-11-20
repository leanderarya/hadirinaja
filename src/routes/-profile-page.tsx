import { Building01Icon, Logout03Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { useEffect, useRef, useState } from "react"
import { EmployeeShell, useEmployeeLogout } from "@/components/employee-shell"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer"
import { Separator } from "@/components/ui/separator"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { type AuthSession, apiRequest } from "@/lib/api"
import { getAuthRecoveryPath } from "@/lib/auth-navigation"

type AssignedOutlet = { id: number; name: string }

type PersonalAttendanceRead = {
  outlets?: AssignedOutlet[]
}

type OutletReadState =
  | { status: "loading" }
  | { status: "available"; outlets: AssignedOutlet[] }
  | { status: "unavailable" }

const roleLabels: Record<"owner" | "supervisor" | "employee", string> = {
  employee: "Karyawan",
  supervisor: "Supervisor",
  owner: "Pemilik",
}

function initials(name: string | null | undefined): string {
  const parts = name?.trim().split(/\s+/).filter(Boolean) ?? []
  if (!parts.length) return "?"

  return parts
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toLocaleUpperCase("id-ID")
}

function roleNames(session: AuthSession): string {
  const roles = session.active_membership?.roles ?? []
  const labels = roles.map((role) => roleLabels[role])
  return labels.length
    ? [...new Set(labels)].join(", ")
    : "Peran belum tersedia"
}

function displayText(value: string | null | undefined, fallback: string) {
  const normalized = value?.trim()
  return normalized || fallback
}

function ProfileRows({
  rows,
}: {
  rows: Array<{ label: string; value: string }>
}) {
  return (
    <dl className="divide-y divide-border border-y border-border">
      {rows.map((row) => (
        <div
          className="grid min-w-0 grid-cols-[minmax(5rem,0.8fr)_minmax(0,1.2fr)] gap-3 py-3"
          key={row.label}
        >
          <dt className="text-caption text-muted-foreground">{row.label}</dt>
          <dd className="min-w-0 break-words text-right text-body">
            {row.value}
          </dd>
        </div>
      ))}
    </dl>
  )
}

function AuthorizedOutlets({ outlets }: { outlets: AssignedOutlet[] }) {
  return (
    <ul
      aria-label="Outlet dengan penugasan aktif"
      className="divide-y divide-border"
    >
      {outlets.map((outlet) => (
        <li className="break-words py-3 text-body" key={outlet.id}>
          {outlet.name}
        </li>
      ))}
    </ul>
  )
}

export function EmployeeProfilePage() {
  const [session, setSession] = useState<AuthSession | null>(null)
  const [pageError, setPageError] = useState("")
  const [outletRead, setOutletRead] = useState<OutletReadState>({
    status: "loading",
  })
  const [outletsOpen, setOutletsOpen] = useState(false)
  const [wideViewport, setWideViewport] = useState(false)
  const outletTrigger = useRef<HTMLButtonElement | null>(null)
  const { busy: logoutBusy, error: logoutError, logout } = useEmployeeLogout()

  useEffect(() => {
    const media = window.matchMedia("(min-width: 768px)")
    const update = () => setWideViewport(media.matches)
    update()
    media.addEventListener("change", update)
    return () => media.removeEventListener("change", update)
  }, [])

  useEffect(() => {
    let cancelled = false

    async function loadProfile() {
      try {
        const auth = await apiRequest<AuthSession>("/auth/me")
        if (!auth.active_membership) {
          window.location.assign("/select-tenant")
          return
        }
        if (cancelled) return
        setSession(auth)

        if (!auth.active_membership.roles.includes("employee")) {
          setOutletRead({ status: "unavailable" })
          return
        }

        try {
          const attendance =
            await apiRequest<PersonalAttendanceRead>("/attendance/me")
          if (cancelled) return
          if (!Array.isArray(attendance.outlets)) {
            setOutletRead({ status: "unavailable" })
            return
          }

          const uniqueOutlets = new Map<number, AssignedOutlet>()
          for (const outlet of attendance.outlets) {
            if (
              Number.isInteger(outlet?.id) &&
              typeof outlet.name === "string" &&
              outlet.name.trim()
            ) {
              uniqueOutlets.set(outlet.id, {
                id: outlet.id,
                name: outlet.name.trim(),
              })
            }
          }
          setOutletRead({
            status: "available",
            outlets: [...uniqueOutlets.values()],
          })
        } catch (caught) {
          const recovery = getAuthRecoveryPath(caught)
          if (recovery) {
            window.location.assign(recovery)
            return
          }
          if (!cancelled) setOutletRead({ status: "unavailable" })
        }
      } catch (caught) {
        const recovery = getAuthRecoveryPath(caught)
        if (recovery) {
          window.location.assign(recovery)
          return
        }
        if (!cancelled) {
          setPageError(
            "Profil belum dapat dimuat. Periksa koneksi lalu coba lagi."
          )
          setOutletRead({ status: "unavailable" })
        }
      }
    }

    void loadProfile()
    return () => {
      cancelled = true
    }
  }, [])

  if (!session) {
    return (
      <main
        aria-live="polite"
        className="flex min-h-svh items-center justify-center px-4 text-body text-muted-foreground"
        role={pageError ? "alert" : "status"}
      >
        {pageError || "Memuat profil…"}
      </main>
    )
  }

  const membership = session.active_membership
  if (!membership) {
    return (
      <main
        aria-live="polite"
        className="flex min-h-svh items-center justify-center px-4 text-body text-muted-foreground"
        role="status"
      >
        Membuka pemilihan organisasi…
      </main>
    )
  }

  const name = displayText(session.user.name, "Nama belum tersedia")
  const email = displayText(session.user.email, "Email belum tersedia")
  const roles = roleNames(session)
  const outlets = outletRead.status === "available" ? outletRead.outlets : []
  const title = "Outlet dengan penugasan aktif"

  function closeOutlets() {
    setOutletsOpen(false)
    window.requestAnimationFrame(() => outletTrigger.current?.focus())
  }

  return (
    <EmployeeShell active="profile" accountName={name}>
      <div className="mx-auto flex min-w-0 max-w-2xl flex-col gap-4 py-3 sm:py-5">
        {pageError ? (
          <Alert role="alert" variant="destructive">
            <AlertTitle>Profil belum dapat dimuat</AlertTitle>
            <AlertDescription>{pageError}</AlertDescription>
          </Alert>
        ) : null}

        <section
          aria-label="Identitas karyawan"
          className="flex min-w-0 flex-col items-center border-b border-border px-2 pb-5 pt-2 text-center"
        >
          <Avatar
            aria-label={`Avatar ${name}`}
            className="size-16 border border-border bg-muted"
            role="img"
          >
            <AvatarFallback className="text-title font-medium">
              {initials(session.user.name)}
            </AvatarFallback>
          </Avatar>
          <h1 className="mt-3 max-w-full break-words text-title">{name}</h1>
          <p className="mt-1 max-w-full break-all text-body text-muted-foreground">
            {email}
          </p>
        </section>

        <section aria-labelledby="profile-employment-heading" className="py-1">
          <h2 className="mb-2 text-subtitle" id="profile-employment-heading">
            Kepegawaian
          </h2>
          <ProfileRows
            rows={[
              { label: "Peran", value: roles },
              {
                label: "Organisasi",
                value: displayText(
                  membership.tenant.name,
                  "Organisasi belum tersedia"
                ),
              },
            ]}
          />
        </section>

        <Separator />

        <section aria-labelledby="profile-outlets-heading" className="py-1">
          <h2 className="mb-2 text-subtitle" id="profile-outlets-heading">
            Outlet
          </h2>
          {outletRead.status === "loading" ? (
            <p className="py-3 text-body text-muted-foreground" role="status">
              Memuat Outlet…
            </p>
          ) : outletRead.status === "unavailable" ? (
            <p className="py-3 text-body text-muted-foreground" role="status">
              Detail Outlet belum tersedia untuk akun ini.
            </p>
          ) : outlets.length === 0 ? (
            <p className="py-3 text-body text-muted-foreground" role="status">
              Belum ada Outlet dengan penugasan aktif.
            </p>
          ) : outlets.length === 1 ? (
            <ProfileRows rows={[{ label: "Outlet", value: outlets[0].name }]} />
          ) : (
            <Button
              aria-expanded={outletsOpen}
              aria-haspopup="dialog"
              aria-label={`Lihat ${outlets.length} Outlet dengan penugasan aktif`}
              className="min-h-11 w-full justify-between rounded-md px-2 text-left"
              onClick={() => setOutletsOpen(true)}
              ref={outletTrigger}
              title={title}
              variant="ghost"
            >
              <span className="flex min-w-0 items-center gap-2">
                <HugeiconsIcon aria-hidden="true" icon={Building01Icon} />
                <span>{outlets.length} Outlet</span>
              </span>
              <span className="text-caption text-muted-foreground">
                Lihat daftar
              </span>
            </Button>
          )}
        </section>

        <Separator />

        <section aria-labelledby="profile-account-heading" className="py-1">
          <h2 className="mb-2 text-subtitle" id="profile-account-heading">
            Akun
          </h2>
          {logoutError ? (
            <Alert className="mb-3" role="alert" variant="destructive">
              <AlertTitle>Belum berhasil keluar dari akun</AlertTitle>
              <AlertDescription>{logoutError}</AlertDescription>
            </Alert>
          ) : null}
          <Button
            className="min-h-11 w-full justify-start"
            nativeButton={false}
            render={<a href="/attendance#history" />}
            variant="ghost"
          >
            Riwayat kehadiran
          </Button>
          <Button
            className="min-h-11 w-full justify-start"
            nativeButton={false}
            render={<a href="/select-tenant" />}
            variant="ghost"
          >
            Ganti organisasi
          </Button>
          <Button
            className="min-h-11 w-full justify-start"
            disabled={logoutBusy}
            onClick={() => void logout()}
            variant="ghost"
          >
            <HugeiconsIcon
              aria-hidden="true"
              data-icon="inline-start"
              icon={Logout03Icon}
            />
            {logoutBusy ? "Keluar dari akun…" : "Keluar dari akun"}
          </Button>
        </section>
      </div>

      {outlets.length > 1 && outletsOpen ? (
        wideViewport ? (
          <Sheet
            modal={false}
            open
            onOpenChange={(open) => !open && closeOutlets()}
          >
            <SheetContent
              aria-describedby="profile-outlets-description"
              className="w-full overflow-y-auto pb-[env(safe-area-inset-bottom)] sm:max-w-md"
              side="right"
            >
              <SheetHeader className="gap-1 border-b border-border px-5 pb-3 pt-5 pr-14">
                <SheetTitle>Outlet yang diizinkan</SheetTitle>
                <SheetDescription id="profile-outlets-description">
                  Outlet dengan penugasan aktif pada organisasi ini. Daftar ini
                  tidak mengubah konteks tampilan atau tujuan presensi.
                </SheetDescription>
              </SheetHeader>
              <div className="min-h-0 overflow-y-auto px-5 pb-6">
                <AuthorizedOutlets outlets={outlets} />
              </div>
            </SheetContent>
          </Sheet>
        ) : (
          <Drawer open onOpenChange={(open) => !open && closeOutlets()}>
            <DrawerContent
              aria-describedby="profile-outlets-description"
              className="max-h-[85dvh] overflow-hidden rounded-t-lg pb-0 before:rounded-lg"
            >
              <DrawerHeader className="px-5 pb-2 pt-1 text-left">
                <DrawerTitle>Outlet yang diizinkan</DrawerTitle>
                <DrawerDescription id="profile-outlets-description">
                  Outlet dengan penugasan aktif pada organisasi ini. Daftar ini
                  tidak mengubah konteks tampilan atau tujuan presensi.
                </DrawerDescription>
              </DrawerHeader>
              <div className="min-h-0 overflow-y-auto overscroll-contain px-5 pb-[calc(1rem+env(safe-area-inset-bottom))]">
                <AuthorizedOutlets outlets={outlets} />
              </div>
            </DrawerContent>
          </Drawer>
        )
      ) : null}
    </EmployeeShell>
  )
}
