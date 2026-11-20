import { describe, expect, it } from "vitest"

import { formatAuditTime } from "./audit-time"

describe("formatAuditTime", () => {
  it("treats timezone-less API timestamps as UTC", () => {
    expect(formatAuditTime("2026-10-24 03:03:26")).toBe(
      "24 Okt 2026, 03.03 UTC"
    )
  })

  it("preserves UTC and explicit offset instants", () => {
    expect(formatAuditTime("2026-10-24T03:03:26Z")).toBe(
      "24 Okt 2026, 03.03 UTC"
    )
    expect(formatAuditTime("2026-10-24T10:03:26+07:00")).toBe(
      "24 Okt 2026, 03.03 UTC"
    )
  })

  it("handles date boundaries and invalid input", () => {
    expect(formatAuditTime("2026-10-23T23:30:00-02:00")).toBe(
      "24 Okt 2026, 01.30 UTC"
    )
    expect(formatAuditTime("not-a-date")).toBe("Waktu tidak valid")
    expect(formatAuditTime("")).toBe("Waktu tidak valid")
  })
})
