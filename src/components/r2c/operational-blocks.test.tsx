// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  ScheduleMatrix,
  WorkWeekControl,
  scheduleTimeLabel,
  type ScheduleDaySummary,
} from "./operational-blocks"
import { ApprovalQueueItem, EvidenceAccess } from "./components"

afterEach(cleanup)
const day: ScheduleDaySummary = {
  work_date: "2026-10-26",
  status: "scheduled",
  outlet: { id: 1, name: "Menteng" },
  shift: {
    start_time: "09:30:00",
    end_time: "17:00:00",
    crosses_midnight: false,
  },
  provenance: {
    source: "weekly_rule",
    schedule_rule_id: 1,
    exception_id: null,
  },
  conflicts: [],
}
describe("R2C operational screen blocks", () => {
  it("preserves partial hours, overnight and exception sources without inventing schedule state", () => {
    expect(scheduleTimeLabel(day)).toBe("09:30–17")
    expect(
      scheduleTimeLabel({
        ...day,
        shift: {
          start_time: "09:30:00",
          end_time: "17:00:00",
          crosses_midnight: true,
        },
        provenance: { ...day.provenance, exception_id: 2 },
      })
    ).toBe("09:30–17 +1*")
    expect(scheduleTimeLabel({ ...day, status: "rest", shift: null })).toBe(
      "Libur"
    )
    expect(
      scheduleTimeLabel({ ...day, status: "unscheduled", shift: null })
    ).toBe("Belum diatur")
    expect(scheduleTimeLabel({ ...day, conflicts: ["outlet_closed"] })).toBe(
      "Konflik"
    )
  })
  it("opens the exact employee/day source through an accessible matrix action", () => {
    const open = vi.fn()
    render(
      <ScheduleMatrix
        days={[day.work_date]}
        employees={[{ id: 3, name: "Arif", days: [day] }]}
        onSelect={open}
      />
    )
    expect(open).not.toHaveBeenCalled()
    fireEvent.click(
      screen.getAllByRole("button", { name: /Arif.*Buka rincian/ })[0]
    )
    expect(open).toHaveBeenCalledWith(expect.objectContaining({ id: 3 }), day)
  })
  it("keeps week selection explicit, closes on Escape and labels its native date input", () => {
    const change = vi.fn()
    render(<WorkWeekControl weekStart="2026-10-26" onChange={change} />)
    const button = screen.getByRole("button", { name: /Minggu kerja/ })
    const details = button.closest("details")
    if (!details) throw new Error("Week control requires a disclosure")
    details.open = true
    expect(change).not.toHaveBeenCalled()
    fireEvent.keyDown(button, { key: "Escape" })
    expect(details.open).toBe(false)
    details.open = true
    fireEvent.change(screen.getByLabelText("Pilih tanggal dalam minggu"), {
      target: { value: "2026-11-02" },
    })
    expect(change).toHaveBeenCalledWith("2026-11-02")
    expect(details.open).toBe(false)
  })
  it("discloses auditing with a caller-supplied evidence action and preserves disabled queue boundaries", () => {
    const open = vi.fn()
    render(
      <>
        <EvidenceAccess
          actions={
            <button type="button" onClick={open}>
              Bukti sintetis
            </button>
          }
        />
        <ApprovalQueueItem
          subject="Arif"
          requestType="Izin"
          context="Menteng"
          status="Disetujui"
          tone="success"
          disabled
          onSelect={open}
        />
      </>
    )
    expect(open).not.toHaveBeenCalled()
    expect(screen.getByText(/Membuka atau mengunduh bukti/)).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: /Arif/ }))
    expect(open).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole("button", { name: "Bukti sintetis" }))
    expect(open).toHaveBeenCalledOnce()
  })
})
