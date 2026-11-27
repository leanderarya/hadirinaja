import { describe, expect, it } from "vitest"
import {
  buildPolicySnapshot,
  changedPolicyFields,
  hasPolicyOverride,
  policyToday,
  policyTomorrow,
  type PolicyResponse,
  policyDefaults,
  policyDraft,
  policyFingerprint,
  validatePolicyDate,
  validatePolicyDraft,
} from "./policy-editor"

const fixture = (): PolicyResponse => ({
  effective_date: "2026-10-28",
  effective: {
    effective_from: "2026-10-01",
    configuration: structuredClone(policyDefaults),
    tenant_default: structuredClone(policyDefaults),
    outlet_overrides: {
      late_tolerance_minutes: 10,
      check_in_window: { late_minutes: 90 },
      personal_location_validation: { latitude: -6.2, longitude: 106.8 },
      operational_review: { minimum_notice_hours: 48 },
    },
    tenant_version_id: 1,
    outlet_version_id: 2,
  },
  history: null,
})
describe("policy version snapshot editing", () => {
  it("preserves unrelated explicit leaves and does not materialize inherited values", () => {
    const response = fixture(),
      base = structuredClone(policyDefaults),
      draft = policyDraft(base)
    draft["check_in_window.early_minutes"] = "45"
    const original = structuredClone(response)
    const snapshot = buildPolicySnapshot(
      response,
      "outlet",
      changedPolicyFields(base, draft),
      draft
    )
    expect(snapshot).toEqual({
      ...response.effective.outlet_overrides,
      check_in_window: { early_minutes: 45, late_minutes: 90 },
    })
    expect(snapshot).not.toHaveProperty("attendance_mode")
    expect(snapshot).not.toHaveProperty("retroactive_request_limit_days")
    expect(response).toEqual(original)
  })
  it("normalizes Laravel empty override arrays before creating the first explicit leaf", () => {
    const response = fixture(),
      draft = policyDraft(policyDefaults)
    response.effective.outlet_overrides = [] as unknown as Record<
      string,
      unknown
    >
    draft.late_tolerance_minutes = "12"
    const snapshot = buildPolicySnapshot(
      response,
      "outlet",
      changedPolicyFields(policyDefaults, draft),
      draft
    )
    expect(JSON.parse(JSON.stringify(snapshot))).toEqual({
      late_tolerance_minutes: 12,
    })
  })
  it("carries the target-date snapshot rather than the old editing snapshot", () => {
    const target = fixture(),
      base = policyDefaults,
      draft = policyDraft(base)
    target.effective.outlet_overrides = {
      attendance_mode: "personal",
      check_in_window: { late_minutes: 0 },
    }
    draft.late_tolerance_minutes = "10"
    expect(
      buildPolicySnapshot(
        target,
        "outlet",
        changedPolicyFields(base, draft),
        draft
      )
    ).toEqual({
      attendance_mode: "personal",
      check_in_window: { late_minutes: 0 },
      late_tolerance_minutes: 10,
    })
  })
  it("treats zero/null as explicit, and omitted sibling leaves as inherited", () => {
    expect(
      hasPolicyOverride(
        { check_in_window: { early_minutes: 0 } },
        "check_in_window.early_minutes"
      )
    ).toBe(true)
    expect(
      hasPolicyOverride(
        { check_in_window: { early_minutes: 0 } },
        "check_in_window.late_minutes"
      )
    ).toBe(false)
    expect(
      hasPolicyOverride(
        { personal_location_validation: { latitude: null } },
        "personal_location_validation.latitude"
      )
    ).toBe(true)
  })
  it("patches coordinates as a pair, including explicit null pair", () => {
    const response = fixture(),
      base = structuredClone(policyDefaults)
    base.personal_location_validation.latitude = -6.2
    base.personal_location_validation.longitude = 106.8
    const draft = policyDraft(base)
    draft["personal_location_validation.latitude"] = ""
    draft["personal_location_validation.longitude"] = ""
    expect(
      buildPolicySnapshot(
        response,
        "outlet",
        changedPolicyFields(base, draft),
        draft
      )
    ).toMatchObject({
      personal_location_validation: { latitude: null, longitude: null },
    })
    draft["personal_location_validation.latitude"] = "0"
    expect(validatePolicyDraft(draft)).toHaveProperty(
      "personal_location_validation.latitude"
    )
  })
  it("sends a complete tenant configuration from tenant defaults, never Outlet effective values", () => {
    const response = fixture(),
      base = policyDefaults,
      draft = policyDraft(base)
    response.effective.configuration = {
      ...policyDefaults,
      attendance_mode: "personal",
    }
    response.effective.tenant_default = {
      ...policyDefaults,
      retroactive_request_limit_days: 14,
    }
    draft.late_tolerance_minutes = "7"
    expect(
      buildPolicySnapshot(
        response,
        "tenant",
        changedPolicyFields(base, draft),
        draft
      )
    ).toEqual({
      ...response.effective.tenant_default,
      late_tolerance_minutes: 7,
    })
  })
  it("does not submit no-op edits, unknown fields or missing Outlet base", () => {
    const response = fixture(),
      draft = policyDraft(policyDefaults)
    expect(changedPolicyFields(policyDefaults, draft)).toHaveLength(0)
    expect(() => buildPolicySnapshot(response, "outlet", [], draft)).toThrow(
      "Belum ada"
    )
    draft.late_tolerance_minutes = "9"
    response.effective.outlet_overrides.future_field = 42
    expect(() =>
      buildPolicySnapshot(
        response,
        "outlet",
        changedPolicyFields(policyDefaults, draft),
        draft
      )
    ).toThrow("belum didukung")
    response.effective.configuration = null
    expect(() =>
      buildPolicySnapshot(
        response,
        "outlet",
        changedPolicyFields(policyDefaults, draft),
        draft
      )
    ).toThrow("Kebijakan organisasi harus tersedia")
  })
  it("validates range boundaries, integers, modes and business-local dates", () => {
    const draft = policyDraft(policyDefaults)
    draft.late_tolerance_minutes = "0"
    draft["check_in_window.early_minutes"] = "360"
    expect(validatePolicyDraft(draft)).toEqual({})
    for (const value of ["", "181", "-1", "2.5", "NaN"]) {
      draft.late_tolerance_minutes = value
      expect(validatePolicyDraft(draft)).toHaveProperty(
        "late_tolerance_minutes"
      )
    }
    expect(validatePolicyDate("2026-10-28", "2026-10-28")).toBe(true)
    for (const date of ["2026-10-27", "2026-02-30", "invalid"])
      expect(validatePolicyDate(date, "2026-10-28")).toBe(false)
  })
  it("uses the Asia/Jakarta calendar at 23:30 WIB and across local midnight", () => {
    const beforeMidnight = new Date("2026-11-26T16:30:00.000Z")
    expect(policyToday(beforeMidnight)).toBe("2026-11-26")
    expect(policyTomorrow(beforeMidnight)).toBe("2026-11-27")

    const afterMidnight = new Date("2026-11-26T17:30:00.000Z")
    expect(policyToday(afterMidnight)).toBe("2026-11-27")
    expect(policyTomorrow(afterMidnight)).toBe("2026-11-28")
  })
  it("accepts a 25 meter geofence radius and rejects 24.99 meters", () => {
    const draft = policyDraft(policyDefaults),
      radius = "personal_location_validation.radius_meters"
    draft[radius] = "25"
    expect(validatePolicyDraft(draft)).not.toHaveProperty(radius)
    draft[radius] = "24.99"
    expect(validatePolicyDraft(draft)).toHaveProperty(radius)
  })
  it("compares snapshot data and version ids without sensitivity to property order", () => {
    const a = fixture(),
      b = fixture()
    b.effective.outlet_overrides = Object.fromEntries(
      Object.entries(b.effective.outlet_overrides).reverse()
    )
    expect(policyFingerprint(a, "outlet")).toBe(policyFingerprint(b, "outlet"))
    b.effective.outlet_version_id = 9
    expect(policyFingerprint(a, "outlet")).not.toBe(
      policyFingerprint(b, "outlet")
    )
    expect(policyFingerprint(a, "tenant")).toBe(policyFingerprint(b, "tenant"))
  })
})
