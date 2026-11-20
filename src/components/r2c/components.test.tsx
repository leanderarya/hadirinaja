// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  AttendanceProjection,
  AttendanceRecovery,
  EvidenceAccess,
  LabeledControl,
  MembershipContext,
} from "@/components/r2c/components"
import { r2cComponents } from "@/components/r2c/catalog"
import { Input } from "@/components/ui/input"

afterEach(cleanup)

describe("R2C native patterns", () => {
  it("labels invalid controls and announces the actual validation message", () => {
    render(
      <LabeledControl
        label="Tanggal berlaku"
        control={<Input />}
        helper="Tanggal lokal"
        error="Tanggal tidak tersedia"
      />
    )
    const input = screen.getByLabelText("Tanggal berlaku")
    expect(input.getAttribute("aria-invalid")).toBe("true")
    expect(input.getAttribute("aria-describedby")).toBe(
      screen.getByRole("alert").id
    )
    expect(screen.getByRole("alert").textContent).toBe("Tanggal tidak tersedia")
  })

  it("keeps proposed values separate from effective attendance", () => {
    render(
      <AttendanceProjection
        original="08:10–17:00"
        effective="08:10–17:00"
        proposed="08:00–17:00"
      />
    )
    expect(
      screen.getByText("Efektif saat ini").nextElementSibling?.textContent
    ).toBe("08:10–17:00")
    expect(
      screen.getByText("Usulan koreksi").nextElementSibling?.textContent
    ).toBe("08:00–17:00")
    expect(
      screen.getByText(/Usulan yang menunggu keputusan belum mengubah nilai efektif/)
    ).toBeTruthy()
  })

  it("recovers only through the provided status action, with no new attendance operation", () => {
    const check = vi.fn()
    render(<AttendanceRecovery onCheck={check} />)
    expect(check).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole("button", { name: "Periksa status" }))
    expect(check).toHaveBeenCalledOnce()
    expect(
      screen.queryByRole("button", { name: /Check-in|Catat masuk/ })
    ).toBeNull()
  })

  it("discloses evidence auditing before any explicit access action", () => {
    const open = vi.fn()
    render(<EvidenceAccess onOpen={open} disabled />)
    expect(
      screen.getByText(/Membuka atau mengunduh bukti mencatat/)
    ).toBeTruthy()
    expect(open).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole("button", { name: "Buka bukti" }))
    expect(open).not.toHaveBeenCalled()
  })

  it("shows membership roles as data without a capability-changing control", () => {
    render(
      <MembershipContext
        roles={["Owner", "Employee"]}
        tenantName="Tenant contoh"
      />
    )
    expect(screen.getByText("Owner · Employee")).toBeTruthy()
    expect(screen.queryByRole("combobox")).toBeNull()
    expect(screen.queryByRole("switch")).toBeNull()
  })

  it("accounts for exactly the approved 22 native origins", () => {
    expect(r2cComponents).toHaveLength(22)
    expect(new Set(r2cComponents.map((item) => item.penId)).size).toBe(22)
  })
})
