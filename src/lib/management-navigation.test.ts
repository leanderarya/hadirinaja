import { describe, expect, it } from "vitest"
import {
  getActiveManagementDestination,
  getManagementNavigation,
  getSchedulingSection,
} from "@/lib/management-navigation"

describe("approved management navigation", () => {
  it("keeps the six destinations and maps Team to the real roster", () => {
    const menu = getManagementNavigation(["owner"])
    expect(menu.map((item) => item.label)).toEqual([
      "Ringkasan",
      "Tim",
      "Jadwal",
      "Persetujuan",
      "Laporan",
      "Pengaturan",
    ])
    expect(menu.find((item) => item.id === "team")?.href).toBe(
      "/workspace#people-devices"
    )
    expect(
      menu
        .find((item) => item.id === "reporting")
        ?.children?.map((item) => item.href)
    ).toEqual(["/reports/attendance", "/reports/audit"])
  })

  it("keeps shift Settings Owner-only while preserving the Supervisor operational entry", () => {
    const shiftHref = (role: string) => getManagementNavigation([role]).find(item => item.id === "settings")?.children?.find(item => item.id === "shift")?.href
    expect(shiftHref("owner")).toBe("/settings/shift-templates")
    expect(shiftHref("supervisor")).toBe("/scheduling#shift")
  })

  it("excludes Owner-only settings for Supervisor without hiding readable configuration", () => {
    const settings = getManagementNavigation(["supervisor"]).find(
      (item) => item.id === "settings"
    )
    expect(settings?.children?.map((item) => item.id)).toEqual([
      "shift",
      "kebijakan",
      "kalender",
    ])
    expect(settings?.children?.every((item) => !item.ownerOnly)).toBe(true)
  })

  it("shows kiosk settings only when the feature is enabled", () => {
    const settings = (kioskEnabled: boolean) =>
      getManagementNavigation(["owner"], kioskEnabled)
        .find((item) => item.id === "settings")
        ?.children?.map((item) => item.id)

    expect(settings(false)).not.toContain("kiosk-devices")
    expect(settings(true)).toContain("kiosk-devices")
  })

  it.each([
    [],
    ["employee"],
    ["support"],
  ])("does not create management access for roles %j", (...roles) => {
    expect(getManagementNavigation(roles.flat())).toEqual([])
  })

  it("retains Owner capabilities for multi-role membership without a role switch", () => {
    expect(getManagementNavigation(["employee", "owner"])).toEqual(
      getManagementNavigation(["owner"])
    )
  })

  it("keeps secondary screens from falsely activating a mobile shortcut", () => {
    expect(getActiveManagementDestination("attendance-report")).toBe(
      "reporting"
    )
    expect(getActiveManagementDestination("audit")).toBe("reporting")
    expect(getActiveManagementDestination("workspace", "#organization")).toBe(
      "settings"
    )
    expect(getActiveManagementDestination("workspace", "#people-devices")).toBe(
      "team"
    )
    expect(getActiveManagementDestination("access")).toBe("settings")
  })

  it("deep-links existing scheduling tabs without inventing routes", () => {
    expect(getSchedulingSection("#kalender")).toBe("kalender")
    expect(getSchedulingSection("#unknown")).toBe("jadwal")
    expect(getActiveManagementDestination("scheduling", "#kebijakan")).toBe(
      "settings"
    )
    expect(getActiveManagementDestination("scheduling")).toBe("schedule")
  })
})

describe("B1 landing", () => {
  it("links manager roles to the Settings landing", () => {
    for (const role of ["owner", "supervisor"])
      expect(
        getManagementNavigation([role]).find((item) => item.id === "settings")
          ?.href
      ).toBe("/settings")
    expect(getActiveManagementDestination("settings")).toBe("settings")
  })
})
