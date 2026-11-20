import { describe, expect, it } from "vitest"
import { fromSettings, settingsOrigin } from "./settings-navigation"
describe("Settings navigation context", () => {
  it("accepts only the explicit fixed origin", () => {
    expect(settingsOrigin({from:"settings"}).from).toBe("settings")
    for (const from of ["https://evil.test", "//evil.test", ["settings"], undefined, "workspace"]) expect(settingsOrigin({from}).from).toBeUndefined()
  })
  it("preserves employee and hash context", () => {
    expect(fromSettings("/settings/organization?unitId=201&outletId=301")).toBe("/settings/organization?unitId=201&outletId=301&from=settings")
    expect(fromSettings("/settings/shift-templates?templateId=501&versionId=601")).toBe("/settings/shift-templates?templateId=501&versionId=601&from=settings")
    expect(fromSettings("/access?employeeId=42")).toBe("/access?employeeId=42&from=settings")
    expect(fromSettings("/workspace#kiosk-devices")).toBe("/workspace?from=settings#kiosk-devices")
    expect(fromSettings("/scheduling#kalender")).toBe("/scheduling?from=settings#kalender")
    expect(fromSettings("https://evil.test/access")).toBe("https://evil.test/access")
  })
})
