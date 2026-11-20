import { describe, expect, it } from "vitest"

import {
  attendanceEligibilityCopy,
  canSubmitPersonalRequests,
  type RequestAccess,
  requestEligibilityCopy,
} from "@/lib/personal-eligibility"

describe("personal eligibility guidance", () => {
  it("does not enable requests when the employee link is missing", () => {
    const access: RequestAccess = {
      status: "employee_link_required",
      linked: false,
      can_submit: false,
    }

    expect(canSubmitPersonalRequests(access)).toBe(false)
    expect(requestEligibilityCopy("employee_link_required").title).toBe(
      "Identitas karyawan belum terhubung"
    )
  })

  it("allows request forms from server request eligibility independent of today's schedule", () => {
    const access: RequestAccess = {
      status: "available",
      linked: true,
      can_submit: true,
    }

    expect(canSubmitPersonalRequests(access)).toBe(true)
  })

  it("keeps requests unavailable when the Employee role is missing", () => {
    const access: RequestAccess = {
      status: "employee_role_required",
      linked: true,
      can_submit: false,
    }

    expect(canSubmitPersonalRequests(access)).toBe(false)
    expect(requestEligibilityCopy("employee_role_required").title).toBe(
      "Peran karyawan diperlukan"
    )
  })

  it("uses specific attendance states for assignment and kiosk restrictions", () => {
    expect(attendanceEligibilityCopy("assignment_unavailable")?.title).toBe(
      "Penempatan Outlet belum tersedia"
    )
    expect(attendanceEligibilityCopy("kiosk_only")?.title).toBe(
      "Pencatatan harus melalui kiosk"
    )
    expect(attendanceEligibilityCopy("eligible")).toBeNull()
  })

  it("explains when the Employee role is missing from a linked membership", () => {
    expect(attendanceEligibilityCopy("employee_role_required")?.title).toBe(
      "Peran karyawan diperlukan"
    )
  })
})
