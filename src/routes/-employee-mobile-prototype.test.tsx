// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import { EmployeeAttendanceClock } from "@/components/employee-attendance-clock"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { EmployeeMobilePrototype } from "./-employee-mobile-prototype"

function chooseVerificationScenario(value: string) {
  const panelToggle = screen.getByRole("button", {
    name: "Panel pengembangan · data contoh",
  })
  if (panelToggle.getAttribute("aria-expanded") !== "true") {
    fireEvent.click(panelToggle)
  }
  fireEvent.change(
    screen.getByRole("combobox", { name: "Skenario verifikasi sintetis" }),
    { target: { value } }
  )
}

function openVerification(action: "checkIn" | "checkOut") {
  fireEvent.click(
    screen.getByRole("button", {
      name:
        action === "checkIn"
          ? "Buka simulasi Absen Masuk"
          : "Buka simulasi Absen Keluar",
    })
  )
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
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe("Employee Mobile UI prototype", () => {
  it("places the Outlet context first and utilities at the right of one sticky row", () => {
    render(<EmployeeMobilePrototype />)

    const header = screen.getByRole("banner")
    const layout = header.firstElementChild as HTMLElement
    const [outletContext, utilities] = Array.from(
      layout.children
    ) as HTMLElement[]
    const outletTrigger = screen.getByRole("button", {
      name: "Outlet aktif: Outlet Menteng. Pilih konteks Outlet",
    })

    expect(header.className).toContain("sticky")
    expect(layout.className).toContain("h-14")
    expect(outletContext.className).toContain("flex-1")
    expect(layout.children[0]).toBe(outletContext)
    expect(layout.children[1]).toBe(utilities)
    expect(
      within(utilities).getByRole("button", { name: "Notifikasi" })
    ).toBeTruthy()
    expect(
      within(utilities).getByRole("button", {
        name: "Menu akun Karyawan Contoh",
      })
    ).toBeTruthy()
    expect(outletTrigger.parentElement).toBe(outletContext)
    expect(outletTrigger.className).toContain("h-14")
    expect(outletTrigger.className).toContain("text-left")
    expect(outletTrigger.className).toContain("border-transparent")
    expect(outletTrigger.className).not.toContain("border-border")
    expect(outletTrigger.className).toContain("focus-visible:ring-2")
    expect(outletTrigger.className).toContain("data-pressed:bg-accent")
    expect(outletTrigger.className).toContain("active:bg-accent")
    expect(outletTrigger.className).toContain("aria-expanded:bg-accent")
    expect(outletTrigger.getAttribute("aria-expanded")).toBe("false")
    expect(outletTrigger.querySelector(".truncate")).toBeTruthy()
    expect(outletTrigger.querySelector(".text-caption")?.textContent).toBe(
      "Outlet"
    )
    expect(outletTrigger.querySelector(".truncate")?.textContent).toBe(
      "Outlet Menteng"
    )
    expect(outletTrigger.getAttribute("title")).toBe("Outlet Menteng")
  })

  it("keeps long Outlet names accessible and restores focus after popover dismissal", async () => {
    render(<EmployeeMobilePrototype />)

    const initialTrigger = screen.getByRole("button", {
      name: "Outlet aktif: Outlet Menteng. Pilih konteks Outlet",
    })
    fireEvent.click(initialTrigger)
    expect(initialTrigger.getAttribute("aria-expanded")).toBe("true")
    const search = screen.getByRole("searchbox", { name: "Cari Outlet" })
    await waitFor(() => expect(document.activeElement).toBe(search))

    const longOutlet = "Outlet Pusat Operasional Cilandak Barat"
    const option = screen.getByRole("button", { name: longOutlet })
    expect(option.getAttribute("title")).toBe(longOutlet)
    fireEvent.click(option)

    const selectedTrigger = screen.getByRole("button", {
      name: `Outlet aktif: ${longOutlet}. Pilih konteks Outlet`,
    })
    expect(selectedTrigger.querySelector(".truncate")?.textContent).toBe(
      longOutlet
    )
    expect(selectedTrigger.getAttribute("title")).toBe(longOutlet)
    expect(screen.queryByRole("searchbox", { name: "Cari Outlet" })).toBeNull()

    fireEvent.click(selectedTrigger)
    const reopenedSearch = screen.getByRole("searchbox", {
      name: "Cari Outlet",
    })
    fireEvent.keyDown(reopenedSearch, { key: "Escape" })
    await waitFor(() =>
      expect(
        screen.queryByRole("searchbox", { name: "Cari Outlet" })
      ).toBeNull()
    )
    expect(selectedTrigger.getAttribute("aria-expanded")).toBe("false")
    await waitFor(() => expect(document.activeElement).toBe(selectedTrigger))
  })

  it("keeps actions disabled, varies their preview emphasis, and hides dev controls by default", () => {
    render(<EmployeeMobilePrototype />)

    const checkIn = screen.getByRole("button", { name: "Absen Masuk" })
    const checkOut = screen.getByRole("button", { name: "Absen Keluar" })
    expect((checkIn as HTMLButtonElement).disabled).toBe(true)
    expect((checkOut as HTMLButtonElement).disabled).toBe(true)
    expect(checkIn.parentElement?.className).toContain("grid-cols-2")
    expect(checkOut.parentElement).toBe(checkIn.parentElement)
    expect(checkIn.className).toContain("bg-primary")
    expect(checkOut.className).not.toContain("bg-primary")
    const panelToggle = screen.getByRole("button", {
      name: "Panel pengembangan · data contoh",
    })
    expect(panelToggle.getAttribute("aria-expanded")).toBe("false")
    expect(
      screen
        .getByText(/seluruh data sintetis/i)
        .closest("#prototype-dev-panel")
        ?.hasAttribute("hidden")
    ).toBe(true)
    fireEvent.click(panelToggle)
    expect(screen.getByText(/seluruh data sintetis/i)).toBeTruthy()
    expect(panelToggle.getAttribute("aria-expanded")).toBe("true")
    expect(
      screen
        .getByText(/seluruh data sintetis/i)
        .closest("#prototype-dev-panel")
        ?.hasAttribute("hidden")
    ).toBe(false)

    const scenario = screen.getByRole("combobox", { name: "Skenario contoh" })
    const stateLabels = [
      ["empty", "Belum ada presensi"],
      ["not_checked_in", "Belum absen masuk"],
      ["working", "Sedang bekerja"],
      ["completed", "Sesi hari ini selesai"],
      ["multiple_sessions", "2 sesi selesai"],
      ["unresolved", "Ada sesi sebelumnya yang belum selesai"],
    ]

    for (const [value, expected] of stateLabels) {
      fireEvent.change(scenario, { target: { value } })
      expect(screen.getAllByText(expected).length).toBeGreaterThan(0)
    }

    fireEvent.change(scenario, { target: { value: "working" } })
    expect(checkIn.className).not.toContain("bg-primary")
    expect(checkOut.className).toContain("bg-primary")
    expect((checkIn as HTMLButtonElement).disabled).toBe(true)
    expect((checkOut as HTMLButtonElement).disabled).toBe(true)
  })

  it("renders weekly history as separated rows without an outer card", () => {
    render(<EmployeeMobilePrototype />)

    const history = screen.getByRole("list", {
      name: "Riwayat minggu ini, terbaru lebih dulu",
    })
    expect(history.className).toContain("divide-y")
    expect(history.className).not.toContain("border-border")
    expect(history.className).not.toContain("bg-card")
    expect(within(history).getAllByRole("listitem").length).toBeGreaterThan(0)
  })

  it("shows chronological session summaries and accessible conditional details", async () => {
    render(<EmployeeMobilePrototype />)
    const day = screen.getByRole("button", { name: /Sabtu, 07 November/ })
    day.focus()
    fireEvent.click(day)

    const dialog = screen.getByRole("dialog", {
      name: /Presensi · Sabtu, 07 November/,
    })
    const sessions = screen.getAllByRole("region", { name: /^Sesi \d/ })
    expect(sessions).toHaveLength(2)

    const first = within(sessions[0])
    expect(first.getByText("Sesi 1")).toBeTruthy()
    expect(first.getByText("Selesai")).toBeTruthy()
    expect(first.getAllByText("Outlet Menteng")[0]).toBeTruthy()
    expect(first.getByText("08.00")).toBeTruthy()
    expect(first.getByText("12.10")).toBeTruthy()
    expect(sessions[0].className).not.toContain("border")
    expect(sessions[0].className).not.toContain("bg-card")

    const firstDisclosure = sessions[0].querySelector("details")
    expect(firstDisclosure?.open).toBe(false)
    expect(firstDisclosure?.querySelector("summary")?.className).toContain(
      "w-full"
    )
    expect(first.queryByText("Bukti foto")).toBeNull()
    expect(first.queryByRole("button", { name: "Ajukan koreksi" })).toBeNull()

    const second = within(sessions[1])
    expect(second.getByText("Sesi 2")).toBeTruthy()
    expect(second.getAllByText("Outlet Kemang")[0]).toBeTruthy()
    expect(second.getByText("12.42")).toBeTruthy()
    expect(second.getByText("16.05")).toBeTruthy()
    const secondDisclosure = sessions[1].querySelector("details")
    expect(secondDisclosure?.open).toBe(false)
    fireEvent.click(second.getByText("Lihat detail"))
    expect(secondDisclosure?.open).toBe(true)
    expect(second.getByText("Work Date asal")).toBeTruthy()
    expect(second.getByText("Outlet asal")).toBeTruthy()
    expect(second.getByText("Work Date efektif")).toBeTruthy()
    expect(second.getByText("Outlet Kuningan")).toBeTruthy()
    expect(second.getByText("Bukti foto")).toBeTruthy()
    expect(
      (
        second.getByRole("button", {
          name: "Ajukan koreksi",
        }) as HTMLButtonElement
      ).disabled
    ).toBe(true)

    fireEvent.keyDown(dialog, { key: "Escape" })
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
    await waitFor(() => expect(document.activeElement).toBe(day))
  })

  it("preserves an unresolved session as open and displays recovery guidance", () => {
    render(<EmployeeMobilePrototype />)
    fireEvent.click(screen.getByText("Panel pengembangan · data contoh"))
    fireEvent.change(
      screen.getByRole("combobox", { name: "Skenario contoh" }),
      {
        target: { value: "unresolved" },
      }
    )

    expect(
      screen.getByRole("complementary", { name: "Panduan sesi belum selesai" })
    ).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: /Rabu, 04 November/ }))
    expect(screen.getByText("Belum tercatat")).toBeTruthy()
    expect(screen.getByText(/Sesi belum memiliki waktu checkout/)).toBeTruthy()
  })

  it("keeps module navigation visible and exposes notification placeholder without creating records", () => {
    render(<EmployeeMobilePrototype />)
    const nav = screen.getByRole("navigation", { name: "Navigasi karyawan" })
    expect(within(nav).getByRole("link", { name: "Beranda" })).toBeTruthy()
    expect(
      within(nav).getByRole("link", { name: "Jadwal" }).getAttribute("href")
    ).toBe("/scheduling")
    expect(
      within(nav).getByRole("link", { name: "Permintaan" }).getAttribute("href")
    ).toBe("/requests")
    fireEvent.click(screen.getByRole("button", { name: "Notifikasi" }))
    expect(screen.getByText("Notifikasi belum tersedia.")).toBeTruthy()
  })

  it("opens the synthetic account menu with unavailable destinations disabled", () => {
    render(<EmployeeMobilePrototype />)
    fireEvent.click(
      screen.getByRole("button", { name: "Menu akun Karyawan Contoh" })
    )

    expect(screen.getByRole("menu")).toBeTruthy()
    expect(screen.getByText("akun.sintetis@example.test")).toBeTruthy()
    expect(
      screen.getByRole("menuitem", { name: /Profil.*belum tersedia/ })
    ).toBeTruthy()
    expect(
      screen.getByRole("menuitem", { name: /Keluar.*dinonaktifkan/ })
    ).toBeTruthy()
  })

  it("opens Check-in in Focus Mode, requires accepted mandatory photo, and returns focus", async () => {
    render(<EmployeeMobilePrototype />)
    chooseVerificationScenario("ready")
    const launcher = screen.getByRole("button", {
      name: "Buka simulasi Absen Masuk",
    })
    launcher.focus()
    fireEvent.click(launcher)

    const heading = screen.getByRole("heading", { name: "Absen Masuk" })
    expect(document.activeElement).toBe(heading)
    expect(screen.getByText("Simulasi · tanpa kamera/GPS/server")).toBeTruthy()
    expect(
      screen.queryByRole("navigation", { name: "Navigasi karyawan" })
    ).toBeNull()
    expect(screen.getByRole("heading", { name: "Lokasi" })).toBeTruthy()
    expect(screen.getByText("Peta tidak tersedia pada pratinjau.")).toBeTruthy()
    expect(screen.queryByText("Wajib")).toBeNull()
    expect(screen.queryByText("Opsional")).toBeNull()
    expect(screen.queryByText("GPS siap · simulasi")).toBeNull()
    expect(screen.queryByText("Sabtu, 7 November 2026")).toBeNull()

    const submit = screen.getByRole("button", {
      name: "Simulasikan Absen Masuk",
    }) as HTMLButtonElement
    expect(submit.disabled).toBe(true)
    const capture = screen.getByRole("button", { name: "Ambil foto" })
    expect(capture.parentElement?.className).toContain("justify-center")
    fireEvent.click(capture)
    expect(
      screen.getByRole("img", { name: "Pratinjau foto simulasi" })
    ).toBeTruthy()
    expect(submit.disabled).toBe(true)
    fireEvent.click(screen.getByRole("button", { name: "Gunakan Foto" }))
    expect(submit.disabled).toBe(false)
    const retake = screen.getByRole("button", { name: "Ambil ulang" })
    expect(retake.parentElement?.className).toContain("items-center")
    fireEvent.click(retake)
    expect(submit.disabled).toBe(true)
    fireEvent.click(screen.getByRole("button", { name: "Ambil foto" }))
    fireEvent.click(screen.getByRole("button", { name: "Gunakan Foto" }))
    expect(submit.disabled).toBe(false)
    fireEvent.click(submit)
    expect(screen.getAllByText(/Memproses Absen Masuk/)).toHaveLength(2)
    await waitFor(() =>
      expect(screen.getByText("Simulasi berhasil")).toBeTruthy()
    )
    expect(submit.disabled).toBe(true)

    fireEvent.keyDown(document, { key: "Escape" })
    await waitFor(() =>
      expect(screen.queryByRole("heading", { name: "Absen Masuk" })).toBeNull()
    )
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole("button", { name: "Buka simulasi Absen Masuk" })
      )
    )
    expect(
      screen
        .getByRole("button", { name: "Panel pengembangan · data contoh" })
        .getAttribute("aria-expanded")
    ).toBe("true")
  })

  it("uses the flat verification hierarchy and keeps the action label aligned", () => {
    render(<EmployeeMobilePrototype />)
    chooseVerificationScenario("ready")
    openVerification("checkIn")

    const mode = document.querySelector('[data-verification-mode="focus"]')
    expect(mode?.querySelectorAll('[data-slot="card"]')).toHaveLength(0)
    expect(mode?.querySelectorAll('[data-slot="separator"]')).toHaveLength(2)
    const title = screen.getByRole("heading", { name: "Absen Masuk" })
    expect(title.parentElement?.tagName).toBe("DIV")
    expect(title.className).toContain("text-center")
    expect(title.closest("header")).toBeTruthy()
    expect(screen.queryByText("Sabtu, 7 November 2026")).toBeNull()
    expect(
      screen.getByRole("img", { name: "Peta lokasi simulasi" })
    ).toBeTruthy()
    expect(screen.getByText("48 m · contoh")).toBeTruthy()
    expect(screen.getByText("±12 m · contoh")).toBeTruthy()
    expect(
      screen.getByRole("button", { name: "Simulasikan Absen Masuk" })
    ).toBeTruthy()
    expect(screen.queryByText(/Periksa Outlet, lokasi/)).toBeNull()

    fireEvent.click(
      screen.getByRole("button", { name: "Kembali ke Beranda prototype" })
    )
    chooseVerificationScenario("cross_outlet_checkout")
    openVerification("checkOut")
    expect(screen.getByRole("heading", { name: "Absen Keluar" })).toBeTruthy()
    expect(
      screen.getByRole("button", { name: "Simulasikan Absen Keluar" })
    ).toBeTruthy()
    expect(
      screen.queryByRole("button", { name: "Simulasikan Absen Masuk" })
    ).toBeNull()
    expect(screen.getByText("Outlet Menteng")).toBeTruthy()
  })

  it("requires explicit Outlet selection for ambiguous eligibility and checkout destination", () => {
    render(<EmployeeMobilePrototype />)
    chooseVerificationScenario("ambiguous_outlet")
    openVerification("checkIn")
    expect(screen.getByRole("radio", { name: "Outlet Menteng" })).toBeTruthy()
    expect(
      (
        screen.getByRole("button", {
          name: "Simulasikan Absen Masuk",
        }) as HTMLButtonElement
      ).disabled
    ).toBe(true)
    fireEvent.click(screen.getByRole("radio", { name: "Outlet Kemang" }))
    expect(
      screen
        .getByRole("radio", { name: "Outlet Kemang" })
        .getAttribute("aria-checked")
    ).toBe("true")
    expect(
      (
        screen.getByRole("button", {
          name: "Simulasikan Absen Masuk",
        }) as HTMLButtonElement
      ).disabled
    ).toBe(true)

    fireEvent.click(
      screen.getByRole("button", { name: "Kembali ke Beranda prototype" })
    )
    chooseVerificationScenario("cross_outlet_checkout")
    openVerification("checkOut")
    expect(screen.getByRole("heading", { name: "Absen Keluar" })).toBeTruthy()
    expect(screen.getByText("7 November 2026")).toBeTruthy()
    expect(
      screen.getByText("Outlet asal").parentElement?.textContent
    ).toContain("Outlet Menteng")
    expect(screen.queryByRole("radio", { name: "Outlet Menteng" })).toBeNull()
    expect(screen.getByRole("radio", { name: "Outlet Kemang" })).toBeTruthy()
    expect(
      (
        screen.getByRole("button", {
          name: "Simulasikan Absen Keluar",
        }) as HTMLButtonElement
      ).disabled
    ).toBe(true)
    fireEvent.click(screen.getByRole("radio", { name: "Outlet Kemang" }))
    expect(
      screen
        .getByRole("radio", { name: "Outlet Kemang" })
        .getAttribute("aria-checked")
    ).toBe("true")
    expect(
      screen.getByText("Outlet asal").parentElement?.textContent
    ).toContain("Outlet Menteng")
  })

  it("blocks the verification action when no Outlet is eligible", () => {
    render(<EmployeeMobilePrototype />)
    chooseVerificationScenario("no_eligible_outlet")
    openVerification("checkIn")
    expect(
      screen.getByText("Tidak ada Outlet yang memenuhi skenario")
    ).toBeTruthy()
    expect(
      (
        screen.getByRole("button", {
          name: "Simulasikan Absen Masuk",
        }) as HTMLButtonElement
      ).disabled
    ).toBe(true)
  })

  it("requires accepted preview for an optional photo when one is captured", () => {
    render(<EmployeeMobilePrototype />)
    chooseVerificationScenario("optional_photo")
    openVerification("checkIn")
    const submit = screen.getByRole("button", {
      name: "Simulasikan Absen Masuk",
    }) as HTMLButtonElement
    expect(submit.disabled).toBe(false)
    fireEvent.click(screen.getByRole("button", { name: "Ambil foto" }))
    expect(submit.disabled).toBe(true)
    fireEvent.click(screen.getByRole("button", { name: "Gunakan Foto" }))
    expect(submit.disabled).toBe(false)
  })

  it("keeps mandatory camera failure closed while optional failure can be skipped", () => {
    render(<EmployeeMobilePrototype />)
    chooseVerificationScenario("required_camera_denied")
    openVerification("checkIn")
    expect(screen.getByRole("alert").textContent).toContain(
      "Foto wajib belum dapat diambil"
    )
    expect(
      (
        screen.getByRole("button", {
          name: "Simulasikan Absen Masuk",
        }) as HTMLButtonElement
      ).disabled
    ).toBe(true)
    expect(screen.queryByRole("button", { name: "Lewati foto" })).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "Coba lagi" }))
    fireEvent.click(screen.getByRole("button", { name: "Ambil foto" }))
    fireEvent.click(screen.getByRole("button", { name: "Gunakan Foto" }))
    expect(
      (
        screen.getByRole("button", {
          name: "Simulasikan Absen Masuk",
        }) as HTMLButtonElement
      ).disabled
    ).toBe(false)

    fireEvent.click(
      screen.getByRole("button", { name: "Kembali ke Beranda prototype" })
    )
    chooseVerificationScenario("optional_camera_denied")
    openVerification("checkIn")
    const optionalSubmit = screen.getByRole("button", {
      name: "Simulasikan Absen Masuk",
    }) as HTMLButtonElement
    expect(optionalSubmit.disabled).toBe(true)
    fireEvent.click(screen.getByRole("button", { name: "Lewati foto" }))
    expect(screen.getByText(/Foto dilewati/)).toBeTruthy()
    expect(optionalSubmit.disabled).toBe(false)
  })

  it("shows GPS denial inline, keeps the map fallback present, and retries locally", () => {
    render(<EmployeeMobilePrototype />)
    chooseVerificationScenario("gps_denied")
    openVerification("checkIn")
    expect(screen.getByRole("alert").textContent).toContain(
      "Izin lokasi ditolak"
    )
    expect(screen.getByText("Peta tidak tersedia pada pratinjau.")).toBeTruthy()
    expect(screen.getAllByText("Belum tersedia")).toHaveLength(2)
    expect(screen.queryByText("GPS siap · simulasi")).toBeNull()
    expect(
      (
        screen.getByRole("button", {
          name: "Simulasikan Absen Masuk",
        }) as HTMLButtonElement
      ).disabled
    ).toBe(true)
    fireEvent.click(screen.getByRole("button", { name: "Coba lagi" }))
    expect(screen.getByText("Lokasi siap.")).toBeTruthy()
    expect(screen.getByText("Peta tidak tersedia pada pratinjau.")).toBeTruthy()
  })

  it("does not offer a second submit after an uncertain synthetic response", async () => {
    render(<EmployeeMobilePrototype />)
    chooseVerificationScenario("uncertain")
    openVerification("checkIn")
    const submit = screen.getByRole("button", {
      name: "Simulasikan Absen Masuk",
    }) as HTMLButtonElement
    expect(submit.disabled).toBe(false)
    fireEvent.click(submit)
    await waitFor(() =>
      expect(screen.getByText("Hasil simulasi belum pasti")).toBeTruthy()
    )
    expect(submit.disabled).toBe(true)
    expect(
      screen.getByRole("button", { name: "Periksa status simulasi" })
    ).toBeTruthy()
    fireEvent.click(
      screen.getByRole("button", { name: "Periksa status simulasi" })
    )
    expect(screen.getByText("Simulasi berhasil")).toBeTruthy()
    expect(submit.disabled).toBe(true)
  })

  it("presents the synthetic submitting scenario without exposing global navigation", async () => {
    render(<EmployeeMobilePrototype />)
    chooseVerificationScenario("submitting")
    openVerification("checkOut")
    expect(screen.getAllByText(/Memproses Absen Keluar/)).toHaveLength(2)
    expect(
      screen.queryByRole("navigation", { name: "Navigasi karyawan" })
    ).toBeNull()
    await waitFor(
      () => expect(screen.getByText("Simulasi berhasil")).toBeTruthy(),
      { timeout: 1600 }
    )
  })

  it("ticks the Outlet clock, refreshes it on visibility changes, and cleans its timer", () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-11-07T00:00:00.000Z"))
    const { unmount } = render(
      <EmployeeAttendanceClock outletTimeZone="Asia/Jakarta" />
    )

    const clock = screen.getByRole("timer")
    expect(clock.textContent).toBe("07:00:00")
    expect(screen.getByText("Zona waktu Outlet · Asia/Jakarta")).toBeTruthy()

    act(() => vi.advanceTimersByTime(1000))
    expect(clock.textContent).toBe("07:00:01")

    vi.setSystemTime(new Date("2026-11-07T00:00:05.000Z"))
    act(() => document.dispatchEvent(new Event("visibilitychange")))
    expect(clock.textContent).toBe("07:00:05")

    unmount()
    expect(vi.getTimerCount()).toBe(0)
  })

  it("labels the device-timezone fallback when Outlet timezone is missing", () => {
    const deviceTimeZone =
      Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"
    render(<EmployeeAttendanceClock />)

    expect(
      screen.getByText(`Zona waktu perangkat · ${deviceTimeZone}`)
    ).toBeTruthy()
  })
})
