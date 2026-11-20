// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"

import { AttendanceConfirmationSummary } from "./attendance-confirmation-summary"

afterEach(cleanup)

const rows = [
  { label: "Jenis aksi", value: "Check-in" },
  { label: "Waktu", value: "09.00–17.00" },
  { label: "Lokasi", value: "Di titik outlet" },
  { label: "Outlet", value: "Outlet Sudirman", emphasis: true },
]

function rowElements(container: HTMLElement) {
  return Array.from(
    container.querySelectorAll<HTMLElement>(
      '[data-slot="attendance-summary-row"]'
    )
  )
}

describe("AttendanceConfirmationSummary", () => {
  it("renders the AWKAr card: white, r20, 1px E5E7EB, 16px padding", () => {
    const { container } = render(<AttendanceConfirmationSummary rows={rows} />)
    const card = container.querySelector<HTMLElement>(
      '[data-slot="attendance-confirmation-summary"]'
    )
    expect(card?.dataset.variant).toBe("card")
    expect(card?.style.backgroundColor).toBe("rgb(255, 255, 255)")
    expect(card?.style.borderRadius).toBe("20px")
    expect(card?.style.border).toBe("1px solid rgb(229, 231, 235)")
    expect(card?.style.padding).toBe("16px")
    expect(card?.querySelector("dl")?.style.gap).toBe("4px")
    expect(card?.style.display).toBe("flex")
  })

  it("keeps 37px rows at a 41px pitch with hairlines between plain rows", () => {
    const { container } = render(<AttendanceConfirmationSummary rows={rows} />)
    const items = rowElements(container)
    expect(items).toHaveLength(4)
    for (const item of items) {
      expect(item.style.height).toBe("37px")
    }
    // 37px row + 4px gap = the frame's 41px pitch
    expect(items[0].style.borderBottom).toBe("1px solid rgb(229, 231, 235)")
    expect(items[1].style.borderBottom).toBe("1px solid rgb(229, 231, 235)")
    expect(items[2].style.borderBottom).toBe("1px solid rgb(229, 231, 235)")
    // no hairline under the orchid row, and none after the last row
    expect(items[3].style.borderBottom).toBe("")
  })

  it("uses 13/500 labels in an 80px column and right-aligned 14/600 values", () => {
    const { container } = render(<AttendanceConfirmationSummary rows={rows} />)
    const item = rowElements(container)[0]
    const label = item.querySelector("dt") as HTMLElement
    const value = item.querySelector("dd") as HTMLElement
    expect(label.style.fontSize).toBe("13px")
    expect(label.style.fontWeight).toBe("500")
    expect(label.style.color).toBe("rgb(82, 88, 102)")
    expect(label.style.width).toBe("80px")
    expect(value.style.fontSize).toBe("14px")
    expect(value.style.fontWeight).toBe("600")
    expect(value.style.color).toBe("rgb(14, 14, 16)")
    expect(value.style.textAlign).toBe("right")
  })

  it("stacks an 18px row icon ahead of the label on the card variant", () => {
    const { container } = render(
      <AttendanceConfirmationSummary
        rows={[
          {
            label: "Jenis aksi",
            value: "Check-in",
            icon: <span data-testid="row-icon" />,
          },
        ]}
      />
    )
    const icon = container.querySelector<HTMLElement>(
      '[data-slot="attendance-summary-icon"]'
    )
    expect(icon?.style.width).toBe("18px")
    expect(icon?.style.height).toBe("18px")
    expect(icon?.querySelector('[data-testid="row-icon"]')).not.toBeNull()
  })

  it("gives the emphasis row the orchid surface, radius 8 and 10px inset", () => {
    const { container } = render(<AttendanceConfirmationSummary rows={rows} />)
    const emphasis = rowElements(container)[3]
    expect(emphasis.dataset.emphasis).toBe("true")
    expect(emphasis.style.backgroundColor).toBe("rgb(231, 159, 245)")
    expect(emphasis.style.borderRadius).toBe("8px")
    expect(emphasis.style.paddingLeft).toBe("10px")
    expect(emphasis.style.paddingRight).toBe("10px")
    const label = emphasis.querySelector("dt") as HTMLElement
    expect(label.style.color).toBe("rgb(14, 14, 16)")
  })

  it("renders the flat variant with no surface, border, radius or padding", () => {
    const { container } = render(
      <AttendanceConfirmationSummary rows={rows} variant="flat" />
    )
    const card = container.querySelector<HTMLElement>(
      '[data-slot="attendance-confirmation-summary"]'
    )
    expect(card?.dataset.variant).toBe("flat")
    expect(card?.style.backgroundColor).toBe("")
    expect(card?.style.border).toBe("")
    expect(card?.style.borderRadius).toBe("")
    expect(card?.style.padding).toBe("")
  })

  it("uses an 8px flat row gap, producing the frame's 45px pitch", () => {
    const { container } = render(
      <AttendanceConfirmationSummary rows={rows} variant="flat" />
    )
    expect(container.querySelector("dl")?.style.gap).toBe("8px")
    // 37px row + 8px gap = the 45px pitch measured on wdXB0 / ZhBqn
    for (const item of rowElements(container)) {
      expect(item.style.height).toBe("37px")
    }
  })

  it("drops row icons in the flat variant — the result list has none", () => {
    const { container } = render(
      <AttendanceConfirmationSummary
        rows={[
          {
            label: "Jenis aksi",
            value: "Check-in",
            icon: <span data-testid="row-icon" />,
          },
        ]}
        variant="flat"
      />
    )
    expect(
      container.querySelector('[data-slot="attendance-summary-icon"]')
    ).toBeNull()
    expect(container.querySelector('[data-testid="row-icon"]')).toBeNull()
  })

  it("omits the photo block when photoUrl is absent", () => {
    const { container } = render(
      <AttendanceConfirmationSummary photoCaption="Diunggah" rows={rows} />
    )
    expect(
      container.querySelector('[data-slot="attendance-summary-photo"]')
    ).toBeNull()
  })

  it("renders a 96×112 radius-14 photo with the caption block beside it", () => {
    const { container, getByText } = render(
      <AttendanceConfirmationSummary
        photoCaption="Diambil pada perangkat ini."
        photoUrl="data:image/jpeg;base64,AAAA"
        rows={rows}
      />
    )
    const block = container.querySelector<HTMLElement>(
      '[data-slot="attendance-summary-photo"]'
    )
    expect(block).not.toBeNull()
    expect(block?.style.paddingTop).toBe("12px")
    const img = block?.querySelector("img") as HTMLImageElement
    expect(img.getAttribute("alt")).toBe("Foto bukti presensi")
    expect(img.style.width).toBe("96px")
    expect(img.style.height).toBe("112px")
    expect(img.style.borderRadius).toBe("14px")
    expect(img.style.objectFit).toBe("cover")
    expect(getByText("Foto bukti")).toBeDefined()
    expect(getByText("Diambil pada perangkat ini.")).toBeDefined()
  })
})
