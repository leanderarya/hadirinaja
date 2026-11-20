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
import { EmployeeAttendanceHistory } from "./employee-attendance-history"
import type { EffectiveAttendanceDay } from "@/lib/attendance-presentation"
import { attendanceIdentityChangeEventName } from "@/lib/attendance-photo-recovery"
import type { PersonalCorrectionOptions } from "@/lib/attendance-correction-navigation"

const session = {
  id: 55,
  recording_status: "closed",
  outlet: { id: 3, name: "Outlet asal" },
  original: {
    outlet_id: 3,
    outlet: { id: 3, name: "Outlet asal" },
    work_date: "2026-11-05",
    check_in_at: "2026-11-05T01:00:00Z",
    check_out_at: "2026-11-05T09:00:00Z",
  },
  effective: {
    work_date: "2026-11-05",
    check_in_at: "2026-11-05T01:00:00Z",
    check_out_at: "2026-11-05T09:00:00Z",
  },
  correction: null,
  schedule_snapshot: { timezone: "Asia/Jakarta" },
  review_indicators: [],
  checkout_destination: {
    id: 6,
    name: "Outlet tujuan",
    timezone: "Asia/Makassar",
  },
  evidence: [
    {
      event_id: 99,
      type: "check_in" as const,
      available: true,
      expires_at: "2027-02-03T01:00:00Z",
    },
  ],
}

const day: EffectiveAttendanceDay = {
  work_date: "2026-11-05",
  outcome: "present",
  outlet: { id: 3, name: "Outlet asal" },
  schedule: { timezone: "Asia/Jakarta" },
  review: { status: "none", indicators: [] },
  unresolved_conflicts: [],
  is_finalized: false,
  sessions: [session],
}

const correctionOptions: PersonalCorrectionOptions = {
  tenant_id: 12,
  employee_id: 34,
  evaluated_at: "2026-11-07T00:00:00Z",
  sessions: [
    {
      session_id: 55,
      work_date: "2026-11-05",
      outlet: { id: 3, name: "Outlet asal" },
      correction_type: "missing_checkout",
      can_start: true,
      deadline: {
        exclusive_at: "2026-11-12T00:00:00Z",
        historical_timezone: "Asia/Jakarta",
        owner_required: false,
      },
    },
    {
      session_id: 56,
      work_date: "2026-11-05",
      outlet: { id: 8, name: "Outlet lain" },
      correction_type: "session",
      can_start: false,
      deadline: {
        exclusive_at: "2026-11-12T00:00:00Z",
        historical_timezone: "Asia/Jakarta",
        owner_required: false,
      },
    },
  ],
  reconstructions: [
    {
      work_date: "2026-11-05",
      outlet: { id: 3, name: "Outlet asal" },
      correction_type: "reconstruction",
      can_start: false,
      deadline: {
        exclusive_at: "2026-11-12T00:00:00Z",
        historical_timezone: "Asia/Jakarta",
        owner_required: false,
      },
    },
  ],
}

let request: ReturnType<typeof vi.fn>
let viewportWidth = 390

beforeEach(() => {
  request = vi.fn(
    async () =>
      new Response("synthetic-jpeg", {
        headers: { "Content-Type": "image/jpeg" },
      })
  )
  vi.stubGlobal("fetch", request)
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      matches: query.includes("768px") && viewportWidth >= 768,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }))
  )
  vi.spyOn(URL, "createObjectURL").mockReturnValue(
    "blob:private-attendance-photo"
  )
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined)
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  viewportWidth = 390
})

function openDay(workDate = "Kamis, 5 November") {
  render(
    <EmployeeAttendanceHistory days={[day]} currentWorkDate="2026-11-07" />
  )
  fireEvent.click(screen.getByRole("button", { name: new RegExp(workDate) }))
}

async function openSessionDetails() {
  await screen.findByRole("dialog")
  fireEvent.click(screen.getAllByText("Lihat detail")[0])
}

describe("employee attendance history", () => {
  it("bounds the list to Monday through server Work Date and sorts newest first", () => {
    const otherDay = (workDate: string): EffectiveAttendanceDay => ({
      ...day,
      work_date: workDate,
      sessions: [],
    })
    render(
      <EmployeeAttendanceHistory
        currentWorkDate="2026-11-07"
        days={[
          otherDay("2026-11-08"),
          otherDay("2026-11-01"),
          otherDay("2026-11-02"),
          otherDay("2026-11-07"),
          otherDay("2026-11-05"),
        ]}
      />
    )
    const dates = screen
      .getAllByRole("button")
      .map((button) => button.textContent ?? "")
    expect(dates).toHaveLength(3)
    expect(dates[0]).toContain("Sabtu, 7 November")
    expect(dates[1]).toContain("Kamis, 5 November")
    expect(dates[2]).toContain("Senin, 2 November")
    expect(dates.join(" ")).not.toContain("8 November")
    expect(dates.join(" ")).not.toContain("Minggu, 1 November")
  })

  it("opens an accessible sheet with chronological multiple sessions and expandable details", async () => {
    const earlier = {
      ...session,
      id: 56,
      outlet: { id: 8, name: "Outlet pagi" },
      original: {
        ...session.original,
        outlet_id: 8,
        outlet: { id: 8, name: "Outlet pagi" },
        check_in_at: "2026-11-05T00:30:00Z",
        check_out_at: "2026-11-05T01:30:00Z",
      },
      effective: {
        ...session.effective,
        check_in_at: "2026-11-05T00:30:00Z",
        check_out_at: "2026-11-05T01:30:00Z",
      },
      schedule_snapshot: { timezone: "Asia/Jakarta" },
      checkout_destination: null,
      evidence: [
        {
          event_id: 100,
          type: "check_out" as const,
          available: false,
          expires_at: "2026-11-05T12:00:00Z",
        },
      ],
    }
    const multipleDay = { ...day, sessions: [session, earlier] }
    const triggerDate = screen.queryByRole("button")
    render(
      <EmployeeAttendanceHistory
        currentWorkDate="2026-11-07"
        days={[multipleDay]}
        correctionOptions={correctionOptions}
      />
    )
    const trigger = screen.getByRole("button", {
      name: /Kamis, 5 November, Hadir, 2 sesi/,
    })
    expect(triggerDate).toBeNull()
    fireEvent.click(trigger)

    const dialog = await screen.findByRole("dialog")
    expect(dialog.getAttribute("role")).toBe("dialog")
    expect(dialog.getAttribute("aria-modal")).toBe("true")
    expect(dialog.className).toContain("overflow-hidden")
    const list = within(dialog).getByRole("list", {
      name: "Sesi berurutan berdasarkan waktu masuk",
    })
    const rows = Array.from(list.children)
    expect(rows[0].textContent).toContain("Sesi 1")
    expect(rows[0].textContent).toContain("Outlet pagi")
    expect(rows[0].textContent).toContain("07.30")
    expect(rows[1].textContent).toContain("Sesi 2")
    expect(rows[1].textContent).toContain("Outlet asal")
    expect(rows[1].textContent).toContain("08.00")
    expect(
      within(dialog)
        .getAllByText("Outlet tujuan keluar")
        .every((label) => !label.closest("details")?.open)
    ).toBe(true)
    const photoTrigger = within(dialog).getByRole("button", {
      name: /Lihat foto masuk · sesi #55/,
    })
    expect(photoTrigger.closest("details")?.open).toBe(false)
    const correctionBeforeExpansion = within(dialog).getByRole("link", {
      name: /Koreksi/,
    })
    expect(correctionBeforeExpansion.closest("details")?.open).toBe(false)

    fireEvent.click(within(dialog).getAllByText("Lihat detail")[1])
    expect(
      within(dialog)
        .getAllByText("Work Date asal")
        .some((label) => label.closest("details")?.open)
    ).toBe(true)
    expect(
      within(dialog)
        .getAllByText("Outlet tujuan keluar")
        .some((label) => label.closest("details")?.open)
    ).toBe(true)
    expect(
      within(dialog).getByRole("button", {
        name: "Lihat foto masuk · sesi #55",
      })
    ).toBeTruthy()
    const correction = within(dialog).getByRole("link", {
      name: "Koreksi presensi keluar terlewat",
    })
    expect(correction.getAttribute("href")).toBe(
      "/requests?correction=missing_checkout&workDate=2026-11-05&outletId=3&tenantId=12&employeeId=34&sessionId=55"
    )
    expect(
      within(dialog).queryByRole("link", { name: /Ajukan sesi terlewat/ })
    ).toBeNull()
    expect(
      within(dialog).queryByRole("link", { name: "Koreksi session" })
    ).toBeNull()
    fireEvent.click(within(dialog).getAllByText("Lihat detail")[0])
    expect(within(dialog).getByText("Foto keluar tidak tersedia")).toBeTruthy()
    expect(
      within(dialog).queryByRole("button", { name: /Lihat foto keluar/ })
    ).toBeNull()
  })

  it("shows an explicit empty-day state, dismisses with Escape, and returns focus", async () => {
    const empty = { ...day, sessions: [], outcome: "no_recorded_outcome" }
    render(
      <EmployeeAttendanceHistory currentWorkDate="2026-11-07" days={[empty]} />
    )
    const trigger = screen.getByRole("button", { name: /Kamis, 5 November/ })
    fireEvent.click(trigger)
    const dialog = await screen.findByRole("dialog")
    expect(
      within(dialog).getByText("Belum ada sesi pada tanggal kerja ini.")
    ).toBeTruthy()
    expect(dialog.getAttribute("data-slot")).toBe("drawer-content")
    fireEvent.keyDown(document, { key: "Escape" })
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
    await waitFor(() => expect(document.activeElement).toBe(trigger))
  })

  it("uses the wide Sheet at tablet widths with a contained scroll region", async () => {
    viewportWidth = 1024
    const empty = { ...day, sessions: [], outcome: "no_recorded_outcome" }
    render(
      <EmployeeAttendanceHistory currentWorkDate="2026-11-07" days={[empty]} />
    )
    const trigger = screen.getByRole("button", { name: /Kamis, 5 November/ })
    fireEvent.click(trigger)
    const dialog = await screen.findByRole("dialog")
    expect(dialog.getAttribute("data-slot")).toBe("sheet-content")
    expect(dialog.getAttribute("data-side")).toBe("right")
    expect(dialog.getAttribute("aria-modal")).toBe("true")
    expect(dialog.className).toContain("overflow-hidden")
    expect(
      dialog.querySelector(".overflow-y-auto.overscroll-contain")
    ).toBeTruthy()
    fireEvent.keyDown(document, { key: "Escape" })
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
    await waitFor(() => expect(document.activeElement).toBe(trigger))
  })

  it("does not infer an unknown original Outlet from the effective or checkout Outlet", async () => {
    const noOrigin: EffectiveAttendanceDay = {
      ...day,
      sessions: [
        {
          ...session,
          outlet: { id: 18, name: "Outlet efektif" },
          original: {
            work_date: "2026-11-04",
            check_in_at: "2026-11-05T01:00:00Z",
            check_out_at: "2026-11-05T09:00:00Z",
          },
          correction: { request_id: 5, reason: "Koreksi disetujui" },
          checkout_destination: {
            id: 19,
            name: "Outlet tujuan",
            timezone: "Asia/Makassar",
          },
          evidence: [],
        },
      ],
    }
    render(
      <EmployeeAttendanceHistory
        currentWorkDate="2026-11-07"
        days={[noOrigin]}
      />
    )
    fireEvent.click(screen.getByRole("button", { name: /Kamis, 5 November/ }))
    const dialog = await screen.findByRole("dialog")
    const summary = dialog.querySelector("ol > li > section > div")
    expect(summary?.textContent).toContain("Belum tersedia")
    expect(summary?.textContent).not.toContain("Outlet efektif")
    expect(summary?.textContent).not.toContain("Outlet tujuan")
    fireEvent.click(within(dialog).getByText("Lihat detail"))
    expect(within(dialog).getByText("Work Date asal")).toBeTruthy()
    expect(within(dialog).getByText("Work Date efektif")).toBeTruthy()
    expect(
      Array.from(dialog.querySelectorAll("details[open] time")).map((time) =>
        time.getAttribute("dateTime")
      )
    ).toEqual(["2026-11-04", "2026-11-05"])
    expect(
      within(dialog).getByText("Outlet asal", { exact: true }).parentElement
        ?.textContent
    ).toContain("Belum tersedia")
  })

  it("shows only backend-eligible date-level reconstruction actions after expansion", async () => {
    const options: PersonalCorrectionOptions = {
      ...correctionOptions,
      reconstructions: [
        {
          ...correctionOptions.reconstructions[0],
          can_start: true,
        },
      ],
    }
    render(
      <EmployeeAttendanceHistory
        currentWorkDate="2026-11-07"
        days={[day]}
        correctionOptions={options}
      />
    )
    fireEvent.click(screen.getByRole("button", { name: /Kamis, 5 November/ }))
    const dialog = await screen.findByRole("dialog")
    const action = within(dialog).getByRole("link", {
      name: "Ajukan sesi terlewat · Outlet asal",
    })
    expect(action.closest("details")?.open).toBe(false)
    expect(action.getAttribute("href")).toBe(
      "/requests?correction=reconstruction&workDate=2026-11-05&outletId=3&tenantId=12&employeeId=34"
    )
    fireEvent.click(within(dialog).getByText("Koreksi sesi terlewat"))
    expect(action.closest("details")?.open).toBe(true)
  })
})

describe("personal attendance evidence", () => {
  it("loads no photo until requested and revokes its private blob on identity change", async () => {
    const before = JSON.stringify(day)
    openDay()
    expect(request).not.toHaveBeenCalled()
    await openSessionDetails()
    expect(screen.getByText("Outlet tujuan keluar")).toBeTruthy()
    fireEvent.click(
      screen.getByRole("button", { name: "Lihat foto masuk · sesi #55" })
    )
    const image = await screen.findByRole("img", {
      name: "Foto presensi masuk sesi #55",
    })
    expect(image.getAttribute("src")).toBe("blob:private-attendance-photo")
    expect(request).toHaveBeenCalledWith(
      "/api/v1/attendance/me/events/99/evidence",
      expect.objectContaining({
        credentials: "include",
        cache: "no-store",
        method: "GET",
      })
    )
    fireEvent(window, new Event(attendanceIdentityChangeEventName()))
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Foto presensi masuk" })
      ).toBeNull()
    )
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(
      "blob:private-attendance-photo"
    )
    expect(JSON.stringify(day)).toBe(before)
  })

  it("does not display bytes rejected after availability metadata became stale", async () => {
    request.mockImplementation(
      async () =>
        new Response(JSON.stringify({ message: "Unavailable" }), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        })
    )
    openDay()
    await openSessionDetails()
    fireEvent.click(
      screen.getByRole("button", { name: "Lihat foto masuk · sesi #55" })
    )
    expect(
      await screen.findByText(
        "Foto kedaluwarsa atau tidak tersedia untuk akun ini."
      )
    ).toBeTruthy()
    expect(screen.queryByRole("img")).toBeNull()
    expect(URL.createObjectURL).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole("button", { name: "Coba lagi" }))
    await waitFor(() => expect(request).toHaveBeenCalledTimes(2))
    expect(
      await screen.findByText(
        "Foto kedaluwarsa atau tidak tersedia untuk akun ini."
      )
    ).toBeTruthy()
    expect(
      request.mock.calls.every(
        ([url, options]) =>
          url === "/api/v1/attendance/me/events/99/evidence" &&
          options.method === "GET"
      )
    ).toBe(true)
    expect(URL.createObjectURL).not.toHaveBeenCalled()
  })

  it("aborts a closed viewer and discards a late response", async () => {
    let finish: (response: Response) => void = () => undefined
    request.mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          finish = resolve
        })
    )
    openDay()
    await openSessionDetails()
    fireEvent.click(
      screen.getByRole("button", { name: "Lihat foto masuk · sesi #55" })
    )
    expect(
      await screen.findByRole("dialog", { name: /Foto presensi masuk/ })
    ).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Tutup" }))
    expect(request.mock.calls[0][1].signal.aborted).toBe(true)
    await act(async () => {
      finish(
        new Response("jpeg", { headers: { "Content-Type": "image/jpeg" } })
      )
    })
    expect(URL.createObjectURL).not.toHaveBeenCalled()
    expect(screen.queryByRole("img")).toBeNull()
  })
})
