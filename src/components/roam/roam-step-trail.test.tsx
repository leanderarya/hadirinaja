// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"

import { type RoamStep, RoamStepTrail } from "./roam-step-trail"

afterEach(cleanup)

const threeSteps: RoamStep[] = [
  { id: "location", label: "Lokasi", number: "1" },
  { id: "photo", label: "Foto", number: "2" },
  { id: "confirm", label: "Konfirmasi", number: "3" },
]

const twoSteps: RoamStep[] = [
  { id: "checkin", label: "Check-in", number: "1" },
  { id: "checkout", label: "Checkout", number: "2" },
]

function stepAt(index: number): HTMLElement {
  const steps = screen.getAllByRole("listitem")
  return steps[index] as HTMLElement
}

function circleAt(index: number): HTMLElement | null {
  return stepAt(index).querySelector<HTMLElement>(
    "[data-slot='roam-step-circle']"
  )
}

describe("RoamStepTrail", () => {
  it("fills the rail with equal columns and 28px circles", () => {
    render(<RoamStepTrail activeIndex={0} steps={threeSteps} />)
    const list = screen.getByRole("list", { name: "Langkah absensi" })

    expect(list.tagName).toBe("OL")
    expect(screen.getAllByRole("listitem")).toHaveLength(3)
    for (let index = 0; index < 3; index += 1) {
      expect(stepAt(index).style.flexGrow).toBe("1")
      expect(stepAt(index).style.flexBasis).toBe("0px")
    }
    expect(list.style.gap).toBe("8px")
    const circle = circleAt(0)
    expect(circle?.style.height).toBe("28px")
    expect(circle?.style.width).toBe("28px")
    expect(circle?.style.borderRadius).toBe("999px")
    expect(circle?.style.fontSize).toBe("12px")
  })

  it("colours done, current and pending states per the frame", () => {
    render(<RoamStepTrail activeIndex={1} steps={threeSteps} />)

    const done = stepAt(0)
    const doneCircle = circleAt(0)
    const doneLabel = done.querySelector<HTMLElement>(
      "[data-slot='roam-step-label']"
    )
    expect(done.getAttribute("data-state")).toBe("done")
    expect(doneCircle?.style.background).toBe("rgb(14, 14, 16)")
    expect(doneCircle?.style.color).toBe("rgb(255, 255, 255)")
    // The compact Location frames ink done labels #0E0E10 and carry the state in
    // the circle; only pending steps stay #525866.
    expect(doneLabel?.style.color).toBe("rgb(14, 14, 16)")

    const current = stepAt(1)
    const currentCircle = circleAt(1)
    const currentLabel = current.querySelector<HTMLElement>(
      "[data-slot='roam-step-label']"
    )
    expect(currentCircle?.style.background).toBe("rgb(191, 209, 250)")
    expect(currentCircle?.style.color).toBe("rgb(14, 14, 16)")
    expect(currentLabel?.style.color).toBe("rgb(14, 14, 16)")
    expect(currentLabel?.style.fontWeight).toBe("700")
    expect(currentLabel?.style.fontSize).toBe("12px")

    const pending = stepAt(2)
    const pendingCircle = circleAt(2)
    expect(pending.getAttribute("data-state")).toBe("pending")
    expect(pendingCircle?.style.background).toBe("rgb(244, 245, 248)")
    expect(pendingCircle?.style.color).toBe("rgb(14, 14, 16)")
    expect(
      pending.querySelector<HTMLElement>("[data-slot='roam-step-label']")?.style
        .color
    ).toBe("rgb(82, 88, 102)")
  })

  it("swaps the number for a check mark once a step is done", () => {
    render(<RoamStepTrail activeIndex={1} steps={threeSteps} />)

    expect(circleAt(0)?.querySelector("svg")).not.toBeNull()
    expect(circleAt(0)?.textContent).toBe("")
    expect(circleAt(1)?.querySelector("svg")).toBeNull()
    expect(circleAt(1)?.textContent).toBe("2")
  })

  it("exposes aria-current only on the current step", () => {
    render(<RoamStepTrail activeIndex={1} steps={threeSteps} />)

    expect(stepAt(1).getAttribute("aria-current")).toBe("step")
    expect(stepAt(0).getAttribute("aria-current")).toBeNull()
    expect(stepAt(2).getAttribute("aria-current")).toBeNull()
  })

  it("marks every step done and drops aria-current when complete", () => {
    render(<RoamStepTrail activeIndex={2} complete steps={threeSteps} />)

    const list = screen.getByRole("list", { name: "Langkah absensi" })
    for (let index = 0; index < 3; index += 1) {
      expect(stepAt(index).getAttribute("data-state")).toBe("done")
      expect(circleAt(index)?.style.background).toBe("rgb(14, 14, 16)")
    }
    expect(list.querySelectorAll("[aria-current]")).toHaveLength(0)
  })

  it("paints a failed step #9B2937 (DBvSR)", () => {
    render(<RoamStepTrail activeIndex={2} errorIndex={0} steps={threeSteps} />)

    expect(stepAt(0).getAttribute("data-state")).toBe("error")
    expect(circleAt(0)?.style.background).toBe("rgb(155, 41, 55)")
    expect(
      stepAt(0).querySelector<HTMLElement>("[data-slot='roam-step-label']")
        ?.style.color
    ).toBe("rgb(155, 41, 55)")
    expect(circleAt(0)?.querySelector("svg")).not.toBeNull()
  })

  it("uses 13px labels for the two-step variant", () => {
    render(<RoamStepTrail activeIndex={0} steps={twoSteps} />)

    const currentLabel = stepAt(0).querySelector<HTMLElement>(
      "[data-slot='roam-step-label']"
    )
    const pendingLabel = stepAt(1).querySelector<HTMLElement>(
      "[data-slot='roam-step-label']"
    )
    expect(currentLabel?.style.fontSize).toBe("13px")
    expect(currentLabel?.style.fontWeight).toBe("700")
    expect(pendingLabel?.style.fontSize).toBe("13px")
    expect(pendingLabel?.style.fontWeight).toBe("500")
  })
})
