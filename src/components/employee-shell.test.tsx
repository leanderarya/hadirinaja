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

  it("keeps full outlet names accessible and returns focus after Escape", async () => {
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

    const outletTrigger = screen.getByRole("button", {
      name: `Outlet aktif: ${longName}. Pilih konteks Outlet`,
    })
    expect(outletTrigger.getAttribute("title")).toBe(longName)
    expect(outletTrigger.querySelector(".truncate")).not.toBeNull()
    fireEvent.click(outletTrigger)
    const dialog = screen.getByRole("dialog")
    fireEvent.keyDown(dialog, { key: "Escape" })

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
    await waitFor(() => expect(document.activeElement).toBe(outletTrigger))
  })

  it("does not imply a global outlet view when the page has no outlet contract", async () => {
    render(<EmployeeTopbar accountName="Rani Employee" />)

    const outletTrigger = screen.getByRole("button", {
      name: "Outlet aktif: Konteks Outlet tidak tersedia. Pilih konteks Outlet",
    })
    fireEvent.click(outletTrigger)

    expect(
      screen.getByText("Daftar Outlet belum tersedia pada halaman ini.")
    ).toBeTruthy()
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
