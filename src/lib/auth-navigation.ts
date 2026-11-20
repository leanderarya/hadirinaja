import { ApiError, type TenantMembership } from "@/lib/api"

export type AuthenticatedEntryPath =
  | "/select-tenant"
  | "/workspace"
  | "/attendance"

export type AuthRecoveryPath = "/login?expired=1" | "/select-tenant"

export function getAuthenticatedEntryPath(
  membership: TenantMembership | null
): AuthenticatedEntryPath {
  if (!membership) return "/select-tenant"

  if (
    membership.roles.includes("owner") ||
    membership.roles.includes("supervisor")
  ) {
    return "/workspace"
  }

  if (membership.roles.includes("employee")) return "/attendance"

  return "/select-tenant"
}

export function getAuthRecoveryPath(error: unknown): AuthRecoveryPath | null {
  if (!(error instanceof ApiError)) return null
  if (error.status === 401 || error.status === 419) return "/login?expired=1"
  if (error.code === "active_membership_required") return "/select-tenant"

  return null
}
