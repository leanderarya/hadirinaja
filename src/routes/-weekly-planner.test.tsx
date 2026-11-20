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
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type {
  PlannerSettings,
  PlannerWeek,
  StaffingReport,
} from "@/lib/weekly-planner"

const { apiRequest, ApiFailure } = vi.hoisted(() => ({
  apiRequest: vi.fn(),
  ApiFailure: class extends Error {
    constructor(
      message: string,
      public status: number,
      public errors?: Record<string, string[]>
    ) {
      super(message)
    }
  },
}))
vi.mock("@/lib/api", () => ({ apiRequest, ApiError: ApiFailure }))
vi.mock("@/lib/use-configuration-draft", () => ({
  useConfigurationDraft: () => ({
    mark: vi.fn(),
    clear: vi.fn(),
    attempt: (action: () => void) => action(),
    dialog: null,
  }),
}))

import { WeeklyPlanner } from "./-weekly-planner"

const report: StaffingReport = {
  enabled: true,
  days: [],
  deficits: [
    {
      work_date: "2026-11-09",
      role: "morning",
      required: 1,
      assigned: 0,
      missing: 1,
    },
  ],
  conflicts: [],
  checksum: "a".repeat(64),
}
const templates = [
  {
    id: 1,
    name: "Pagi QA",
    versions: [
      {
        id: 1,
        revision: 1,
        start_time: "08:00:00",
        end_time: "16:00:00",
        effective_from: "2026-11-02",
        crosses_midnight: false,
      },
    ],
  },
  {
    id: 2,
    name: "Weekend QA",
    versions: [
      {
        id: 2,
        revision: 1,
        start_time: "16:00:00",
        end_time: "23:00:00",
        effective_from: "2026-11-09",
        crosses_midnight: false,
      },
      {
        id: 3,
        revision: 2,
        start_time: "16:00:00",
        end_time: "23:00:00",
        effective_from: "2026-11-15",
        crosses_midnight: false,
      },
      {
        id: 4,
        revision: 3,
        start_time: "16:00:00",
        end_time: "22:00:00",
        effective_from: "2026-11-09",
        crosses_midnight: false,
      },
      {
        id: 5,
        revision: 4,
        start_time: "16:00:00",
        end_time: "23:00:00",
        effective_from: "2026-11-09",
        crosses_midnight: true,
      },
    ],
  },
]
const fridayWeekendSettings: PlannerSettings = {
  weekend_starts_on: 5,
  weekday_shifts: {
    morning: ["08:00:00", "16:00:00"],
    middle: ["11:00:00", "18:00:00"],
    evening: ["16:00:00", "22:00:00"],
  },
  weekend_evening: ["16:00:00", "23:00:00"],
  custom: true,
}
function week(id = 1, plannerSettings?: PlannerSettings): PlannerWeek {
  return {
    version: 1,
    week_start: "2026-11-09",
    draft: {
      revision_id: id,
      entries: [],
      staffing: { morning: 1, middle: 2, evening: 3 },
      publication_warnings: [],
    },
    published: null,
    staffing_report: report,
    outlet: { id, name: `Outlet QA ${id}`, weekly_planner_start_on: null },
    employees: [{ id: 1, name: "Employee QA" }],
    published_weeks: [],
    ...(plannerSettings ? { planner_settings: plannerSettings } : {}),
  }
}
function planner(outletId = 1) {
  return (
    <WeeklyPlanner
      key={outletId}
      outletId={outletId}
      outletName={`Outlet QA ${outletId}`}
      weekStart="2026-11-09"
      templates={templates}
      onBusyChange={vi.fn()}
      onPublished={vi.fn()}
    />
  )
}
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
afterEach(cleanup)
beforeEach(() => {
  apiRequest.mockReset()
  apiRequest.mockImplementation(
    async (_path: string, options?: { method?: string }) =>
      options?.method === "POST"
        ? { version: 1, staffing_report: report }
        : week()
  )
})

describe("Supervisor weekly planner", () => {
  it("requires acknowledging the server warning checksum and never activates cutover", async () => {
    render(planner())
    fireEvent.click(
      await screen.findByRole("button", { name: "Periksa dan publikasikan" })
    )
    const dialog = await screen.findByRole("dialog")
    fireEvent.change(within(dialog).getByLabelText("Alasan perubahan"), {
      target: { value: "Kebutuhan QA" },
    })
    const publish = within(dialog).getByRole("button", {
      name: "Publikasikan roster",
    }) as HTMLButtonElement
    expect(publish.disabled).toBe(true)
    fireEvent.click(within(dialog).getByRole("checkbox"))
    expect(publish.disabled).toBe(false)
    fireEvent.click(publish)
    await waitFor(() =>
      expect(apiRequest).toHaveBeenCalledWith(
        expect.stringContaining("/publish"),
        expect.objectContaining({
          body: {
            expected_version: 1,
            expected_published_revision_id: null,
            warnings_checksum: report.checksum,
            reason: "Kebutuhan QA",
          },
        })
      )
    )
  })
  it.each([
    ["2026-11-13", ["Weekend QA · v1"]],
    ["2026-11-14", ["Weekend QA · v1"]],
    ["2026-11-15", ["Weekend QA · v1", "Weekend QA · v2"]],
  ])("offers date-valid configured weekend options on %s and hides middle", async (date, expectedOptions) => {
    apiRequest.mockResolvedValue(week(1, fridayWeekendSettings))
    render(planner())
    expect(
      await screen.findAllByText("Akhir pekan · tanpa tengah")
    ).toHaveLength(3)
    fireEvent.click(
      await screen.findByRole("button", {
        name: `Tambah penugasan ${date}`,
      })
    )
    const dialog = await screen.findByRole("dialog")
    const assignment = within(dialog).getByLabelText(
      "Penugasan"
    ) as HTMLSelectElement
    const optionLabels = Array.from(assignment.options).map((option) =>
      option.textContent?.trim()
    )

    for (const label of expectedOptions) expect(optionLabels).toContain(label)
    expect(optionLabels).not.toContain("Weekend QA · v3")
    expect(optionLabels).not.toContain("Tengah · 11:00–18:00")
    expect(optionLabels).not.toContain("Weekend QA · v4")
  })
  it("keeps absent planner settings on the existing Saturday-Sunday mapping", async () => {
    apiRequest.mockResolvedValue(week())
    render(planner())
    expect(
      await screen.findAllByText("Akhir pekan · tanpa tengah")
    ).toHaveLength(2)
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Tambah penugasan 2026-11-14",
      })
    )
    const dialog = await screen.findByRole("dialog")
    const assignment = within(dialog).getByLabelText(
      "Penugasan"
    ) as HTMLSelectElement
    const optionLabels = Array.from(assignment.options).map((option) =>
      option.textContent?.trim()
    )
    expect(optionLabels).toContain("Pagi · 08:00–16:00")
    expect(optionLabels).toContain("Sore · 16:00–22:00")
    expect(optionLabels).not.toContain("Tengah · 11:00–19:00")
  })
  it("blocks stale publication until the latest version is loaded", async () => {
    apiRequest.mockImplementation(
      async (path: string, options?: { method?: string }) => {
        if (path.endsWith("/publish"))
          throw new ApiFailure("Versi roster berubah", 409)
        return options?.method
          ? { version: 1, staffing_report: report }
          : week()
      }
    )
    render(planner())
    fireEvent.click(
      await screen.findByRole("button", { name: "Periksa dan publikasikan" })
    )
    const dialog = await screen.findByRole("dialog")
    fireEvent.change(within(dialog).getByLabelText("Alasan perubahan"), {
      target: { value: "Publish QA" },
    })
    fireEvent.click(within(dialog).getByRole("checkbox"))
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Publikasikan roster" })
    )
    await within(dialog).findByRole("button", { name: "Muat versi terbaru" })
    expect(
      (
        within(dialog).getByRole("button", {
          name: "Publikasikan roster",
        }) as HTMLButtonElement
      ).disabled
    ).toBe(true)
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Muat versi terbaru" })
    )
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
  })
  it("ignores a delayed response after an Outlet switch", async () => {
    const old = deferred<PlannerWeek>()
    apiRequest.mockImplementation((path: string) =>
      path.includes("outlets/1/") ? old.promise : Promise.resolve(week(2))
    )
    const view = render(planner())
    view.rerender(planner(2))
    await screen.findByText("Draf #2")
    await act(async () => old.resolve(week(1)))
    expect(screen.queryByText("Draf #1")).toBeNull()
    expect(screen.getByText("Draf #2")).toBeTruthy()
  })
  it("retries an uncertain save with the identical idempotency key and body", async () => {
    let attempts = 0
    apiRequest.mockImplementation(
      async (_path: string, options?: { method?: string }) => {
        if (options?.method === "PUT" && ++attempts === 1)
          throw new TypeError("Network failed")
        return week()
      }
    )
    render(planner())
    fireEvent.click(
      await screen.findByRole("button", { name: "Tambah penugasan 2026-11-09" })
    )
    const dialog = await screen.findByRole("dialog")
    fireEvent.change(within(dialog).getByLabelText(/Karyawan/), {
      target: { value: "1" },
    })
    fireEvent.change(within(dialog).getByLabelText("Alasan perubahan"), {
      target: { value: "Rest QA" },
    })
    fireEvent.click(within(dialog).getByRole("button", { name: "Simpan draf" }))
    await within(dialog).findByText("Jangan kirim perubahan baru")
    expect(
      (
        within(dialog).getByRole("button", {
          name: "Simpan draf",
        }) as HTMLButtonElement
      ).disabled
    ).toBe(true)
    fireEvent.click(
      within(dialog).getByRole("button", {
        name: "Periksa hasil dengan kunci yang sama",
      })
    )
    await waitFor(() => expect(attempts).toBe(2))
    const saves = apiRequest.mock.calls.filter(
      ([, options]) => options?.method === "PUT"
    )
    expect(saves[0][1]).toEqual(saves[1][1])
  })
  it("copies a published week into an empty draft without configuring shifts again", async () => {
    const empty = {
      ...week(),
      version: 0,
      draft: null,
      staffing_report: undefined,
      published_weeks: [{ week_start: "2026-11-02", published_revision_id: 7 }],
    }
    apiRequest.mockResolvedValue(empty)
    render(planner())
    const copy = (await screen.findByRole("button", {
      name: "Salin minggu published",
    })) as HTMLButtonElement
    expect(copy.disabled).toBe(false)
    fireEvent.click(copy)
    const dialog = await screen.findByRole("dialog")
    fireEvent.change(within(dialog).getByLabelText("Alasan perubahan"), {
      target: { value: "Copy QA week" },
    })
    fireEvent.click(within(dialog).getByRole("button", { name: "Simpan draf" }))
    await waitFor(() =>
      expect(apiRequest).toHaveBeenCalledWith(
        expect.stringContaining("/copy"),
        expect.objectContaining({
          body: {
            expected_version: 0,
            source_week_start: "2026-11-02",
            source_revision_id: 7,
            reason: "Copy QA week",
          },
        })
      )
    )
  })

  it("does not offer a middle shift for a weekend assignment", async () => {
    render(planner())
    fireEvent.click(
      await screen.findByRole("button", { name: "Tambah penugasan 2026-11-14" })
    )
    const dialog = await screen.findByRole("dialog")
    const assignment = within(dialog).getByLabelText(
      "Penugasan"
    ) as HTMLSelectElement
    expect(
      [...assignment.options].some((option) => option.text.startsWith("Tengah"))
    ).toBe(false)
    expect(
      [...assignment.options].some((option) => option.text.startsWith("Pagi"))
    ).toBe(true)
  })
  it("can remove an invalidated assignment from the draft without replacing its Employee", async () => {
    const data = week()
    data.employees = []
    if (data.draft)
      data.draft.entries = [
        {
          employee_id: 1,
          work_date: "2026-11-09",
          status: "work",
          shift_template_version_id: 1,
        },
      ]
    apiRequest.mockResolvedValue(data)
    render(planner())
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Ubah Karyawan tidak tersedia 2026-11-09",
      })
    )
    const dialog = await screen.findByRole("dialog")
    expect(
      (within(dialog).getByLabelText(/Karyawan/) as HTMLSelectElement).disabled
    ).toBe(true)
    fireEvent.change(within(dialog).getByLabelText("Alasan perubahan"), {
      target: { value: "Assignment expired QA" },
    })
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Hapus dari draf" })
    )
    await waitFor(() =>
      expect(apiRequest).toHaveBeenCalledWith(
        expect.stringContaining("/draft"),
        expect.objectContaining({
          method: "PUT",
          body: expect.objectContaining({ entries: [] }),
        })
      )
    )
  })
})
