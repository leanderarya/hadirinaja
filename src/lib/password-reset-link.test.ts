import { expect, it } from "vitest"
import { passwordResetLink } from "./password-reset-link"
it("uses HTTPS and fragments with no token query", () => {
  const token = "a".repeat(64)
  expect(passwordResetLink("https://pilot.example.test/access", token)).toBe(
    `https://pilot.example.test/reset-password#${token}`
  )
  expect(passwordResetLink("http://pilot.example.test", token)).toBeNull()
  expect(passwordResetLink("https://pilot.example.test", "bad")).toBeNull()
})
