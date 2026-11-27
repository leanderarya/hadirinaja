import { describe, expect, it } from "vitest"
import { canExportAttendanceCsv } from "./reporting-access"

describe("attendance CSV access", () => {
  it("allows Owner and denies Supervisor", () => {
    expect(canExportAttendanceCsv(["owner"])).toBe(true)
    expect(canExportAttendanceCsv(["supervisor"])).toBe(false)
    expect(canExportAttendanceCsv(["employee", "owner"])).toBe(true)
  })
})
