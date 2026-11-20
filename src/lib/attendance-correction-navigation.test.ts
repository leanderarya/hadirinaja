import { describe, expect, it } from "vitest"
import {
  correctionHref,
  correctionSearch,
  matchingCorrection,
  type PersonalCorrectionOptions,
} from "./attendance-correction-navigation"

const options: PersonalCorrectionOptions = {
  tenant_id: 2,
  employee_id: 17,
  evaluated_at: "2026-11-06T01:00:00Z",
  sessions: [
    {
      session_id: 55,
      work_date: "2026-11-05",
      outlet: { id: 3, name: "Outlet asal" },
      correction_type: "missing_checkout",
      can_start: true,
      deadline: {
        exclusive_at: "2026-11-10T17:00:00Z",
        historical_timezone: "Asia/Jakarta",
        owner_required: false,
      },
    },
  ],
  reconstructions: [],
}

function search() {
  return Object.fromEntries(
    new URL(correctionHref(options, options.sessions[0]), "http://localhost")
      .searchParams
  )
}

describe("personal correction navigation", () => {
  it("round-trips the server context and requires a currently eligible owned target", () => {
    expect(matchingCorrection(correctionSearch(search()), options)).toEqual(
      options.sessions[0]
    )
    expect(
      matchingCorrection(
        correctionSearch({ ...search(), tenantId: 99 }),
        options
      )
    ).toBeUndefined()
    expect(
      matchingCorrection(
        correctionSearch({ ...search(), employeeId: 99 }),
        options
      )
    ).toBeUndefined()
    expect(
      matchingCorrection(
        correctionSearch({ ...search(), outletId: 99 }),
        options
      )
    ).toBeUndefined()
    expect(
      matchingCorrection(
        correctionSearch({ ...search(), sessionId: 99 }),
        options
      )
    ).toBeUndefined()
    expect(
      matchingCorrection(correctionSearch(search()), {
        ...options,
        sessions: [{ ...options.sessions[0], can_start: false }],
      })
    ).toBeUndefined()
    expect(
      matchingCorrection(correctionSearch(search()), undefined)
    ).toBeUndefined()
  })
  it.each([
    { workDate: "2026-02-30" },
    { workDate: "not-a-date" },
    { sessionId: "1e3" },
    { sessionId: -1 },
    { outletId: Number.MAX_SAFE_INTEGER + 1 },
    { employeeId: null },
    { correction: "reconstruction" },
    { correction: "delete" },
  ])("rejects malformed or conflicting search values %j", (invalid) => {
    expect(correctionSearch({ ...search(), ...invalid })).toEqual({
      correction: "invalid",
    })
  })
  it("allows ordinary Requests navigation without a correction context", () => {
    expect(correctionSearch({})).toEqual({})
  })
})
