// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { RoamButton } from "./roam-button"

afterEach(cleanup)

describe("RoamButton", () => {
  it("renders the WBM9u primary pill at 52px", () => {
    render(<RoamButton>Check-in</RoamButton>)
    const button = screen.getByRole("button", { name: "Check-in" })

    expect(button.style.height).toBe("52px")
    expect(button.style.borderRadius).toBe("999px")
    expect(button.style.background).toBe("rgb(14, 14, 16)")
    expect(button.style.color).toBe("rgb(255, 255, 255)")
    expect(button.style.fontWeight).toBe("700")
    expect(button.style.fontSize).toBe("14px")
  })

  it("renders the secondary control at 48px with a 1px dark border", () => {
    render(<RoamButton variant="secondary">Kembali</RoamButton>)
    const button = screen.getByRole("button", { name: "Kembali" })

    expect(button.style.height).toBe("48px")
    expect(button.style.background).toBe("transparent")
    expect(button.style.border).toBe("1px solid rgb(14, 14, 16)")
    expect(button.style.color).toBe("rgb(14, 14, 16)")
    expect(button.style.fontWeight).toBe("600")
  })

  it("renders danger as the #9B2937 outline from WBM9u", () => {
    render(<RoamButton variant="danger">Batal check-in</RoamButton>)
    const button = screen.getByRole("button", { name: "Batal check-in" })

    expect(button.style.background).toBe("transparent")
    expect(button.style.border).toBe("1px solid rgb(155, 41, 55)")
    expect(button.style.color).toBe("rgb(155, 41, 55)")
    expect(button.style.height).toBe("48px")
    expect(button.style.borderRadius).toBe("999px")
  })

  it("disables without dimming or collapsing the box", () => {
    render(
      <RoamButton disabled fullWidth>
        Simpan
      </RoamButton>
    )
    const button = screen.getByRole<HTMLButtonElement>("button", {
      name: "Simpan",
    })

    expect(button.disabled).toBe(true)
    expect(button.style.background).toBe("rgb(229, 231, 235)")
    expect(button.style.color).toBe("rgb(82, 88, 102)")
    expect(button.style.opacity).toBe("1")
    expect(button.style.cursor).toBe("default")
    expect(button.style.width).toBe("100%")
  })

  it("swaps in a loading label while keeping the height and blocking clicks", () => {
    const onClick = vi.fn()
    render(
      <RoamButton loading onClick={onClick}>
        Simpan
      </RoamButton>
    )
    const button = screen.getByRole<HTMLButtonElement>("button", {
      name: "Memuat…",
    })

    expect(button.getAttribute("aria-busy")).toBe("true")
    expect(button.style.height).toBe("52px")
    expect(button.disabled).toBe(true)
    fireEvent.click(button)
    expect(onClick).not.toHaveBeenCalled()
  })

  it("wires clicks, honours the minimum size and merges className last", () => {
    const onClick = vi.fn()
    render(
      <RoamButton
        className="custom-class"
        onClick={onClick}
        size="min"
        type="submit"
      >
        Kirim
      </RoamButton>
    )
    const button = screen.getByRole<HTMLButtonElement>("button", {
      name: "Kirim",
    })

    expect(button.type).toBe("submit")
    expect(button.style.height).toBe("44px")
    fireEvent.click(button)
    expect(onClick).toHaveBeenCalledOnce()
    expect(button.className).toContain("roam-button")
    expect(button.className).toContain("custom-class")
  })

  it("puts the primary icon after the label and the secondary icon before it", () => {
    const { container: primary } = render(
      <RoamButton icon={<span data-testid="primary-icon" />}>Kirim</RoamButton>
    )
    expect(
      primary.querySelector('[data-testid="primary-icon"]')?.parentElement
    ).toBe(primary.querySelector('[data-slot="roam-button"]')?.lastElementChild)
    cleanup()

    const { container: secondary } = render(
      <RoamButton
        icon={<span data-testid="secondary-icon" />}
        variant="secondary"
      >
        Kembali
      </RoamButton>
    )
    expect(
      secondary.querySelector('[data-testid="secondary-icon"]')?.parentElement
    ).toBe(
      secondary.querySelector('[data-slot="roam-button"]')?.firstElementChild
    )
  })
})
