"use client"

import { useState } from "react"
import { CorrectionEvidencePanel } from "@/components/correction-evidence-panel"
import { CtaSection } from "@/components/cta-section"
import { EmployeeAttendanceClock } from "@/components/employee-attendance-clock"
import { EmployeeAttendanceHistory } from "@/components/employee-attendance-history"
import { EmployeeAttendanceHomeCard } from "@/components/employee-attendance-home-card"
import { EmployeeAttendanceVerificationHeader } from "@/components/employee-attendance-verification-header"
import { EmployeeNavigation, EmployeeTopbar } from "@/components/employee-shell"
import { FacebookIcon } from "@/components/facebook-icon"
import { Footer } from "@/components/footer"
import { Header } from "@/components/header"
import { HeaderMenu } from "@/components/header-menu"
import { HeroSection } from "@/components/hero"
import { InfrastructureSection } from "@/components/infrastructure-section"
import { LinkedinIcon } from "@/components/linkedin-icon"
import { Logo, LogoIcon } from "@/components/logo"
import { LogoCloud } from "@/components/logo-cloud"
import { LogosSection } from "@/components/logos-section"
import {
  ManagementSidebar,
  ManagementTopbar,
  OrganizationSwitcher,
} from "@/components/management-sidebar"
import { MetricsSection } from "@/components/metrics-section"
import { NewsSection } from "@/components/news-section"
import { OutletGeofenceMap } from "@/components/outlet-geofence-map"
import { Portal, PortalBackdrop } from "@/components/portal"
import { PricingSection } from "@/components/pricing-section"
import { SupportSection } from "@/components/support-section"
import { TeamSection } from "@/components/team-section"
import { Button } from "@/components/ui/button"
import { SidebarProvider } from "@/components/ui/sidebar"
import { UiKitSection } from "@/components/ui-kit/ui-kit-section"
import { XIcon } from "@/components/x-icon"
import { YoutubeIcon } from "@/components/youtube-icon"

export function AppComponentsSection() {
  const [portalOpen, setPortalOpen] = useState(false)
  const [mapPoint, setMapPoint] = useState({
    latitude: -6.2,
    longitude: 106.816666,
  })
  const [demoOutletId, setDemoOutletId] = useState<number | null>(null)

  return (
    <div className="flex flex-col gap-6">
      <UiKitSection
        id="outlet-geofence-map"
        importPath="@/components/outlet-geofence-map"
        title="Outlet Geofence Map"
      >
        <p className="text-body">
          Demo lokasi sintetis, tanpa penyimpanan API. Kontrol zoom memiliki
          target 44 × 44 px dan dapat digunakan dengan keyboard.
        </p>
        <OutletGeofenceMap
          {...mapPoint}
          radiusMeters={100}
          outletName="Outlet contoh"
          onChange={setMapPoint}
        />
      </UiKitSection>
      <UiKitSection
        id="management-topbar"
        title="Management Topbar · R2C"
        importPath="@/components/management-sidebar"
      >
        <SidebarProvider className="min-h-0">
          <div className="w-full">
            <ManagementTopbar
              context={{ tenantName: "Uji HadirinAja", roles: ["owner"] }}
              onLogout={() => undefined}
            />
          </div>
        </SidebarProvider>
      </UiKitSection>
      <UiKitSection
        id="organization-switcher"
        title="Organization Switcher · R2C"
        importPath="@/components/management-sidebar"
      >
        <div className="max-w-[248px]">
          <OrganizationSwitcher tenantName="Uji HadirinAja" />
        </div>
      </UiKitSection>
      <UiKitSection
        id="employee-navigation"
        importPath="@/components/employee-shell"
        title="Employee Navigation"
      >
        <div className="employee-navigation employee-navigation-demo">
          <EmployeeNavigation active="profile" />
        </div>
      </UiKitSection>
      <UiKitSection
        id="employee-topbar"
        importPath="@/components/employee-shell"
        title="Employee Top Bar"
      >
        <EmployeeTopbar
          accountName="Rani Karyawan"
          outletContext={{
            outlets: [{ id: 1, name: "Outlet Menteng" }],
            selectedOutletId: 1,
          }}
        />
        <EmployeeTopbar
          accountName="Rani Karyawan"
          outletContext={{
            outlets: [
              { id: 1, name: "Outlet Menteng" },
              { id: 2, name: "Outlet Kemang" },
            ],
            selectedOutletId: demoOutletId,
            onChange: setDemoOutletId,
          }}
        />
      </UiKitSection>
      <UiKitSection
        id="correction-evidence-panel"
        title="Correction Evidence"
        importPath="@/components/correction-evidence-panel"
      >
        <p className="text-body">
          Lampiran tetap opsional. Pada permintaan yang dapat diakses, tindakan
          bukti dan pembuka permintaan bukti tambahan memiliki target minimal 44
          × 44 px.
        </p>
        <CorrectionEvidencePanel
          preview={{
            files: [
              {
                id: 1,
                mime_type: "application/pdf",
                size_bytes: 4096,
                available: true,
                hold_state: "held",
                expires_at: "2027-01-01",
                decision_id: null,
              },
            ],
            supplement: {
              reason: "Lampirkan catatan waktu kerja.",
              satisfied: false,
            },
          }}
        />
      </UiKitSection>
      <UiKitSection
        id="employee-attendance-home-card"
        importPath="@/components/employee-attendance-home-card"
        title="Employee Attendance Home Card"
      >
        <EmployeeAttendanceHomeCard
          state="working"
          greeting="Selamat pagi, Rani"
          duration="5 j 23 m"
          checkInTime="08.05"
          timeRange={null}
          canCheckIn={false}
          canCheckOut
          onCheckIn={() => undefined}
          onCheckOut={() => undefined}
        />
      </UiKitSection>
      <UiKitSection
        id="employee-attendance-verification-header"
        importPath="@/components/employee-attendance-verification-header"
        title="Employee Attendance Verification Header"
      >
        <EmployeeAttendanceVerificationHeader
          title="Absen masuk"
          onBack={() => undefined}
        />
      </UiKitSection>
      <UiKitSection
        id="employee-attendance-history"
        importPath="@/components/employee-attendance-history"
        title="Employee Attendance History"
      >
        <p className="text-body">
          Contoh sintetis dua sesi dalam urutan waktu pada satu Work Date.
        </p>
        <EmployeeAttendanceHistory
          id="history-demo"
          days={[
            {
              work_date: "2026-11-05",
              outcome: "present",
              sessions: [
                {
                  id: 1,
                  recording_status: "closed",
                  outlet: { id: 1, name: "Outlet contoh" },
                  original: {
                    work_date: "2026-11-05",
                    check_in_at: "2026-11-05T01:00:00Z",
                    check_out_at: "2026-11-05T05:00:00Z",
                  },
                  effective: {
                    work_date: "2026-11-05",
                    check_in_at: "2026-11-05T01:00:00Z",
                    check_out_at: "2026-11-05T05:00:00Z",
                  },
                  schedule_snapshot: { timezone: "Asia/Jakarta" },
                  review_indicators: [],
                  correction: null,
                  checkout_destination: {
                    id: 1,
                    name: "Outlet contoh",
                    timezone: "Asia/Jakarta",
                  },
                  evidence: [
                    {
                      event_id: 1,
                      type: "check_in",
                      available: false,
                      expires_at: "2026-11-05T12:00:00Z",
                    },
                  ],
                },
                {
                  id: 2,
                  recording_status: "closed",
                  outlet: { id: 2, name: "Outlet tujuan contoh" },
                  original: {
                    outlet_id: 2,
                    outlet: { id: 2, name: "Outlet tujuan contoh" },
                    work_date: "2026-11-05",
                    check_in_at: "2026-11-05T06:00:00Z",
                    check_out_at: "2026-11-05T09:00:00Z",
                  },
                  effective: {
                    work_date: "2026-11-05",
                    check_in_at: "2026-11-05T06:00:00Z",
                    check_out_at: "2026-11-05T09:00:00Z",
                  },
                  schedule_snapshot: { timezone: "Asia/Makassar" },
                  review_indicators: [],
                  correction: null,
                  checkout_destination: {
                    id: 2,
                    name: "Outlet tujuan contoh",
                    timezone: "Asia/Makassar",
                  },
                  evidence: [
                    {
                      event_id: 2,
                      type: "check_in",
                      available: false,
                      expires_at: "2026-11-05T12:00:00Z",
                    },
                  ],
                },
              ],
              review: { status: "none", indicators: [] },
              unresolved_conflicts: [],
              is_finalized: false,
            },
          ]}
          currentWorkDate="2026-11-05"
        />
      </UiKitSection>
      <UiKitSection
        id="employee-attendance-clock"
        importPath="@/components/employee-attendance-clock"
        title="Employee Attendance Clock"
      >
        <p className="text-body">
          Jam berjalan mengikuti zona waktu Outlet yang diberikan; zona waktu
          perangkat ditampilkan sebagai fallback.
        </p>
        <EmployeeAttendanceClock outletTimeZone="Asia/Jakarta" />
      </UiKitSection>
      <UiKitSection id="logo" importPath="@/components/logo" title="Logo">
        <div className="flex flex-wrap items-end gap-8">
          <div className="flex flex-col gap-2">
            <Logo className="size-6" />
            <p className="text-muted-foreground text-xs">Logo</p>
          </div>
          <div className="flex flex-col gap-2">
            <LogoIcon className="size-8" />
            <p className="text-muted-foreground text-xs">LogoIcon</p>
          </div>
        </div>
      </UiKitSection>

      <UiKitSection id="header" importPath="@/components/header" title="Header">
        <div className="relative overflow-hidden rounded-xl border bg-muted/30 py-4">
          <Header />
        </div>
      </UiKitSection>

      <UiKitSection
        id="header-menu"
        importPath="@/components/header-menu"
        title="Header Menu"
      >
        <div className="flex justify-end">
          <HeaderMenu />
        </div>
      </UiKitSection>

      <UiKitSection
        className="overflow-hidden p-0"
        id="hero"
        importPath="@/components/hero"
        title="Hero"
      >
        <div className="max-h-[600px] overflow-y-auto">
          <HeroSection />
        </div>
      </UiKitSection>

      <UiKitSection
        id="logos-section"
        importPath="@/components/logos-section"
        title="Logos Section"
      >
        <LogosSection />
      </UiKitSection>

      <UiKitSection
        id="logo-cloud"
        importPath="@/components/logo-cloud"
        title="Logo Cloud"
      >
        <LogoCloud />
      </UiKitSection>

      <UiKitSection id="portal" importPath="@/components/portal" title="Portal">
        <div className="flex flex-col gap-3">
          <p className="text-muted-foreground text-sm">
            Opens a full-screen portal and locks body scroll while mounted.
          </p>
          <Button onClick={() => setPortalOpen(true)}>Open portal</Button>
          {portalOpen ? (
            <Portal>
              <PortalBackdrop />
              <div className="flex flex-1 flex-col items-center justify-center gap-4 p-6">
                <p className="font-medium text-lg">Portal content</p>
                <Button onClick={() => setPortalOpen(false)}>Close</Button>
              </div>
            </Portal>
          ) : null}
        </div>
      </UiKitSection>

      <UiKitSection
        id="management-topbar-compact"
        title="Management topbar · Settings return"
        importPath="@/components/management-sidebar"
      >
        <SidebarProvider className="min-h-0">
          <div className="min-w-0 w-full">
            <ManagementTopbar
              settingsBack
              context={{ tenantName: "Organisasi Contoh", roles: ["owner"] }}
            />
          </div>
        </SidebarProvider>
      </UiKitSection>

      <UiKitSection
        id="management-sidebar"
        importPath="@/components/management-sidebar"
        title="Management Sidebar"
      >
        <SidebarProvider>
          <div className="flex min-h-[320px] w-full overflow-hidden rounded-xl border">
            <ManagementSidebar
              activePage="scheduling"
              preview
              context={{ tenantName: "Uji HadirinAja", roles: ["owner"] }}
            />
            <div className="flex flex-1 items-center justify-center p-4 text-body text-muted-foreground">
              Area konten portal
            </div>
          </div>
        </SidebarProvider>
      </UiKitSection>

      <UiKitSection
        id="social-icons"
        importPath="@/components/*-icon"
        title="Social Icons"
      >
        <div className="flex flex-wrap gap-4">
          <FacebookIcon className="size-6" />
          <LinkedinIcon className="size-6" />
          <XIcon className="size-6" />
          <YoutubeIcon className="size-6" />
        </div>
      </UiKitSection>

      <UiKitSection
        id="metrics-section"
        importPath="@/components/metrics-section"
        title="Metrics Section"
      >
        <MetricsSection />
      </UiKitSection>

      <UiKitSection
        id="team-section"
        importPath="@/components/team-section"
        title="Team Section"
      >
        <TeamSection />
      </UiKitSection>

      <UiKitSection
        id="news-section"
        importPath="@/components/news-section"
        title="News Section"
      >
        <NewsSection />
      </UiKitSection>

      <UiKitSection
        id="pricing-section"
        importPath="@/components/pricing-section"
        title="Pricing Section"
      >
        <PricingSection />
      </UiKitSection>

      <UiKitSection
        id="cta-section"
        importPath="@/components/cta-section"
        title="CTA Section"
      >
        <CtaSection />
      </UiKitSection>

      <UiKitSection
        id="support-section"
        importPath="@/components/support-section"
        title="Support Section"
      >
        <SupportSection />
      </UiKitSection>

      <UiKitSection
        id="infrastructure-section"
        importPath="@/components/infrastructure-section"
        title="Infrastructure Section"
      >
        <InfrastructureSection />
      </UiKitSection>

      <UiKitSection id="footer" importPath="@/components/footer" title="Footer">
        <Footer />
      </UiKitSection>
    </div>
  )
}
