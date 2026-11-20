import { describe, expect, it } from "vitest"
import {
  LOCATION_NOT_SENT_CAPTION,
  locationDeviceOffset,
  locationRecoverySteps,
  locationRecoveryTitle,
  locationStageView,
} from "./location-presentation"

const base = {
  operation: "check_in" as const,
  required: true,
  eligible: true,
  message: "",
  locating: false,
  permissionPending: false,
  location: { status: "provided" as const, accuracy_meters: 8 },
  radiusMeters: 100,
  outletName: "Outlet Sudirman",
  distanceMeters: 18,
  accuracyMeters: 8,
}

describe("locationStageView", () => {
  it("requires location permission to be reported before acquiring", () => {
    const pending = locationStageView({
      ...base,
      permissionPending: true,
      locating: true,
      location: null,
    })
    expect(pending.state).toBe("permission_requested")
    expect(pending.title).toBe("Butuh izin lokasi")
    expect(pending.facts).toBe("Browser meminta izin; pilih Izinkan.")
    expect(pending.primaryDisabled).toBe(true)
    expect(pending.mapVariant).toBe("permission_denied")
  })

  it("reports the acquiring state with a loading map and disabled action", () => {
    const view = locationStageView({ ...base, locating: true, location: null })
    expect(view.state).toBe("acquiring")
    expect(view.title).toBe("Mencari lokasi…")
    expect(view.facts).toBe("Biasanya selesai dalam 5–10 detik.")
    expect(view.primaryDisabled).toBe(true)
    expect(view.mapVariant).toBe("loading")
  })

  it("reports a found location with distance and accuracy", () => {
    const view = locationStageView(base)
    expect(view.state).toBe("acquired")
    expect(view.title).toBe("Lokasi ditemukan")
    expect(view.facts).toBe("Outlet Sudirman · ± 18 m · akurasi ± 8 m")
    expect(view.primaryLabel).toBe("Lanjut ke foto")
    expect(view.primaryDisabled).toBe(false)
    expect(view.mapVariant).toBe("resolved")
    expect(view.tone).toBe("neutral")
    expect(view.recoverySteps).toEqual([])
  })

  it("uses check-out wording throughout", () => {
    const view = locationStageView({ ...base, operation: "check_out" })
    expect(view.title).toBe("Lokasi check-out ditemukan")
    expect(view.primaryLabel).toBe("Lanjut ke foto check-out")
    expect(view.caption).toBe("Check-out belum dikirim.")
  })

  it("treats a denied permission as an error with a secondary exit", () => {
    const view = locationStageView({
      ...base,
      location: { status: "permission_denied" },
    })
    expect(view.state).toBe("permission_denied")
    expect(view.tone).toBe("error")
    expect(view.title).toBe("Izin lokasi ditolak")
    expect(view.primaryLabel).toBe("Coba lagi")
    expect(view.secondaryLabel).toBe("Kembali ke Hari Ini")
    expect(view.mapVariant).toBe("permission_denied")
    expect(view.recoverySteps).toHaveLength(3)
  })

  it("lets a denied permission win over a stale locating flag", () => {
    const view = locationStageView({
      ...base,
      locating: true,
      permissionPending: true,
      location: { status: "permission_denied" },
    })
    expect(view.state).toBe("permission_denied")
  })

  it("reports an unreadable position as an error", () => {
    const view = locationStageView({
      ...base,
      location: { status: "unavailable" },
    })
    expect(view.state).toBe("unavailable")
    expect(view.title).toBe("Lokasi belum terbaca")
    expect(view.tone).toBe("error")
    expect(view.mapVariant).toBe("unavailable")
  })

  it("never invents eligibility when the geofence rejects", () => {
    const view = locationStageView({
      ...base,
      eligible: false,
      distanceMeters: 240,
    })
    expect(view.state).toBe("out_of_range")
    expect(view.title).toBe("Di luar area outlet")
    expect(view.facts).toBe("Kamu ± 240 m dari Outlet Sudirman.")
    expect(view.state).not.toBe("acquired")
    // The frame keeps the resolved map and moves the dot out instead.
    expect(view.mapVariant).toBe("resolved")
  })

  it("never prints a raw four-digit metre value that reads like a decimal", () => {
    const view = locationStageView({
      ...base,
      eligible: false,
      distanceMeters: 116237,
    })
    expect(view.facts).toBe("Kamu ± 116,2 km dari Outlet Sudirman.")
    expect(view.facts).not.toMatch(/116237/)
  })

  it("keeps out-of-range wording distinct for check-out", () => {
    const view = locationStageView({
      ...base,
      operation: "check_out",
      eligible: false,
      distanceMeters: 240,
    })
    expect(view.title).toBe("Check-out di luar area")
    expect(view.facts).toBe("Belum terkirim · ± 240 m dari outlet.")
  })

  it("lets required=false win over every other signal", () => {
    const view = locationStageView({
      ...base,
      required: false,
      eligible: false,
      locating: true,
      location: { status: "permission_denied" },
    })
    expect(view.state).toBe("not_required")
    expect(view.recoverySteps).toEqual([])
    expect(view.primaryLabel).toBe("Lanjut ke foto")
  })

  it("always carries a caption", () => {
    expect(locationStageView(base).caption).toBe(LOCATION_NOT_SENT_CAPTION)
    expect(LOCATION_NOT_SENT_CAPTION).toBe("Check-in belum dikirim.")
  })
})

describe("recovery copy", () => {
  it("titles the disclosure the way the frames do", () => {
    for (const state of [
      "permission_denied",
      "unavailable",
      "out_of_range",
    ] as const) {
      expect(locationRecoveryTitle(state)).toBe("Cara memperbaiki")
      expect(locationRecoverySteps(state).length).toBeGreaterThan(0)
    }
  })

  it("offers no recovery copy for healthy states", () => {
    for (const state of [
      "acquired",
      "acquiring",
      "permission_requested",
      "not_required",
    ] as const) {
      expect(locationRecoveryTitle(state)).toBeNull()
      expect(locationRecoverySteps(state)).toEqual([])
    }
  })

  it("uses plain Indonesian with no technical identifiers", () => {
    for (const state of [
      "permission_denied",
      "unavailable",
      "out_of_range",
    ] as const) {
      const joined = locationRecoverySteps(state).join(" ")
      expect(joined).not.toMatch(/GPS\?|geofence|latency|token|API/i)
    }
  })
})

describe("locationDeviceOffset", () => {
  it("returns null when there is nothing to place", () => {
    expect(
      locationDeviceOffset({ distanceMeters: null, radiusMeters: 100 })
    ).toBeNull()
    expect(
      locationDeviceOffset({ distanceMeters: 10, radiusMeters: null })
    ).toBeNull()
    expect(
      locationDeviceOffset({ distanceMeters: 10, radiusMeters: 0 })
    ).toBeNull()
  })

  it("stays inside the field while the device is within the radius", () => {
    for (const distance of [0, 10, 99, 100]) {
      const offset = locationDeviceOffset({
        distanceMeters: distance,
        radiusMeters: 100,
      })
      expect(offset).not.toBeNull()
      expect(offset?.x).toBeGreaterThan(0.5)
      expect(offset?.x).toBeLessThanOrEqual(1)
      expect(offset?.y).toBeGreaterThanOrEqual(0)
      expect(offset?.y).toBeLessThanOrEqual(1)
    }
  })

  it("moves the dot past the field when out of range, still on-canvas", () => {
    // `CUETL` / `zLn5t` show the rejection spatially: the dot sits at scene
    // x≈345 of 402 (≈0.86), beyond the radius field but inside the 362px crop.
    const inside = locationDeviceOffset({
      distanceMeters: 100,
      radiusMeters: 100,
    })
    const outside = locationDeviceOffset({
      distanceMeters: 240,
      radiusMeters: 100,
    })
    expect(outside?.x).toBeGreaterThan(inside?.x ?? 0)
    expect(outside?.x).toBeGreaterThan(0.8)
    expect(outside?.x).toBeLessThanOrEqual(0.95)
  })

  it("moves the dot outward as the distance grows", () => {
    const near = locationDeviceOffset({ distanceMeters: 10, radiusMeters: 100 })
    const far = locationDeviceOffset({ distanceMeters: 90, radiusMeters: 100 })
    expect(far?.x).toBeGreaterThan(near?.x ?? 0)
  })

  it("bounds an absurd distance so the dot cannot leave the scene", () => {
    const beyond = locationDeviceOffset({
      distanceMeters: 5000,
      radiusMeters: 100,
    })
    expect(beyond?.x).toBeGreaterThan(0.8)
    expect(beyond?.x).toBeLessThanOrEqual(0.95)
  })
})
