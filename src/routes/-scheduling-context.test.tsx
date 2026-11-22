// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import type { ReactNode } from "react"
import { schedulingSearch } from "@/lib/scheduling-search"

const { apiRequest } = vi.hoisted(() => ({ apiRequest: vi.fn() }))
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

const context = {
  tenant: { id: 1, name: "QA" },
  user: { id: 1, name: "Supervisor QA" },
  roles: ["supervisor"],
  employee_id: null,
  capabilities: {
    manage_schedules: true,
    manage_templates: false,
    manage_policies: false,
    manage_calendars: false,
    read_personal_schedule: false,
  },
  outlets: [1, 2].map((id) => ({
    id,
    name: `Outlet QA ${id}`,
    business_unit_id: id,
  })),
  business_units: [1, 2].map((id) => ({ id, name: `Unit ${id}` })),
  employees: [],
  shift_templates: [],
}
let employee = false
let delayed: Promise<unknown> | undefined
let serverTime = "2026-11-11T12:00:00Z"
let duplicateToday = false
function roster(id: number, week: string) {
  return {
    outlet: { id, name: `Outlet QA ${id}`, weekly_planner_start_on: null },
    week_start: week,
    version: 1,
    draft: null,
    published: null,
    staffing_report: { enabled: false, days: [], deficits: [], conflicts: [] },
    employees: [],
    published_weeks: [],
  }
}
function personalWeek(week: string) {
  const start = new Date(`${week}T12:00:00Z`)
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(start)
    date.setUTCDate(date.getUTCDate() + index)
    const workDate = date.toISOString().slice(0, 10)
    const weekday = date.getUTCDay()
    const day = {
      employee_id: 1,
      tenant_id: 1,
      work_date: workDate,
      status: "unscheduled" as const,
      outlet: null,
      timezone: "Asia/Jakarta",
      shift: null,
      scheduled_start: null,
      scheduled_end: null,
      policy: {
        tenant_version_id: null,
        outlet_version_id: null,
        effective: null,
      },
      provenance: {
        source: "none",
        schedule_rule_id: null,
        exception_id: null,
      },
      holiday_references: [],
      outlet_operating: null,
      conflicts: [] as string[],
    }
    if (weekday === 1) return { ...day, status: "rest" as const }
    if (weekday === 2)
      return {
        ...day,
        conflicts: ["attendance_policy_missing"],
      }
    return day
  })
  return { week_start: week, days }
}
function mount(url = "/scheduling?outletId=2&week=2026-11-09") {
  const root = createRootRoute({ component: Outlet })
  const route = createRoute({
    getParentRoute: () => root,
    path: "/scheduling",
    validateSearch: schedulingSearch,
    component: SchedulingPage,
  })
  const history = createMemoryHistory({ initialEntries: [url] })
  const router = createRouter({
    routeTree: root.addChildren([route]),
    history,
    defaultPendingMinMs: 0,
  })
  const view = render(<RouterProvider router={router} />)
  return { router, history, ...view }
}
async function ready(id: number) {
  await screen.findByRole("region", { name: `Planner Outlet QA ${id}` })
  await screen.findByRole("button", { name: "Siapkan shift staffing" })
}
function selected() {
  return (
    screen.getByLabelText("Outlet", { selector: "select" }) as HTMLSelectElement
  ).value
}
beforeEach(() => {
  vi.clearAllMocks()
  employee = false
  delayed = undefined
  serverTime = "2026-11-11T12:00:00Z"
  duplicateToday = false
  apiRequest.mockImplementation(async (path: string) => {
    if (path === "/auth/me")
      return {
        active_membership: { roles: [employee ? "employee" : "supervisor"] },
      }
    if (path.endsWith("/context"))
      return employee
        ? {
            ...context,
            employee_id: 1,
            capabilities: {
              ...context.capabilities,
              manage_schedules: false,
              read_personal_schedule: true,
            },
          }
        : context
    if (path === "/attendance/me")
      return {
        server_time: serverTime,
        employee: { id: 1, name: "Employee QA" },
        schedule: { work_date: "2026-11-07", timezone: "Asia/Jakarta" },
      }
    if (path.includes("/planner/")) {
      const m = path.match(/outlets\/(\d+)\/weeks\/([^/]+)/)
      if (!m) throw new Error("Invalid planner test path")
      return Number(m[1]) === 1 && delayed
        ? delayed
        : roster(Number(m[1]), m[2])
    }
    if (path.includes("/me/week")) {
      const week = new URLSearchParams(path.split("?")[1]).get("week_start")
      if (!week) throw new Error("Missing personal week start")
      const response = personalWeek(week)
      if (duplicateToday && week === "2026-11-09") {
        const today = response.days.find(
          (day) => day.work_date === "2026-11-11"
        )
        if (today) response.days.push({ ...today })
      }
      return response
    }
    const query = new URLSearchParams(path.split("?")[1])
    const id = Number(query.get("outlet_id"))
    if (path.includes("/calendar?"))
      return { outlet: { id }, days: [], versions: [] }
    if (path.includes("/week?"))
      return { outlet: { id }, days: [], employees: [] }
    throw new Error(`Unexpected API ${path}`)
  })
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

it("restores the same URL on direct navigation and a fresh mount (refresh)", async () => {
  const first = mount()
  await ready(2)
  expect(selected()).toBe("2")
  expect(apiRequest).toHaveBeenCalledWith(
    expect.stringContaining("/outlets/2/weeks/2026-11-09")
  )
  const href = first.history.location.href
  first.unmount()
  mount(href)
  await ready(2)
  expect(selected()).toBe("2")
})
it("pushes outlet/week changes and restores both on back/forward", async () => {
  const { router, history } = mount()
  await ready(2)
  fireEvent.change(screen.getByLabelText("Outlet", { selector: "select" }), {
    target: { value: "1" },
  })
  await ready(1)
  expect(router.state.location.search).toMatchObject({
    outletId: 1,
    week: "2026-11-09",
  })
  await act(() =>
    router.navigate({
      to: "/scheduling",
      search: schedulingSearch({ outletId: 2, week: "2026-11-16" }),
    })
  )
  await ready(2)
  await act(() => history.back())
  await ready(1)
  expect(router.state.location.search.week).toBe("2026-11-09")
  await act(() => history.forward())
  await ready(2)
  expect(router.state.location.search.week).toBe("2026-11-16")
})
it.each([
  "999",
  "-1",
  "wat",
])("never requests an inaccessible/stale/invalid outlet %s", async (id) => {
  mount(`/scheduling?outletId=${id}&week=2026-11-09`)
  await ready(1)
  expect(selected()).toBe("1")
  expect(
    apiRequest.mock.calls.some(
      ([path]) =>
        path.includes(`outlets/${id}/`) || path.includes(`outlet_id=${id}`)
    )
  ).toBe(false)
})
it("ignores a late response after rapid history outlet switching", async () => {
  let resolve!: (value: unknown) => void
  delayed = new Promise((done) => {
    resolve = done
  })
  const { router } = mount("/scheduling?outletId=1&week=2026-11-09")
  await waitFor(() =>
    expect(apiRequest).toHaveBeenCalledWith(
      expect.stringContaining("/outlets/1/weeks/")
    )
  )
  await act(() =>
    router.navigate({
      to: "/scheduling",
      search: schedulingSearch({ outletId: 2, week: "2026-11-09" }),
    })
  )
  await ready(2)
  await act(async () => resolve(roster(1, "2026-11-09")))
  expect(selected()).toBe("2")
  expect(
    screen.queryByRole("region", { name: "Planner Outlet QA 1" })
  ).toBeNull()
})
it("blocks search navigation while the planner editor is dirty", async () => {
  const { router } = mount()
  await ready(2)
  await act(() =>
    router.navigate({
      to: "/scheduling",
      search: schedulingSearch({ outletId: 1, week: "2026-11-16" }),
    })
  )
  await ready(1)
  fireEvent.click(
    screen.getByRole("button", { name: "Siapkan shift staffing" })
  )
  fireEvent.change(screen.getByLabelText("Alasan perubahan"), {
    target: { value: "Unsaved QA" },
  })
  act(() => {
    void router.navigate({
      to: "/scheduling",
      search: schedulingSearch({ outletId: 2, week: "2026-11-09" }),
    })
  })
  await screen.findByRole("alertdialog")
  expect(router.state.location.search.outletId).toBe(1)
  fireEvent.click(screen.getByRole("button", { name: "Buang dan lanjutkan" }))
  await ready(2)
  expect(router.state.location.search.week).toBe("2026-11-09")
})
it("opens the notified week for Employee without granting manager outlet access", async () => {
  employee = true
  mount()
  await waitFor(() =>
    expect(
      apiRequest.mock.calls.some(([path]) => path.includes("/me/week"))
    ).toBe(true)
  )
  expect(
    apiRequest.mock.calls.some(([path]) => path.includes("/planner/"))
  ).toBe(false)
  expect(apiRequest).toHaveBeenCalledWith(
    "/management/scheduling/me/week?week_start=2026-11-09"
  )
  expect(apiRequest).toHaveBeenCalledWith("/attendance/me")
  expect(screen.getByText("Rabu, 11 November 2026")).toBeTruthy()
  expect(
    screen.getByRole("region", { name: "Hari ini" }).textContent
  ).toContain("Belum dijadwalkan")
})
it("keeps server Today visible while browsing another week and distinguishes rest from uncertainty", async () => {
  employee = true
  const { router } = mount()
  const previous = await screen.findByRole("button", {
    name: "Minggu sebelumnya",
  })
  await waitFor(() => expect(previous.matches(":disabled")).toBe(false))
  fireEvent.click(previous)

  await waitFor(() =>
    expect(apiRequest).toHaveBeenCalledWith(
      "/management/scheduling/me/week?week_start=2026-11-02"
    )
  )
  expect(router.state.location.pathname).toBe("/scheduling")
  const today = screen.getByRole("region", { name: "Hari ini" })
  expect(today.textContent).toContain("Rabu, 11 November 2026")
  const rows = screen.getByRole("region", { name: "Jadwal mingguan" })
  expect(rows.textContent).toContain("Libur")
  expect(rows.textContent).toContain("Perlu dipastikan")
  expect(rows.textContent).toContain("Belum dijadwalkan")

  serverTime = "2026-11-16T00:01:00Z"
  fireEvent.focus(window)
  await waitFor(() =>
    expect(today.textContent).toContain("Senin, 16 November 2026")
  )
  expect(
    screen
      .getByRole("button", { name: /Pilih tanggal untuk minggu/ })
      .getAttribute("aria-label")
  ).toContain("Senin, 2 November 2026")
})
it("does not choose the first of duplicate Today schedule rows", async () => {
  employee = true
  duplicateToday = true
  mount()

  const today = await screen.findByRole("region", { name: "Hari ini" })
  await waitFor(() =>
    expect(today.textContent).toContain(
      "Data jadwal hari ini berulang dan belum dapat dipastikan."
    )
  )
  expect(today.textContent).not.toContain("Belum dijadwalkan")
  expect(
    screen.getByRole("button", { name: /Rab, 11 Nov/ }).textContent
  ).toContain("Perlu dipastikan")
})
it("uses a newly verified server date after returning to the page", async () => {
  employee = true
  serverTime = "2026-11-08T13:37:31Z"
  mount()
  const today = await screen.findByRole("region", { name: "Hari ini" })
  await waitFor(() =>
    expect(today.textContent).toContain("Minggu, 8 November 2026")
  )
  expect(apiRequest).toHaveBeenCalledWith(
    "/management/scheduling/me/week?week_start=2026-11-02"
  )

  serverTime = "2026-11-09T00:01:00Z"
  fireEvent.focus(window)

  await waitFor(() =>
    expect(today.textContent).toContain("Senin, 9 November 2026")
  )
  await waitFor(() =>
    expect(
      screen
        .getByRole("button", { name: /Pilih tanggal untuk minggu/ })
        .getAttribute("aria-label")
    ).toContain("Senin, 9 November 2026")
  )
  expect(apiRequest).toHaveBeenCalledWith(
    "/management/scheduling/me/week?week_start=2026-11-09"
  )
})
it("keeps the date picker keyboard-focusable, selects a date's Monday, and restores trigger focus", async () => {
  employee = true
  mount()
  const picker = await screen.findByRole("button", {
    name: /Pilih tanggal untuk minggu/,
  })
  await waitFor(() => expect(picker.matches(":disabled")).toBe(false))
  picker.focus()
  expect(document.activeElement).toBe(picker)
  fireEvent.click(picker)
  await screen.findByText("Pilih tanggal")
  fireEvent.keyDown(document, { key: "Escape" })
  await waitFor(() => expect(document.activeElement).toBe(picker))

  fireEvent.click(picker)
  const selectedDate = await screen.findByRole("button", {
    name: /Senin, 9 November 2026, dipilih/,
  })
  act(() => selectedDate.focus())
  fireEvent.keyDown(selectedDate, { key: "ArrowRight" })
  const nextDate = await screen.findByRole("button", {
    name: /Selasa, 10 November 2026/,
  })
  await waitFor(() => expect(document.activeElement).toBe(nextDate))

  const chosenDate = screen.getByRole("button", {
    name: /Selasa, 17 November 2026/,
  })
  fireEvent.click(chosenDate)
  await waitFor(() =>
    expect(apiRequest).toHaveBeenCalledWith(
      "/management/scheduling/me/week?week_start=2026-11-16"
    )
  )
})
it("opens an accessible date detail and restores focus after Escape", async () => {
  employee = true
  mount()
  const restRow = await screen.findByRole("button", { name: /Sen, 9 Nov/ })
  const outside = screen.getByRole("button", {
    name: /Pilih tanggal untuk minggu/,
  })
  fireEvent.click(restRow)
  const dialog = await screen.findByRole("dialog")
  expect(dialog.getAttribute("aria-modal")).toBe("true")
  expect(dialog.contains(document.activeElement)).toBe(true)
  expect(screen.getAllByText("Libur").length).toBeGreaterThan(1)
  outside.focus()
  await waitFor(() =>
    expect(dialog.contains(document.activeElement)).toBe(true)
  )
  fireEvent.keyDown(document, { key: "Escape" })
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
  await waitFor(() => expect(document.activeElement).toBe(restRow))
})
it("uses a nonmodal side panel for date details at wider viewports", async () => {
  employee = true
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query === "(min-width: 768px)",
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }))
  mount()

  const restRow = await screen.findByRole("button", { name: /Sen, 9 Nov/ })
  fireEvent.click(restRow)
  const dialog = await screen.findByRole("dialog")
  expect(document.querySelector('[data-slot="sheet-content"]')).toBeTruthy()
  expect(dialog.hasAttribute("aria-modal")).toBe(false)
  expect(document.querySelector("main")?.hasAttribute("aria-hidden")).toBe(
    false
  )

  const outside = screen.getByRole("button", {
    name: /Pilih tanggal untuk minggu/,
  })
  outside.focus()
  await waitFor(() => expect(document.activeElement).toBe(outside))
  fireEvent.keyDown(dialog, { key: "Escape" })
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
  await waitFor(() => expect(document.activeElement).toBe(restRow))
})
it.each([
  "2026-11-10",
  "2026-02-30",
  "bad",
  "2026-11-09T00:00:00Z",
])("rejects invalid/non-Monday week %s", (week) => {
  expect(schedulingSearch({ week }).week).toBeUndefined()
})
