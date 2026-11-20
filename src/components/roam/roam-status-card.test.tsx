// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"

import { RoamStatusCard, type RoamStatusTone } from "./roam-status-card"

afterEach(cleanup)

describe("RoamStatusCard", () => {
  it("maps each tone to its canonical pastel surface with a 20px radius", () => {
    const view = render(
      <RoamStatusCard
        description="Menunggu jadwal."
        headline="Menunggu"
        tone="info"
      />
    )
    const card = screen.getByRole<HTMLElement>("status")

    expect(card.getAttribute("data-tone")).toBe("info")
    expect(card.style.background).toBe("rgb(191, 209, 250)")
    expect(card.style.borderRadius).toBe("20px")
    expect(card.style.padding).toBe("20px")

    const expected: Array<[RoamStatusTone, string]> = [
      ["waiting", "rgb(239, 194, 99)"],
      ["request", "rgb(231, 159, 245)"],
      ["error", "rgb(252, 237, 239)"],
      ["neutral", "rgb(244, 245, 248)"],
    ]
    for (const [tone, background] of expected) {
      view.rerender(<RoamStatusCard description="x" headline="y" tone={tone} />)
      const painted = view.container.querySelector<HTMLElement>(
        "[data-slot='roam-status-card']"
      )
      expect(painted?.style.background).toBe(background)
    }
  })

  it("selects the alert role and the error text colour for the error tone", () => {
    render(
      <RoamStatusCard
        description="Coba lagi sebentar."
        headline="Koneksi terputus"
        tone="error"
      />
    )
    const card = screen.getByRole("alert")

    expect(card.style.color).toBe("rgb(155, 41, 55)")
    expect(
      screen.getByRole("heading", { name: "Koneksi terputus" }).style.fontSize
    ).toBe("25px")
    expect(screen.getByText("Coba lagi sebentar.").style.fontWeight).toBe("500")
  })

  it("uses 22px headlines when compact and keeps a caller-supplied role", () => {
    render(
      <RoamStatusCard
        compact
        description="Lokasi ditemukan."
        headline="Siap check-in"
        role="status"
        tone="waiting"
      />
    )
    const card = screen.getByRole("status")

    expect(
      screen.getByRole("heading", { name: "Siap check-in" }).style.fontSize
    ).toBe("22px")
    expect(card.style.color).toBe("rgb(14, 14, 16)")
  })

  it("puts the icon in a 56px round medallion", () => {
    render(
      <RoamStatusCard
        description="Di luar radius outlet."
        headline="Di luar jangkauan"
        icon={<svg aria-hidden="true" />}
        tone="request"
      />
    )
    const medallion = document.querySelector(
      "[data-slot='roam-status-card-medallion']"
    )

    expect(medallion).not.toBeNull()
    expect((medallion as HTMLElement).style.height).toBe("56px")
    expect((medallion as HTMLElement).style.width).toBe("56px")
    expect((medallion as HTMLElement).style.borderRadius).toBe("999px")
    expect((medallion as HTMLElement).style.background).toBe(
      "rgb(251, 251, 253)"
    )
  })

  it("renders children after the description and never a button of its own", () => {
    render(
      <RoamStatusCard description="Deskripsi" headline="Judul" tone="neutral">
        <p data-testid="caller-slot">Slot pemanggil</p>
      </RoamStatusCard>
    )
    const card = screen.getByRole("status")
    const children = card.querySelectorAll("[data-testid='caller-slot']")

    expect(children).toHaveLength(1)
    expect(card.lastElementChild?.getAttribute("data-testid")).toBe(
      "caller-slot"
    )
    expect(screen.queryByRole("button")).toBeNull()
  })
})
