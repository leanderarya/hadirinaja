import { describe, expect, it } from "vitest"
import { cn } from "./utils"

describe("semantic typography class merging", () => {
  it("preserves type size when applying a text color", () => {
    expect(cn("text-body text-muted-foreground", "text-brand-700")).toBe(
      "text-body text-brand-700"
    )
    expect(cn("text-caption", "text-danger-strong")).toBe(
      "text-caption text-danger-strong"
    )
  })
  it("allows explicit size overrides without dropping the color", () => {
    expect(cn("text-body text-brand-700", "text-sm")).toBe(
      "text-brand-700 text-sm"
    )
    expect(cn("text-lg", "text-label text-foreground")).toBe(
      "text-label text-foreground"
    )
  })
})
