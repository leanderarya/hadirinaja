import { ShiftTemplateExplorer } from "@/components/r2c/shift-template-explorer"
import type { ShiftTemplate, ShiftSelection } from "@/lib/shift-templates"
import { OrganizationExplorer } from "@/components/r2c/organization-explorer"
import { demoOrganization } from "@/components/ui-kit/organization-fixtures"
import type { OrganizationSummary } from "@/lib/api"
import type { OrganizationSelection } from "@/lib/organization-explorer"
import { useState } from "react"
import { ContextFilterBar } from "@/components/r2c/components"
import {
  ContextDrawer,
  FollowupCard,
  PageHeading,
  ReportSectionNavigation,
  ScopeBanner,
  WorkDateRangeControl,
} from "@/components/r2c/screen-blocks"
import { Button } from "@/components/ui/button"
import { UiKitSection } from "@/components/ui-kit/ui-kit-section"

export function R2cScreensSection() {
  const [shiftSelection, setShiftSelection] = useState<ShiftSelection>({ templateId: 501 })
  const [shiftQuery, setShiftQuery] = useState("")
  const [templates, setTemplates] = useState<ShiftTemplate[]>([{ id: 501, name: "Shift Contoh UI Kit", versions: [{ id: 601, revision: 1, start_time: "09:00", end_time: "17:00", crosses_midnight: false, effective_from: "2000-01-01" }] }])
  const [selection, setSelection] = useState<OrganizationSelection>({})
  const [query, setQuery] = useState("")
  const [organization, setOrganization] = useState<OrganizationSummary>({
    tenant: demoOrganization.tenant,
    roles: ["owner"], employee_count: 0,
    business_units: demoOrganization.businessUnits.map(unit => ({ ...unit })),
    outlets: demoOrganization.outlets.map(outlet => ({ id: outlet.id, name: outlet.name, business_unit_id: outlet.businessUnitId })),
  })
  const [open, setOpen] = useState(false)
  const [range, setRange] = useState({ from: "2026-10-26", to: "2026-10-30" })
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <UiKitSection id="r2c-shift-template-explorer" title="R2C · Shift Template Explorer" importPath="@/components/r2c/shift-template-explorer">
        <ShiftTemplateExplorer compact templates={templates} canManage selection={shiftSelection} query={shiftQuery} onSelect={setShiftSelection} onQuery={setShiftQuery} onDirtyChange={() => {}} onInspect={() => {}} onSave={async command => {
          const id = command.kind === "create" ? Math.max(500, ...templates.map(item => item.id)) + 1 : command.templateId
          const current = templates.find(item => item.id === id)
          const versionId = Math.max(600, ...templates.flatMap(item => item.versions.map(version => version.id))) + 1
          const version = { id: versionId, revision: Math.max(0, ...(current?.versions.map(item => item.revision) ?? [])) + 1, start_time: command.draft.start_time, end_time: command.draft.end_time, crosses_midnight: command.draft.crosses_midnight, effective_from: command.draft.effective_from }
          setTemplates(items => [...items.filter(item => item.id !== id), { id, name: current?.name ?? command.draft.name, versions: [...(current?.versions ?? []), version] }])
          return { templateId: id, versionId }
        }} />
      </UiKitSection>
      <UiKitSection id="r2c-organization-explorer" title="R2C · Organization Explorer" importPath="@/components/r2c/organization-explorer">
        <OrganizationExplorer organization={organization} canManage selection={selection} query={query} onSelect={setSelection} onQuery={setQuery} onDirtyChange={() => {}} onSave={async command => {
          if (command.kind === "create-unit" || command.kind === "rename-unit") {
            const id = command.kind === "rename-unit" ? command.id : Math.max(0, ...organization.business_units.map(unit => unit.id)) + 1
            setOrganization(current => ({ ...current, business_units: [...current.business_units.filter(unit => unit.id !== id), { id, name: command.name }] }))
            return { unitId: id }
          }
          const id = command.kind === "rename-outlet" ? command.id : Math.max(0, ...organization.outlets.map(outlet => outlet.id)) + 1
          const unitId = command.kind === "create-outlet" ? command.unitId : organization.outlets.find(outlet => outlet.id === id)?.business_unit_id
          if (!unitId) throw new Error("Synthetic parent unavailable")
          setOrganization(current => ({ ...current, outlets: [...current.outlets.filter(outlet => outlet.id !== id), { id, name: command.name, business_unit_id: unitId }] }))
          return { unitId, outletId: id }
        }} />
      </UiKitSection>
      <UiKitSection
        id="r2c-page-heading"
        title="R2C · Page heading"
        importPath="@/components/r2c/screen-blocks"
      >
        <PageHeading
          className="min-w-0"
          title="Tim"
          description="Profil karyawan dan penempatan efektif."
          actions={
            <Button onClick={() => setOpen(true)}>Tambah karyawan</Button>
          }
        />
      </UiKitSection>
      <UiKitSection id="r2c-page-heading-minimal" title="R2C · Minimal Settings heading" importPath="@/components/r2c/screen-blocks"><PageHeading minimal title="Template Shift" description="" /></UiKitSection>
      <UiKitSection
        id="r2c-report-navigation"
        title="R2C · Report section navigation"
        importPath="@/components/r2c/screen-blocks"
      >
        <div className="max-w-xl">
          <ReportSectionNavigation active="attendance" />
        </div>
      </UiKitSection>
      <UiKitSection
        id="r2c-scope-banner"
        title="R2C · Scope banner"
        importPath="@/components/r2c/screen-blocks"
      >
        <ScopeBanner title="Tenant aktif · seluruh Outlet">
          Tanggal kerja mengikuti zona lokal setiap Outlet.
        </ScopeBanner>
      </UiKitSection>
      <UiKitSection
        id="r2c-work-date-range"
        title="R2C · Work-date range"
        importPath="@/components/r2c/screen-blocks"
      >
        <ContextFilterBar className="overflow-visible">
          <WorkDateRangeControl {...range} onApply={setRange} />
        </ContextFilterBar>
      </UiKitSection>
      <UiKitSection
        id="r2c-followup-card"
        title="R2C · Operational follow-up"
        importPath="@/components/r2c/screen-blocks"
      >
        <FollowupCard
          items={[
            {
              title: "Tinjauan presensi",
              description: "3 kasus menunggu pemeriksaan",
              href: "/approvals",
              action: "Buka Persetujuan",
            },
          ]}
        />
      </UiKitSection>
      <UiKitSection
        id="r2c-context-drawer"
        title="R2C · Context drawer"
        importPath="@/components/r2c/screen-blocks"
      >
        <Button variant="outline" onClick={() => setOpen(true)}>
          Buka profil sintetis
        </Button>
        <ContextDrawer
          open={open}
          onOpenChange={setOpen}
          title="Profil karyawan"
          description="Nabila Putri · EMP-014"
          footer={
            <Button variant="outline" onClick={() => setOpen(false)}>
              Selesai
            </Button>
          }
        >
          <p className="text-body">Contoh penempatan sintetis</p>
          <p className="text-caption">Demo sintetis tanpa permintaan API.</p>
        </ContextDrawer>
      </UiKitSection>
    </div>
  )
}
