// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { AttendanceLocationStep } from "./attendance-location-step"
import { LocationMapPreview } from "./location-map-preview"

afterEach(cleanup)

const CAPTION = "Contoh tampilan · bukan penolakan nyata."

const base = {
  operation: "check_in" as const,
  map: <LocationMapPreview variant="resolved" />,
  tone: "neutral" as const,
  title: "Lokasi ditemukan",
  facts: "Outlet Sudirman · ± 18 m · akurasi ± 8 m",
  primary: { label: "Lanjut ke foto", onClick: () => undefined },
  caption: CAPTION,
}

const RECOVERY = {
  title: "Cara memperbaiki",
  steps: [
    "Buka setelan browser, pilih izin lokasi.",
    "Pilih Izinkan untuk situs HadirinAja.",
    "Muat ulang halaman, lalu ketuk Coba lagi.",
  ],
}

function slots(container: HTMLElement): string[] {
  const root = container.querySelector('[data-slot="attendance-location-step"]')
  if (!root) throw new Error("step root missing")
  return Array.from(root.querySelectorAll<HTMLElement>("[data-slot]"))
    .map((node) => node.dataset.slot ?? "")
    .filter((slot) =>
      [
        "location-map-preview",
        "attendance-location-status",
        "attendance-recovery-detail",
        "roam-button",
        "attendance-location-caption",
      ].includes(slot)
    )
}

describe("AttendanceLocationStep", () => {
  it("renders map → status → recovery → primary → secondary → caption", () => {
    const { container } = render(
      <AttendanceLocationStep
        {...base}
        recovery={RECOVERY}
        secondary={{ label: "Kembali ke Hari Ini", onClick: () => undefined }}
        tone="error"
      />
    )
    const order = slots(container)
    expect(order[0]).toBe("location-map-preview")
    expect(order[1]).toBe("attendance-location-status")
    expect(order[2]).toBe("attendance-recovery-detail")
    expect(order[3]).toBe("roam-button")
    expect(order[4]).toBe("roam-button")
    expect(order[5]).toBe("attendance-location-caption")
  })

  it("always renders the caption", () => {
    render(<AttendanceLocationStep {...base} />)
    expect(screen.getByText(CAPTION)).toBeDefined()
  })

  it("omits recovery entirely when not supplied", () => {
    const { container } = render(<AttendanceLocationStep {...base} />)
    expect(
      container.querySelector('[data-slot="attendance-recovery-detail"]')
    ).toBeNull()
    expect(container.textContent).not.toContain("Cara memperbaiki")
  })

  it("renders the primary at 52 and the secondary at 48 as an outline", () => {
    render(
      <AttendanceLocationStep
        {...base}
        secondary={{ label: "Kembali ke Hari Ini", onClick: () => undefined }}
      />
    )
    const primary = screen.getByRole("button", { name: "Lanjut ke foto" })
    const secondary = screen.getByRole("button", {
      name: "Kembali ke Hari Ini",
    })
    expect(primary.style.height).toBe("52px")
    expect(secondary.style.height).toBe("48px")
    expect(secondary.dataset.variant).toBe("secondary")
    expect(secondary.style.background).toBe("transparent")
  })

  it("renders a disabled primary that does not fire onClick", () => {
    const onClick = vi.fn()
    render(
      <AttendanceLocationStep
        {...base}
        primary={{ label: "Lanjut ke foto", onClick, disabled: true }}
      />
    )
    const primary = screen.getByRole("button", { name: "Lanjut ke foto" })
    expect((primary as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(primary)
    expect(onClick).not.toHaveBeenCalled()
  })

  it("passes tone, title, facts and status icon through to the status line", () => {
    const { container } = render(
      <AttendanceLocationStep
        {...base}
        statusIcon={<svg data-testid="status-glyph" />}
        tone="error"
        title="Izin lokasi ditolak"
        facts="Tanpa izin, absensi belum bisa dilanjutkan."
      />
    )
    const status = container.querySelector<HTMLElement>(
      '[data-slot="attendance-location-status"]'
    )
    expect(status?.dataset.tone).toBe("error")
    expect(status?.getAttribute("role")).toBe("alert")
    expect(status?.textContent).toContain("Izin lokasi ditolak")
    expect(status?.textContent).toContain(
      "Tanpa izin, absensi belum bisa dilanjutkan."
    )
    expect(screen.getByTestId("status-glyph")).toBeDefined()
  })

  it("keeps recovery collapsed so the retry stays reachable", () => {
    const { container } = render(
      <AttendanceLocationStep
        {...base}
        recovery={RECOVERY}
        secondary={{ label: "Kembali ke Hari Ini", onClick: () => undefined }}
        tone="error"
      />
    )
    const toggle = container.querySelector<HTMLElement>(
      '[data-slot="attendance-recovery-detail-summary"]'
    )
    expect(toggle?.getAttribute("aria-expanded")).toBe("false")
    expect(
      container.querySelector<HTMLElement>(
        '[data-slot="attendance-recovery-detail-body"]'
      )?.hidden
    ).toBe(true)
    // The retry action is on screen without expanding the detail.
    expect(screen.getByRole("button", { name: "Lanjut ke foto" })).toBeDefined()
  })
})
