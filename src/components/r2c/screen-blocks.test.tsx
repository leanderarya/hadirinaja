// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { WorkDateRangeControl, FollowupCard } from "./screen-blocks"
import { EmployeeRosterRow } from "./components"
import { Table, TableBody } from "@/components/ui/table"

afterEach(cleanup)

describe("R2C screen blocks", () => {
  it("keeps an invalid range open without invoking the report request", () => {
    const apply = vi.fn()
    render(
      <WorkDateRangeControl from="2026-10-26" to="2026-10-30" onApply={apply} />
    )
    const details = screen
      .getByText("26–30 Okt 2026")
      .closest("details") as HTMLDetailsElement
    details.open = true
    fireEvent.change(screen.getByLabelText("Dari tanggal"), {
      target: { value: "2026-10-01" },
    })
    fireEvent.change(screen.getByLabelText("Sampai tanggal"), {
      target: { value: "2026-11-01" },
    })
    fireEvent.submit(
      screen
        .getByRole("button", { name: "Terapkan periode" })
        .closest("form") as HTMLFormElement
    )
    expect(apply).not.toHaveBeenCalled()
    expect(screen.getByRole("alert").textContent).toContain("31 hari")
    expect(details.open).toBe(true)
    fireEvent.change(screen.getByLabelText("Sampai tanggal"), {
      target: { value: "2026-10-31" },
    })
    fireEvent.submit(
      screen
        .getByRole("button", { name: "Terapkan periode" })
        .closest("form") as HTMLFormElement
    )
    expect(apply).toHaveBeenCalledWith({ from: "2026-10-01", to: "2026-10-31" })
    expect(details.open).toBe(false)
  })
  it("navigates to an explicit follow-up without running discovery", () => {
    render(
      <FollowupCard
        items={[
          {
            title: "Tinjauan presensi",
            description: "3 kasus",
            href: "/approvals",
            action: "Buka Persetujuan",
          },
        ]}
      />
    )
    expect(
      screen
        .getByRole("link", { name: "Buka Persetujuan" })
        .getAttribute("href")
    ).toBe("/approvals")
  })
  it("uses actual placement context without inventing an effective date", () => {
    render(
      <Table>
        <TableBody>
          <EmployeeRosterRow
            record={{
              name: "Nabila",
              employeeId: "EMP-014",
              placement: "Menteng",
              placementContext: "Penempatan aktif",
              accessLabel: "Terhubung",
              accessTone: "success",
              accountHelper: "Akun aktif",
            }}
          />
        </TableBody>
      </Table>
    )
    expect(screen.getByText("Penempatan aktif")).toBeTruthy()
    expect(screen.getByText("Akun aktif")).toBeTruthy()
    expect(screen.queryByText(/Berlaku/)).toBeNull()
  })
})
