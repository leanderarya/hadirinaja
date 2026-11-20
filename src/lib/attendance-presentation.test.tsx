// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import { EmployeeAttendanceHistory } from "@/components/employee-attendance-history"
import { EmployeeShell } from "@/components/employee-shell"
import {
  attendanceConfirmation,
  attendanceWorkDate,
  currentWeekAttendance,
  type EffectiveAttendanceDay,
  formatAttendanceTime,
} from "./attendance-presentation"

afterEach(cleanup)
const day: EffectiveAttendanceDay = {
  work_date: "2026-10-24",
  outcome: "present",
  is_finalized: false,
  review: { status: "resolved", indicators: ["unscheduled_work"] },
  unresolved_conflicts: [],
  sources: [
    {
      source_kind: "physical_session",
      source_id: 1,
      physical: { outlet_id: 7 },
    },
    {
      source_kind: "physical_session",
      source_id: 2,
      physical: { outlet_id: 7 },
    },
    {
      source_kind: "reconstruction",
      source_id: 3,
      effective: {
        outlet_id: 7,
        check_in_at: "2026-10-24T16:00:00Z",
        check_out_at: "2026-10-24T16:30:00Z",
      },
    },
  ],
  pending_corrections: [{ id: 17, details: { attendance_session_id: 2 } }],
  sessions: [2, 1].map((id) => ({
    id,
    recording_status: "closed",
    outlet: { id: 1, name: "Outlet QA" },
    original: {
      work_date: "2026-10-24",
      check_in_at: id === 1 ? "2026-10-24T15:00:00Z" : "2026-10-24T19:00:00Z",
      check_out_at: "2026-10-24T23:00:00Z",
      events: [{ id, type: "check_in", has_evidence: true }],
    },
    effective: {
      work_date: "2026-10-24",
      check_in_at: id === 1 ? "2026-10-24T15:00:00Z" : "2026-10-24T19:00:00Z",
      check_out_at: "2026-10-24T23:30:00Z",
    },
    schedule_snapshot: { timezone: "Asia/Jakarta" },
    review_indicators: [],
    correction: { request_id: 8, reason: "Koreksi disetujui pengelola" },
  })),
}

describe("employee attendance presentation", () => {
  it("opens a work date and orders physical sessions and approved reconstructions by start", async () => {
    render(
      <EmployeeAttendanceHistory
        days={[day]}
        outletNames={new Map([[7, "Outlet Asal QA"]])}
      />
    )
    const toggle = screen.getByRole("button", { name: /Sabtu, 24 Oktober/ })
    fireEvent.click(toggle)
    const dialog = await screen.findByRole("dialog")
    const sessions = within(dialog).getByRole("list", {
      name: "Sesi berurutan berdasarkan waktu masuk",
    })
    const rows = Array.from(sessions.children)
    expect(rows).toHaveLength(3)
    expect(rows[0].textContent).toContain("Sesi 1")
    expect(rows[0].textContent).toContain("Outlet Asal QA")
    expect(rows[1].textContent).toContain("Rekonstruksi disetujui")
    expect(rows[2].textContent).toContain("Sesi 3")
    expect(rows[2].textContent).toContain("Outlet Asal QA")
    expect(
      within(dialog).getByText("Belum ditetapkan · Sudah ditinjau")
    ).toBeTruthy()
    const firstDisclosure = rows[0].querySelector("summary")
    expect(firstDisclosure).toBeTruthy()
    if (firstDisclosure) fireEvent.click(firstDisclosure)
    expect(
      within(sessions)
        .getAllByText("Outlet Asal QA")
        .some((label) => label.closest("details")?.open)
    ).toBe(true)
    expect(
      within(sessions)
        .getAllByText("Outlet efektif")
        .some((label) => label.closest("details")?.open)
    ).toBe(true)
    expect(
      within(sessions)
        .getAllByText("Akses foto dari riwayat belum tersedia.")
        .some((label) => label.closest("details")?.open)
    ).toBe(true)
    expect(within(dialog).queryByRole("img")).toBeNull()
    const pendingDisclosure = rows[2].querySelector("summary")
    expect(pendingDisclosure).toBeTruthy()
    if (pendingDisclosure) fireEvent.click(pendingDisclosure)
    expect(
      within(dialog)
        .getByRole("link", { name: "Lihat koreksi yang menunggu" })
        .getAttribute("href")
    ).toBe("/requests#request-17")
  })
  it("uses the outlet's server date across midnight and excludes prior and future workdays", () => {
    const today = attendanceWorkDate("2026-10-25T17:00:00Z", "Asia/Jakarta")
    expect(today).toBe("2026-10-26")
    const days = ["2026-10-25", "2026-10-26", "2026-10-27"].map(
      (work_date) => ({ ...day, work_date })
    )
    expect(
      currentWeekAttendance(days, today)?.map((item) => item.work_date)
    ).toEqual(["2026-10-26"])
    expect(
      currentWeekAttendance(days, "2026-10-27")?.map((item) => item.work_date)
    ).toEqual(["2026-10-27", "2026-10-26"])
  })
  it("distinguishes unavailable projection from an empty response", () => {
    const view = render(<EmployeeAttendanceHistory days={undefined} />)
    expect(screen.getByText("Riwayat kehadiran belum tersedia")).toBeTruthy()
    view.rerender(<EmployeeAttendanceHistory days={[]} />)
    expect(screen.getByText("Belum ada riwayat")).toBeTruthy()
  })
  it("does not convert a missing timezone using the browser timezone", () => {
    expect(formatAttendanceTime("2026-10-24T23:00:00Z", undefined)).toContain(
      "zona waktu tidak tersedia"
    )
    expect(
      formatAttendanceTime("2026-10-24T23:00:00Z", "Asia/Jakarta")
    ).toContain("25 Okt")
  })
  it("uses recorded event time, not a local success timestamp", () => {
    expect(
      attendanceConfirmation({
        operation: { type: "check_out" },
        event: { recorded_at: "2026-10-24T23:00:00Z" },
        session: {
          timezone: "Asia/Jakarta",
          check_in_at: "2026-10-24T15:00:00Z",
          check_out_at: "2026-10-24T23:00:00Z",
        },
      })
    ).toMatch(/Presensi keluar dicatat oleh server.*25 Okt.*06.00/)
  })
  it("shows the approved four-link employee navigation, including Profile", () => {
    render(
      <EmployeeShell active="today">
        <p>Konten hari ini</p>
      </EmployeeShell>
    )
    const links = screen
      .getByRole("navigation", { name: "Navigasi karyawan" })
      .querySelectorAll("a")
    expect(Array.from(links).map((link) => link.getAttribute("href"))).toEqual([
      "/attendance",
      "/scheduling",
      "/requests",
      "/profile",
    ])
  })
})
