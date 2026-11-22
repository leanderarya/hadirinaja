// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  EmployeeNavigation,
  EmployeeShell,
  EmployeeTopbar,
} from "@/components/employee-shell"

afterEach(cleanup)

const authorizedOutlets = [
  { id: 4, name: "Outlet Menteng" },
  { id: 9, name: "Outlet Kemang" },
]

describe("EmployeeTopbar", () => {
  it("shows only the supplied authorized outlet list when view switching is unsupported", async () => {
    render(
      <EmployeeTopbar
        accountName="Rani Employee"
        outletContext={{ outlets: authorizedOutlets, selectedOutletId: null }}
      />
    )

    const outletTrigger = screen.getByRole("button", {
      name: "Outlet aktif: Semua Outlet. Pilih konteks Outlet",
    })
    expect(outletTrigger.className).toContain("h-14")
    expect(outletTrigger.className).toContain("border-transparent")
    expect(outletTrigger.className).toContain("focus-visible:ring-2")
    expect(outletTrigger.getAttribute("aria-expanded")).toBe("false")

    fireEvent.click(outletTrigger)
    await waitFor(() =>
      expect(outletTrigger.getAttribute("aria-expanded")).toBe("true")
    )

    const dialog = screen.getByRole("dialog")
    expect(
      (
        within(dialog).getByRole("button", {
          name: "Outlet Menteng",
        }) as HTMLButtonElement
      ).disabled
    ).toBe(true)
    expect(
      (
        within(dialog).getByRole("button", {
          name: "Outlet Kemang",
        }) as HTMLButtonElement
      ).disabled
    ).toBe(true)
    expect(
      within(dialog).queryByRole("button", { name: /Outlet di luar akses/ })
    ).toBeNull()
    expect(
      within(dialog).getByText(/belum didukung pada halaman ini/)
    ).toBeTruthy()
  })

  it("invokes only the supplied context callback and closes after selection", async () => {
    const onChange = vi.fn()
    render(
      <EmployeeTopbar
        accountName="Rani Employee"
        outletContext={{
          outlets: authorizedOutlets,
          selectedOutletId: null,
          onChange,
        }}
      />
    )

    fireEvent.click(
      screen.getByRole("button", {
        name: "Outlet aktif: Semua Outlet. Pilih konteks Outlet",
      })
    )
    const dialog = screen.getByRole("dialog")
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Outlet Kemang" })
    )

    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith(9)
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
  })

  it("shows one outlet as plain wrapping text without a picker", () => {
    const longName =
      "Outlet HadirinAja dengan Nama Panjang untuk Pengujian Responsif"
    render(
      <EmployeeTopbar
        accountName="Rani Employee"
        outletContext={{
          outlets: [{ id: 4, name: longName }],
          selectedOutletId: 4,
        }}
      />
    )

    expect(screen.getByText(longName)).toBeTruthy()
    expect(screen.queryByRole("button", { name: /Outlet aktif:/ })).toBeNull()
    expect(screen.queryByRole("dialog")).toBeNull()
  })

  it("shows a static fallback when the page has no outlet contract", () => {
    render(<EmployeeTopbar accountName="Rani Employee" />)

    expect(screen.getByText("Outlet belum tersedia")).toBeTruthy()
    expect(screen.queryByRole("button", { name: /Outlet aktif:/ })).toBeNull()
  })

  it("exposes the authenticated Profile destination from the account menu", async () => {
    render(
      <EmployeeShell active="today" accountName="Rani Employee">
        <p>Attendance content</p>
      </EmployeeShell>
    )

    fireEvent.click(
      screen.getByRole("button", { name: "Menu akun Rani Employee" })
    )
    const accountDialog = screen.getByRole("dialog")
    expect(within(accountDialog).getByText("Rani Employee")).toBeTruthy()
    expect(
      within(accountDialog)
        .getByRole("link", { name: "Buka profil" })
        .getAttribute("href")
    ).toBe("/profile")
  })

  it("keeps the four Employee destinations in the shared navigation", () => {
    render(<EmployeeNavigation active="schedule" />)

    const navigation = screen.getByRole("navigation", {
      name: "Navigasi karyawan",
    })
    expect(
      within(navigation)
        .getByRole("link", { name: "Beranda" })
        .getAttribute("href")
    ).toBe("/attendance")
    expect(
      within(navigation)
        .getByRole("link", { name: "Jadwal" })
        .getAttribute("aria-current")
    ).toBe("page")
    expect(
      within(navigation)
        .getByRole("link", { name: "Permintaan" })
        .getAttribute("href")
    ).toBe("/requests")
    expect(
      within(navigation)
        .getByRole("link", { name: "Profil" })
        .getAttribute("href")
    ).toBe("/profile")
    expect(
      within(navigation)
        .getByRole("link", { name: "Profil" })
        .getAttribute("aria-current")
    ).toBeNull()
  })

  it("passes logout through the existing account-menu action", () => {
    const onLogout = vi.fn()
    render(<EmployeeTopbar accountName="Rani Employee" onLogout={onLogout} />)

    fireEvent.click(
      screen.getByRole("button", { name: "Menu akun Rani Employee" })
    )
    fireEvent.click(screen.getByRole("button", { name: "Keluar dari akun" }))

    expect(onLogout).toHaveBeenCalledOnce()
  })
})
