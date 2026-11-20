// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
const { apiRequest } = vi.hoisted(() => ({ apiRequest: vi.fn() }))
vi.mock("@/lib/api", () => ({ apiRequest, ApiError: class extends Error {} }))
import { OwnerPasswordReset } from "./-owner-password-reset"
const token = "a".repeat(64)
const writeText = vi.fn().mockResolvedValue(undefined)
beforeEach(() => {
  apiRequest.mockReset()
  writeText.mockClear()
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  })
})
afterEach(cleanup)
async function issue() {
  fireEvent.change(screen.getByLabelText("Password Owner untuk reset"), {
    target: { value: "OwnerPassword" },
  })
  fireEvent.click(screen.getByRole("button", { name: /Buat tautan reset/ }))
  const confirm = await screen.findByRole("alertdialog")
  expect(apiRequest).not.toHaveBeenCalled()
  fireEvent.click(
    within(confirm).getByRole("button", { name: "Konfirmasi reset" })
  )
  await screen.findByRole("button", { name: "Salin tautan reset" })
}
it("Owner issues only after confirmation and copies a private fragment link without persistence", async () => {
  apiRequest.mockResolvedValue({
    reset_token: token,
    reset_id: 7,
    email: "target@example.test",
    expires_at: "2026-11-04T12:00:00Z",
  })
  render(<OwnerPasswordReset membership={2} email="target@example.test" />)
  expect(
    (
      screen.getByRole("button", {
        name: "Buat tautan reset password",
      }) as HTMLButtonElement
    ).disabled
  ).toBe(true)
  await issue()
  expect(apiRequest).toHaveBeenCalledWith(
    "/management/access/members/2/password-reset",
    { method: "POST", body: { password: "OwnerPassword" } }
  )
  expect(
    (screen.getByLabelText("Password Owner untuk reset") as HTMLInputElement)
      .value
  ).toBe("")
  fireEvent.click(screen.getByRole("button", { name: "Salin tautan reset" }))
  await waitFor(() =>
    expect(writeText).toHaveBeenCalledWith(
      `${window.location.origin}/reset-password#${token}`
    )
  )
  expect(localStorage.getItem("reset_token")).toBeNull()
  fireEvent.click(
    screen.getByRole("button", { name: "Sembunyikan tautan reset" })
  )
  expect(screen.queryByLabelText("Tautan reset privat")).toBeNull()
})
it("Owner can revoke with fresh Owner password and explicit confirmation", async () => {
  apiRequest.mockResolvedValue({
    reset_token: token,
    reset_id: 7,
    email: "target@example.test",
    expires_at: "2026-11-04T12:00:00Z",
  })
  render(<OwnerPasswordReset membership={2} email="target@example.test" />)
  await issue()
  fireEvent.change(screen.getByLabelText("Password Owner untuk reset"), {
    target: { value: "OwnerPassword" },
  })
  fireEvent.click(screen.getByRole("button", { name: "Cabut tautan reset" }))
  fireEvent.click(
    within(await screen.findByRole("alertdialog")).getByRole("button", {
      name: "Konfirmasi reset",
    })
  )
  await screen.findByText("Tautan reset sudah dicabut.")
  expect(apiRequest).toHaveBeenCalledWith(
    "/management/access/password-resets/7/revoke",
    { method: "POST", body: { password: "OwnerPassword" } }
  )
  expect(screen.queryByLabelText("Tautan reset privat")).toBeNull()
})
it("rejects failed requests without displaying a link and clears password", async () => {
  apiRequest.mockRejectedValue(new Error("Password Owner salah"))
  render(<OwnerPasswordReset membership={2} email="target@example.test" />)
  fireEvent.change(screen.getByLabelText("Password Owner untuk reset"), {
    target: { value: "wrong" },
  })
  fireEvent.click(
    screen.getByRole("button", { name: "Buat tautan reset password" })
  )
  fireEvent.click(
    within(await screen.findByRole("alertdialog")).getByRole("button", {
      name: "Konfirmasi reset",
    })
  )
  await screen.findByText("Password Owner salah")
  expect(screen.queryByLabelText("Tautan reset privat")).toBeNull()
  expect(
    (screen.getByLabelText("Password Owner untuk reset") as HTMLInputElement)
      .value
  ).toBe("")
})
