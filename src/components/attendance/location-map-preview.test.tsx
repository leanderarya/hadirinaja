// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"

import { LocationMapPreview } from "./location-map-preview"

afterEach(cleanup)

const RESOLVED_COPY = [
  "Menyiapkan peta…",
  "Peta tidak bisa dimuat",
  "Izinkan lokasi untuk melihat peta",
]

function frame(container: HTMLElement): HTMLElement {
  const node = container.querySelector<HTMLElement>(
    '[data-slot="location-map-preview"]'
  )
  if (!node) throw new Error("map frame missing")
  return node
}

function scene(container: HTMLElement): HTMLElement | null {
  return container.querySelector<HTMLElement>(
    '[data-slot="location-map-preview-scene"]'
  )
}

function dot(container: HTMLElement): HTMLElement | null {
  return container.querySelector<HTMLElement>(
    '[data-slot="location-map-preview-device-dot"]'
  )
}

describe("LocationMapPreview", () => {
  it("gives each variant its own copy", () => {
    render(<LocationMapPreview variant="loading" />)
    expect(screen.getByText("Menyiapkan peta…")).toBeDefined()
    cleanup()

    render(<LocationMapPreview variant="unavailable" />)
    expect(screen.getByText("Peta tidak bisa dimuat")).toBeDefined()
    cleanup()

    render(<LocationMapPreview variant="permission_denied" />)
    expect(screen.getByText("Izinkan lokasi untuk melihat peta")).toBeDefined()
  })

  it("resolved draws the scene and outlet pill but no state caption", () => {
    render(
      <LocationMapPreview
        deviceOffset={{ x: 0.6, y: 0.5 }}
        outletName="Outlet Sudirman"
        variant="resolved"
      />
    )
    expect(screen.getByText("Outlet Sudirman")).toBeDefined()
    for (const copy of RESOLVED_COPY) {
      expect(screen.queryByText(copy)).toBeNull()
    }
  })

  it("holds the 362×132 radius-20 frame with a 1px #E5E7EB border in every variant", () => {
    for (const variant of [
      "resolved",
      "loading",
      "unavailable",
      "permission_denied",
    ] as const) {
      const { container, unmount } = render(
        <LocationMapPreview variant={variant} />
      )
      const node = frame(container)
      expect(node.style.height).toBe("132px")
      expect(node.style.maxWidth).toBe("362px")
      expect(node.style.borderRadius).toBe("20px")
      expect(node.style.border).toBe("1px solid rgb(229, 231, 235)")
      unmount()
    }
  })

  it("draws the device dot only for resolved", () => {
    const resolved = render(<LocationMapPreview variant="resolved" />)
    expect(dot(resolved.container)).not.toBeNull()
    resolved.unmount()

    for (const variant of [
      "loading",
      "unavailable",
      "permission_denied",
    ] as const) {
      const { container, unmount } = render(
        <LocationMapPreview variant={variant} />
      )
      expect(dot(container)).toBeNull()
      unmount()
    }
  })

  it("clamps deviceOffset to the documented range and moves the dot", () => {
    const low = render(
      <LocationMapPreview deviceOffset={{ x: -4, y: -4 }} variant="resolved" />
    )
    const lowDot = dot(low.container)
    const atZero = render(
      <LocationMapPreview deviceOffset={{ x: 0, y: 0 }} variant="resolved" />
    )
    const zeroDot = dot(atZero.container)
    expect(lowDot?.style.left).toBe(zeroDot?.style.left)
    expect(lowDot?.style.top).toBe(zeroDot?.style.top)
    low.unmount()
    atZero.unmount()

    // Offsets above 1 are legal: they place the dot outside the radius field,
    // which is how the out-of-range frames show a rejection.
    const high = render(
      <LocationMapPreview deviceOffset={{ x: 99, y: 99 }} variant="resolved" />
    )
    const atMax = render(
      <LocationMapPreview
        deviceOffset={{ x: 1.6, y: 1.6 }}
        variant="resolved"
      />
    )
    expect(dot(high.container)?.style.left).toBe(
      dot(atMax.container)?.style.left
    )
    expect(dot(high.container)?.style.top).toBe(dot(atMax.container)?.style.top)
    high.unmount()
    atMax.unmount()

    const near = render(
      <LocationMapPreview
        deviceOffset={{ x: 0.2, y: 0.2 }}
        variant="resolved"
      />
    )
    const far = render(
      <LocationMapPreview
        deviceOffset={{ x: 0.8, y: 0.8 }}
        variant="resolved"
      />
    )
    expect(dot(near.container)?.style.left).not.toBe(
      dot(far.container)?.style.left
    )
    expect(dot(near.container)?.style.top).not.toBe(
      dot(far.container)?.style.top
    )
  })

  it("does not throw on non-finite offsets", () => {
    expect(() =>
      render(
        <LocationMapPreview
          deviceOffset={{ x: Number.POSITIVE_INFINITY, y: Number.NaN }}
          variant="resolved"
        />
      )
    ).not.toThrow()
  })

  it("hides the decorative scene from assistive tech and states the variant in text", () => {
    const { container } = render(<LocationMapPreview variant="resolved" />)
    expect(scene(container)?.getAttribute("aria-hidden")).toBe("true")

    cleanup()
    render(<LocationMapPreview variant="unavailable" />)
    expect(screen.getByText("Peta tidak bisa dimuat")).toBeDefined()
  })
})
