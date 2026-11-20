import { describe, expect, it } from "vitest"
import { locationEligibility, validCoordinates } from "./geofence"

const outlet = { required: true, latitude: 0, longitude: 0, radius_meters: 100 }
const location = {
  status: "provided" as const,
  latitude: 0,
  longitude: 0,
  accuracy_meters: 10,
}

describe("personal location feedback", () => {
  it.each([
    0, 100, 100.01, 101, 1000,
  ])("matches the inclusive boundary at %s meters", (meters) => {
    expect(
      locationEligibility(outlet, {
        ...location,
        latitude: ((meters / 6371000) * 180) / Math.PI,
      }).eligible
    ).toBe(meters <= 100)
  })
  it("accepts zero coordinates but rejects missing configuration", () => {
    expect(locationEligibility(outlet, location).eligible).toBe(true)
    expect(
      locationEligibility({ ...outlet, latitude: null }, location).eligible
    ).toBe(false)
  })
  it("uses the existing radius as maximum accuracy without rounding", () => {
    expect(
      locationEligibility(outlet, { ...location, accuracy_meters: 100 })
        .eligible
    ).toBe(true)
    expect(
      locationEligibility(outlet, { ...location, accuracy_meters: 100.001 })
        .eligible
    ).toBe(false)
  })
  it("rejects missing GPS and denied permission", () => {
    expect(locationEligibility(outlet, null).eligible).toBe(false)
    expect(
      locationEligibility(outlet, { status: "permission_denied" }).message
    ).toContain("Izin lokasi ditolak")
  })
  it.each([NaN, Infinity, 91])("rejects invalid latitude %s", (latitude) => {
    expect(validCoordinates({ latitude, longitude: 0 })).toBe(false)
    expect(
      locationEligibility(outlet, { ...location, latitude }).eligible
    ).toBe(false)
  })
})
