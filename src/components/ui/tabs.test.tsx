// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./tabs"

afterEach(cleanup)

describe("shared Tabs keyboard semantics", () => {
  it("preserves arrow navigation and focusable labelled panels", async () => {
    render(
      <Tabs defaultValue="first">
        <TabsList aria-label="Sections">
          <TabsTrigger value="first">First</TabsTrigger>
          <TabsTrigger value="last">Last</TabsTrigger>
        </TabsList>
        <TabsContent value="first">First content</TabsContent>
        <TabsContent value="last">Last content</TabsContent>
      </Tabs>
    )
    expect(screen.getByRole("tabpanel").tabIndex).toBe(0)
    const first = screen.getByRole("tab", { name: "First" })
    await act(async () => first.focus())
    fireEvent.keyDown(first, { key: "ArrowRight" })
    await waitFor(() => expect(document.activeElement?.textContent).toBe("Last"))
    expect(screen.getByRole("tabpanel").textContent).toBe("First content")
    fireEvent.click(screen.getByRole("tab", { name: "Last" }))
    await waitFor(() => expect(screen.getByRole("tabpanel").textContent).toBe("Last content"))
    const panel = screen.getByRole("tabpanel")
    expect(panel.tabIndex).toBe(0)
    expect(panel.getAttribute("aria-labelledby")).toBe(document.activeElement?.id)
  })
  it("keeps disabled tabs inactive when clicked", () => {
    render(<Tabs defaultValue="first"><TabsList><TabsTrigger value="first">First</TabsTrigger><TabsTrigger value="disabled" disabled>Unavailable</TabsTrigger></TabsList><TabsContent value="first">First content</TabsContent><TabsContent value="disabled">Unavailable content</TabsContent></Tabs>)
    fireEvent.click(screen.getByRole("tab", { name: "Unavailable" }))
    expect(screen.getByRole("tabpanel").textContent).toBe("First content")
    expect(screen.getByRole("tab", { name: "Unavailable" }).getAttribute("aria-selected")).toBe("false")
  })
})
