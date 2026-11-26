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
import { ApiError } from "@/lib/api"

const { apiRequest } = vi.hoisted(() => ({ apiRequest: vi.fn() }))
vi.mock("@/lib/api", () => ({
  apiRequest,
  ApiError: class extends Error {
    status: number
    errors?: Record<string, string[]>
    constructor(
      message: string,
      status = 422,
      errors?: Record<string, string[]>
    ) {
      super(message)
      this.status = status
      this.errors = errors
    }
  },
}))
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: object) => ({ options }),
}))

import { Route } from "./ubah-email"

const Page = Route.options.component as ComponentType
const token = "c".repeat(64)

beforeEach(() => {
  apiRequest.mockReset()
  window.history.replaceState({}, "", `/ubah-email#token=${token}`)
  apiRequest.mockResolvedValue({
    email_masked: "m***@example.test",
    expires_at: "2026-11-27T12:00:00Z",
  })
})

afterEach(cleanup)

it("removes the fragment before inspection and submits the user's new email and current password", async () => {
  render(<Page />)
  await screen.findByText("Akun: m***@example.test")
  expect(window.location.hash).toBe("")
  expect(apiRequest).toHaveBeenCalledWith("/email-change-links/inspect", {
    method: "POST",
    body: { token },
  })

  fireEvent.change(screen.getByLabelText("Email baru"), {
    target: { value: "New.Member@Example.test" },
  })
  fireEvent.change(screen.getByLabelText("Konfirmasi email baru"), {
    target: { value: "new.member@example.test" },
  })
  fireEvent.change(screen.getByLabelText("Password saat ini"), {
    target: { value: "CurrentPassword123!" },
  })
  fireEvent.click(screen.getByRole("button", { name: "Simpan email baru" }))

  await screen.findByText(/Email berhasil diganti/)
  expect(apiRequest).toHaveBeenLastCalledWith("/email-change-links/consume", {
    method: "POST",
    body: {
      token,
      email: "new.member@example.test",
      email_confirmation: "new.member@example.test",
      password: "CurrentPassword123!",
    },
  })
  expect(screen.queryByLabelText("Password saat ini")).toBeNull()
})

it("rejects a malformed fragment without making a request", async () => {
  window.history.replaceState({}, "", "/ubah-email#bad")
  render(<Page />)
  await screen.findByText("Tautan ubah email tidak lengkap atau tidak valid.")
  expect(apiRequest).not.toHaveBeenCalled()
})

it("shows expired or used link guidance without showing the form", async () => {
  apiRequest.mockRejectedValue(new ApiError("Gone", 410))
  render(<Page />)
  await screen.findByText(/Tautan sudah kedaluwarsa, digunakan, atau dicabut/)
  expect(screen.queryByLabelText("Email baru")).toBeNull()
})

it("rejects mismatched confirmation and keeps the form open", async () => {
  render(<Page />)
  await screen.findByText("Akun: m***@example.test")
  fireEvent.change(screen.getByLabelText("Email baru"), {
    target: { value: "first@example.test" },
  })
  fireEvent.change(screen.getByLabelText("Konfirmasi email baru"), {
    target: { value: "second@example.test" },
  })
  fireEvent.change(screen.getByLabelText("Password saat ini"), {
    target: { value: "CurrentPassword123!" },
  })
  fireEvent.click(screen.getByRole("button", { name: "Simpan email baru" }))

  await screen.findByText("Konfirmasi email harus sama dengan email baru.")
  expect(apiRequest).toHaveBeenCalledTimes(1)
  await waitFor(() => expect(screen.getByLabelText("Email baru")).toBeTruthy())
})
