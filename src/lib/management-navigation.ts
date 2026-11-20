import {
  Building2,
  Calendar,
  CalendarDays,
  ClipboardCheck,
  FileChartColumn,
  FileText,
  History,
  Layers,
  LayoutDashboard,
  Monitor,
  Settings2,
  Shield,
  ShieldCheck,
  Users,
  type LucideIcon,
} from "lucide-react"

export type ManagementPage =
  | "workspace"
  | "access"
  | "scheduling"
  | "approvals"
  | "reports"
  | "attendance-report"
  | "audit"
  | "settings"
export type ManagementDestination =
  | "overview"
  | "team"
  | "schedule"
  | "requests"
  | "reporting"
  | "settings"

export interface ManagementNavigationContext {
  tenantName: string
  roles: readonly string[]
  userName?: string
}

export interface ManagementNavigationItem {
  id: string
  label: string
  icon: LucideIcon
  href?: string
  ownerOnly?: boolean
  children?: readonly ManagementNavigationItem[]
}

const destinations: readonly ManagementNavigationItem[] = [
  {
    id: "overview",
    label: "Ringkasan",
    href: "/reports",
    icon: LayoutDashboard,
  },
  { id: "team", label: "Tim", href: "/workspace#people-devices", icon: Users },
  { id: "schedule", label: "Jadwal", href: "/scheduling", icon: Calendar },
  {
    id: "requests",
    label: "Persetujuan",
    href: "/approvals",
    icon: ClipboardCheck,
  },
  {
    id: "reporting",
    label: "Laporan",
    icon: FileChartColumn,
    children: [
      {
        id: "attendance-report",
        label: "Kehadiran",
        href: "/reports/attendance",
        icon: FileText,
      },
      { id: "audit", label: "Audit", href: "/reports/audit", icon: History },
    ],
  },
  {
    id: "settings",
    href: "/settings",
    label: "Pengaturan",
    icon: Settings2,
    children: [
      {
        id: "organization",
        label: "Unit bisnis dan Outlet",
        href: "/settings/organization",
        icon: Building2,
        ownerOnly: true,
      },
      {
        id: "access",
        label: "Akses pengguna",
        href: "/access",
        icon: ShieldCheck,
        ownerOnly: true,
      },
      {
        id: "shift",
        label: "Template shift",
        href: "/scheduling#shift",
        icon: Layers,
      },
      {
        id: "kebijakan",
        label: "Kebijakan presensi",
        href: "/scheduling#kebijakan",
        icon: Shield,
      },
      {
        id: "kalender",
        label: "Kalender Outlet",
        href: "/scheduling#kalender",
        icon: CalendarDays,
      },
      {
        id: "kiosk-devices",
        label: "Kiosk dan perangkat",
        href: "/workspace#kiosk-devices",
        icon: Monitor,
        ownerOnly: true,
      },
    ],
  },
]

export function getManagementNavigation(roles: readonly string[]) {
  const owner = roles.includes("owner")
  if (!owner && !roles.includes("supervisor")) return []
  return destinations.map((item) => ({
    ...item,
    children: item.children?.filter((child) => !child.ownerOnly || owner).map((child) => child.id === "shift" && owner ? { ...child, href: "/settings/shift-templates" } : child),
  }))
}

export function getSchedulingSection(hash: string) {
  const section = hash.replace(/^#/, "")
  return ["jadwal", "shift", "kebijakan", "kalender"].includes(section)
    ? section
    : "jadwal"
}

export function getActiveManagementDestination(
  page: ManagementPage,
  hash = ""
): ManagementDestination {
  if (page === "settings" || page === "access") return "settings"
  if (page === "workspace")
    return ["#organization", "#kiosk-devices"].includes(hash)
      ? "settings"
      : "team"
  if (page === "scheduling")
    return getSchedulingSection(hash) === "jadwal" ? "schedule" : "settings"
  if (page === "approvals") return "requests"
  if (page === "reports") return "overview"
  return "reporting"
}
