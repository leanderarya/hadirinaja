// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import type { ComponentType, ReactNode } from "react"
import { afterEach, beforeEach, expect, it, vi } from "vitest"

const { apiRequest, search } = vi.hoisted(() => ({ apiRequest: vi.fn(), search: {} }))
vi.mock("@/lib/api", () => ({ apiRequest, ApiError: class extends Error {} }))
vi.mock("@tanstack/react-router", () => ({ createFileRoute: () => (options: object) => ({ options, useSearch: () => search }) }))
vi.mock("@/components/management-sidebar", () => ({ ManagementSidebar: () => null, ManagementTopbar: () => null }))
vi.mock("@/components/r2c/screen-blocks", () => ({
  PageHeading: ({ title }: { title: string }) => <h1>{title}</h1>,
  ScopeBanner: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))
vi.mock("@/components/ui/sidebar", () => ({ SidebarProvider: ({ children }: { children: ReactNode }) => <div>{children}</div> }))
import { Route } from "./access"
const Page = Route.options.component as ComponentType
const token = "A".repeat(64)
const session = {
  user: { id: 1, name: "Owner" },
  features: { kiosk_enabled: false },
  active_membership: {
    id: 1,
    tenant: { id: 1, name: "Tenant QA" },
    roles: ["owner"],
  },
}
let data: { members: unknown[]; employees: unknown[]; outlets: unknown[]; invitations: unknown[] }
const writeText = vi.fn().mockResolvedValue(undefined)
const emailToken = "e".repeat(64)
beforeEach(() => {
  apiRequest.mockReset()
  writeText.mockClear()
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } })
  data = {
    members: [], employees: [{ id: 1, name: "Employee QA", access_status: "none" }], outlets: [], invitations: [],
  }
  apiRequest.mockImplementation(async (path: string, options?: { method?: string; body?: unknown }) => {
    if (path === "/auth/me") return session
    if (path === "/management/access") return data
    if (path.endsWith("/cancel")) return { canceled: true }
    if (path.endsWith("/email-change-link")) {
      return {
        token: emailToken,
        link_id: 12,
        expires_at: "2026-11-27T12:00:00Z",
        email_masked: "t***@example.test",
      }
    }
    if (path.endsWith("/revoke")) return { revoked: true }
    if (options?.method === "POST") return { activation_token: token }
    throw Error(`Unexpected endpoint ${path}`)
  })
})
afterEach(cleanup)

it("Owner binds an existing employee and email, copies the single-use fragment link, and can hide it", async () => {
  render(<Page />)
  fireEvent.click(await screen.findByRole("button", { name: "Undang pengguna" }))
  const dialog = await screen.findByRole("dialog")
  fireEvent.change(within(dialog).getByLabelText("Email akun penerima"), { target: { value: "employee@example.test" } })
  fireEvent.change(within(dialog).getByLabelText("Identitas karyawan"), { target: { value: "1" } })
  fireEvent.click(within(dialog).getByRole("button", { name: "Buat undangan" }))
  fireEvent.click(await screen.findByRole("button", { name: "Salin tautan" }))
  expect(apiRequest).toHaveBeenCalledWith("/management/access/invitations", { method: "POST", body: { email: "employee@example.test", role: "employee", employee_id: 1 } })
  expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/activate#${token}`)
  expect(localStorage.getItem("activation_token")).toBeNull()
  fireEvent.click(screen.getByRole("button", { name: "Sembunyikan tautan" }))
  expect(screen.queryByText(`${window.location.origin}/activate#${token}`)).toBeNull()
})

it.each(["pending", "expired"])("Owner corrects the %s invitation recipient only after confirmation", async (status) => {
  data.invitations = [{ id: 7, email: "old@example.test", role: "employee", status, employee: { id: 1, name: "Employee QA" }, outlets: [], invited_by: "Owner", expires_at: "2026-11-05T00:00:00Z" }]
  render(<Page />)
  fireEvent.click(await screen.findByRole("button", { name: "Lihat undangan old@example.test" }))
  const dialog = await screen.findByRole("dialog")
  fireEvent.change(within(dialog).getByLabelText("Email login karyawan"), { target: { value: "correct@example.test" } })
  fireEvent.click(within(dialog).getByRole("button", { name: "Simpan email & buat tautan baru" }))
  const confirm = await screen.findByRole("alertdialog")
  expect(apiRequest.mock.calls.some(([p]) => p.endsWith("/reissue"))).toBe(false)
  fireEvent.click(within(confirm).getByRole("button", { name: "Lanjutkan" }))
  await waitFor(() => expect(apiRequest).toHaveBeenCalledWith("/management/access/invitations/7/reissue", { method: "POST", body: { email: "correct@example.test" } }))
  fireEvent.click(await screen.findByRole("button", { name: "Salin tautan" }))
  expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/activate#${token}`)
})

it("Owner can revoke a pending link without changing employee identity", async () => {
  data.invitations = [{ id: 7, email: "old@example.test", role: "employee", status: "pending", employee: { id: 1, name: "Employee QA" }, outlets: [], invited_by: "Owner", expires_at: "2026-11-05T00:00:00Z" }]
  render(<Page />)
  fireEvent.click(await screen.findByRole("button", { name: "Lihat undangan old@example.test" }))
  fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Batalkan undangan" }))
  fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Lanjutkan" }))
  await waitFor(() => expect(apiRequest).toHaveBeenCalledWith("/management/access/invitations/7/cancel", { method: "POST" }))
})

it("Supervisor sees only Employee rows and can issue and copy an in-scope email link", async () => {
  data.members = [
    {
      id: 4,
      name: "Employee QA",
      email: "target@example.test",
      roles: ["employee"],
      status: "active",
      employee: { id: 1, name: "Employee QA" },
      outlets: [{ id: 2, name: "Scoped Outlet" }],
      email_change_link: null,
    },
    {
      id: 5,
      name: "Owner QA",
      email: "owner@example.test",
      roles: ["owner"],
      status: "active",
      employee: null,
      outlets: [],
      email_change_link: null,
    },
    {
      id: 6,
      name: "Supervisor QA",
      email: "supervisor@example.test",
      roles: ["supervisor"],
      status: "active",
      employee: null,
      outlets: [{ id: 2, name: "Scoped Outlet" }],
      email_change_link: null,
    },
  ]
  data.invitations = [
    { id: 9, email: "hidden@example.test", role: "employee", status: "pending", employee: null, outlets: [], invited_by: "Owner", expires_at: "2026-11-27T12:00:00Z" },
  ]
  apiRequest.mockImplementation(async (path: string, options?: { method?: string; body?: unknown }) => {
    if (path === "/auth/me") {
      return {
        ...session,
        active_membership: {
          ...session.active_membership,
          roles: ["supervisor"],
        },
      }
    }
    if (path === "/management/access") return data
    if (path.endsWith("/email-change-link")) {
      return {
        token: emailToken,
        link_id: 12,
        expires_at: "2026-11-27T12:00:00Z",
        email_masked: "t***@example.test",
      }
    }
    if (path.endsWith("/revoke")) return { revoked: true }
    throw Error(`Unexpected endpoint ${path} ${options?.method ?? ""}`)
  })
  render(<Page />)
  await screen.findByText("Karyawan dalam cakupan Outlet")
  expect(screen.getByText("Employee QA")).toBeTruthy()
  expect(screen.queryByText("Owner QA")).toBeNull()
  expect(screen.queryByText("Supervisor QA")).toBeNull()
  expect(screen.queryByText("hidden@example.test")).toBeNull()
  expect(screen.queryByRole("button", { name: "Undang pengguna" })).toBeNull()
  const detailButton = await screen.findByRole("button", {
    name: "Ubah email Employee QA",
  })
  fireEvent.click(detailButton)
  const dialog = await screen.findByRole("dialog")
  fireEvent.click(
    within(dialog).getByRole("button", {
      name: "Terbitkan tautan ubah email",
    })
  )
  const confirmation = await screen.findByRole("alertdialog")
  fireEvent.change(within(confirmation).getByLabelText("Password Anda"), {
    target: { value: "password" },
  })
  fireEvent.click(
    within(confirmation).getByRole("button", { name: "Terbitkan tautan" })
  )
  await screen.findByText(/Tautan baru siap dibagikan/)
  expect(apiRequest).toHaveBeenCalledWith(
    "/management/access/members/4/email-change-link",
    { method: "POST", body: { password: "password" } }
  )
  fireEvent.click(
    within(dialog).getByRole("button", { name: "Salin tautan ubah email" })
  )
  await waitFor(() =>
    expect(writeText).toHaveBeenCalledWith(
      `${window.location.origin}/ubah-email#token=${emailToken}`
    )
  )
})

it("does not offer email correction or regeneration after activation", async () => {
  data.invitations = [{ id: 7, email: "active@example.test", role: "employee", status: "accepted", employee: { id: 1, name: "Employee QA" }, outlets: [], invited_by: "Owner", expires_at: "2026-11-05T00:00:00Z" }]
  render(<Page />)
  fireEvent.click(await screen.findByRole("button", { name: "Lihat undangan active@example.test" }))
  const dialog = await screen.findByRole("dialog")
  expect(within(dialog).queryByLabelText("Email login karyawan")).toBeNull()
  expect(within(dialog).queryByRole("button", { name: "Simpan email & buat tautan baru" })).toBeNull()
})
