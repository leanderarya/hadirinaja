// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import type { ReactNode } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const { apiRequest, router } = vi.hoisted(() => ({
  apiRequest: vi.fn(),
  router: {
    location: {
      search: { outletId: 1, days: 7 } as Record<string, unknown>,
      hash: "",
    },
    listeners: new Set<() => void>(),
    navigate: vi.fn(),
  },
}))
vi.mock("@tanstack/react-router", async () => {
  const { useSyncExternalStore } = await import("react")
  return {
    createFileRoute: () => (options: unknown) => options,
    useLocation: (options?: {
      select: (location: typeof router.location) => unknown
    }) => {
      const location = useSyncExternalStore(
        (listener) => {
          router.listeners.add(listener)
          return () => router.listeners.delete(listener)
        },
        () => router.location
      )
      return options?.select ? options.select(location) : location
    },
    useNavigate: () => router.navigate,
    useBlocker: () => ({ status: "idle" }),
  }
})
vi.mock("@/lib/api", () => ({ apiRequest, ApiError: class extends Error {} }))
vi.mock("@/components/management-sidebar", () => ({
  ManagementSidebar: () => null,
  ManagementTopbar: () => null,
}))
vi.mock("@/components/ui/sidebar", () => ({
  SidebarProvider: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
}))
vi.mock("./-shift-templates", () => ({ ShiftTemplatesExperience: () => null }))
vi.mock("./-attendance-policy", () => ({ AttendancePolicy: () => null }))

import { SchedulingPage } from "./-scheduling-page"

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: Error) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}
function calendar(id: number, timezone: string) {
  return {
    outlet: { id, name: `Outlet ${id}` },
    days: [
      {
        date: "2026-11-02",
        timezone,
        status: "open",
        holiday_references: [],
        exception: null,
      },
    ],
    versions: [
      {
        id,
        effective_from: "2026-11-01",
        timezone,
        operating_weekdays: [1, 2, 3, 4, 5],
        reason: "Initial calendar",
      },
    ],
  }
}
const context = {
  tenant: { id: 1, name: "QA" },
  user: { id: 1, name: "Owner" },
  roles: ["owner"],
  capabilities: {
    manage_templates: true,
    manage_schedules: true,
    manage_policies: true,
    manage_calendars: true,
    read_personal_schedule: false,
  },
  employee_id: null,
  business_units: [{ id: 1, name: "BU" }],
  outlets: [1, 2, 3].map((id) => ({
    id,
    name: `Outlet ${id}`,
    business_unit_id: 1,
  })),
  employees: [],
  shift_templates: [],
}
let responses: Map<number, Promise<ReturnType<typeof calendar>>>
let saveResponse: Promise<unknown>
function changeLocation(search: Record<string, unknown>) {
  router.location = {
    ...router.location,
    search: { ...router.location.search, ...search },
  }
  for (const listener of router.listeners) listener()
}
function editorButton() {
  return screen.getByRole("button", { name: "Jadwalkan perubahan" })
}
async function ready() {
  await waitFor(() => expect(editorButton().matches(":disabled")).toBe(false))
}
function selectOutlet(id: number) {
  fireEvent.change(screen.getByLabelText("Outlet", { selector: "select" }), {
    target: { value: String(id) },
  })
}
function mutations() {
  return apiRequest.mock.calls.filter(
    ([, options]) => options?.method === "POST"
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  router.location = { search: { outletId: 1, days: 7 }, hash: "" }
  window.history.replaceState(null, "", "/settings/outlet-calendar")
  router.navigate.mockImplementation(
    async (next: { search: Record<string, unknown> }) =>
      changeLocation(next.search)
  )
  responses = new Map([[1, Promise.resolve(calendar(1, "Asia/Jakarta"))]])
  saveResponse = Promise.resolve({})
  apiRequest.mockImplementation(
    async (path: string, options?: { method?: string }) => {
      if (path === "/auth/me")
        return {
          features: { kiosk_enabled: false },
          active_membership: { roles: ["owner"] },
        }
      if (path === "/management/scheduling/context") return context
      if (options?.method === "POST") return saveResponse
      if (path.startsWith("/management/scheduling/calendar?")) {
        const id = Number(
          new URLSearchParams(path.split("?")[1]).get("outlet_id")
        )
        const result = responses.get(id)
        if (!result) throw new Error(`Unexpected Outlet ${id}`)
        return result
      }
      throw new Error(`Unexpected API ${path}`)
    }
  )
})
afterEach(() => {
  cleanup()
  router.listeners.clear()
})

describe("Outlet calendar loading and draft context", () => {
  it("blocks all editors until the selected calendar loads, then saves that Outlet's defaults", async () => {
    const first = deferred<ReturnType<typeof calendar>>()
    const second = deferred<ReturnType<typeof calendar>>()
    responses.set(1, first.promise)
    responses.set(2, second.promise)
    render(<SchedulingPage configuration="kalender" />)
    await screen.findByRole("button", { name: "Jadwalkan perubahan" })
    expect(editorButton().matches(":disabled")).toBe(true)
    expect(
      screen.getByRole("button", { name: "Catat libur" }).matches(":disabled")
    ).toBe(true)
    fireEvent.click(editorButton())
    expect(screen.queryByRole("dialog")).toBeNull()
    await act(async () => first.resolve(calendar(1, "Asia/Jakarta")))
    await ready()
    selectOutlet(2)
    expect(editorButton().matches(":disabled")).toBe(true)
    fireEvent.click(editorButton())
    expect(screen.queryByLabelText("Zona waktu Outlet")).toBeNull()
    await act(async () => second.resolve(calendar(2, "Asia/Makassar")))
    await ready()
    fireEvent.click(editorButton())
    expect(
      (screen.getByLabelText("Zona waktu Outlet") as HTMLInputElement).value
    ).toBe("Asia/Makassar")
    fireEvent.change(screen.getByLabelText("Alasan perubahan"), {
      target: { value: "QA calendar change" },
    })
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Jadwalkan perubahan",
      })
    )
    const confirmation = await screen.findByRole("alertdialog")
    fireEvent.click(
      within(confirmation).getByRole("button", { name: "Jadwalkan perubahan" })
    )
    await waitFor(() => expect(mutations()).toHaveLength(1))
    expect(mutations()[0][1].body).toMatchObject({
      outlet_id: 2,
      timezone: "Asia/Makassar",
      operating_weekdays: [1, 2, 3, 4, 5],
      reason: "QA calendar change",
    })
    await ready()
  })

  it.each([
    "success",
    "failure",
  ])("ignores a delayed %s after rapid switching and preserves the current draft", async (outcome) => {
    const late = deferred<ReturnType<typeof calendar>>()
    const current = deferred<ReturnType<typeof calendar>>()
    responses.set(2, late.promise)
    responses.set(3, current.promise)
    render(<SchedulingPage configuration="kalender" />)
    await ready()
    selectOutlet(2)
    selectOutlet(3)
    await act(async () => current.resolve(calendar(3, "Asia/Jayapura")))
    await ready()
    fireEvent.click(editorButton())
    fireEvent.change(screen.getByLabelText("Zona waktu Outlet"), {
      target: { value: "Asia/Pontianak" },
    })
    fireEvent.change(screen.getByLabelText("Alasan perubahan"), {
      target: { value: "Draft must survive" },
    })
    await act(async () => {
      if (outcome === "success") late.resolve(calendar(2, "Asia/Makassar"))
      else late.reject(new Error("Delayed old failure"))
    })
    expect(
      (screen.getByLabelText("Zona waktu Outlet") as HTMLInputElement).value
    ).toBe("Asia/Pontianak")
    expect(
      (screen.getByLabelText("Alasan perubahan") as HTMLInputElement).value
    ).toBe("Draft must survive")
    expect(
      screen.queryByText(/Jadwal dan kebijakan belum dapat dimuat/)
    ).toBeNull()
    expect(mutations()).toHaveLength(0)
  })

  it("invalidates a pending confirmation when route context changes and never reopens it for another Outlet", async () => {
    const pending = deferred<ReturnType<typeof calendar>>()
    responses.set(2, pending.promise)
    render(<SchedulingPage configuration="kalender" />)
    await ready()
    fireEvent.click(editorButton())
    fireEvent.change(screen.getByLabelText("Alasan perubahan"), {
      target: { value: "Old Outlet draft" },
    })
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Jadwalkan perubahan",
      })
    )
    await screen.findByRole("alertdialog")
    act(() => changeLocation({ outletId: 2 }))
    expect(screen.queryByRole("alertdialog")).toBeNull()
    expect(screen.queryByRole("dialog")).toBeNull()
    expect(mutations()).toHaveLength(0)
    await act(async () => pending.resolve(calendar(2, "Asia/Makassar")))
    await ready()
    expect(screen.queryByRole("alertdialog")).toBeNull()
    fireEvent.click(editorButton())
    expect(screen.queryByRole("alertdialog")).toBeNull()
    expect(
      (screen.getByLabelText("Zona waktu Outlet") as HTMLInputElement).value
    ).toBe("Asia/Makassar")
    expect(mutations()).toHaveLength(0)
  })

  it.each([
    "failed",
    "mismatched",
  ])("does not enable editors on a %s calendar response", async (outcome) => {
    const pending = deferred<ReturnType<typeof calendar>>()
    responses.set(2, pending.promise)
    render(<SchedulingPage configuration="kalender" />)
    await ready()
    selectOutlet(2)
    await act(async () => {
      if (outcome === "failed")
        pending.reject(new Error("Calendar unavailable"))
      else pending.resolve(calendar(1, "Asia/Jakarta"))
    })
    await screen.findByText(/Jadwal dan kebijakan belum dapat dimuat/)
    expect(editorButton().matches(":disabled")).toBe(true)
    expect(screen.queryByRole("dialog")).toBeNull()
    expect(mutations()).toHaveLength(0)
  })

  it("does not refresh the old Outlet when its delayed save finishes after a context switch", async () => {
    const saved = deferred<unknown>()
    saveResponse = saved.promise
    responses.set(2, Promise.resolve(calendar(2, "Asia/Makassar")))
    render(<SchedulingPage configuration="kalender" />)
    await ready()
    fireEvent.click(editorButton())
    fireEvent.change(screen.getByLabelText("Alasan perubahan"), {
      target: { value: "Save on old Outlet" },
    })
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Jadwalkan perubahan",
      })
    )
    fireEvent.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", {
        name: "Jadwalkan perubahan",
      })
    )
    await waitFor(() => expect(mutations()).toHaveLength(1))
    act(() => changeLocation({ outletId: 2 }))
    await waitFor(() =>
      expect(
        apiRequest.mock.calls.some(([path]) =>
          path.includes("calendar?outlet_id=2")
        )
      ).toBe(true)
    )
    await act(async () => saved.resolve({}))
    await ready()
    expect(
      apiRequest.mock.calls.filter(([path]) =>
        path.includes("calendar?outlet_id=1")
      )
    ).toHaveLength(1)
    fireEvent.click(editorButton())
    expect(
      (screen.getByLabelText("Zona waktu Outlet") as HTMLInputElement).value
    ).toBe("Asia/Makassar")
    expect(mutations()).toHaveLength(1)
  })

  it("blocks editors when the date/range changes even if the Outlet is unchanged", async () => {
    render(<SchedulingPage configuration="kalender" />)
    await ready()
    const pending = deferred<ReturnType<typeof calendar>>()
    responses.set(1, pending.promise)
    act(() => changeLocation({ days: 14, date: "2026-11-03" }))
    expect(editorButton().matches(":disabled")).toBe(true)
    fireEvent.click(editorButton())
    expect(screen.queryByRole("dialog")).toBeNull()
    await act(async () => pending.resolve(calendar(1, "Asia/Jakarta")))
    await ready()
    fireEvent.click(editorButton())
    expect(
      (screen.getByLabelText("Zona waktu Outlet") as HTMLInputElement).value
    ).toBe("Asia/Jakarta")
  })
})
