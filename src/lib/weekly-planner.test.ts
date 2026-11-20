import { describe, expect, it } from "vitest"
import {
  plannerDates,
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
})
