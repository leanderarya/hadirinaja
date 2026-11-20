import { r2cComponents } from "@/components/r2c/catalog"

export type CatalogItem = {
  id: string
  label: string
  importPath: string
}

export type CatalogCategory = {
  id: string
  label: string
  items: CatalogItem[]
}

export const catalogCategories: CatalogCategory[] = [
  { id: "r2c-operations", label: "R2C · Slice 02B", items: [
    { id: "weekly-planner-board", label: "Weekly planner board", importPath: "@/components/weekly-planner-board" },
    { id: "r2c-work-week", label: "Work-week control", importPath: "@/components/r2c/operational-blocks" },
    { id: "r2c-schedule-matrix", label: "Weekly schedule matrix", importPath: "@/components/r2c/operational-blocks" },
    { id: "r2c-operation-summary", label: "Read-first operational summary", importPath: "@/components/r2c/operational-blocks" },
  ] },
  { id: "r2c-screens", label: "R2C · Slice 02A", items: [
    { id: "r2c-shift-template-explorer", label: "Shift Template Explorer", importPath: "@/components/r2c/shift-template-explorer" },
    { id: "r2c-organization-explorer", label: "Organization Explorer", importPath: "@/components/r2c/organization-explorer" },
    { id: "r2c-page-heading-minimal", label: "Minimal Settings heading", importPath: "@/components/r2c/screen-blocks" },
    { id: "r2c-page-heading", label: "Page heading", importPath: "@/components/r2c/screen-blocks" },
    { id: "r2c-report-navigation", label: "Report section navigation", importPath: "@/components/r2c/screen-blocks" },
    { id: "r2c-scope-banner", label: "Scope banner", importPath: "@/components/r2c/screen-blocks" },
    { id: "r2c-work-date-range", label: "Work-date range", importPath: "@/components/r2c/screen-blocks" },
    { id: "r2c-followup-card", label: "Operational follow-up", importPath: "@/components/r2c/screen-blocks" },
    { id: "r2c-context-drawer", label: "Context drawer", importPath: "@/components/r2c/screen-blocks" },
  ] },
  { id: "r2c", label: "R2C · Slice 01", items: r2cComponents.map(({ id, label, importPath }) => ({ id, label: id === "r2c-settings" ? "Read-first settings section · optional icon (B1)" : label, importPath })) },
  {
    id: "tokens",
    label: "Design Tokens",
    items: [
      {
        id: "colors",
        label: "Colors",
        importPath: "src/styles.css",
      },
      {
        id: "typography",
        label: "Typography",
        importPath: "src/styles.css",
      },
      {
        id: "radius",
        label: "Radius",
        importPath: "src/styles.css",
      },
      {
        id: "spacing",
        label: "Spacing",
        importPath: "src/styles.css",
      },
      {
        id: "shadows",
        label: "Shadows",
        importPath: "src/styles.css",
      },
      {
        id: "motion",
        label: "Motion",
        importPath: "src/styles.css",
      },
      {
        id: "logo-tokens",
        label: "Logo Tokens",
        importPath: "src/styles.css",
      },
    ],
  },
  {
    id: "app",
    label: "App Components",
    items: [
      { id: "outlet-geofence-map", label: "Outlet Geofence Map · 44px zoom controls", importPath: "@/components/outlet-geofence-map" },
      { id: "management-topbar-compact", label: "Settings topbar return", importPath: "@/components/management-sidebar" },
      { id: "management-topbar", label: "Management Topbar · R2C", importPath: "@/components/management-sidebar" },
      { id: "organization-switcher", label: "Organization Switcher · R2C", importPath: "@/components/management-sidebar" },
      { id: "logo", label: "Logo", importPath: "@/components/logo" },
      { id: "header", label: "Header", importPath: "@/components/header" },
      {
        id: "header-menu",
        label: "Header Menu",
        importPath: "@/components/header-menu",
      },
      { id: "hero", label: "Hero", importPath: "@/components/hero" },
      {
        id: "logos-section",
        label: "Logos Section",
        importPath: "@/components/logos-section",
      },
      {
        id: "logo-cloud",
        label: "Logo Cloud",
        importPath: "@/components/logo-cloud",
      },
      { id: "portal", label: "Portal", importPath: "@/components/portal" },
      {
        id: "employee-navigation",
        label: "Employee Navigation",
        importPath: "@/components/employee-shell",
      },
      {
        id: "employee-navigation-attendance",
        label: "Employee Navigation · Hari Ini",
        importPath: "@/components/employee-shell",
      },
      {
        id: "employee-topbar",
        label: "Employee Top Bar",
        importPath: "@/components/employee-shell",
      },
      {
        id: "employee-topbar-attendance",
        label: "Employee Top Bar · Hari Ini",
        importPath: "@/components/employee-shell",
      },
      {
        id: "correction-evidence-panel",
        label: "Correction Evidence · 44px actions",
        importPath: "@/components/correction-evidence-panel",
      },
      {
        id: "employee-attendance-history",
        label: "Employee Attendance History · Sessions, evidence & corrections",
        importPath: "@/components/employee-attendance-history",
      },
      {
        id: "employee-attendance-clock",
        label: "Employee Attendance Clock · Outlet timezone",
        importPath: "@/components/employee-attendance-clock",
      },
      {
        id: "roam-button",
        label: "Roam Button · WBM9u primary / secondary / danger",
        importPath: "@/components/roam/roam-button",
      },
      {
        id: "roam-step-trail",
        label: "Roam Step Trail · WLYnJ three steps",
        importPath: "@/components/roam/roam-step-trail",
      },
      {
        id: "roam-status-card",
        label: "Roam Status Card · QihdH pastel status surface",
        importPath: "@/components/roam/roam-status-card",
      },
      {
        id: "roam-status-message",
        label: "Roam Status Message · esTPz inline tone",
        importPath: "@/components/roam/roam-status-message",
      },
      {
        id: "attendance-confirmation-summary",
        label: "Attendance Confirmation Summary · uqxF6",
        importPath: "@/components/attendance/attendance-confirmation-summary",
      },
      {
        id: "attendance-recovery-list",
        label: "Attendance Recovery List · outside-card recovery",
        importPath: "@/components/attendance/attendance-recovery-list",
      },
      {
        id: "attendance-step-heading",
        label: "Attendance Step Heading · 22/700 title",
        importPath: "@/components/attendance/attendance-step-heading",
      },
      {
        id: "attendance-location-step",
        label: "Attendance Location Step",
        importPath: "@/components/attendance/attendance-location-step",
      },
      {
        id: "attendance-result-step",
        label: "Attendance Result Step",
        importPath: "@/components/attendance/attendance-result-step",
      },
      {
        id: "management-sidebar",
        label: "Management Sidebar",
        importPath: "@/components/management-sidebar",
      },
      {
        id: "owner-mobile-navigation",
        label: "Owner Mobile Navigation",
        importPath: "@/components/management-sidebar",
      },
      {
        id: "social-icons",
        label: "Social Icons",
        importPath: "@/components/*-icon",
      },
      {
        id: "metrics-section",
        label: "Metrics Section",
        importPath: "@/components/metrics-section",
      },
      {
        id: "team-section",
        label: "Team Section",
        importPath: "@/components/team-section",
      },
      {
        id: "news-section",
        label: "News Section",
        importPath: "@/components/news-section",
      },
      {
        id: "pricing-section",
        label: "Pricing Section",
        importPath: "@/components/pricing-section",
      },
      {
        id: "cta-section",
        label: "CTA Section",
        importPath: "@/components/cta-section",
      },
      {
        id: "support-section",
        label: "Support Section",
        importPath: "@/components/support-section",
      },
      {
        id: "infrastructure-section",
        label: "Infrastructure Section",
        importPath: "@/components/infrastructure-section",
      },
      {
        id: "footer",
        label: "Footer",
        importPath: "@/components/footer",
      },
    ],
  },
  {
    id: "actions",
    label: "Actions",
    items: [
      {
        id: "accordion",
        label: "Accordion",
        importPath: "@/components/ui/accordion",
      },
      {
        id: "alert-dialog",
        label: "Alert Dialog",
        importPath: "@/components/ui/alert-dialog",
      },
      { id: "badge", label: "Status Badge · Pen", importPath: "@/components/ui/badge" },
      { id: "button", label: "Button · Pen foundation", importPath: "@/components/ui/button" },
      { id: "button-attendance", label: "Button · Hari Ini", importPath: "@/components/ui/button" },
      {
        id: "button-group",
        label: "Button Group",
        importPath: "@/components/ui/button-group",
      },
      { id: "toggle", label: "Toggle", importPath: "@/components/ui/toggle" },
      {
        id: "toggle-group",
        label: "Toggle Group",
        importPath: "@/components/ui/toggle-group",
      },
    ],
  },
  {
    id: "forms",
    label: "Forms",
    items: [
      {
        id: "calendar",
        label: "Calendar",
        importPath: "@/components/ui/calendar",
      },
      {
        id: "checkbox",
        label: "Checkbox",
        importPath: "@/components/ui/checkbox",
      },
      {
        id: "combobox",
        label: "Combobox",
        importPath: "@/components/ui/combobox",
      },
      { id: "field", label: "Field", importPath: "@/components/ui/field" },
      { id: "input", label: "Input · Pen control", importPath: "@/components/ui/input" },
      {
        id: "input-group",
        label: "Input Group",
        importPath: "@/components/ui/input-group",
      },
      {
        id: "input-otp",
        label: "Input OTP",
        importPath: "@/components/ui/input-otp",
      },
      { id: "label", label: "Label", importPath: "@/components/ui/label" },
      {
        id: "native-select",
        label: "Native Select",
        importPath: "@/components/ui/native-select",
      },
      {
        id: "radio-group",
        label: "Radio Group",
        importPath: "@/components/ui/radio-group",
      },
      { id: "select", label: "Select", importPath: "@/components/ui/select" },
      { id: "slider", label: "Slider", importPath: "@/components/ui/slider" },
      { id: "switch", label: "Switch", importPath: "@/components/ui/switch" },
      {
        id: "textarea",
        label: "Textarea",
        importPath: "@/components/ui/textarea",
      },
    ],
  },
  {
    id: "feedback",
    label: "Feedback",
    items: [
      { id: "alert", label: "Alert", importPath: "@/components/ui/alert" },
      { id: "empty", label: "Empty", importPath: "@/components/ui/empty" },
      { id: "kbd", label: "Kbd", importPath: "@/components/ui/kbd" },
      {
        id: "progress",
        label: "Progress",
        importPath: "@/components/ui/progress",
      },
      {
        id: "skeleton",
        label: "Skeleton",
        importPath: "@/components/ui/skeleton",
      },
      {
        id: "spinner",
        label: "Spinner",
        importPath: "@/components/ui/spinner",
      },
      { id: "sonner", label: "Sonner", importPath: "@/components/ui/sonner" },
    ],
  },
  {
    id: "overlays",
    label: "Overlays",
    items: [
      {
        id: "command",
        label: "Command",
        importPath: "@/components/ui/command",
      },
      {
        id: "context-menu",
        label: "Context Menu",
        importPath: "@/components/ui/context-menu",
      },
      { id: "dialog", label: "Dialog", importPath: "@/components/ui/dialog" },
      { id: "drawer", label: "Drawer", importPath: "@/components/ui/drawer" },
      {
        id: "dropdown-menu",
        label: "Dropdown Menu",
        importPath: "@/components/ui/dropdown-menu",
      },
      {
        id: "hover-card",
        label: "Hover Card",
        importPath: "@/components/ui/hover-card",
      },
      {
        id: "popover",
        label: "Popover",
        importPath: "@/components/ui/popover",
      },
      { id: "sheet", label: "Sheet", importPath: "@/components/ui/sheet" },
      {
        id: "tooltip",
        label: "Tooltip",
        importPath: "@/components/ui/tooltip",
      },
    ],
  },
  {
    id: "navigation",
    label: "Navigation",
    items: [
      {
        id: "breadcrumb",
        label: "Breadcrumb",
        importPath: "@/components/ui/breadcrumb",
      },
      {
        id: "menubar",
        label: "Menubar",
        importPath: "@/components/ui/menubar",
      },
      {
        id: "navigation-menu",
        label: "Navigation Menu",
        importPath: "@/components/ui/navigation-menu",
      },
      {
        id: "pagination",
        label: "Pagination",
        importPath: "@/components/ui/pagination",
      },
      {
        id: "sidebar",
        label: "Sidebar",
        importPath: "@/components/ui/sidebar",
      },
      { id: "tabs", label: "Tabs · keyboard panel focus", importPath: "@/components/ui/tabs" },
    ],
  },
  {
    id: "data-display",
    label: "Data Display",
    items: [
      {
        id: "aspect-ratio",
        label: "Aspect Ratio",
        importPath: "@/components/ui/aspect-ratio",
      },
      { id: "avatar", label: "Avatar", importPath: "@/components/ui/avatar" },
      { id: "card", label: "Surface Card · Pen", importPath: "@/components/ui/card" },
      {
        id: "carousel",
        label: "Carousel",
        importPath: "@/components/ui/carousel",
      },
      { id: "chart", label: "Chart", importPath: "@/components/ui/chart" },
      {
        id: "collapsible",
        label: "Collapsible",
        importPath: "@/components/ui/collapsible",
      },
      { id: "item", label: "Item", importPath: "@/components/ui/item" },
      {
        id: "scroll-area",
        label: "Scroll Area",
        importPath: "@/components/ui/scroll-area",
      },
      {
        id: "separator",
        label: "Separator",
        importPath: "@/components/ui/separator",
      },
      { id: "table", label: "Table", importPath: "@/components/ui/table" },
    ],
  },
  {
    id: "layout",
    label: "Layout",
    items: [
      {
        id: "direction",
        label: "Direction",
        importPath: "@/components/ui/direction",
      },
      {
        id: "resizable",
        label: "Resizable",
        importPath: "@/components/ui/resizable",
      },
    ],
  },
]
