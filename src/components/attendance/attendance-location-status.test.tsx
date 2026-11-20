// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"

import { AttendanceLocationStatus } from "./attendance-location-status"

afterEach(cleanup)

function status(container: HTMLElement): HTMLElement {
  const node = container.querySelector<HTMLElement>(
    '[data-slot="attendance-location-status"]'
  )
  if (!node) throw new Error("status surface missing")
  return node
}

describe("AttendanceLocationStatus", () => {
  it("uses #BFD1FA for neutral and #FCEDEF for error", () => {
    const neutral = render(
      <AttendanceLocationStatus
        facts="Outlet Sudirman · ± 18 m · akurasi ± 8 m"
        title="Lokasi ditemukan"
        tone="neutral"
      />
    )
    expect(status(neutral.container).style.background).toBe(
      "rgb(191, 209, 250)"
    )
    neutral.unmount()

    const error = render(
      <AttendanceLocationStatus
        facts="Tanpa izin, absensi belum bisa dilanjutkan."
        icon={<span />}
        title="Izin lokasi ditolak"
        tone="error"
      />
    )
    expect(status(error.container).style.background).toBe("rgb(252, 237, 239)")
  })

  it("paints the error icon #9B2937 and keeps the neutral icon #0E0E10", () => {
    const { container } = render(
      <AttendanceLocationStatus
        facts="GPS lemah atau akurasi rendah."
        icon={<svg data-testid="glyph" />}
        title="Lokasi belum terbaca"
        tone="error"
      />
    )
    const icon = container.querySelector<HTMLElement>(
      '[data-slot="attendance-location-status-icon"]'
    )
    expect(icon?.style.color).toBe("rgb(155, 41, 55)")
    expect(screen.getByTestId("glyph")).toBeDefined()
  })

  it("sets title 14/700 and facts 12/500", () => {
    const { container } = render(
      <AttendanceLocationStatus
        facts="Biasanya selesai dalam 5–10 detik."
        title="Mencari lokasi…"
        tone="neutral"
      />
    )
    const title = container.querySelector<HTMLElement>(
      '[data-slot="attendance-location-status-title"]'
    )
    const facts = container.querySelector<HTMLElement>(
      '[data-slot="attendance-location-status-facts"]'
    )
    expect(title?.style.fontSize).toBe("14px")
    expect(title?.style.fontWeight).toBe("700")
    expect(facts?.style.fontSize).toBe("12px")
    expect(facts?.style.fontWeight).toBe("500")
    expect(status(container).style.padding).toBe("12px 14px")
    expect(status(container).style.borderRadius).toBe("16px")
    expect(status(container).style.gap).toBe("4px")
  })

  it("defaults role to alert on error and status otherwise", () => {
    const error = render(
      <AttendanceLocationStatus facts="coba lagi" title="Gagal" tone="error" />
    )
    expect(status(error.container).getAttribute("role")).toBe("alert")
    error.unmount()

    const neutral = render(
      <AttendanceLocationStatus facts="tunggu" title="Mencari" tone="neutral" />
    )
    expect(status(neutral.container).getAttribute("role")).toBe("status")
    neutral.unmount()

    const override = render(
      <AttendanceLocationStatus
        facts="polite"
        role="status"
        title="Polite"
        tone="error"
      />
    )
    expect(status(override.container).getAttribute("role")).toBe("status")
  })
})
