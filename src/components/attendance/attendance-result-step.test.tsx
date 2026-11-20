// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { AttendanceResultStep } from "./attendance-result-step"

afterEach(cleanup)

const base = {
  headline: "Mengirim Check-in",
  description: "Tunggu hingga hasil pengiriman muncul.",
  caption: "Check-in belum dikirim.",
}

const details = [
  { label: "Jenis aksi", value: "Check-in" },
  { label: "Outlet tujuan", value: "Outlet Sudirman", emphasis: true },
]

describe("AttendanceResultStep", () => {
  it("keeps the plain heading and the summary card while the request is in flight", () => {
    const { container } = render(
      <AttendanceResultStep {...base} details={details} variant="progress" />
    )
    expect(container.querySelector('[data-slot="roam-status-card"]')).toBeNull()
    expect(
      container.querySelector('[data-slot="roam-status-message"]')
    ).toBeNull()
    const heading = screen.getByRole("heading", { name: "Mengirim Check-in" })
    expect(heading.style.fontSize).toBe("22px")
    expect(heading.style.fontWeight).toBe("700")
    // A3TMy composes uqxF6 as the card variant while sending.
    expect(
      container.querySelector<HTMLElement>(
        '[data-slot="attendance-confirmation-summary"]'
      )?.dataset.variant
    ).toBe("card")
  })

  it("treats checking the same way and shows no section title", () => {
    const { container } = render(
      <AttendanceResultStep {...base} details={details} variant="checking" />
    )
    expect(
      container.querySelector('[data-slot="attendance-result-details-title"]')
    ).toBeNull()
    expect(container.querySelector('[data-slot="roam-status-card"]')).toBeNull()
    expect(
      container.querySelector<HTMLElement>(
        '[data-slot="attendance-confirmation-summary"]'
      )?.dataset.variant
    ).toBe("card")
  })

  it("renders success with the centred 64px result card and a flat summary", () => {
    const { container } = render(
      <AttendanceResultStep
        {...base}
        details={details}
        detailsTitle="Data yang tercatat"
        variant="success"
      />
    )
    const card = container.querySelector<HTMLElement>(
      '[data-slot="roam-status-card"]'
    )
    expect(card?.dataset.tone).toBe("info")
    expect(card?.dataset.align).toBe("center")
    expect(card?.dataset.variant).toBe("result")
    expect(card?.style.padding).toBe("28px 20px")

    const headline = container.querySelector<HTMLElement>(
      '[data-slot="roam-status-card-headline"]'
    )
    expect(headline?.style.fontSize).toBe("22px")
    const medallion = container.querySelector<HTMLElement>(
      '[data-slot="roam-status-card-medallion"]'
    )
    expect(medallion?.style.width).toBe("64px")
    expect(medallion?.style.height).toBe("64px")

    expect(screen.getByText("Data yang tercatat")).toBeDefined()
    // wdXB0 draws the recorded facts as the flat full-bleed list.
    expect(
      container.querySelector<HTMLElement>(
        '[data-slot="attendance-confirmation-summary"]'
      )?.dataset.variant
    ).toBe("flat")
  })

  it("renders lost as an error result card with role=alert", () => {
    const { container } = render(
      <AttendanceResultStep {...base} variant="lost" />
    )
    const card = container.querySelector<HTMLElement>(
      '[data-slot="roam-status-card"]'
    )
    expect(card?.dataset.tone).toBe("error")
    expect(card?.dataset.variant).toBe("result")
    expect(card?.getAttribute("role")).toBe("alert")
  })

  it("renders out_of_range as an error card carrying the failure title", () => {
    const { container } = render(
      <AttendanceResultStep
        {...base}
        details={details}
        detailsTitle="Lokasi yang ditolak"
        variant="out_of_range"
      />
    )
    expect(
      container.querySelector<HTMLElement>('[data-slot="roam-status-card"]')
        ?.dataset.tone
    ).toBe("error")
    expect(
      container.querySelector<HTMLElement>('[data-slot="roam-status-card"]')
        ?.dataset.variant
    ).toBe("result")
    expect(screen.getByText("Lokasi yang ditolak")).toBeDefined()
  })

  it("renders the confirmation summary for details", () => {
    const { container } = render(
      <AttendanceResultStep {...base} details={details} variant="success" />
    )
    const summary = container.querySelector<HTMLElement>(
      '[data-slot="attendance-confirmation-summary"]'
    )
    expect(summary).not.toBeNull()
    expect(
      summary?.querySelectorAll('[data-slot="attendance-summary-row"]')
    ).toHaveLength(2)
    expect(screen.getByText("Outlet Sudirman")).toBeDefined()
  })

  it("keeps recovery steps outside the status card and wires the actions", () => {
    const onPrimary = vi.fn()
    const onSecondary = vi.fn()
    const { container } = render(
      <AttendanceResultStep
        {...base}
        primary={{ label: "Coba lagi", onClick: onPrimary }}
        recoverySteps={["Periksa koneksi internet."]}
        recoveryTitle="Sebelum mencoba lagi"
        secondary={{
          label: "Kembali ke halaman presensi",
          onClick: onSecondary,
        }}
        variant="lost"
      />
    )
    const card = container.querySelector<HTMLElement>(
      '[data-slot="roam-status-card"]'
    )
    expect(card?.textContent).not.toContain("Periksa koneksi internet.")

    const recovery = container.querySelector<HTMLElement>(
      '[data-slot="attendance-recovery"]'
    )
    expect(recovery?.textContent).toContain("Periksa koneksi internet.")

    const primary = screen.getByRole("button", { name: "Coba lagi" })
    const secondary = screen.getByRole("button", {
      name: "Kembali ke halaman presensi",
    })
    expect(primary.style.height).toBe("52px")
    expect(secondary.style.height).toBe("48px")
    expect(secondary.dataset.variant).toBe("secondary")

    const stack = container.querySelector<HTMLElement>(
      '[data-slot="attendance-action-stack"]'
    )
    expect(stack?.style.gap).toBe("12px")

    fireEvent.click(primary)
    fireEvent.click(secondary)
    expect(onPrimary).toHaveBeenCalledTimes(1)
    expect(onSecondary).toHaveBeenCalledTimes(1)
    expect(screen.getByText("Check-in belum dikirim.")).toBeDefined()
  })

  it("renders a secondary link as an anchor when href is given", () => {
    const { container } = render(
      <AttendanceResultStep
        {...base}
        secondary={{ href: "#history", label: "Lihat riwayat absensi" }}
        variant="success"
      />
    )
    const link = screen.getByRole("link", { name: "Lihat riwayat absensi" })
    expect(link.getAttribute("href")).toBe("#history")
    expect(link.style.height).toBe("48px")
    expect(link.style.borderRadius).toBe("999px")
    // wdXB0 keeps a 12px gap between the primary and the anchor secondary.
    const stack = container.querySelector<HTMLElement>(
      '[data-slot="attendance-action-stack"]'
    )
    expect(stack?.style.gap).toBe("12px")
    expect(link.closest('[data-slot="attendance-action-stack"]')).not.toBeNull()
  })
})
