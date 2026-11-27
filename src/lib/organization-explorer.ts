import type { OrganizationSummary } from "./api"
import { settingsOrigin } from "./settings-navigation"

function entityId(value: unknown) {
  if (typeof value !== "string" && typeof value !== "number") return undefined
  const id = Number(value)
  return Number.isSafeInteger(id) && id > 0 ? id : undefined
}

export function organizationSearch(search: Record<string, unknown>) {
  return {
    ...settingsOrigin(search),
    unitId: entityId(search.unitId),
    outletId: entityId(search.outletId),
    q: typeof search.q === "string" ? search.q.slice(0, 120) : undefined,
  }
}

export type OrganizationSelection = { unitId?: number; outletId?: number }
export type OrganizationCommand =
  | { kind: "create-unit"; name: string }
  | { kind: "rename-unit"; id: number; name: string }
  | { kind: "create-outlet"; unitId: number; name: string; address: string }
  | { kind: "rename-outlet"; id: number; name: string; address: string }

export function selectedOrganization(
  organization: OrganizationSummary,
  selection: OrganizationSelection
) {
  const outlet = organization.outlets.find(
    (item) => item.id === selection.outletId
  )
  const unit = organization.business_units.find(
    (item) => item.id === (selection.unitId ?? outlet?.business_unit_id)
  )
  const invalid = Boolean(
    (selection.unitId && !unit) ||
      (selection.outletId &&
        (!outlet || !unit || outlet.business_unit_id !== unit.id))
  )
  return {
    unit: invalid ? undefined : unit,
    outlet: invalid ? undefined : outlet,
    invalid,
  }
}

export function organizationUnits(
  organization: OrganizationSummary,
  query = ""
) {
  const search = query.trim().toLocaleLowerCase("id-ID")
  return organization.business_units
    .map((unit) => ({
      ...unit,
      outlets: organization.outlets.filter(
        (outlet) => outlet.business_unit_id === unit.id
      ),
    }))
    .filter(
      (unit) =>
        !search ||
        unit.name.toLocaleLowerCase("id-ID").includes(search) ||
        unit.outlets.some((outlet) =>
          outlet.name.toLocaleLowerCase("id-ID").includes(search)
        )
    )
}
