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
import type { PlannerWeek, StaffingReport } from "@/lib/weekly-planner"

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
  days: [
    {
      work_date: "2026-11-09",
      targets: { morning: 1, middle: 0, evening: 0 },
      counts: { morning: 0, middle: 0, evening: 0 },
    },
  ],
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
    name: "Tengah QA",
    versions: [
      {
        id: 2,
        revision: 1,
        start_time: "11:00:00",
        end_time: "19:00:00",
        effective_from: "2026-11-02",
        crosses_midnight: false,
      },
    ],
  },
  {
    id: 3,
    name: "Sore QA",
    versions: [
      {
        id: 3,
        revision: 1,
        start_time: "16:00:00",
        end_time: "22:00:00",
        effective_from: "2026-11-02",
        crosses_midnight: false,
      },
    ],
  },
]
function week(id = 1): PlannerWeek {
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
  }
}
function publishedWeek(): PlannerWeek {
  return {
    ...week(),
    version: 4,
    draft: null,
    published: {
      revision_id: 9,
      entries: [
        {
          employee_id: 1,
          work_date: "2026-11-09",
          status: "work",
          shift_template_version_id: 1,
        },
      ],
      staffing: { morning: 1, middle: 2, evening: 3 },
      publication_warnings: [],
    },
    published_weeks: [{ week_start: "2026-11-02", published_revision_id: 7 }],
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
function publishedPlanner() {
  return (
    <WeeklyPlanner
      outletId={1}
      outletName="Outlet QA 1"
      weekStart="2026-11-09"
      templates={templates}
      onBusyChange={vi.fn()}
      onPublished={vi.fn()}
    />
  )
}
async function changePublishedAssignment(assignment: string) {
  fireEvent.click(
    await screen.findByRole("button", {
      name: /Ubah penugasan Employee QA/,
    })
  )
  const drawer = await screen.findByRole("dialog")
  fireEvent.change(within(drawer).getByLabelText("Penugasan"), {
    target: { value: assignment },
  })
  fireEvent.click(
    within(drawer).getByRole("button", { name: "Terapkan penugasan" })
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
        ? { valid: true, version: 1, staffing_report: report }
        : week()
  )
})

describe("Supervisor weekly planner", () => {
  it("requires acknowledging the server warning checksum and never activates cutover", async () => {
    render(planner())
    fireEvent.click(
      await screen.findByRole("button", { name: "Periksa dan terbitkan" })
    )
    const dialog = await screen.findByRole("dialog")
    fireEvent.change(within(dialog).getByLabelText("Alasan perubahan"), {
      target: { value: "Kebutuhan QA" },
    })
    const publish = within(dialog).getByRole("button", {
      name: "Terbitkan jadwal",
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
  it("keeps shift settings in the draft menu while publication stays primary", async () => {
    render(planner())
    expect(
      await screen.findByRole("button", {
        name: "Periksa dan terbitkan",
      })
    ).toBeTruthy()
    expect(
      screen.queryByRole("button", { name: "Atur kebutuhan shift" })
    ).toBeNull()

    fireEvent.click(screen.getByRole("button", { name: "Aksi lainnya" }))
    fireEvent.click(
      screen.getByRole("menuitem", { name: "Atur kebutuhan shift" })
    )

    const drawer = await screen.findByRole("dialog")
    expect(
      within(drawer).getByRole("heading", { name: "Kebutuhan shift" })
    ).toBeTruthy()
    expect(apiRequest).toHaveBeenCalledTimes(1)
  })
  it("blocks stale publication until the latest version is loaded", async () => {
    apiRequest.mockImplementation(
      async (path: string, options?: { method?: string }) => {
        if (path.endsWith("/publish"))
          throw new ApiFailure("Versi roster berubah", 409)
        return options?.method
          ? { valid: true, version: 1, staffing_report: report }
          : week()
      }
    )
    render(planner())
    fireEvent.click(
      await screen.findByRole("button", { name: "Periksa dan terbitkan" })
    )
    const dialog = await screen.findByRole("dialog")
    fireEvent.change(within(dialog).getByLabelText("Alasan perubahan"), {
      target: { value: "Publish QA" },
    })
    fireEvent.click(within(dialog).getByRole("checkbox"))
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Terbitkan jadwal" })
    )
    await screen.findByRole("button", {
      name: "Pakai data terbaru, tinjau ulang perubahan saya",
    })
    fireEvent.click(
      screen.getByRole("button", {
        name: "Pakai data terbaru, tinjau ulang perubahan saya",
      })
    )
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
    fireEvent.click(
      screen.getByRole("button", { name: "Periksa dan terbitkan" })
    )
    const refreshedDialog = await screen.findByRole("dialog")
    expect(
      (
        within(refreshedDialog).getByLabelText(
          "Alasan perubahan"
        ) as HTMLInputElement
      ).value
    ).toBe("Publish QA")
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
      await screen.findByRole("button", { name: /Tambah penugasan.*9 Nov/ })
    )
    const drawer = await screen.findByRole("dialog")
    fireEvent.change(within(drawer).getByLabelText(/Karyawan/), {
      target: { value: "1" },
    })
    fireEvent.click(
      within(drawer).getByRole("button", { name: "Terapkan penugasan" })
    )
    fireEvent.click(screen.getByRole("button", { name: "Simpan draf" }))
    const dialog = await screen.findByRole("dialog")
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
        name: "Periksa hasil penyimpanan",
      })
    )
    await waitFor(() => expect(attempts).toBe(2))
    const saves = apiRequest.mock.calls.filter(
      ([, options]) => options?.method === "PUT"
    )
    expect(saves[0][1]).toEqual(saves[1][1])
    expect(saves[0][1]?.body).toBe(saves[1][1]?.body)
    expect(saves[0][1]?.headers).toEqual(saves[1][1]?.headers)
  })
  it("copies a published week into an empty draft without configuring shifts again", async () => {
    const empty = {
      ...week(),
      version: 0,
      draft: null,
      staffing_report: undefined,
      published_weeks: [{ week_start: "2026-11-02", published_revision_id: 7 }],
    }
    const source = {
      ...week(),
      week_start: "2026-11-02",
      draft: null,
      published: {
        revision_id: 7,
        entries: [
          {
            employee_id: 1,
            work_date: "2026-11-02",
            status: "work" as const,
            shift_template_version_id: 1,
          },
        ],
        staffing: { morning: 1, middle: 2, evening: 3 },
        publication_warnings: [],
      },
      published_weeks: [],
    }
    apiRequest.mockImplementation(async (path: string) =>
      path.endsWith("/weeks/2026-11-02") ? source : empty
    )
    render(planner())
    fireEvent.click(await screen.findByRole("button", { name: "Aksi lainnya" }))
    const copy = screen.getByRole("menuitem", {
      name: "Salin minggu sebelumnya",
    })
    fireEvent.click(copy)
    const dialog = await screen.findByRole("dialog")
    await within(dialog).findByText(/1 penugasan akan dipetakan/)
    fireEvent.change(within(dialog).getByLabelText("Alasan perubahan"), {
      target: { value: "Copy QA week" },
    })
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Salin sebagai draf" })
    )
    await waitFor(() =>
      expect(apiRequest).toHaveBeenCalledWith(
        expect.stringContaining("/copy"),
        expect.objectContaining({
          method: "POST",
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

  it("shows a staffing deficit and uses the date as the only weekly route to the editor", async () => {
    render(planner())
    expect(await screen.findByText("Pagi 0/1, kurang 1")).toBeTruthy()

    fireEvent.click(screen.getByRole("tab", { name: "Mingguan" }))
    fireEvent.click(
      await screen.findByRole("button", { name: /Buka editor .*9 Nov/ })
    )

    expect(
      screen.getByRole("tab", { name: "Harian" }).getAttribute("aria-selected")
    ).toBe("true")
    expect(
      screen.getByRole("button", { name: /Tambah penugasan.*9 Nov/ })
    ).toBeTruthy()
  })

  it("starts empty locally and only writes after explicitly saving a draft", async () => {
    const empty: PlannerWeek = {
      ...week(),
      version: 0,
      draft: null,
      published: null,
      staffing_report: undefined,
    }
    let current = empty
    apiRequest.mockImplementation(
      async (path: string, options?: { method?: string; body?: unknown }) => {
        if (path.endsWith("/draft")) {
          current = {
            ...empty,
            version: 1,
            draft: {
              revision_id: 1,
              entries: [],
              staffing: { morning: 1, middle: 2, evening: 3 },
              publication_warnings: [],
            },
          }
          return current
        }
        return options?.method ? {} : current
      }
    )
    render(planner())
    fireEvent.click(
      await screen.findByRole("button", { name: "Mulai jadwal kosong" })
    )
    expect(await screen.findByText("Draf belum disimpan")).toBeTruthy()
    fireEvent.click(
      screen.getByRole("button", { name: "Atur kebutuhan shift" })
    )
    const drawer = await screen.findByRole("dialog")
    fireEvent.change(within(drawer).getByLabelText(/Pagi/), {
      target: { value: "1" },
    })
    fireEvent.change(within(drawer).getByLabelText(/Tengah/), {
      target: { value: "2" },
    })
    fireEvent.change(within(drawer).getByLabelText(/Sore/), {
      target: { value: "3" },
    })
    fireEvent.click(
      within(drawer).getByRole("button", { name: "Terapkan pemetaan" })
    )
    expect(apiRequest).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole("button", { name: "Simpan draf" }))
    const dialog = await screen.findByRole("dialog")
    fireEvent.change(within(dialog).getByLabelText("Alasan perubahan"), {
      target: { value: "Roster awal QA" },
    })
    fireEvent.click(within(dialog).getByRole("button", { name: "Simpan draf" }))
    await waitFor(() =>
      expect(apiRequest).toHaveBeenCalledWith(
        expect.stringContaining("/draft"),
        expect.objectContaining({
          method: "PUT",
          body: {
            expected_version: 0,
            entries: [],
            staffing: { morning: 1, middle: 2, evening: 3 },
            reason: "Roster awal QA",
          },
        })
      )
    )
  })

  it("validates and explicitly saves a published replacement with its deficit checksum", async () => {
    const current = publishedWeek()
    const saved = publishedWeek()
    let persisted = current
    saved.version = 5
    const savedRevision = saved.published
    if (!savedRevision)
      throw new Error("Test fixture needs a published revision")
    saved.published = {
      ...savedRevision,
      revision_id: 10,
      entries: [
        {
          employee_id: 1,
          work_date: "2026-11-09",
          status: "rest",
          shift_template_version_id: null,
        },
      ],
    }
    apiRequest.mockImplementation(async (path: string) => {
      if (path.endsWith("/validate"))
        return {
          valid: true,
          version: 4,
          entry_count: 1,
          staffing_report: report,
        }
      if (path.endsWith("/save-changes")) {
        persisted = saved
        return {
          week_id: 1,
          week_start: saved.week_start,
          version: saved.version,
          draft: null,
          published: saved.published,
          staffing_report: saved.staffing_report,
        }
      }
      return persisted
    })
    render(publishedPlanner())
    await changePublishedAssignment("rest")
    fireEvent.click(await screen.findByRole("tab", { name: "Mingguan" }))
    expect(await screen.findByText("Istirahat")).toBeTruthy()
    fireEvent.click(screen.getByRole("tab", { name: "Harian" }))
    fireEvent.click(screen.getByRole("button", { name: "Simpan perubahan" }))
    const dialog = await screen.findByRole("dialog")
    expect(apiRequest).toHaveBeenCalledWith(
      expect.stringContaining("/validate"),
      {
        method: "POST",
        body: {
          expected_version: 4,
          expected_published_revision_id: 9,
          entries: [
            {
              employee_id: 1,
              work_date: "2026-11-09",
              status: "rest",
              shift_template_version_id: null,
            },
          ],
        },
      }
    )
    fireEvent.change(within(dialog).getByLabelText("Alasan perubahan"), {
      target: { value: "Penyesuaian QA" },
    })
    const save = within(dialog).getByRole("button", {
      name: "Simpan perubahan",
    }) as HTMLButtonElement
    expect(save.disabled).toBe(true)
    fireEvent.click(within(dialog).getByRole("checkbox"))
    expect(save.disabled).toBe(false)
    fireEvent.click(save)
    await waitFor(() =>
      expect(apiRequest).toHaveBeenCalledWith(
        expect.stringContaining("/save-changes"),
        expect.objectContaining({
          method: "POST",
          body: {
            expected_version: 4,
            expected_published_revision_id: 9,
            reason: "Penyesuaian QA",
            entries: [
              {
                employee_id: 1,
                work_date: "2026-11-09",
                status: "rest",
                shift_template_version_id: null,
              },
            ],
            warnings_checksum: report.checksum,
          },
          headers: { "Idempotency-Key": expect.any(String) },
        })
      )
    )
    expect(
      await screen.findByText("Perubahan jadwal berhasil disimpan.")
    ).toBeTruthy()
    expect(screen.queryByText("Hasil penyimpanan belum pasti")).toBeNull()
  })

  it("blocks a published replacement when server validation is invalid", async () => {
    apiRequest.mockImplementation(async (path: string) => {
      if (path.endsWith("/validate"))
        return {
          valid: false,
          version: 4,
          entry_count: 1,
          staffing_report: { ...report, deficits: [], checksum: null },
        }
      return publishedWeek()
    })
    render(publishedPlanner())
    await changePublishedAssignment("rest")
    fireEvent.click(screen.getByRole("button", { name: "Simpan perubahan" }))
    const dialog = await screen.findByRole("dialog")
    expect(
      await within(dialog).findByText("Jadwal belum lolos pemeriksaan.")
    ).toBeTruthy()
    expect(
      (
        within(dialog).getByRole("button", {
          name: "Simpan perubahan",
        }) as HTMLButtonElement
      ).disabled
    ).toBe(true)
    expect(
      apiRequest.mock.calls.some(([path]) =>
        String(path).endsWith("/save-changes")
      )
    ).toBe(false)
  })

  it("retries an ambiguous direct save with the exact same key and request", async () => {
    const current = publishedWeek()
    const saved = publishedWeek()
    saved.version = 5
    const noDeficits: StaffingReport = {
      ...report,
      deficits: [],
      checksum: null,
    }
    let persisted = current
    let attempts = 0
    apiRequest.mockImplementation(async (path: string) => {
      if (path.endsWith("/validate"))
        return {
          valid: true,
          version: 4,
          entry_count: 1,
          staffing_report: noDeficits,
        }
      if (path.endsWith("/save-changes")) {
        attempts += 1
        if (attempts === 1) throw new TypeError("Network failed")
        persisted = saved
        return {
          week_id: 1,
          week_start: saved.week_start,
          version: saved.version,
          draft: null,
          published: saved.published,
          staffing_report: noDeficits,
        }
      }
      return persisted
    })
    render(publishedPlanner())
    await changePublishedAssignment("rest")
    fireEvent.click(screen.getByRole("button", { name: "Simpan perubahan" }))
    const dialog = await screen.findByRole("dialog")
    expect(within(dialog).queryByRole("checkbox")).toBeNull()
    fireEvent.change(within(dialog).getByLabelText("Alasan perubahan"), {
      target: { value: "Save ulang QA" },
    })
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Simpan perubahan" })
    )
    await within(dialog).findByText("Jangan kirim perubahan baru")
    fireEvent.click(
      within(dialog).getByRole("button", {
        name: "Periksa hasil penyimpanan",
      })
    )
    await waitFor(() => expect(attempts).toBe(2))
    const saves = apiRequest.mock.calls.filter(([path]) =>
      String(path).endsWith("/save-changes")
    )
    expect(saves).toHaveLength(2)
    expect(saves[0][1]).toEqual(saves[1][1])
    expect(saves[0][1]?.body).toBe(saves[1][1]?.body)
    expect(saves[0][1]?.headers).toEqual(saves[1][1]?.headers)
    expect(saves[0][1]?.body).not.toHaveProperty("warnings_checksum")
    expect(
      await screen.findByText("Perubahan jadwal berhasil disimpan.")
    ).toBeTruthy()
  })

  it("keeps the candidate and reason through a stale Save Changes and requires explicit revalidation", async () => {
    const current = publishedWeek()
    const latest = publishedWeek()
    latest.version = 5
    const latestRevision = latest.published
    if (!latestRevision)
      throw new Error("Test fixture needs a published revision")
    latest.published = {
      ...latestRevision,
      revision_id: 10,
      entries: [
        {
          employee_id: 1,
          work_date: "2026-11-09",
          status: "work",
          shift_template_version_id: 3,
        },
      ],
    }
    let reads = 0
    let validates = 0
    apiRequest.mockImplementation(
      async (path: string, options?: { method?: string }) => {
        if (!options?.method) return reads++ === 0 ? current : latest
        if (path.endsWith("/validate")) {
          validates += 1
          return {
            valid: true,
            version: validates === 1 ? 4 : 5,
            entry_count: 1,
            staffing_report: report,
          }
        }
        if (path.endsWith("/save-changes"))
          throw new ApiFailure("Versi published berubah", 409)
        return {}
      }
    )
    render(publishedPlanner())
    await changePublishedAssignment("rest")
    fireEvent.click(screen.getByRole("button", { name: "Simpan perubahan" }))
    const dialog = await screen.findByRole("dialog")
    fireEvent.change(within(dialog).getByLabelText("Alasan perubahan"), {
      target: { value: "Koreksi jadwal QA" },
    })
    fireEvent.click(within(dialog).getByRole("checkbox"))
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Simpan perubahan" })
    )
    await screen.findByRole("heading", { name: "Jadwal terbaru" })
    expect(screen.getByText(/Sore QA · 16:00/)).toBeTruthy()
    expect(screen.getByRole("heading", { name: "Perubahan Anda" })).toBeTruthy()
    fireEvent.click(
      screen.getByRole("button", {
        name: "Pakai data terbaru, tinjau ulang perubahan saya",
      })
    )
    fireEvent.click(screen.getByRole("button", { name: "Simpan perubahan" }))
    const refreshedDialog = await screen.findByRole("dialog")
    expect(
      (
        within(refreshedDialog).getByLabelText(
          "Alasan perubahan"
        ) as HTMLInputElement
      ).value
    ).toBe("Koreksi jadwal QA")
    expect(
      within(refreshedDialog).getByRole("checkbox").getAttribute("aria-checked")
    ).toBe("false")
    expect(apiRequest).toHaveBeenLastCalledWith(
      expect.stringContaining("/validate"),
      {
        method: "POST",
        body: {
          expected_version: 5,
          expected_published_revision_id: 10,
          entries: [
            {
              employee_id: 1,
              work_date: "2026-11-09",
              status: "rest",
              shift_template_version_id: null,
            },
          ],
        },
      }
    )
  })

  it("does not apply a published candidate over a draft created by someone else", async () => {
    const current = publishedWeek()
    const latest = {
      ...week(),
      version: 5,
      draft: {
        revision_id: 11,
        entries: [
          {
            employee_id: 1,
            work_date: "2026-11-09",
            status: "work" as const,
            shift_template_version_id: 3,
          },
        ],
        staffing: { morning: 1, middle: 2, evening: 3 },
        publication_warnings: [],
      },
      published: current.published,
    }
    let reads = 0
    apiRequest.mockImplementation(
      async (path: string, options?: { method?: string }) => {
        if (!options?.method) return reads++ === 0 ? current : latest
        if (path.endsWith("/validate"))
          return {
            valid: true,
            version: 4,
            entry_count: 1,
            staffing_report: { ...report, deficits: [], checksum: null },
          }
        if (path.endsWith("/save-changes"))
          throw new ApiFailure("Versi published berubah", 409)
        return {}
      }
    )
    render(publishedPlanner())
    await changePublishedAssignment("rest")
    fireEvent.click(screen.getByRole("button", { name: "Simpan perubahan" }))
    const dialog = await screen.findByRole("dialog")
    fireEvent.change(within(dialog).getByLabelText("Alasan perubahan"), {
      target: { value: "Penyesuaian QA" },
    })
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Simpan perubahan" })
    )
    await screen.findByRole("heading", { name: "Jadwal terbaru" })
    expect(screen.getByText(/Perubahan lama tidak dipindahkan/)).toBeTruthy()
    expect(
      screen.queryByRole("button", {
        name: "Pakai data terbaru, tinjau ulang perubahan saya",
      })
    ).toBeNull()
    fireEvent.click(
      screen.getByRole("button", {
        name: "Muat data terbaru dan buang perubahan",
      })
    )
    expect(await screen.findByText("Draf #11")).toBeTruthy()
  })

  it("does not offer a middle shift for a weekend assignment", async () => {
    render(planner())
    fireEvent.click(await screen.findByRole("tab", { name: "Mingguan" }))
    fireEvent.click(
      await screen.findByRole("button", { name: /Buka editor .*14 Nov/ })
    )
    fireEvent.click(
      await screen.findByRole("button", { name: /Tambah penugasan.*14 Nov/ })
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
        name: /Ubah penugasan Karyawan tidak tersedia/,
      })
    )
    const drawer = await screen.findByRole("dialog")
    expect(
      (within(drawer).getByLabelText(/Karyawan/) as HTMLSelectElement).disabled
    ).toBe(true)
    fireEvent.click(
      within(drawer).getByRole("button", { name: "Hapus dari editor" })
    )
    fireEvent.click(screen.getByRole("button", { name: "Simpan draf" }))
    const dialog = await screen.findByRole("dialog")
    fireEvent.change(within(dialog).getByLabelText("Alasan perubahan"), {
      target: { value: "Assignment expired QA" },
    })
    fireEvent.click(within(dialog).getByRole("button", { name: "Simpan draf" }))
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
