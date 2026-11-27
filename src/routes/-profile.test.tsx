// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ApiError, apiRequest, type AuthSession } from "@/lib/api"
import { EmployeeProfilePage } from "./-profile-page"

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>()
  return { ...actual, apiRequest: vi.fn() }
})

let wideViewport = false
const requestMock = vi.mocked(apiRequest)

const session: AuthSession = {
  user: { id: 531, name: "Rani Karyawan", email: "rani@example.test" },
  features: { kiosk_enabled: false },
  memberships: [
    {
      id: 808,
      tenant: { id: 842, name: "HadirinAja Demo" },
      roles: ["employee"],
    },
  ],
  active_membership: {
    id: 808,
    tenant: { id: 842, name: "HadirinAja Demo" },
    roles: ["employee"],
  },
}

function mockReads({
  auth = session,
  attendance = { outlets: [{ id: 17, name: "Outlet Kuningan" }] },
}: {
  auth?: AuthSession
  attendance?: { outlets?: Array<{ id: number; name: string }> }
} = {}) {
  requestMock.mockImplementation((async (path: string) => {
    if (path === "/auth/me") return auth
    if (path === "/attendance/me") return attendance
    throw new Error(`Unexpected request: ${path}`)
  }) as typeof apiRequest)
}

beforeEach(() => {
  wideViewport = false
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: wideViewport && query === "(min-width: 768px)",
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }))
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
    setTimeout(() => callback(performance.now()), 0)
  )
  vi.stubGlobal("cancelAnimationFrame", (id: number) => clearTimeout(id))
  mockReads()
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  requestMock.mockReset()
})

describe("operational Employee Profile", () => {
  it("renders authenticated identity and the single assigned Outlet without switching context", async () => {
    render(<EmployeeProfilePage />)

    expect(
      await screen.findByRole("heading", { name: "Rani Karyawan" })
    ).toBeTruthy()
    expect(screen.getByText("rani@example.test")).toBeTruthy()
    expect(screen.getByText("HadirinAja Demo")).toBeTruthy()
    expect(screen.getByText("Outlet Kuningan")).toBeTruthy()
    expect(
      screen
        .getByRole("link", { name: "Riwayat kehadiran" })
        .getAttribute("href")
    ).toBe("/attendance#history")
    expect(
      screen
        .getByRole("link", { name: "Ganti organisasi" })
        .getAttribute("href")
    ).toBe("/select-tenant")
    const profileNavigation = screen.getByRole("link", { name: "Profil" })
    expect(profileNavigation.getAttribute("href")).toBe("/profile")
    expect(profileNavigation.getAttribute("aria-current")).toBe("page")
    expect(requestMock.mock.calls.map(([path]) => path)).toEqual([
      "/auth/me",
      "/attendance/me",
    ])
    expect(document.body.textContent).not.toContain("531")
    expect(document.body.textContent).not.toContain("842")
    expect(document.body.textContent).not.toContain("17")
  })

  it("lists multiple assigned Outlets in an accessible mobile drawer and restores focus", async () => {
    mockReads({
      attendance: {
        outlets: [
          { id: 17, name: "Outlet Kuningan" },
          { id: 19, name: "Outlet Kemang" },
        ],
      },
    })
    render(<EmployeeProfilePage />)
    const trigger = await screen.findByRole("button", {
      name: "Lihat 2 Outlet dengan penugasan aktif",
    })
    const outside = screen.getByRole("link", { name: "Riwayat kehadiran" })
    fireEvent.click(trigger)

    const dialog = await screen.findByRole("dialog")
    expect(dialog.getAttribute("aria-modal")).toBe("true")
    expect(dialog.contains(document.activeElement)).toBe(true)
    expect(within(dialog).getByText("Outlet Kuningan")).toBeTruthy()
    expect(within(dialog).getByText("Outlet Kemang")).toBeTruthy()
    expect(
      within(dialog).getByText(/tidak mengubah konteks tampilan/)
    ).toBeTruthy()
    outside.focus()
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true))
    fireEvent.keyDown(dialog, { key: "Escape" })
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
    await waitFor(() => expect(document.activeElement).toBe(trigger))
  })

  it("uses a side sheet for Outlet details at wider viewports", async () => {
    wideViewport = true
    mockReads({
      attendance: {
        outlets: [
          { id: 17, name: "Outlet Kuningan" },
          { id: 19, name: "Outlet Kemang" },
        ],
      },
    })
    render(<EmployeeProfilePage />)
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Lihat 2 Outlet dengan penugasan aktif",
      })
    )

    const dialog = await screen.findByRole("dialog")
    expect(document.querySelector('[data-slot="sheet-content"]')).toBeTruthy()
    expect(dialog.hasAttribute("aria-modal")).toBe(false)
    expect(document.querySelector("main")?.hasAttribute("aria-hidden")).toBe(
      false
    )
    expect(within(dialog).getByText("Outlet Kemang")).toBeTruthy()
  })

  it("does not show unavailable Outlet details when the authenticated read model omits them", async () => {
    mockReads({ attendance: {} })
    render(<EmployeeProfilePage />)

    expect(
      await screen.findByText("Detail Outlet belum tersedia untuk akun ini.")
    ).toBeTruthy()
    expect(
      screen.queryByRole("button", { name: /Lihat \d+ Outlet/ })
    ).toBeNull()
  })

  it("fails closed when the assignment-scoped Outlet read is denied", async () => {
    requestMock.mockImplementation((async (path: string) => {
      if (path === "/auth/me") return session
      if (path === "/attendance/me") throw new ApiError("Forbidden", 403)
      throw new Error(`Unexpected request: ${path}`)
    }) as typeof apiRequest)
    render(<EmployeeProfilePage />)

    expect(
      await screen.findByText("Detail Outlet belum tersedia untuk akun ini.")
    ).toBeTruthy()
    expect(screen.queryByText("Outlet terlarang")).toBeNull()
  })

  it("keeps identity readable when optional values are empty and uses initials fallback", async () => {
    const membership = session.active_membership
    if (!membership) throw new Error("Test membership is required")
    const missingOptionalValues = {
      ...session,
      user: { ...session.user, name: "  ", email: " " },
      active_membership: {
        ...membership,
        tenant: { ...membership.tenant, name: " " },
      },
    }
    mockReads({ auth: missingOptionalValues })
    render(<EmployeeProfilePage />)

    expect(
      await screen.findByRole("heading", { name: "Nama belum tersedia" })
    ).toBeTruthy()
    expect(screen.getByText("Email belum tersedia")).toBeTruthy()
    expect(screen.getByText("Organisasi belum tersedia")).toBeTruthy()
    expect(
      screen.getByRole("img", { name: "Avatar Nama belum tersedia" })
    ).toBeTruthy()
    expect(
      screen.getByRole("button", { name: "Keluar dari akun" })
    ).toBeTruthy()
  })

  it("keeps long names and Outlet names intact in the profile and disclosure", async () => {
    const longName = "Rani Ayu Kartika Wulandari Prameswari"
    const longOutlet = "Outlet Kuningan Selatan Lantai Dua dan Ruang Produksi"
    mockReads({
      auth: { ...session, user: { ...session.user, name: longName } },
      attendance: {
        outlets: [
          { id: 17, name: longOutlet },
          { id: 19, name: "Outlet Kemang" },
        ],
      },
    })
    render(<EmployeeProfilePage />)

    expect(await screen.findByRole("heading", { name: longName })).toBeTruthy()
    fireEvent.click(
      screen.getByRole("button", {
        name: "Lihat 2 Outlet dengan penugasan aktif",
      })
    )
    expect(await screen.findByText(longOutlet)).toBeTruthy()
  })

  it("keeps the existing authenticated logout entry points available without invoking them", async () => {
    render(<EmployeeProfilePage />)
    await screen.findByRole("heading", { name: "Rani Karyawan" })
    expect(
      screen.getByRole("button", { name: "Keluar dari akun" })
    ).toBeTruthy()

    fireEvent.click(
      screen.getByRole("button", { name: "Menu akun Rani Karyawan" })
    )
    const accountMenu = await screen.findByRole("dialog")
    expect(
      within(accountMenu).getByRole("button", { name: "Keluar dari akun" })
    ).toBeTruthy()
    expect(
      within(accountMenu)
        .getByRole("link", { name: "Buka profil" })
        .getAttribute("href")
    ).toBe("/profile")
    expect(requestMock.mock.calls.map(([path]) => path)).not.toContain(
      "/auth/logout"
    )
  })

  it("submits the existing logout request through a mocked API and keeps failure reviewable", async () => {
    requestMock.mockImplementation((async (path: string) => {
      if (path === "/auth/me") return session
      if (path === "/attendance/me") {
        return { outlets: [{ id: 17, name: "Outlet Kuningan" }] }
      }
      if (path === "/auth/logout") throw new ApiError("Unavailable", 503)
      throw new Error(`Unexpected request: ${path}`)
    }) as typeof apiRequest)
    render(<EmployeeProfilePage />)
    await screen.findByRole("heading", { name: "Rani Karyawan" })
    fireEvent.click(screen.getByRole("button", { name: "Keluar dari akun" }))

    expect(
      await screen.findByText("Belum berhasil keluar dari akun")
    ).toBeTruthy()
    expect(requestMock).toHaveBeenCalledWith("/auth/logout", {
      method: "POST",
    })
  })
})
