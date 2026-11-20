// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import type { ComponentType } from "react"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
const { apiRequest } = vi.hoisted(() => ({ apiRequest: vi.fn() }))
vi.mock("@/lib/api", () => ({ apiRequest, ApiError: class extends Error {} }))
vi.mock("@tanstack/react-router", () => ({ createFileRoute: () => (options: object) => ({ options }) }))
import { Route } from "./activate"
const Page = Route.options.component as ComponentType
const token = "Q".repeat(64)
let status = "pending"
beforeEach(() => {
  status = "pending"
  window.history.replaceState({}, "", `/activate#${token}`)
  apiRequest.mockReset()
  apiRequest.mockImplementation(async (path: string) => {
    if (path === "/auth/me") throw Error("Unauthenticated")
    if (path === "/invitations/inspect") return {
      status, invitee_email: "employee@example.test", tenant: { name: "QA Tenant" }, inviter: { name: "Owner QA" }, role: "employee", employee: { name: "Existing Profile" }, outlets: [], expires_at: "2026-11-05T00:00:00Z",
    }
    if (path === "/invitations/activate") return { activated: true }
    throw Error("Unexpected endpoint")
  })
})
afterEach(cleanup)
it("clears the URL fragment, shows the bound identity, and lets the employee choose their own password", async () => {
  render(<Page />)
  const name = await screen.findByLabelText("Nama lengkap")
  expect(window.location.hash).toBe("")
  expect(screen.getByText("Existing Profile")).toBeTruthy()
  expect((screen.getByLabelText("Email akun") as HTMLInputElement).readOnly).toBe(true)
  fireEvent.change(name, { target: { value: "Employee Chosen Name" } })
  fireEvent.change(screen.getByLabelText("Kata sandi baru"), { target: { value: "SelfChosenPassword123!" } })
  fireEvent.change(screen.getByLabelText("Ulangi kata sandi"), { target: { value: "SelfChosenPassword123!" } })
  fireEvent.click(screen.getByRole("button", { name: "Buat akun dan aktifkan" }))
  await screen.findByText("Akun dan akses organisasi berhasil diaktifkan. Masuk untuk melanjutkan.")
  expect(apiRequest).toHaveBeenCalledWith("/invitations/activate", { method: "POST", body: { token, name: "Employee Chosen Name", password: "SelfChosenPassword123!", password_confirmation: "SelfChosenPassword123!" } })
  expect(screen.queryByLabelText("Kata sandi baru")).toBeNull()
  expect(screen.getByRole("link", { name: "Masuk ke HadirinAja" }).getAttribute("href")).toBe("/login?activated=1")
})
it.each(["expired", "revoked", "accepted"])("does not offer password activation for a %s invitation", async (value) => {
  status = value
  render(<Page />)
  await screen.findByText("Existing Profile")
  expect(screen.queryByRole("button", { name: "Buat akun dan aktifkan" })).toBeNull()
  expect(apiRequest.mock.calls.some(([p]) => p === "/invitations/activate")).toBe(false)
})
it("a missing token never calls the inspect endpoint", async () => {
  window.history.replaceState({}, "", "/activate")
  render(<Page />)
  await screen.findByText("Tautan aktivasi tidak lengkap.")
  await waitFor(() => expect(apiRequest).not.toHaveBeenCalled())
})
