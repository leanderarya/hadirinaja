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
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  addScheduleDays,
  EmployeeSchedulePrototype,
  localScheduleDate,
  mondayForScheduleDate,
} from "./-employee-schedule-prototype"

function selectScenario(value: string) {
  const toggle = screen.getByRole("button", {
    name: "Panel pengembangan · skenario",
  })
  if (toggle.getAttribute("aria-expanded") !== "true") {
    fireEvent.click(toggle)
  }
  fireEvent.change(
    screen.getByRole("combobox", { name: "Skenario jadwal sintetis" }),
    { target: { value } }
  )
}

function weekButtons() {
  const list = screen.getByRole("list", {
    name: "Jadwal Senin sampai Minggu",
  })
  return within(list).getAllByRole("button")
}

function currentWeekdayIndex(): number {
  return (new Date().getDay() + 6) % 7
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

describe("Employee Schedule prototype", () => {
  it("calculates Monday weeks across month, year, and leap-day boundaries", () => {
    expect(mondayForScheduleDate("2026-01-01")).toBe("2025-12-29")
    expect(mondayForScheduleDate("2024-02-29")).toBe("2024-02-26")
    expect(addScheduleDays("2026-12-28", 6)).toBe("2027-01-03")
    expect(addScheduleDays("2024-02-28", 1)).toBe("2024-02-29")
  })

  it("keeps today's summary tied to today while browsing another week", () => {
    render(<EmployeeSchedulePrototype />)
    const today = localScheduleDate(new Date())
    const todaySummary = document.querySelector<HTMLElement>(
      '[data-schedule-today="true"]'
    )
    const todayDate = todaySummary?.querySelector("time")?.dateTime
    const todayContent = todaySummary?.textContent
    const initialRange = screen.getByRole("button", {
      name: /Pilih tanggal untuk minggu/,
    }).textContent

    expect(todayDate).toBe(today)
    expect(weekButtons()).toHaveLength(7)
    expect(weekButtons()[0].className).toContain("cursor-pointer")
    expect(weekButtons()[0].className).toContain("active:bg-muted/50")
    expect(
      screen.getByRole("button", { name: "Panel pengembangan · skenario" })
        .className
    ).toContain("cursor-pointer")
    expect(weekButtons()[0].getAttribute("aria-label")).toContain("Senin")
    expect(weekButtons()[6].getAttribute("aria-label")).toContain("Minggu")

    fireEvent.click(screen.getByRole("button", { name: "Minggu berikutnya" }))

    expect(
      screen.getByRole("button", { name: /Pilih tanggal untuk minggu/ })
        .textContent
    ).not.toBe(initialRange)
    expect(todaySummary?.querySelector("time")?.dateTime).toBe(today)
    expect(todaySummary?.textContent).toBe(todayContent)
  })

  it("keeps the week picker centered between compact 44px navigation targets", () => {
    render(<EmployeeSchedulePrototype />)

    const navigation = document.querySelector<HTMLElement>(
      '[data-week-navigation="true"]'
    )
    const previous = screen.getByRole("button", {
      name: "Minggu sebelumnya",
    })
    const next = screen.getByRole("button", { name: "Minggu berikutnya" })
    const range = screen.getByRole("button", {
      name: /Pilih tanggal untuk minggu/,
    })

    expect(navigation?.className).toContain("mx-auto")
    expect(navigation?.className).toContain("max-w-xs")
    expect(previous.className).toContain("absolute left-0")
    expect(next.className).toContain("absolute right-0")
    expect(previous.className).toContain("size-11")
    expect(next.className).toContain("size-11")
    expect(range.className).toContain("justify-center")
    expect(range.className).toContain("max-w-[calc(100%-6rem)]")
    expect(range.querySelector("span")?.className).toContain("truncate")
  })

  it("shows separate current-day shift times and Outlets and supports overnight dates", async () => {
    render(<EmployeeSchedulePrototype />)
    const todaySummary = document.querySelector<HTMLElement>(
      '[data-schedule-today="true"]'
    )
    if ([0, 2, 3, 5].includes(currentWeekdayIndex())) {
      expect(todaySummary?.querySelectorAll("ol li").length).toBeGreaterThan(0)
      expect(todaySummary?.textContent).toContain("Outlet")
    } else {
      expect(todaySummary?.querySelector("ol")).toBeNull()
      const expectedStatus =
        currentWeekdayIndex() === 1
          ? "Libur dikonfirmasi"
          : currentWeekdayIndex() === 4
            ? "Belum dipublikasikan"
            : "Belum dijadwalkan"
      expect(todaySummary?.textContent).toContain(expectedStatus)
    }

    const multipleRow = weekButtons().find((button) =>
      button.getAttribute("aria-label")?.includes("2 shift")
    )
    expect(multipleRow).toBeTruthy()
    fireEvent.click(multipleRow as HTMLElement)

    const details = screen.getByRole("dialog")
    expect(within(details).getByText("Jadwal tersedia")).toBeTruthy()
    const shiftList = within(details).getByRole("list", {
      name: "Shift berurutan berdasarkan waktu mulai",
    })
    const shifts = within(shiftList).getAllByRole("listitem")
    expect(shifts).toHaveLength(2)
    expect(shifts[0].textContent).toContain("Shift 1 · Shift pagi")
    expect(shifts[0].textContent).toContain("Outlet Menteng")
    expect(shifts[1].textContent).toContain("Shift 2 · Shift siang")
    expect(shifts[1].textContent).toContain("Outlet Kemang")
    expect(details.querySelector("[data-schedule-detail-scroll]"))?.toBeTruthy()
    expect(
      details.querySelector("[data-schedule-detail-scroll]")?.className
    ).toContain("overflow-y-auto")

    fireEvent.keyDown(details, { key: "Escape" })
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
    await waitFor(() => expect(document.activeElement).toBe(multipleRow))

    const overnightRow = weekButtons()[3]
    fireEvent.click(overnightRow)
    expect(screen.getAllByText(/22\.00.*02\.00.*\(\+1 hari\)/)).toHaveLength(2)
    expect(screen.getByText("Outlet Kuningan · Asia/Jakarta")).toBeTruthy()
  })

  it("distinguishes confirmed rest, unpublished, unscheduled, and unknown data", () => {
    render(<EmployeeSchedulePrototype />)
    const rows = weekButtons()
    expect(rows[1].getAttribute("aria-label")).toContain("Libur dikonfirmasi")
    expect(rows[4].getAttribute("aria-label")).toContain("Belum dipublikasikan")
    expect(rows[6].getAttribute("aria-label")).toContain("Belum dijadwalkan")

    selectScenario("unknown")
    expect(screen.getByRole("status").textContent).toContain(
      "Data kosong tidak berarti hari libur"
    )
    expect(weekButtons()[1].getAttribute("aria-label")).toContain(
      "Jadwal belum diketahui"
    )
    expect(screen.queryByText("Libur dikonfirmasi")).toBeNull()
  })

  it("offers accessible loading, retryable error, and schedule detail states", async () => {
    render(<EmployeeSchedulePrototype />)
    selectScenario("loading")
    expect(screen.getByRole("status").textContent).toContain(
      "Memuat jadwal contoh"
    )
    expect(
      screen.queryByRole("list", { name: "Jadwal Senin sampai Minggu" })
    ).toBeNull()

    selectScenario("error")
    expect(screen.getByRole("alert").textContent).toContain(
      "Status hari tidak disimpulkan"
    )
    fireEvent.click(screen.getByRole("button", { name: "Coba lagi" }))
    expect(
      screen.getByRole("list", { name: "Jadwal Senin sampai Minggu" })
    ).toBeTruthy()
  })

  it("opens the date picker and navigates to the selected date's Monday week", async () => {
    render(<EmployeeSchedulePrototype />)
    const today = localScheduleDate(new Date())
    fireEvent.click(screen.getByRole("button", { name: "Minggu sebelumnya" }))
    const rangeTrigger = screen.getByRole("button", {
      name: /Pilih tanggal untuk minggu/,
    })
    fireEvent.click(rangeTrigger)

    const picker = await screen.findByText("Pilih tanggal")
    expect(picker).toBeTruthy()
    expect(
      document.querySelector('[data-slot="calendar"]')?.className
    ).not.toContain("border")
    fireEvent.click(screen.getByRole("button", { name: "Bulan berikutnya" }))
    const monthTodayButton = document.querySelector<HTMLButtonElement>(
      `[data-day="${today}"] button`
    )
    expect(monthTodayButton).toBeTruthy()
    await act(async () => {
      fireEvent.click(monthTodayButton as HTMLButtonElement)
    })
    const selectedRange = screen.getByRole("button", {
      name: /Pilih tanggal untuk minggu/,
    })
    await waitFor(() => expect(document.activeElement).toBe(selectedRange))

    expect(weekButtons()[0].getAttribute("aria-label")).toContain(
      weekdayDateLabel(mondayForScheduleDate(today))
    )
    expect(
      weekButtons().some((button) => button.textContent?.includes("Hari ini"))
    ).toBe(true)
    expect(screen.queryByText("Pilih tanggal")).toBeNull()
  })

  it("keeps the current Monday selected and closes when it is reselected", async () => {
    render(<EmployeeSchedulePrototype />)
    const range = screen.getByRole("button", {
      name: /Pilih tanggal untuk minggu/,
    })
    fireEvent.click(range)
    await screen.findByRole("dialog", { name: "Pilih tanggal" })
    const todayButton = document.querySelector<HTMLButtonElement>(
      '[data-slot="calendar"] [data-today="true"] button'
    )
    expect(todayButton?.getAttribute("aria-label")).toMatch(/^Hari ini,/)

    const selectedDay = document.querySelector<HTMLButtonElement>(
      '[data-slot="calendar"] [data-selected="true"] button'
    )
    expect(selectedDay).toBeTruthy()
    fireEvent.click(selectedDay as HTMLButtonElement)

    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Pilih tanggal" })).toBeNull()
    )
    await waitFor(() => expect(document.activeElement).toBe(range))
  })
})

function weekdayDateLabel(value: string): string {
  const [year, month, day] = value.split("-").map(Number)
  return new Intl.DateTimeFormat("id-ID", {
    weekday: "long",
    day: "numeric",
    month: "short",
  }).format(new Date(year, month - 1, day, 12))
}
