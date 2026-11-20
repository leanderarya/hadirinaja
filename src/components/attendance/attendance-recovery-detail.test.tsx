// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"

import { AttendanceRecoveryDetail } from "./attendance-recovery-detail"

afterEach(cleanup)

const STEPS = [
  "Buka setelan browser, pilih izin lokasi.",
  "Pilih Izinkan untuk situs HadirinAja.",
  "Muat ulang halaman, lalu ketuk Coba lagi.",
]

function summary(container: HTMLElement): HTMLButtonElement {
  const node = container.querySelector<HTMLButtonElement>(
    '[data-slot="attendance-recovery-detail-summary"]'
  )
  if (!node) throw new Error("summary row missing")
  return node
}

function body(container: HTMLElement): HTMLElement | null {
  return container.querySelector<HTMLElement>(
    '[data-slot="attendance-recovery-detail-body"]'
  )
}

describe("AttendanceRecoveryDetail", () => {
  it("starts collapsed: no visible body, aria-expanded=false", () => {
    const { container } = render(
      <AttendanceRecoveryDetail steps={STEPS} title="Cara memperbaiki" />
    )
    const button = summary(container)
    expect(button.getAttribute("aria-expanded")).toBe("false")
    expect(button.textContent).toContain("Cara memperbaiki")
    expect(body(container)?.hidden).toBe(true)
    expect(button.getAttribute("aria-controls")).toBe(body(container)?.id)
  })

  it("keeps the summary row exactly 44px tall", () => {
    const { container } = render(
      <AttendanceRecoveryDetail steps={STEPS} title="Cara memperbaiki" />
    )
    const button = summary(container)
    expect(button.style.height).toBe("44px")
    expect(button.style.minHeight).toBe("44px")
    expect(button.style.padding).toBe("0px 14px")
  })

  it("expands on click and reveals the numbered steps", () => {
    const { container } = render(
      <AttendanceRecoveryDetail steps={STEPS} title="Cara memperbaiki" />
    )
    const button = summary(container)
    fireEvent.click(button)

    expect(button.getAttribute("aria-expanded")).toBe("true")
    expect(body(container)?.hidden).toBe(false)
    for (const [index, step] of STEPS.entries()) {
      expect(screen.getByText(step)).toBeDefined()
      expect(body(container)?.textContent).toContain(`${index + 1}. ${step}`)
    }
  })

  it("is a real button and toggles with Enter and Space", () => {
    const { container } = render(
      <AttendanceRecoveryDetail steps={STEPS} title="Cara memperbaiki" />
    )
    const button = summary(container)
    expect(button.tagName).toBe("BUTTON")
    expect(button.getAttribute("type")).toBe("button")
    expect(button.disabled).toBe(false)
    expect(button.tabIndex).toBe(0)

    fireEvent.keyDown(button, { key: "Enter" })
    expect(button.getAttribute("aria-expanded")).toBe("true")

    fireEvent.keyDown(button, { key: " " })
    expect(button.getAttribute("aria-expanded")).toBe("false")
  })

  it("opens initially with defaultOpen", () => {
    const { container } = render(
      <AttendanceRecoveryDetail
        defaultOpen
        steps={STEPS}
        title="Cara memperbaiki"
      />
    )
    expect(summary(container).getAttribute("aria-expanded")).toBe("true")
    expect(body(container)?.hidden).toBe(false)
    expect(screen.getByText(STEPS[0])).toBeDefined()
  })

  it("draws the white card with a 1px #E5E7EB border and radius 16", () => {
    const { container } = render(
      <AttendanceRecoveryDetail steps={STEPS} title="Cara memperbaiki" />
    )
    const card = container.querySelector<HTMLElement>(
      '[data-slot="attendance-recovery-detail"]'
    )
    expect(card?.style.borderRadius).toBe("16px")
    expect(card?.style.border).toBe("1px solid rgb(229, 231, 235)")
    expect(card?.style.background).toBe("rgb(255, 255, 255)")
  })
})
