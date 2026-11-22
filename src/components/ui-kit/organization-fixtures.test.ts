import { describe, expect, it } from "vitest"
import { demoOrganization, demoOutletLabel } from "./organization-fixtures"

describe("UI Kit organization fixture", () => {
  it("keeps its synthetic tenant separate from persistent organization data", () => {
    expect(demoOrganization.tenant).toEqual({
      id: 901,
      name: "Tenant Demo UI Kit",
    })
  })

  it("represents the two business units and five distinct outlets", () => {
    expect(demoOrganization.businessUnits.map(({ name }) => name)).toEqual([
      "Kopi Kelana",
      "Teh Sejuk",
    ])
    expect(demoOrganization.outlets).toHaveLength(5)
    expect(new Set(demoOrganization.outlets.map(({ id }) => id)).size).toBe(5)
    expect(
      new Set(
        demoOrganization.outlets.map(({ businessUnitId }) => businessUnitId)
      )
    ).toEqual(new Set([201, 202]))
    expect(
      demoOrganization.outlets.filter(
        ({ businessUnitId }) => businessUnitId === 201
      )
    ).toHaveLength(2)
    expect(
      demoOrganization.outlets.filter(
        ({ businessUnitId }) => businessUnitId === 202
      )
    ).toHaveLength(3)
  })

  it("keeps outlets with the same locality distinguishable by business unit", () => {
    expect(demoOrganization.outlets.map(demoOutletLabel)).toContain(
      "Kopi Kelana · Kopi Kelana Cendana"
    )
    expect(demoOrganization.outlets.map(demoOutletLabel)).toContain(
      "Teh Sejuk · Teh Sejuk Cendana"
    )
    expect(demoOrganization.outlets.map(demoOutletLabel)).toContain(
      "Kopi Kelana · Kopi Kelana Mawar"
    )
    expect(demoOrganization.outlets.map(demoOutletLabel)).toContain(
      "Teh Sejuk · Teh Sejuk Mawar"
    )
  })
})
