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
import { EmployeeRequestsPrototype } from "./-employee-requests-prototype"

function dateAtOffset(offset: number): string {
  const date = new Date()
  date.setDate(date.getDate() + offset)
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-")
}

function openDevelopmentPanel() {
  fireEvent.click(
    screen.getByRole("button", { name: "Panel pengembangan · skenario" })
  )
}

function selectScenario(value: string) {
  if (
    screen
      .getByRole("button", { name: "Panel pengembangan · skenario" })
      .getAttribute("aria-expanded") !== "true"
  ) {
    openDevelopmentPanel()
  }
  fireEvent.change(
    screen.getByRole("combobox", { name: "Skenario respons sintetis" }),
    { target: { value } }
  )
}

function requestRows() {
  return within(
    screen.getByRole("list", { name: "Daftar permintaan" })
  ).getAllByRole("button")
}

function renderedRequestCount(): number {
  return document.querySelectorAll("[data-request-list] > li > button").length
}

beforeEach(() => {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: false,
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

describe("Employee Requests prototype", () => {
  it("filters the status-first request list into processing and completed groups", () => {
    render(<EmployeeRequestsPrototype />)

    expect(renderedRequestCount()).toBe(4)
    fireEvent.click(screen.getByRole("button", { name: "Diproses" }))
    expect(requestRows()).toHaveLength(2)
    expect(
      requestRows().every((row) => row.textContent?.includes("Diproses"))
    ).toBe(true)

    fireEvent.click(screen.getByRole("button", { name: "Selesai" }))
    expect(requestRows()).toHaveLength(2)
    expect(
      requestRows().some((row) => row.textContent?.includes("Disetujui"))
    ).toBe(true)
    expect(
      requestRows().some((row) => row.textContent?.includes("Ditolak"))
    ).toBe(true)
  })

  it("keeps request details in a mobile sheet and restores focus to its row", async () => {
    render(<EmployeeRequestsPrototype />)
    const row = screen.getByRole("button", {
      name: /Koreksi presensi keluar.*Diproses.*Lihat detail/,
    })
    fireEvent.click(row)

    const dialog = await screen.findByRole("dialog")
    expect(within(dialog).getByText("Outlet Kuningan")).toBeTruthy()
    expect(within(dialog).getByText("#1048")).toBeTruthy()
    expect(
      within(dialog).getByRole("table", { name: "Perbandingan waktu" })
    ).toBeTruthy()
    expect(dialog.querySelector("[data-request-detail-scroll]"))?.toBeTruthy()

    fireEvent.keyDown(dialog, { key: "Escape" })
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
    await waitFor(() => expect(document.activeElement).toBe(row))
  })

  it("opens a full-page guided flow and selects a session before its correction type", async () => {
    render(<EmployeeRequestsPrototype />)
    fireEvent.click(
      screen.getByRole("button", { name: "Buat permintaan baru" })
    )

    expect(
      await screen.findByRole("heading", { name: "Buat permintaan" })
    ).toBeTruthy()
    expect(document.querySelector("[data-correction-page]"))?.toBeTruthy()
    expect(screen.queryByRole("dialog")).toBeNull()
    const session = screen.getByRole("combobox", {
      name: "Sesi presensi yang dapat dikoreksi",
    })
    expect(within(session).getAllByRole("option")).toHaveLength(4)
    fireEvent.change(session, { target: { value: "1048" } })
    expect(
      screen.getByText("Presensi keluar terlewat", { exact: true })
    ).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Lanjutkan" }))

    expect(
      await screen.findByRole("heading", { name: "Koreksi presensi" })
    ).toBeTruthy()
    expect(screen.getByText("Outlet asal")).toBeTruthy()
    expect(screen.getByText("#1048")).toBeTruthy()
    expect(screen.getByText("Batas pengajuan")).toBeTruthy()
    expect(
      screen.getByRole("table", { name: "Perbandingan waktu" })
    ).toBeTruthy()
    expect(screen.getByLabelText("Alasan")).toBeTruthy()
    expect(screen.queryByRole("dialog")).toBeNull()
  })

  it("prefills a contextual Attendance entry with immutable session provenance", async () => {
    render(<EmployeeRequestsPrototype />)
    fireEvent.click(
      screen.getByRole("button", {
        name: "Simulasi koreksi dari Riwayat Presensi",
      })
    )

    expect(
      await screen.findByRole("heading", { name: "Koreksi presensi" })
    ).toBeTruthy()
    expect(screen.getByText("Outlet Kuningan")).toBeTruthy()
    expect(screen.getByText("#1048")).toBeTruthy()
    expect(
      screen.getByText("Presensi keluar terlewat", { exact: true })
    ).toBeTruthy()
    expect(screen.getByText("Batas pengajuan")).toBeTruthy()
    expect(
      screen.queryByLabelText("Sesi presensi yang dapat dikoreksi")
    ).toBeNull()
    expect(screen.queryByRole("dialog")).toBeNull()
  })

  it("returns from the form to the session step, then restores list focus", async () => {
    render(<EmployeeRequestsPrototype />)
    const opener = screen.getByRole("button", { name: "Buat permintaan baru" })
    fireEvent.click(opener)
    fireEvent.change(
      screen.getByLabelText("Sesi presensi yang dapat dikoreksi"),
      { target: { value: "1048" } }
    )
    fireEvent.click(screen.getByRole("button", { name: "Lanjutkan" }))

    expect(await screen.findByLabelText("Alasan")).toBeTruthy()
    fireEvent.click(
      screen.getByRole("button", { name: "Kembali ke pilihan sesi" })
    )
    expect(
      screen.getByRole("heading", { name: "Buat permintaan" })
    ).toBeTruthy()
    expect(
      screen.getByRole("combobox", {
        name: "Sesi presensi yang dapat dikoreksi",
      })
    ).toBeTruthy()

    fireEvent.click(
      screen.getByRole("button", { name: "Kembali ke Permintaan" })
    )
    await waitFor(() =>
      expect(
        screen.queryByRole("heading", { name: "Koreksi presensi" })
      ).toBeNull()
    )
    await waitFor(() => expect(document.activeElement).toBe(opener))
  })

  it("validates required values and chronological order before synthetic submission", async () => {
    render(<EmployeeRequestsPrototype />)
    fireEvent.click(
      screen.getByRole("button", {
        name: "Simulasi koreksi dari Riwayat Presensi",
      })
    )
    await screen.findByRole("heading", { name: "Koreksi presensi" })
    const form = document.getElementById("prototype-correction-form")
    if (!form) throw new Error("Correction form is missing")
    const submitButton = screen.getByRole("button", {
      name: "Ajukan contoh",
    })

    fireEvent.submit(form)
    expect(
      await screen.findByText("Isi waktu keluar yang diajukan.")
    ).toBeTruthy()
    expect(screen.getByText("Isi alasan pengajuan.")).toBeTruthy()

    fireEvent.change(screen.getByLabelText("Waktu keluar yang diajukan"), {
      target: { value: `${dateAtOffset(-1)}T08:00` },
    })
    fireEvent.change(screen.getByLabelText("Alasan"), {
      target: { value: "Waktu keluar terlewat." },
    })
    fireEvent.submit(form)
    expect(
      await screen.findByText("Waktu keluar harus setelah waktu masuk.")
    ).toBeTruthy()
    expect(submitButton).toBeTruthy()
    expect(renderedRequestCount()).toBe(4)
  })

  it("blocks expired and unavailable correction options without a submit action", async () => {
    const view = render(<EmployeeRequestsPrototype />)
    selectScenario("expired")
    fireEvent.click(
      screen.getByRole("button", {
        name: "Simulasi koreksi dari Riwayat Presensi",
      })
    )
    expect(
      await screen.findByText("Batas pengajuan telah terlewati")
    ).toBeTruthy()
    expect(screen.queryByRole("button", { name: /Ajukan contoh/ })).toBeNull()
    fireEvent.click(
      screen.getByRole("button", { name: "Kembali ke Permintaan" })
    )

    selectScenario("unavailable")
    fireEvent.click(
      screen.getByRole("button", {
        name: "Simulasi koreksi dari Riwayat Presensi",
      })
    )
    expect(await screen.findByText("Koreksi belum tersedia")).toBeTruthy()
    expect(screen.queryByRole("button", { name: /Ajukan contoh/ })).toBeNull()
    view.unmount()
  })

  it("reconciles an uncertain response without creating a duplicate request", async () => {
    render(<EmployeeRequestsPrototype />)
    selectScenario("uncertain")
    fireEvent.click(
      screen.getByRole("button", {
        name: "Simulasi koreksi dari Riwayat Presensi",
      })
    )
    await screen.findByRole("heading", { name: "Koreksi presensi" })
    fireEvent.change(screen.getByLabelText("Waktu keluar yang diajukan"), {
      target: { value: `${dateAtOffset(-1)}T17:15` },
    })
    fireEvent.change(screen.getByLabelText("Alasan"), {
      target: { value: "Respons contoh tidak diterima." },
    })
    const form = document.getElementById("prototype-correction-form")
    if (!form) throw new Error("Correction form is missing")
    const submitButton = screen.getByRole("button", {
      name: "Ajukan contoh",
    })
    fireEvent.submit(form)

    expect(
      await screen.findByText("Respons pengajuan belum pasti")
    ).toBeTruthy()
    expect(requestRows()).toHaveLength(4)
    fireEvent.click(
      screen.getByRole("button", { name: "Periksa status contoh" })
    )
    expect(
      await screen.findByText(/ditemukan dengan status Diproses/)
    ).toBeTruthy()
    expect(requestRows()).toHaveLength(5)
    expect(
      screen.queryByRole("button", { name: "Periksa status contoh" })
    ).toBeNull()
    expect(
      requestRows().filter((row) =>
        row
          .getAttribute("aria-label")
          ?.includes("Koreksi presensi · Presensi keluar terlewat")
      )
    ).toHaveLength(1)
    expect(submitButton).toBeTruthy()
  })

  it("uses synthetic local outcomes only", async () => {
    const fetchSpy = vi.spyOn(window, "fetch")
    render(<EmployeeRequestsPrototype />)
    fireEvent.click(
      screen.getByRole("button", {
        name: "Simulasi koreksi dari Riwayat Presensi",
      })
    )
    await screen.findByRole("heading", { name: "Koreksi presensi" })
    expect(
      screen.getByText(/Waktu contoh mengikuti Asia\/Jakarta/)
    ).toBeTruthy()
    expect(
      within(
        document.querySelector("[data-correction-page]") as HTMLElement
      ).getByText(/bukan daftar kemampuan API/)
    ).toBeTruthy()
    expect(screen.queryByRole("dialog")).toBeNull()
    expect(fetchSpy).not.toHaveBeenCalled()
    fetchSpy.mockRestore()
  })
})
