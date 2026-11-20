import { describe, expect, it } from "vitest"

import { ApiError, type TenantMembership } from "@/lib/api"
import {
  type AuthenticatedEntryPath,
  getAuthenticatedEntryPath,
  getAuthRecoveryPath,
} from "@/lib/auth-navigation"

function membership(roles: TenantMembership["roles"]): TenantMembership {
  return {
    id: 1,
    tenant: { id: 1, name: "Contoh" },
    roles,
  }
}

describe("getAuthenticatedEntryPath", () => {
  it("sends accounts without an active organization to organization selection", () => {
    const path: AuthenticatedEntryPath = getAuthenticatedEntryPath(null)

    expect(path).toBe("/select-tenant")
  })

  it.each([
    "owner",
    "supervisor",
  ] as const)("sends %s memberships to the management workspace", (role) => {
    expect(getAuthenticatedEntryPath(membership([role]))).toBe("/workspace")
  })

  it("sends employee-only memberships to personal attendance", () => {
    expect(getAuthenticatedEntryPath(membership(["employee"]))).toBe(
      "/attendance"
    )
  })

  it("prioritizes management access for memberships with multiple roles", () => {
    expect(
      getAuthenticatedEntryPath(membership(["employee", "supervisor"]))
    ).toBe("/workspace")
  })
})

describe("getAuthRecoveryPath", () => {
  it.each([
    401, 419,
  ])("returns the expired-session path for HTTP %i", (status) => {
    expect(getAuthRecoveryPath(new ApiError("Expired", status))).toBe(
      "/login?expired=1"
    )
  })

  it("returns organization selection for an inactive membership", () => {
    expect(
      getAuthRecoveryPath(
        new ApiError("Membership required", 409, "active_membership_required")
      )
    ).toBe("/select-tenant")
  })

  it("leaves other authorization failures for their own handling", () => {
    expect(getAuthRecoveryPath(new ApiError("Forbidden", 403))).toBeNull()
  })
})
