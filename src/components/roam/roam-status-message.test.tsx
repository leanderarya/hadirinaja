// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { RoamStatusMessage } from "./roam-status-message"

afterEach(cleanup)

describe("RoamStatusMessage", () => {
  it("renders the esTPz box at radius 16 with 12px title and body", () => {
    render(
      <RoamStatusMessage
        body="Menyiapkan kamera."
        title="Memuat"
        tone="progress"
      />
    )
    const message = screen.getByRole("status")

    expect(message.style.borderRadius).toBe("16px")
    expect(message.style.padding).toBe("14px")
    expect(message.style.background).toBe("rgb(244, 245, 248)")
    expect(screen.getByRole("heading", { name: "Memuat" }).style.fontSize).toBe(
      "12px"
    )
    expect(screen.getByText("Menyiapkan kamera.").style.fontWeight).toBe("500")
  })

  it("maps every tone surface", () => {
    const view = render(<RoamStatusMessage body="b" title="t" tone="info" />)
    const surfaces: Array<["info" | "progress" | "error" | "locked", string]> =
      [
        ["info", "rgb(191, 209, 250)"],
        ["error", "rgb(252, 237, 239)"],
        ["locked", "rgb(244, 245, 248)"],
      ]

    for (const [tone, background] of surfaces) {
      view.rerender(<RoamStatusMessage body="b" title="t" tone={tone} />)
      expect(
        view.container.querySelector<HTMLElement>(
          "[data-slot='roam-status-message']"
        )?.style.background
      ).toBe(background)
    }
  })

  it("keeps a retry control beneath an error message and defaults to alert", () => {
    const onClick = vi.fn()
    render(
      <RoamStatusMessage
        action={{ label: "Coba lagi", onClick }}
        body="Hasil check-in belum dapat dipastikan."
        title="Koneksi terputus"
        tone="error"
      />
    )
    const message = screen.getByRole("alert")
    const button = screen.getByRole("button", { name: "Coba lagi" })

    expect(message.style.background).toBe("rgb(252, 237, 239)")
    expect(button.style.height).toBe("48px")
    expect(button.style.border).toBe("1px solid rgb(14, 14, 16)")
    expect(message.lastElementChild).toBe(button)
    fireEvent.click(button)
    expect(onClick).toHaveBeenCalledOnce()
  })

  it("allows an explicit role override", () => {
    render(
      <RoamStatusMessage
        body="Menunggu."
        role="alert"
        title="Terkunci"
        tone="locked"
      />
    )
    const message = screen.getByRole("alert")

    expect(message.style.background).toBe("rgb(244, 245, 248)")
    expect(screen.queryByRole("status")).toBeNull()
    expect(screen.queryByRole("button")).toBeNull()
  })
})
