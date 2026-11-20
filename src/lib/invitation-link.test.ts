import { expect, it } from "vitest"
import { invitationLink } from "./invitation-link"

it("builds a same-origin HTTPS fragment link without putting the token in a query or path", () => {
  const token = `${"Ab9".repeat(21)}Z`
  const link = invitationLink("https://example.test/access?ignored=1", token)
  expect(link).toBe(`https://example.test/activate#${token}`)
  if (link === null) throw new Error("Expected a secure invitation link")
  const url = new URL(link)
  expect(url.search).toBe("")
  expect(url.pathname).toBe("/activate")
})
it.each(["http://example.test", "javascript:alert(1)", "invalid"])("does not share a credential over unsafe origin %s", (origin) => {
  expect(invitationLink(origin, "A".repeat(64))).toBeNull()
})
it.each(["short", `${"A".repeat(63)}#`, "A".repeat(65)])("rejects malformed tokens without embedding their value", (token) => {
  expect(invitationLink("https://example.test", token)).toBeNull()
})
it("allows loopback HTTP only for local development", () => {
  expect(invitationLink("http://localhost:3000", "A".repeat(64))).toBe(`http://localhost:3000/activate#${"A".repeat(64)}`)
})
