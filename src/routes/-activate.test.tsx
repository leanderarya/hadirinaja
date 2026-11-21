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
    if (path === "/invitations/inspect")
      return {
        status,
        invitee_email: "employee@example.test",
        tenant: { name: "QA Tenant" },
        inviter: { name: "Owner QA" },
        role: "employee",
        employee: { name: "Existing Profile" },
        outlets: [{ id: 1, name: "Outlet QA" }],
        expires_at: "2026-11-05T00:00:00Z",
      }
    if (path === "/invitations/activate") return { activated: true }
    throw Error("Unexpected endpoint")
  })
})

afterEach(cleanup)

it("prefills the employee name and activates the account", async () => {
  render(<Page />)
  const name = (await screen.findByLabelText(
    "Nama lengkap"
  )) as HTMLInputElement
  expect(window.location.hash).toBe("")
  expect(name.value).toBe("Existing Profile")
  expect(
    screen.getByText(
      "Halo, Existing Profile. Buat kata sandi untuk mulai absen di Outlet QA."
    )
  ).toBeTruthy()
  expect(
    (screen.getByLabelText("Email akun") as HTMLInputElement).readOnly
  ).toBe(true)
  fireEvent.change(name, { target: { value: "Employee Chosen Name" } })
  fireEvent.change(screen.getByLabelText("Kata sandi baru"), {
    target: { value: "SelfChosenPassword123!" },
  })
  fireEvent.change(screen.getByLabelText("Ulangi kata sandi"), {
    target: { value: "SelfChosenPassword123!" },
  })
  fireEvent.click(screen.getByRole("button", { name: "Aktifkan akun" }))
  await screen.findByText(
    "Akun aktif! Masuk dengan email dan kata sandi yang baru Anda buat."
  )
  expect(apiRequest).toHaveBeenCalledWith("/invitations/activate", {
    method: "POST",
    body: {
      token,
      name: "Employee Chosen Name",
      password: "SelfChosenPassword123!",
      password_confirmation: "SelfChosenPassword123!",
    },
  })
  expect(screen.queryByLabelText("Kata sandi baru")).toBeNull()
  expect(
    screen.getByRole("link", { name: "Masuk sekarang" }).getAttribute("href")
  ).toBe("/login?activated=1")
})

it("disables submit when the passwords differ", async () => {
  render(<Page />)
  await screen.findByLabelText("Kata sandi baru")
  fireEvent.change(screen.getByLabelText("Kata sandi baru"), {
    target: { value: "password1" },
  })
  fireEvent.change(screen.getByLabelText("Ulangi kata sandi"), {
    target: { value: "password2" },
  })
  expect(screen.getByText("Kata sandi belum sama.")).toBeTruthy()
  expect(screen.getByRole("button", { name: "Aktifkan akun" })).toHaveProperty(
    "disabled",
    true
  )
})

it("toggles both password inputs between hidden and visible text", async () => {
  render(<Page />)
  const password = (await screen.findByLabelText(
    "Kata sandi baru"
  )) as HTMLInputElement
  const confirmation = screen.getByLabelText(
    "Ulangi kata sandi"
  ) as HTMLInputElement
  expect(password.type).toBe("password")
  expect(confirmation.type).toBe("password")
  fireEvent.click(screen.getByLabelText("Tampilkan kata sandi"))
  expect(password.type).toBe("text")
  expect(confirmation.type).toBe("text")
})

it("keeps existing-account form hidden until opened", async () => {
  render(<Page />)
  await screen.findByLabelText("Nama lengkap")
  expect(screen.queryByLabelText("Email atau nomor telepon")).toBeNull()
  fireEvent.click(
    screen.getByRole("button", {
      name: "Sudah punya akun HadirinAja? Masuk di sini",
    })
  )
  expect(screen.getByLabelText("Email atau nomor telepon")).toBeTruthy()
  expect(screen.queryByLabelText("Nama lengkap")).toBeNull()
})

it.each([
  [
    "expired",
    "Tautan ini sudah kedaluwarsa. Minta Owner mengirim tautan baru.",
  ],
  ["revoked", "Tautan ini sudah dibatalkan. Minta Owner mengirim tautan baru."],
  ["accepted", "Tautan ini sudah dipakai. Silakan masuk."],
])("shows plain status text for a %s invitation", async (value, message) => {
  status = value
  render(<Page />)
  await screen.findByText(message)
  expect(screen.queryByRole("button", { name: "Aktifkan akun" })).toBeNull()
  expect(
    apiRequest.mock.calls.some(([path]) => path === "/invitations/activate")
  ).toBe(false)
})

it("does not inspect when the token is missing", async () => {
  window.history.replaceState({}, "", "/activate")
  render(<Page />)
  await screen.findByText("Tautan aktivasi tidak lengkap.")
  await waitFor(() => expect(apiRequest).not.toHaveBeenCalled())
})
