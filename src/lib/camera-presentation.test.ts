import { describe, expect, it } from "vitest"

import {
  CAMERA_NOT_SENT_CAPTION,
  type CameraStageState,
  cameraRecoverySteps,
  cameraStageView,
} from "@/lib/camera-presentation"

const base = {
  secureContext: true,
  supported: true,
  mode: "capture" as const,
  ready: false,
  error: "",
  hasPhoto: false,
}

describe("cameraStageView", () => {
  it("prefers unsupported over every other signal", () => {
    expect(cameraStageView({ ...base, secureContext: false }).state).toBe(
      "unsupported"
    )
    expect(cameraStageView({ ...base, supported: false }).state).toBe(
      "unsupported"
    )
    expect(
      cameraStageView({
        ...base,
        secureContext: false,
        supported: false,
        error: "Izin kamera ditolak.",
        hasPhoto: true,
        mode: "preview",
        ready: true,
      }).state
    ).toBe("unsupported")
  })

  it("explains the insecure-context and unsupported-browser cases differently", () => {
    const insecure = cameraStageView({ ...base, secureContext: false })
    const unsupported = cameraStageView({ ...base, supported: false })

    expect(insecure.description).toContain("koneksi aman")
    expect(unsupported.description).toContain("tidak mendukung")
    expect(insecure.headline).toBe(unsupported.headline)
  })

  it("shows preview when a photo exists or the mode is preview", () => {
    expect(cameraStageView({ ...base, hasPhoto: true }).state).toBe("preview")
    expect(cameraStageView({ ...base, mode: "preview" }).state).toBe("preview")
    expect(
      cameraStageView({
        ...base,
        hasPhoto: true,
        error: "Izin kamera ditolak.",
      }).state
    ).toBe("preview")

    const preview = cameraStageView({ ...base, hasPhoto: true })
    expect(preview.secondaryLabel).toBe("Ambil ulang foto")
    expect(preview.headline).toBe("Periksa foto bukti")
  })

  it("maps permission wording to permission_denied and other messages to failed", () => {
    const denied = cameraStageView({
      ...base,
      error:
        "Izin kamera ditolak. Izinkan kamera untuk situs ini di pengaturan browser, lalu coba lagi.",
    })
    expect(denied.state).toBe("permission_denied")
    expect(denied.tone).toBe("error")
    expect(denied.actionLabel).toBe("Coba lagi")
    expect(cameraStageView({ ...base, error: "NotAllowedError" }).state).toBe(
      "permission_denied"
    )
    expect(cameraStageView({ ...base, error: "SecurityError" }).state).toBe(
      "permission_denied"
    )

    const failed = cameraStageView({
      ...base,
      error: "Kamera tidak ditemukan pada perangkat ini.",
    })
    expect(failed.state).toBe("failed")
    expect(failed.tone).toBe("error")
    expect(failed.headline).toBe("Kamera tidak bisa dibuka")
    expect(failed.actionLabel).toBe("Coba lagi")
    expect(failed.recoveryTitle).toBe("Periksa kamera perangkat")
  })

  it("reports ready once the route confirms a usable frame", () => {
    const ready = cameraStageView({ ...base, ready: true })
    expect(ready.state).toBe("ready")
    expect(ready.headline).toBe("Ambil foto bukti")
    expect(ready.actionLabel).toBe("Ambil foto")
    expect(ready.tone).toBe("accent")
    expect(ready.secondaryLabel).toBeNull()
  })

  it("defaults to warming before any readiness or error signal arrives", () => {
    const warming = cameraStageView(base)
    expect(warming.state).toBe("warming")
    expect(warming.tone).toBe("accent")
    expect(warming.actionLabel).toBe("Ambil foto")
  })

  it("keeps the not-sent caption stable", () => {
    expect(CAMERA_NOT_SENT_CAPTION).toBe("Check-in belum dikirim.")
  })
})

describe("cameraRecoverySteps", () => {
  it("lists recovery steps only for denied and failed states", () => {
    expect(cameraRecoverySteps("permission_denied").length).toBeGreaterThan(0)
    expect(cameraRecoverySteps("failed").length).toBeGreaterThan(0)

    const others: CameraStageState[] = [
      "waiting_permission",
      "warming",
      "unsupported",
      "ready",
      "preview",
    ]
    for (const state of others) expect(cameraRecoverySteps(state)).toEqual([])
  })

  it("names the browser permission path for denied access", () => {
    const steps = cameraRecoverySteps("permission_denied").join(" ")
    expect(steps).toContain("pengaturan izin situs")
    expect(steps).toContain("Izinkan")
    expect(steps).toContain("Coba lagi")
  })
})
