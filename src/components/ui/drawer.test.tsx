// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"

beforeEach(() => {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }))
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  )
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe("responsive dialog primitives", () => {
  it("opens the mobile drawer as a focused modal and restores trigger focus", async () => {
    const { container } = render(
      <>
        <button type="button">Background action</button>
        <Drawer>
          <DrawerTrigger asChild>
            <button type="button">Open details</button>
          </DrawerTrigger>
          <DrawerContent>
            <DrawerTitle>Drawer title</DrawerTitle>
            <button type="button">First drawer action</button>
            <DrawerClose asChild>
              <button type="button">Close drawer</button>
            </DrawerClose>
          </DrawerContent>
        </Drawer>
      </>
    )
    const trigger = screen.getByRole("button", { name: "Open details" })
    const background = screen.getByRole("button", {
      name: "Background action",
    })

    fireEvent.click(trigger)

    const dialog = await screen.findByRole("dialog", { name: "Drawer title" })
    const firstAction = screen.getByRole("button", {
      name: "First drawer action",
    })
    const close = screen.getByRole("button", { name: "Close drawer" })

    expect(dialog.getAttribute("aria-modal")).toBe("true")
    expect(container.getAttribute("aria-hidden")).toBe("true")
    await waitFor(() => expect(document.activeElement).toBe(firstAction))

    background.focus()
    await waitFor(() => expect(document.activeElement).toBe(firstAction))

    close.focus()
    fireEvent.keyDown(close, { key: "Tab" })
    expect(document.activeElement).toBe(firstAction)

    fireEvent.keyDown(dialog, { key: "Escape" })
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
    await waitFor(() => expect(document.activeElement).toBe(trigger))
  })

  it("keeps the wider sheet nonmodal and allows outside focus", async () => {
    const { container } = render(
      <>
        <button type="button">Background action</button>
        <Sheet modal={false}>
          <SheetTrigger>Open wide panel</SheetTrigger>
          <SheetContent>
            <SheetHeader>
              <SheetTitle>Wide panel title</SheetTitle>
            </SheetHeader>
          </SheetContent>
        </Sheet>
      </>
    )
    const background = screen.getByRole("button", {
      name: "Background action",
    })

    fireEvent.click(screen.getByRole("button", { name: "Open wide panel" }))

    const dialog = await screen.findByRole("dialog", {
      name: "Wide panel title",
    })
    expect(dialog.hasAttribute("aria-modal")).toBe(false)
    expect(container.hasAttribute("aria-hidden")).toBe(false)

    background.focus()
    await waitFor(() => expect(document.activeElement).toBe(background))
  })
})
