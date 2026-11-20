import { describe, expect, it } from "vitest"
import {
  isPlannerWeekend,
  plannerDates,
  plannerShiftTimes,
  plannerVisibleRoles,
  replacePlannerEntry,
  shiftPlannerDate,
  staffingOptions,
} from "./weekly-planner"

describe("weekly planner helpers", () => {
  it("keeps Monday–Sunday dates stable across months and daylight savings", () => {
    expect(plannerDates("2026-10-26")).toEqual([
      "2026-10-26",
      "2026-10-27",
      "2026-10-28",
      "2026-10-29",
      "2026-10-30",
      "2026-10-31",
      "2026-11-01",
    ])
    expect(shiftPlannerDate("2026-12-28", 7)).toBe("2027-01-04")
  })
  it("replaces one employee day without changing the other entries", () => {
    const original = [
      { employee_id: 1, work_date: "2026-11-02", status: "rest" as const },
      { employee_id: 2, work_date: "2026-11-02", status: "rest" as const },
    ]
    expect(
      replacePlannerEntry(original, {
        employee_id: 1,
        work_date: "2026-11-02",
        status: "work",
        shift_template_version_id: 3,
      })
    ).toEqual([
      original[1],
      {
        employee_id: 1,
        work_date: "2026-11-02",
        status: "work",
        shift_template_version_id: 3,
      },
    ])
    expect(original[0].status).toBe("rest")
  })
  it("does not guess mappings from template names or use future versions", () => {
    const version = {
      id: 1,
      revision: 1,
      start_time: "08:00:00",
      end_time: "16:00:00",
      crosses_midnight: false,
      effective_from: "2026-11-02",
    }
    const templates = [
      {
        id: 1,
        name: "Tengah",
        versions: [
          version,
          { ...version, id: 2, effective_from: "2026-11-10" },
          { ...version, id: 3, crosses_midnight: true },
        ],
      },
    ]
    expect(
      staffingOptions(templates, "morning", "2026-11-09").map((item) => item.id)
    ).toEqual([1])
    expect(staffingOptions(templates, "middle", "2026-11-09")).toEqual([])
  })
  it("uses tenant weekend settings and matching effective shift versions", () => {
    const settings = {
      weekend_starts_on: 5 as const,
      weekday_shifts: {
        morning: ["08:00:00", "16:00:00"] as const,
        middle: ["11:00:00", "18:00:00"] as const,
        evening: ["16:00:00", "22:00:00"] as const,
      },
      weekend_evening: ["16:00:00", "23:00:00"] as const,
      custom: true,
    }
    const templates = [
      {
        id: 1,
        name: "Morning",
        versions: [
          {
            id: 1,
            revision: 1,
            start_time: "08:00:00",
            end_time: "16:00:00",
            crosses_midnight: false,
            effective_from: "2026-11-02",
          },
        ],
      },
      {
        id: 2,
        name: "Middle",
        versions: [
          {
            id: 2,
            revision: 1,
            start_time: "11:00:00",
            end_time: "18:00:00",
            crosses_midnight: false,
            effective_from: "2026-11-02",
          },
        ],
      },
      {
        id: 3,
        name: "Weekday evening",
        versions: [
          {
            id: 3,
            revision: 1,
            start_time: "16:00:00",
            end_time: "22:00:00",
            crosses_midnight: false,
            effective_from: "2026-11-02",
          },
        ],
      },
      {
        id: 4,
        name: "Weekend evening",
        versions: [
          {
            id: 4,
            revision: 1,
            start_time: "16:00:00",
            end_time: "23:00:00",
            crosses_midnight: false,
            effective_from: "2026-11-13",
          },
          {
            id: 5,
            revision: 2,
            start_time: "16:00:00",
            end_time: "23:00:00",
            crosses_midnight: false,
            effective_from: "2026-11-21",
          },
          {
            id: 6,
            revision: 3,
            start_time: "16:00:00",
            end_time: "23:00:00",
            crosses_midnight: true,
            effective_from: "2026-11-02",
          },
          {
            id: 7,
            revision: 4,
            start_time: "16:00:00",
            end_time: "22:00:00",
            crosses_midnight: false,
            effective_from: "2026-11-02",
          },
        ],
      },
    ]

    expect(
      ["2026-11-19", "2026-11-20", "2026-11-21", "2026-11-22"].map((date) =>
        isPlannerWeekend(date, settings)
      )
    ).toEqual([false, true, true, true])
    expect(plannerVisibleRoles("2026-11-20", settings)).toEqual([
      "morning",
      "evening",
    ])
    expect(plannerShiftTimes("middle", settings)).toEqual(["11:00", "18:00"])
    expect(plannerShiftTimes("evening", settings, true)).toEqual([
      "16:00",
      "23:00",
    ])
    expect(
      staffingOptions(templates, "middle", "2026-11-20", settings).map(
        (item) => item.id
      )
    ).toEqual([2])
    expect(
      staffingOptions(templates, "evening", "2026-11-20", settings, true).map(
        (item) => item.id
      )
    ).toEqual([4])
    expect(
      staffingOptions(templates, "evening", "2026-11-21", settings, true).map(
        (item) => item.id
      )
    ).toEqual([4, 5])
  })
  it("keeps Saturday and Sunday as the weekend when settings are absent", () => {
    expect(
      ["2026-11-19", "2026-11-20", "2026-11-21", "2026-11-22"].map((date) =>
        isPlannerWeekend(date)
      )
    ).toEqual([false, false, true, true])
    expect(plannerVisibleRoles("2026-11-20")).toEqual([
      "morning",
      "middle",
      "evening",
    ])
    expect(plannerVisibleRoles("2026-11-21")).toEqual(["morning", "evening"])
    expect(plannerVisibleRoles("2026-11-22")).toEqual(["morning", "evening"])
  })
})
