import { invitationLink } from "./invitation-link"

export function passwordResetLink(
  origin: string,
  token: string
): string | null {
  const link = invitationLink(origin, token)
  return link?.replace("/activate#", "/reset-password#") ?? null
}
