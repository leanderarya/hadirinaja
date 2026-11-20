import { describe, expect, it } from "vitest"
import { policyValueText } from "./policy-presentation"
describe("policy source presentation", () => {
  it("keeps zero and false distinct from unavailable", () => {
    expect(policyValueText(0)).toBe("0")
    expect(policyValueText(false)).toBe("Tidak")
    expect(policyValueText(null)).toBe("Belum tersedia")
  })
  it("labels nested partial overrides without inventing omitted values", () => {
    expect(policyValueText({check_in_window:{early_minutes:0}})).toBe("Rentang presensi masuk: Sebelum mulai (menit): 0")
    expect(policyValueText("hybrid")).toBe("Kiosk dan perangkat pribadi")
  })
})
