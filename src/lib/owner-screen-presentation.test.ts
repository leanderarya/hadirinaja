import { describe, expect, it } from "vitest"
import {
  employeeAccess,
  employeeReference,
  filterRoster,
  formatWorkDateRange,
  validateWorkDateRange,
  workspaceSection,
} from "./owner-screen-presentation"

const employees = [
  {
    id: 14,
    name: "Nabila Putri Ramadhani",
    business_unit_id: 1,
    business_unit_name: "Jakarta",
    outlet_id: 1,
    outlet_name: "Menteng",
  },
  {
    id: 3,
    name: "Arif Rahman",
    business_unit_id: 2,
    business_unit_name: "Bandung",
    outlet_id: 2,
    outlet_name: "Dago",
  },
]

describe("Owner screen presentation", () => {
  it("combines search with organization scope without mutating the source", () => {
    expect(filterRoster(employees, " EMP-014 ", "1", "1")).toEqual([
      employees[0],
    ])
    expect(filterRoster(employees, "nABila", "2", "")).toEqual([])
    expect(filterRoster(employees, "", "", "2")).toEqual([employees[1]])
    expect(employees).toHaveLength(2)
    expect(employeeReference(3)).toBe("EMP-003")
  })
  it("does not present unavailable access data as an invitation opportunity", () => {
    expect(employeeAccess(null).label).toBe("Tidak tersedia")
    expect(employeeAccess("none").action).toBe("Undang")
    expect(employeeAccess("pending").action).toBe("Lihat undangan")
    expect(employeeAccess("revoked").tone).toBe("danger")
    expect(employeeAccess("accepted").label).toBe("Terhubung")
  })
  it("uses the existing settings anchors and defaults to the roster", () => {
    expect(workspaceSection("#organization")).toBe("organization")
    expect(workspaceSection("#kiosk-devices")).toBe("kiosk")
    expect(workspaceSection("#people-devices")).toBe("team")
    expect(workspaceSection("#unknown")).toBe("team")
  })
  it("validates inclusive work dates independent of local timezone", () => {
    expect(validateWorkDateRange("2026-10-01", "2026-10-31")).toBe("")
    expect(validateWorkDateRange("2026-10-01", "2026-11-01")).toBe(
      "Rentang maksimal 31 hari."
    )
    expect(validateWorkDateRange("2026-10-02", "2026-10-01")).toContain(
      "Tanggal akhir"
    )
    expect(validateWorkDateRange("2026-02-30", "2026-03-01")).toContain("valid")
    expect(validateWorkDateRange("", "2026-10-01")).toContain("valid")
    expect(validateWorkDateRange("2028-02-29", "2028-02-29")).toBe("")
  })
  it("formats a same-month range without losing cross-year context", () => {
    expect(formatWorkDateRange("2026-10-26", "2026-10-30")).toBe(
      "26–30 Okt 2026"
    )
    expect(formatWorkDateRange("2026-12-31", "2027-01-01")).toContain("2027")
  })
})
