// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"

import { AttendanceStepHeading } from "./attendance-step-heading"

afterEach(cleanup)

describe("AttendanceStepHeading", () => {
  it("renders the 22/700 title over a 14/500 #525866 description, 8px apart", () => {
    const { container } = render(
      <AttendanceStepHeading
        description="Pastikan foto terang dan tidak buram."
        title="Ambil foto bukti"
      />
    )
    const root = container.querySelector<HTMLElement>(
      '[data-slot="attendance-step-heading"]'
    )
    expect(root?.style.gap).toBe("8px")

    const title = container.querySelector("h2") as HTMLElement
    expect(title.textContent).toBe("Ambil foto bukti")
    expect(title.style.fontSize).toBe("22px")
    expect(title.style.fontWeight).toBe("700")

    const description = container.querySelector("p") as HTMLElement
    expect(description.style.fontSize).toBe("14px")
    expect(description.style.fontWeight).toBe("500")
    expect(description.style.color).toBe("rgb(82, 88, 102)")
  })

  it("passes an id through so the route can label its section", () => {
    const { container } = render(
      <AttendanceStepHeading
        description="Periksa ringkasan ini sebelum mengirim absensi."
        id="confirmation-title"
        title="Periksa data Check-in"
      />
    )
    expect(container.querySelector("#confirmation-title")?.tagName).toBe("H2")
  })
})
