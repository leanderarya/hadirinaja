import { expect, it } from "vitest"
import { emailChangeLink, emailChangeWhatsAppUrl } from "./email-change-link"

it("builds a secure fragment link and rejects unsafe origins or tokens", () => {
  const token = "a".repeat(64)
  expect(emailChangeLink("https://pilot.example.test/access", token)).toBe(
    `https://pilot.example.test/ubah-email#token=${token}`
  )
  expect(emailChangeLink("http://localhost:4179", token)).toBe(
    `http://localhost:4179/ubah-email#token=${token}`
  )
  expect(emailChangeLink("http://pilot.example.test", token)).toBeNull()
  expect(emailChangeLink("https://pilot.example.test", "bad")).toBeNull()
})

it("creates a WhatsApp message with the expiry and one-use terms", () => {
  const url = new URL(
    emailChangeWhatsAppUrl("https://pilot.example.test/ubah-email#token=abc")
  )
  const message = url.searchParams.get("text")

  expect(url.origin).toBe("https://wa.me")
  expect(message).toContain("https://pilot.example.test/ubah-email#token=abc")
  expect(message).toContain("berlaku 24 jam")
  expect(message).toContain("sekali")
})
