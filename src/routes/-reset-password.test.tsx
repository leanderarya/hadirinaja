// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import type { ComponentType } from "react"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
const { apiRequest } = vi.hoisted(() => ({ apiRequest: vi.fn() }))
vi.mock("@/lib/api", () => ({ apiRequest, ApiError: class extends Error {} }))
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: object) => ({ options }),
}))
import { Route } from "./reset-password"
const Page = Route.options.component as ComponentType
const token = "b".repeat(64)
beforeEach(() => {
  apiRequest.mockReset()
  window.history.replaceState({}, "", `/reset-password#${token}`)
  apiRequest.mockResolvedValue({
    email: "target@example.test",
    expires_at: "2026-11-04T12:00:00Z",
    role_unchanged: true,
  })
})
afterEach(cleanup)
it("removes token from URL and resets password only after user submission", async () => {
  render(<Page />)
  await screen.findByText("Akun: target@example.test")
  expect(window.location.hash).toBe("")
  expect(apiRequest).toHaveBeenCalledWith("/password-resets/inspect", {
    method: "POST",
    body: { token },
  })
  fireEvent.change(screen.getByLabelText("Password baru"), {
    target: { value: "NewPassword123!" },
  })
  fireEvent.change(screen.getByLabelText("Konfirmasi password baru"), {
    target: { value: "Different123!" },
  })
  expect(
    (
      screen.getByRole("button", {
        name: "Simpan password baru",
      }) as HTMLButtonElement
    ).disabled
  ).toBe(true)
  fireEvent.change(screen.getByLabelText("Konfirmasi password baru"), {
    target: { value: "NewPassword123!" },
  })
  fireEvent.click(screen.getByRole("button", { name: "Simpan password baru" }))
  await screen.findByText(/Password berhasil diganti/)
  expect(apiRequest).toHaveBeenCalledWith("/password-resets/complete", {
    method: "POST",
    body: {
      token,
      password: "NewPassword123!",
      password_confirmation: "NewPassword123!",
    },
  })
  expect(screen.queryByLabelText("Password baru")).toBeNull()
})
it("invalid fragment is rejected locally without network requests", async () => {
  window.history.replaceState({}, "", "/reset-password#bad")
  render(<Page />)
  await screen.findByText("Tautan reset tidak lengkap atau tidak valid.")
  expect(apiRequest).not.toHaveBeenCalled()
})
it("expired link cannot show the password form", async () => {
  apiRequest.mockRejectedValue(new Error("Tautan kedaluwarsa"))
  render(<Page />)
  await screen.findByText("Tautan kedaluwarsa")
  expect(screen.queryByLabelText("Password baru")).toBeNull()
})
it("failed completion clears passwords and remains on reset form", async () => {
  apiRequest.mockImplementation(async (path: string) => {
    if (path.endsWith("inspect")) return { email: "target@example.test" }
    throw Error("Tautan sudah dipakai")
  })
  render(<Page />)
  await screen.findByText("Akun: target@example.test")
  fireEvent.change(screen.getByLabelText("Password baru"), {
    target: { value: "NewPassword123!" },
  })
  fireEvent.change(screen.getByLabelText("Konfirmasi password baru"), {
    target: { value: "NewPassword123!" },
  })
  fireEvent.click(screen.getByRole("button", { name: "Simpan password baru" }))
  await screen.findByText("Tautan sudah dipakai")
  await waitFor(() =>
    expect(
      (screen.getByLabelText("Password baru") as HTMLInputElement).value
    ).toBe("")
  )
})
