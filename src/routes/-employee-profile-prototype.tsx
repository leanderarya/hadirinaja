import {
  ArrowLeft01Icon,
  Building01Icon,
  Calendar03Icon,
  ClipboardListIcon,
  Home01Icon,
  Logout03Icon,
  UserGroupIcon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { useEffect, useRef, useState } from "react"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { Separator } from "@/components/ui/separator"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"

type Scenario = "single" | "multiple" | "no_outlets" | "missing" | "long_name"

type ProfileFixture = {
  user: { name: string | null; email: string | null }
  membership: { tenantName: string | null; roles: string[] }
  employee: { name: string | null }
  outlets: Array<{ id: number; name: string }> | null
}

const scenarioLabels: Record<Scenario, string> = {
  single: "Satu Outlet",
  multiple: "Beberapa Outlet",
  no_outlets: "Detail Outlet tidak tersedia",
  missing: "Atribut opsional kosong",
  long_name: "Nama panjang",
}

const fixtures: Record<Scenario, ProfileFixture> = {
  single: {
    user: { name: "Nadia Putri", email: "nadia.putri@example.test" },
    membership: { tenantName: "HadirinAja Demo", roles: ["employee"] },
    employee: { name: "Nadia Putri" },
    outlets: [{ id: 1, name: "Outlet Kuningan" }],
  },
  multiple: {
    user: { name: "Nadia Putri", email: "nadia.putri@example.test" },
    membership: { tenantName: "HadirinAja Demo", roles: ["employee"] },
    employee: { name: "Nadia Putri" },
    outlets: [
      { id: 1, name: "Outlet Kuningan" },
      { id: 2, name: "Outlet Kemang" },
      { id: 3, name: "Outlet Menteng" },
    ],
  },
  no_outlets: {
    user: { name: "Nadia Putri", email: "nadia.putri@example.test" },
    membership: { tenantName: "HadirinAja Demo", roles: ["employee"] },
    employee: { name: "Nadia Putri" },
    outlets: null,
  },
  missing: {
    user: { name: "Nadia Putri", email: null },
    membership: { tenantName: null, roles: ["employee"] },
    employee: { name: "Nadia Putri" },
    outlets: [{ id: 1, name: "Outlet Kuningan" }],
  },
  long_name: {
    user: {
      name: "Nadia Putri Rahmawati Prameswari",
      email: "nadia.putri.rahmawati.prameswari@example.test",
    },
    membership: { tenantName: "HadirinAja Demo", roles: ["employee"] },
    employee: { name: "Nadia Putri Rahmawati Prameswari" },
    outlets: [
      {
        id: 1,
        name: "Outlet Kuningan Selatan Lantai Dua dan Ruang Produksi",
      },
    ],
  },
}

const destinations = [
  {
    label: "Presensi",
    href: "/dev-employee-mobile-prototype",
    icon: Home01Icon,
  },
  {
    label: "Jadwal",
    href: "/dev-employee-schedule-prototype",
    icon: Calendar03Icon,
  },
  {
    label: "Permintaan",
    href: "/dev-employee-requests-prototype",
    icon: ClipboardListIcon,
  },
  {
    label: "Profil",
    href: "/dev-employee-profile-prototype",
    icon: UserGroupIcon,
  },
] as const

function initials(name: string | null): string {
  const parts = name?.trim().split(/\s+/).filter(Boolean) ?? []
  if (!parts.length) return "?"
  return parts
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toLocaleUpperCase("id-ID")
}

function roleLabel(roles: string[]): string {
  if (roles.includes("employee")) return "Karyawan"
  if (roles.includes("supervisor")) return "Supervisor"
  if (roles.includes("owner")) return "Owner"
  return "Peran belum tersedia"
}

function InfoRows({ rows }: { rows: Array<{ label: string; value: string }> }) {
  return (
    <dl className="divide-y divide-border border-y border-border">
      {rows.map((row) => (
        <div
          className="grid min-w-0 grid-cols-[minmax(5.5rem,0.8fr)_minmax(0,1.2fr)] gap-3 py-3"
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

function OutletContent({
  outlets,
}: {
  outlets: NonNullable<ProfileFixture["outlets"]>
}) {
  return (
    <ul
      aria-label="Outlet contoh yang diizinkan"
      className="divide-y divide-border"
    >
      {outlets.map((outlet) => (
        <li
          className="break-words py-3 text-body"
          key={outlet.id}
          title={outlet.name}
        >
          {outlet.name}
        </li>
      ))}
    </ul>
  )
}

function OverlayOutletList({
  outlets,
  wide,
  onClose,
}: {
  outlets: NonNullable<ProfileFixture["outlets"]>
  wide: boolean
  onClose: () => void
}) {
  if (wide) {
    return (
      <Sheet open onOpenChange={(open) => !open && onClose()}>
        <SheetContent
          aria-describedby="profile-outlets-description"
          className="w-full overflow-y-auto pb-[env(safe-area-inset-bottom)] sm:max-w-md"
          side="right"
        >
          <SheetHeader className="gap-1 border-b border-border px-5 pb-3 pt-5 pr-14">
            <SheetTitle>Outlet yang diizinkan</SheetTitle>
            <SheetDescription id="profile-outlets-description">
              Daftar Outlet dari data sintetis.
            </SheetDescription>
          </SheetHeader>
          <div className="min-h-0 overflow-y-auto px-5 pb-6">
            <OutletContent outlets={outlets} />
          </div>
        </SheetContent>
      </Sheet>
    )
  }

  return (
    <Drawer open onOpenChange={(open) => !open && onClose()}>
      <DrawerContent
        aria-describedby="profile-outlets-description"
        className="max-h-[85dvh] overflow-hidden rounded-t-lg pb-0 before:rounded-lg"
      >
        <DrawerHeader className="px-5 pb-2 pt-1 text-left">
          <DrawerTitle>Outlet yang diizinkan</DrawerTitle>
          <DrawerDescription id="profile-outlets-description">
            Daftar Outlet dari data sintetis.
          </DrawerDescription>
        </DrawerHeader>
        <div className="min-h-0 overflow-y-auto overscroll-contain px-5 pb-[calc(1rem+env(safe-area-inset-bottom))]">
          <OutletContent outlets={outlets} />
        </div>
      </DrawerContent>
    </Drawer>
  )
}

export function EmployeeProfilePrototype() {
  const [scenario, setScenario] = useState<Scenario>("single")
  const [devPanelOpen, setDevPanelOpen] = useState(false)
  const [outletsOpen, setOutletsOpen] = useState(false)
  const [logoutOpen, setLogoutOpen] = useState(false)
  const [wide, setWide] = useState(false)
  const outletTriggerRef = useRef<HTMLButtonElement | null>(null)
  const logoutTriggerRef = useRef<HTMLButtonElement | null>(null)
  const profile = fixtures[scenario]
  const name = profile.employee.name ?? profile.user.name
  const outlets = profile.outlets ?? []
  const role = roleLabel(profile.membership.roles)

  useEffect(() => {
    const media = window.matchMedia("(min-width: 768px)")
    const update = () => setWide(media.matches)
    update()
    media.addEventListener("change", update)
    return () => media.removeEventListener("change", update)
  }, [])

  function closeOutlets() {
    setOutletsOpen(false)
    window.requestAnimationFrame(() => outletTriggerRef.current?.focus())
  }

  function closeLogout() {
    setLogoutOpen(false)
    window.requestAnimationFrame(() => logoutTriggerRef.current?.focus())
  }

  return (
    <div className="min-h-svh bg-background text-foreground">
      <a
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-md focus:bg-background focus:p-3 focus:ring-2 focus:ring-ring"
        href="#profile-content"
      >
        Lewati navigasi
      </a>
      <header className="sticky top-0 z-30 border-b border-border bg-background">
        <div className="mx-auto grid min-h-14 max-w-2xl grid-cols-[1fr_auto_1fr] items-center px-4">
          <a
            aria-label="Kembali ke Presensi prototype"
            className="inline-flex min-h-11 min-w-11 items-center gap-1 rounded-md text-body text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
            href="/dev-employee-mobile-prototype"
          >
            <HugeiconsIcon aria-hidden="true" icon={ArrowLeft01Icon} />
            <span className="hidden sm:inline">Presensi</span>
          </a>
          <h1 className="text-title">Profil</h1>
          <span aria-hidden="true" />
        </div>
        <p className="border-t border-border px-4 py-2 text-center text-caption text-muted-foreground">
          Pratinjau · data sintetis · tanpa API
        </p>
      </header>

      <main
        className="mx-auto min-h-[calc(100svh-9rem)] max-w-2xl px-4 pb-[calc(6rem+env(safe-area-inset-bottom))]"
        id="profile-content"
        tabIndex={-1}
      >
        <section
          aria-label="Identitas karyawan"
          className="flex flex-col items-center border-b border-border py-5 text-center"
        >
          <Avatar
            aria-label={`Avatar ${name ?? "karyawan"}`}
            className="size-16 border border-border bg-muted"
            role="img"
            size="default"
          >
            <AvatarFallback className="text-title font-medium">
              {initials(name)}
            </AvatarFallback>
          </Avatar>
          <h2 className="mt-3 max-w-full break-words text-title">
            {name ?? "Nama belum tersedia"}
          </h2>
          <p className="mt-1 max-w-full break-all text-body text-muted-foreground">
            {profile.user.email ?? "Email belum tersedia"}
          </p>
          <p className="mt-2 text-caption text-muted-foreground">{role}</p>
        </section>

        <section aria-labelledby="employment-heading" className="py-4">
          <h2 className="mb-2 text-subtitle" id="employment-heading">
            Kepegawaian
          </h2>
          <InfoRows
            rows={[
              { label: "Peran", value: role },
              {
                label: "Organisasi",
                value: profile.membership.tenantName ?? "Belum tersedia",
              },
            ]}
          />
        </section>

        <Separator />

        <section aria-labelledby="outlets-heading" className="py-4">
          <h2 className="mb-2 text-subtitle" id="outlets-heading">
            Outlet
          </h2>
          {outlets.length === 1 ? (
            <InfoRows rows={[{ label: "Outlet", value: outlets[0].name }]} />
          ) : outlets.length > 1 ? (
            <Button
              aria-expanded={outletsOpen}
              aria-haspopup="dialog"
              className="min-h-11 w-full justify-between rounded-md px-2 text-left"
              onClick={() => setOutletsOpen(true)}
              ref={outletTriggerRef}
              title={`Lihat ${outlets.length} Outlet contoh`}
              variant="ghost"
            >
              <span className="flex min-w-0 items-center gap-2">
                <HugeiconsIcon
                  aria-hidden="true"
                  data-icon="inline-start"
                  icon={Building01Icon}
                />
                <span>{outlets.length} Outlet</span>
              </span>
              <span className="text-caption text-muted-foreground">
                Lihat daftar
              </span>
            </Button>
          ) : (
            <p className="py-3 text-body text-muted-foreground" role="status">
              Detail Outlet belum tersedia pada contoh ini.
            </p>
          )}
        </section>

        <Separator />

        <section aria-labelledby="account-heading" className="py-4">
          <h2 className="mb-2 text-subtitle" id="account-heading">
            Akun
          </h2>
          <InfoRows rows={[{ label: "Status", value: "Aktif" }]} />
          <Button
            className="mt-4 min-h-11 w-full justify-start"
            onClick={() => setLogoutOpen(true)}
            ref={logoutTriggerRef}
            variant="outline"
          >
            <HugeiconsIcon
              aria-hidden="true"
              data-icon="inline-start"
              icon={Logout03Icon}
            />
            Simulasikan keluar dari akun
          </Button>
        </section>

        <Separator />

        <details
          className="group py-4"
          onToggle={(event) => setDevPanelOpen(event.currentTarget.open)}
          open={devPanelOpen}
        >
          <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between rounded-md text-label outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
            Panel pengembangan · skenario
            <span aria-hidden="true" className="text-muted-foreground">
              {devPanelOpen ? "−" : "+"}
            </span>
          </summary>
          <FieldGroup className="pt-3">
            <Field>
              <FieldLabel htmlFor="profile-prototype-scenario">
                Skenario data sintetis
              </FieldLabel>
              <NativeSelect
                id="profile-prototype-scenario"
                onChange={(event) =>
                  setScenario(event.target.value as Scenario)
                }
                value={scenario}
              >
                {Object.entries(scenarioLabels).map(([value, label]) => (
                  <NativeSelectOption key={value} value={value}>
                    {label}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </Field>
            <p className="text-caption text-muted-foreground">
              Pilihan ini hanya mengganti data contoh di halaman ini.
            </p>
          </FieldGroup>
        </details>
      </main>

      <nav
        aria-label="Navigasi karyawan prototype"
        className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-background pb-[env(safe-area-inset-bottom)]"
      >
        <div className="mx-auto grid h-[68px] max-w-2xl grid-cols-4 items-center px-1">
          {destinations.map((item) => {
            const current = item.label === "Profil"
            return (
              <a
                aria-current={current ? "page" : undefined}
                className={`flex min-h-12 min-w-0 flex-col items-center justify-center gap-1 rounded-md px-1 text-caption outline-none focus-visible:ring-2 focus-visible:ring-ring ${current ? "font-medium text-primary" : "text-muted-foreground hover:bg-muted/40"}`}
                href={item.href}
                key={item.label}
              >
                <HugeiconsIcon aria-hidden="true" icon={item.icon} />
                <span className="truncate">{item.label}</span>
              </a>
            )
          })}
        </div>
      </nav>

      {outletsOpen && profile.outlets ? (
        <OverlayOutletList
          outlets={profile.outlets}
          onClose={closeOutlets}
          wide={wide}
        />
      ) : null}

      <Dialog
        onOpenChange={(open) => {
          if (!open) closeLogout()
        }}
        open={logoutOpen}
      >
        <DialogContent className="max-h-[80svh] overflow-y-auto rounded-lg">
          <DialogHeader>
            <DialogTitle>Simulasi keluar akun</DialogTitle>
            <DialogDescription>
              Sesi tetap aktif. Pratinjau ini tidak mengirim permintaan atau
              mengubah akun.
            </DialogDescription>
          </DialogHeader>
          <Button className="min-h-11" onClick={closeLogout} variant="outline">
            Tutup pratinjau
          </Button>
        </DialogContent>
      </Dialog>
    </div>
  )
}
