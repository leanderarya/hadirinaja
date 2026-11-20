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
import { EmployeeProfilePrototype } from "./-employee-profile-prototype"

let wideViewport = false

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
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  )
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe("Employee Profile prototype", () => {
  it("shows centered identity and read-only employment and account details", () => {
    render(<EmployeeProfilePrototype />)

    expect(screen.getByRole("heading", { name: "Nadia Putri" })).toBeTruthy()
    expect(screen.getByText("nadia.putri@example.test")).toBeTruthy()
    expect(screen.getByText("HadirinAja Demo")).toBeTruthy()
    expect(screen.queryByText("ID karyawan")).toBeNull()
    expect(screen.queryByText("#1048")).toBeNull()
    expect(screen.getAllByText("Karyawan")).toHaveLength(2)
    expect(screen.getByText("Status").parentElement?.textContent).toContain(
      "Aktif"
    )
    expect(
      screen.queryByRole("button", { name: /Edit|Ubah|Password|MFA|PIN/ })
    ).toBeNull()
  })

  it("shows one Outlet inline without an unnecessary disclosure", () => {
    render(<EmployeeProfilePrototype />)

    expect(screen.getByText("Outlet Kuningan")).toBeTruthy()
    expect(screen.queryByRole("button", { name: /Outlet contoh/ })).toBeNull()
  })

  it("opens the mobile Outlet sheet and restores focus after Escape", async () => {
    render(<EmployeeProfilePrototype />)
    fireEvent.change(screen.getByLabelText("Skenario data sintetis"), {
      target: { value: "multiple" },
    })
    fireEvent.click(screen.getByRole("button", { name: /3 Outlet/ }))

    const dialog = await screen.findByRole("dialog")
    expect(within(dialog).getByText("Outlet Kuningan")).toBeTruthy()
    expect(within(dialog).getByText("Outlet Kemang")).toBeTruthy()
    expect(within(dialog).getByText("Outlet Menteng")).toBeTruthy()
    fireEvent.keyDown(dialog, { key: "Escape" })
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole("button", { name: /3 Outlet/ })
      )
    )
  })

  it("uses a side panel for Outlet details at wider viewports", async () => {
    wideViewport = true
    render(<EmployeeProfilePrototype />)
    fireEvent.change(screen.getByLabelText("Skenario data sintetis"), {
      target: { value: "multiple" },
    })
    fireEvent.click(screen.getByRole("button", { name: /3 Outlet/ }))

    const dialog = await screen.findByRole("dialog")
    expect(document.querySelector('[data-slot="sheet-content"]')).toBeTruthy()
    expect(within(dialog).getByText("Outlet Kuningan")).toBeTruthy()
  })

  it("does not claim Outlet access when the synthetic read model has no details", () => {
    render(<EmployeeProfilePrototype />)
    fireEvent.change(screen.getByLabelText("Skenario data sintetis"), {
      target: { value: "no_outlets" },
    })

    expect(screen.getByRole("status").textContent).toContain(
      "Detail Outlet belum tersedia"
    )
    expect(screen.queryByRole("button", { name: /Outlet/ })).toBeNull()
  })

  it("keeps long names and Outlet names available and wraps the identity", () => {
    render(<EmployeeProfilePrototype />)
    fireEvent.change(screen.getByLabelText("Skenario data sintetis"), {
      target: { value: "long_name" },
    })

    expect(
      screen.getByRole("heading", {
        name: "Nadia Putri Rahmawati Prameswari",
      })
    ).toBeTruthy()
    expect(
      screen.getByText("Outlet Kuningan Selatan Lantai Dua dan Ruang Produksi")
    ).toBeTruthy()
  })

  it("represents missing optional identity and organization details clearly", () => {
    render(<EmployeeProfilePrototype />)
    fireEvent.change(screen.getByLabelText("Skenario data sintetis"), {
      target: { value: "missing" },
    })

    expect(screen.getByText("Email belum tersedia")).toBeTruthy()
    expect(screen.getByText("Organisasi").parentElement?.textContent).toContain(
      "Belum tersedia"
    )
    expect(screen.getByRole("img", { name: "Avatar Nadia Putri" })).toBeTruthy()
  })

  it("simulates logout locally without a request or session-state change", async () => {
    const fetchSpy = vi.spyOn(window, "fetch")
    render(<EmployeeProfilePrototype />)
    fireEvent.click(
      screen.getByRole("button", { name: "Simulasikan keluar dari akun" })
    )

    const dialog = await screen.findByRole("dialog")
    expect(within(dialog).getByText(/Sesi tetap aktif/)).toBeTruthy()
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Tutup pratinjau" })
    )
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
    expect(screen.getByRole("heading", { name: "Nadia Putri" })).toBeTruthy()
    expect(fetchSpy).not.toHaveBeenCalled()
    fetchSpy.mockRestore()
  })
})
