import { describe, expect, it } from "vitest"
import {
  organizationSearch,
  organizationUnits,
  selectedOrganization,
} from "./organization-explorer"
import type { OrganizationSummary } from "./api"

const data: OrganizationSummary = {
  tenant: { id: 1, name: "Synthetic" },
  roles: ["owner"],
  employee_count: 0,
  business_units: [
    { id: 11, name: "Unit A" },
    { id: 12, name: "Unit B" },
  ],
  outlets: [
    { id: 21, name: "Karangawen", address: null, business_unit_id: 11 },
    { id: 22, name: "Karangawen", address: null, business_unit_id: 12 },
  ],
}

describe("Organization Explorer URL and scope boundaries", () => {
  it("accepts only positive safe IDs and a fixed Settings origin", () => {
    for (const id of [0, -1, "1.2", "no", [11], Number.MAX_SAFE_INTEGER + 1])
      expect(organizationSearch({ unitId: id }).unitId).toBeUndefined()
    expect(
      organizationSearch({ from: "https://evil.test", outletId: "21" })
    ).toMatchObject({ from: undefined, outletId: 21 })
    expect(
      organizationSearch({ from: "settings", unitId: "11", q: "x".repeat(200) })
    ).toMatchObject({ from: "settings", unitId: 11, q: "x".repeat(120) })
  })
  it("rejects unknown or mismatched parent selections instead of exposing another unit", () => {
    expect(
      selectedOrganization(data, { unitId: 11, outletId: 22 })
    ).toMatchObject({ invalid: true, unit: undefined, outlet: undefined })
    expect(selectedOrganization(data, { outletId: 99 }).invalid).toBe(true)
    expect(selectedOrganization(data, { outletId: 22 }).unit?.id).toBe(12)
    const scoped = {
      ...data,
      business_units: data.business_units.slice(0, 1),
      outlets: data.outlets.slice(0, 1),
    }
    expect(selectedOrganization(scoped, { outletId: 22 }).invalid).toBe(true)
  })
  it("derives counts and searches across unit and Outlet names without conflating duplicate localities", () => {
    expect(
      organizationUnits(data, "karangawen").map((unit) => [
        unit.id,
        unit.outlets.length,
      ])
    ).toEqual([
      [11, 1],
      [12, 1],
    ])
    expect(organizationUnits(data, "UNIT B").map((unit) => unit.id)).toEqual([
      12,
    ])
    expect(organizationUnits(data, "missing")).toEqual([])
  })
})
