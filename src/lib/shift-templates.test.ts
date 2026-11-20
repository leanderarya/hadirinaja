import { describe, expect, it } from "vitest"
import {
  canReadTemplates,
  defaultShiftSelection,
  selectedShift,
  shiftSearch,
  validateShift,
  type ShiftDraft,
} from "./shift-templates"
const base: ShiftDraft = {
  name: "Pagi",
  start_time: "09:00",
  end_time: "17:00",
  crosses_midnight: false,
  effective_from: "2030-01-01",
  reason: "Penyesuaian operasional",
}
describe("Shift template boundaries", () => {
  it("validates 15-minute and 18-hour boundaries including overnight", () => {
    for (const [start, end, overnight, valid] of [
      ["09:00", "09:15", false, true],
      ["09:00", "09:14", false, false],
      ["06:00", "00:00", true, true],
      ["05:59", "00:00", true, false],
      ["23:50", "00:05", true, true],
      ["22:00", "06:00", false, false],
      ["09:00", "17:00", true, false],
      ["09:00", "09:00", true, false],
    ] as const)
      expect(
        Boolean(
          validateShift(
            {
              ...base,
              start_time: start,
              end_time: end,
              crosses_midnight: overnight,
            },
            true,
            "2030-01-01"
          ).end_time
        )
      ).toBe(!valid)
  })
  it("validates exact dates, UTC floor, fields and time format", () => {
    expect(validateShift(base, true, "2030-01-01")).toEqual({})
    expect(
      validateShift(
        { ...base, effective_from: "2029-12-31" },
        true,
        "2030-01-01"
      )
    ).toHaveProperty("effective_from")
    expect(
      validateShift(
        { ...base, effective_from: "2030-02-30" },
        true,
        "2030-01-01"
      )
    ).toHaveProperty("effective_from")
    expect(
      validateShift(
        { ...base, start_time: "24:00", name: " ", reason: "x" },
        true,
        "2030-01-01"
      )
    ).toMatchObject({
      start_time: expect.any(String),
      name: expect.any(String),
      reason: expect.any(String),
    })
    expect(
      validateShift({ ...base, name: "" }, false, "2030-01-01").name
    ).toBeUndefined()
  })
  it("rejects unsafe query IDs and cross-template revision selections", () => {
    for (const id of [-1, 0, "x", [1], 2 ** 53])
      expect(shiftSearch({ templateId: id }).templateId).toBeUndefined()
    expect(
      shiftSearch({
        templateId: "501",
        versionId: "601",
        from: "https://evil.test",
      })
    ).toMatchObject({ templateId: 501, versionId: 601, from: undefined })
    const templates = [
      {
        id: 501,
        name: "A",
        versions: [
          {
            id: 601,
            revision: 1,
            start_time: "09:00",
            end_time: "17:00",
            crosses_midnight: false,
            effective_from: "2000-01-01",
          },
        ],
      },
      { id: 502, name: "B", versions: [] },
    ]
    expect(defaultShiftSelection([], {})).toBeUndefined()
    expect(defaultShiftSelection(templates, {})).toEqual({ templateId: 501 })
    expect(
      defaultShiftSelection(templates, { templateId: 502 })
    ).toBeUndefined()
    expect(
      defaultShiftSelection(templates, { versionId: 601 })
    ).toBeUndefined()
    expect(
      defaultShiftSelection(templates, { templateId: 999, versionId: 601 })
    ).toEqual({ templateId: 501 })
    expect(
      selectedShift(templates, { templateId: 502, versionId: 601 }).invalid
    ).toBe(true)
    expect(selectedShift(templates, { versionId: 601 }).template?.id).toBe(501)
  })
  it("keeps Supervisor read access operational and Owner management route access", () => {
    expect(canReadTemplates(["owner"], false)).toBe(true)
    expect(canReadTemplates(["supervisor"], true)).toBe(true)
    expect(canReadTemplates(["supervisor"], false)).toBe(false)
    expect(canReadTemplates(["employee"], true)).toBe(false)
  })
})
