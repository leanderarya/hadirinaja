import { describe, expect, it } from "vitest"
import { documentTitle } from "./document-title"

describe("document titles", () => {
  it("distinguishes operational pages and normalizes trailing slashes", () => {
    const pages = ["/attendance", "/requests", "/approvals", "/kiosk", "/reports", "/reports/attendance", "/reports/audit", "/settings"]
    const titles = pages.map(documentTitle)
    expect(new Set(titles).size).toBe(pages.length)
    expect(documentTitle("/reports/")).toBe(documentTitle("/reports"))
    for (const title of titles) {
      expect(title).toContain("HadirinAja")
      expect(title).not.toContain("\u2014")
    }
    expect(documentTitle("/unknown")).toBe("Halaman tidak ditemukan | HadirinAja")
  })
})
