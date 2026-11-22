// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { EmployeeAttendanceHomeCard } from "./employee-attendance-home-card"

afterEach(cleanup)

describe("employee attendance home card", () => {
  it("shows only check-in before the workday starts", () => {
    render(
      <EmployeeAttendanceHomeCard
        state="not-checked-in"
        greeting="Selamat pagi, Rani"
        duration={null}
        checkInTime={null}
        timeRange={null}
        canCheckIn
        canCheckOut={false}
        onCheckIn={vi.fn()}
        onCheckOut={vi.fn()}
      />
    )

    expect(screen.getByRole("button", { name: "Absen masuk" })).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Absen keluar" })).toBeNull()
  })

  it("shows only check-out while the employee is working", () => {
    render(
      <EmployeeAttendanceHomeCard
        state="working"
        greeting=""
        duration="5 j 23 m"
        checkInTime="08.05"
        timeRange={null}
        canCheckIn={false}
        canCheckOut
        onCheckIn={vi.fn()}
        onCheckOut={vi.fn()}
      />
    )

    expect(screen.getByRole("button", { name: "Absen keluar" })).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Absen masuk" })).toBeNull()
    expect(screen.getByText("5 j 23 m")).toBeTruthy()
  })

  it("shows no attendance action after the day is finished", () => {
    render(
      <EmployeeAttendanceHomeCard
        state="finished"
        greeting=""
        duration="9 j 07 m"
        checkInTime={null}
        timeRange="08.05 – 17.12"
        canCheckIn={false}
        canCheckOut={false}
        onCheckIn={vi.fn()}
        onCheckOut={vi.fn()}
      />
    )

    expect(screen.getByText("Selesai hari ini")).toBeTruthy()
    expect(screen.queryByRole("button")).toBeNull()
  })
})
