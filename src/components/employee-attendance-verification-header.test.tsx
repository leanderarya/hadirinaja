// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { EmployeeAttendanceVerificationHeader } from "./employee-attendance-verification-header"

describe("employee attendance verification header", () => {
  it("shows a compact title and accessible back action", () => {
    const onBack = vi.fn()
    render(
      <EmployeeAttendanceVerificationHeader
        title="Absen masuk"
        onBack={onBack}
      />
    )

    expect(screen.getByRole("heading", { name: "Absen masuk" })).toBeTruthy()
    const back = screen.getByRole("button", {
      name: "Kembali ke halaman presensi",
    })
    expect(back.textContent).toBe("")
    fireEvent.click(back)
    expect(onBack).toHaveBeenCalledOnce()
  })

  it("uses a link for preview navigation", () => {
    render(
      <EmployeeAttendanceVerificationHeader
        title="Absen keluar"
        backHref="/attendance"
      />
    )

    expect(
      screen
        .getByRole("link", { name: "Kembali ke halaman presensi" })
        .getAttribute("href")
    ).toBe("/attendance")
  })
})
