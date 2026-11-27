import { fromSettings } from "@/lib/settings-navigation"
import { createFileRoute } from "@tanstack/react-router"
import {
  Building2,
  Calendar,
  CalendarDays,
  Layers,
  Monitor,
  Shield,
  ShieldCheck,
  Users,
} from "lucide-react"
import { useEffect, useState } from "react"
import {
  ManagementSidebar,
  ManagementTopbar,
} from "@/components/management-sidebar"
import { SettingsSection } from "@/components/r2c/components"
import { PageHeading, ScopeBanner } from "@/components/r2c/screen-blocks"
import { Button } from "@/components/ui/button"
import { SidebarProvider } from "@/components/ui/sidebar"
import {
  apiRequest,
  type AuthSession,
  type OrganizationSummary,
} from "@/lib/api"

export const Route = createFileRoute("/settings")({ component: SettingsPage })

const categories = [
  {
    title: "Organisasi",
    summary:
      "Unit bisnis dan Outlet. Kelola struktur organisasi; profil karyawan tetap di Tim.",
    href: "/settings/organization",
    icon: Building2,
  },
  {
    title: "Akses pengguna",
    summary:
      "Akun, undangan, dan akses Outlet Supervisor. Akun pengguna terpisah dari profil karyawan.",
    href: "/access",
    icon: ShieldCheck,
  },
  {
    title: "Template shift",
    summary:
      "Template dan revisi bertanggal berlaku. Penugasan mingguan tetap di Jadwal.",
    href: "/settings/shift-templates",
    icon: Layers,
  },
  {
    title: "Kebijakan presensi",
    summary:
      "Kebijakan organisasi dan pengaturan khusus Outlet. Periksa nilai yang berlaku sebelum mengubahnya.",
    href: "/settings/attendance-policy",
    icon: Shield,
  },
  {
    title: "Kalender Outlet",
    summary:
      "Zona waktu, hari operasional dan pengecualian buka/tutup. Libur referensi tidak menutup Outlet otomatis.",
    href: "/settings/outlet-calendar",
    icon: CalendarDays,
  },
  {
    title: "Perangkat kiosk",
    summary:
      "Pemasangan dan pencabutan akses perangkat. Kode pendaftaran PIN karyawan tersedia di Tim.",
    href: "/settings/kiosk-devices",
    icon: Monitor,
  },
]

function SettingsPage() {
  const [session, setSession] = useState<AuthSession | null>(null)
  const [organization, setOrganization] = useState<OrganizationSummary | null>(
    null
  )
  const [state, setState] = useState("loading")
  const [attempt, setAttempt] = useState(0)
  // biome-ignore lint/correctness/useExhaustiveDependencies: attempt intentionally restarts the isolated context fetch on Retry.
  useEffect(() => {
    let active = true
    setState("loading")
    setSession(null)
    setOrganization(null)
    async function load() {
      try {
        const next = await apiRequest<AuthSession>("/auth/me")
        if (!active) return
        const member = next.active_membership
        if (!member) {
          setState("tenant")
          return
        }
        if (
          !member.roles.some(
            (role) => role === "owner" || role === "supervisor"
          )
        ) {
          setState("denied")
          return
        }
        setSession(next)
        const org = await apiRequest<OrganizationSummary>(
          "/management/organization"
        )
        if (!active) return
        if (org.tenant.id !== member.tenant.id) {
          setSession(null)
          setState("error")
          return
        }
        setOrganization(org)
        setState("ready")
      } catch {
        if (active) setState("error")
      }
    }
    void load()
    return () => {
      active = false
    }
  }, [attempt])
  const membership = session?.active_membership
  const owner = membership?.roles.includes("owner") ?? false
  const role = owner ? "Owner" : "Supervisor"
  const context = membership
    ? {
        tenantName: membership.tenant.name,
        roles: membership.roles,
        userName: session?.user.name,
        kioskEnabled: session?.features.kiosk_enabled ?? false,
      }
    : null
  const entries = owner
    ? categories
    : categories
        .slice(3, 5)
        .map((entry, index) => ({
          ...entry,
          summary:
            index === 0
              ? "Hanya lihat · Nilai yang berlaku di Outlet yang dapat Anda akses."
              : "Hanya lihat · Zona waktu dan hari buka/tutup di Outlet yang dapat Anda akses.",
        }))
  const visibleEntries = entries.filter(
    (entry) =>
      entry.href !== "/settings/kiosk-devices" ||
      session?.features.kiosk_enabled === true
  )
  const noScope = !owner && organization?.outlets.length === 0
  return (
    <SidebarProvider className="pb-[calc(6rem+env(safe-area-inset-bottom))] md:pb-0">
      <ManagementSidebar activePage="settings" context={context} />
      <main className="min-w-0 flex-1 bg-canvas">
        <ManagementTopbar context={context} />
        <div className="b1-settings flex flex-col gap-6 p-4 md:p-6">
          <PageHeading
            role={membership ? role : "Ruang kerja"}
            title="Pengaturan"
            description="Pilih bagian untuk membaca pengaturan dan melanjutkan sesuai izin."
          />
          {state !== "ready" ? (
            <ScopeBanner
              title={
                state === "loading"
                  ? "Memuat konteks organisasi…"
                  : state === "denied"
                    ? "Akses manajemen tidak tersedia"
                    : state === "tenant"
                      ? "Pilih organisasi terlebih dahulu"
                      : "Pengaturan belum dapat dimuat"
              }
            >
              {state === "loading" ? (
                "Menyiapkan akses yang sesuai dengan keanggotaan Anda."
              ) : state === "denied" ? (
                <a href="/attendance" className="underline">
                  Kembali ke Presensi
                </a>
              ) : state === "tenant" ? (
                <a href="/select-tenant" className="underline">
                  Pilih organisasi
                </a>
              ) : (
                <Button
                  variant="outline"
                  onClick={() => setAttempt((value) => value + 1)}
                >
                  Coba lagi
                </Button>
              )}
            </ScopeBanner>
          ) : (
            <>
              <ScopeBanner
                title={
                  owner
                    ? "Owner · organisasi aktif"
                    : "Supervisor · Outlet yang dapat Anda akses"
                }
              >
                {owner
                  ? "Buka bagian terlebih dahulu. Perubahan tersedia pada halaman pengelolaan."
                  : "Kebijakan dan kalender tersedia untuk dibaca. Untuk perubahan, hubungi Owner."}
              </ScopeBanner>
              <div className="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,1fr)_304px]">
                <section
                  className="flex min-w-0 flex-col gap-3"
                  aria-labelledby="settings-categories"
                >
                  <h2 id="settings-categories" className="text-subtitle">
                    {owner
                      ? "Konfigurasi organisasi"
                      : "Konfigurasi yang dapat dibaca"}
                  </h2>
                  <div className="overflow-hidden rounded-[16px] border border-border bg-surface">
                    {visibleEntries.map((entry) =>
                      noScope ? (
                        <div
                          key={entry.href}
                          className="border-b border-border p-4 last:border-b-0"
                        >
                          <h3 className="text-label">{entry.title}</h3>
                          <p className="text-caption">
                            Belum ada Outlet yang dapat Anda akses. Hubungi Owner.
                          </p>
                        </div>
                      ) : (
                        <SettingsSection
                          key={entry.href}
                          {...entry} href={fromSettings(entry.href)}
                          icon={<entry.icon size={20} />}
                        />
                      )
                    )}
                  </div>
                </section>
                <section
                  className="flex min-w-0 flex-col gap-3"
                  aria-labelledby="settings-operations"
                >
                  <h2 id="settings-operations" className="text-subtitle">
                    Tetap di Tim dan Jadwal
                  </h2>
                  <div className="overflow-hidden rounded-[16px] border border-border bg-surface">
                    <SettingsSection
                      title="Tim"
                      href="/workspace#people-devices"
                      summary={
                        owner
                          ? session?.features.kiosk_enabled
                            ? "Profil, penempatan dan kode pendaftaran PIN karyawan."
                            : "Profil dan penempatan karyawan."
                          : "Profil dan penempatan di Outlet yang dapat Anda akses · hanya lihat."
                      }
                      icon={<Users size={20} />}
                    />
                    <SettingsSection
                      title="Jadwal"
                      href="/scheduling"
                      summary={
                        owner
                          ? "Jadwal mingguan, pola berulang dan pengecualian karyawan."
                          : "Mingguan, pola berulang dan pengecualian karyawan."
                      }
                      icon={<Calendar size={20} />}
                    />
                    {!owner ? (
                      <>
                        <SettingsSection
                          title="Struktur organisasi yang dapat diakses"
                          href={fromSettings("/settings/organization")}
                          summary="Unit bisnis dan Outlet yang dapat Anda akses · hanya lihat."
                          icon={<Building2 size={20} />}
                        />
                        <SettingsSection
                          title="Template shift"
                          href={fromSettings("/scheduling#shift")}
                          summary="Hanya lihat template shift organisasi untuk penjadwalan."
                          icon={<Layers size={20} />}
                        />
                      </>
                    ) : null}
                  </div>
                  {owner && session?.features.kiosk_enabled ? (
                    <ScopeBanner title="Presensi di perangkat">
                      Kiosk presensi digunakan pada perangkat Outlet. Karyawan
                      mengatur PIN di perangkat tersebut.
                    </ScopeBanner>
                  ) : null}
                </section>
              </div>
            </>
          )}
        </div>
      </main>
    </SidebarProvider>
  )
}
