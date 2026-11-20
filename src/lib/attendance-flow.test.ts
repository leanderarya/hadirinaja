import { describe, expect, it } from "vitest"
import {
  attendanceFlowStepIndex,
  attendanceFlowSteps,
  attendanceFlowTitle,
  attendanceResultCopy,
  attendanceTrailState,
  confirmationRows,
  operationNoun,
} from "./attendance-flow"

describe("attendance flow presentation", () => {
  it("exposes the canonical three steps in order", () => {
    const steps = attendanceFlowSteps()
    expect(steps.map((step) => step.label)).toEqual([
      "Lokasi",
      "Foto",
      "Konfirmasi",
    ])
    expect(steps.map((step) => step.number)).toEqual(["1", "2", "3"])
    // callers must not be able to mutate the shared list
    steps[0].label = "mutated"
    expect(attendanceFlowSteps()[0].label).toBe("Lokasi")
  })

  it("names the operation per step like the pen.dev frames", () => {
    expect(operationNoun("check_in")).toBe("Check-in")
    expect(operationNoun("check_out")).toBe("Check-out")
    expect(
      attendanceFlowTitle({
        stage: "location",
        operation: "check_in",
        submission: "idle",
      })
    ).toBe("Check-in")
    expect(
      attendanceFlowTitle({
        stage: "confirm",
        operation: "check_out",
        submission: "idle",
      })
    ).toBe("Konfirmasi absensi")
    expect(
      attendanceFlowTitle({
        stage: "submitting",
        operation: "check_in",
        submission: "sending",
      })
    ).toBe("Mengirim absensi")
  })

  it("titles result screens by outcome", () => {
    expect(
      attendanceFlowTitle({
        stage: "result",
        operation: "check_in",
        submission: "success",
      })
    ).toBe("Hasil absensi")
    expect(
      attendanceFlowTitle({
        stage: "result",
        operation: "check_out",
        submission: "checking",
      })
    ).toBe("Memeriksa absensi")
    expect(
      attendanceFlowTitle({
        stage: "result",
        operation: "check_in",
        submission: "sending",
      })
    ).toBe("Mengirim absensi")
  })

  it("maps stages onto trail indexes", () => {
    expect(attendanceFlowStepIndex("destination")).toBe(0)
    expect(attendanceFlowStepIndex("location")).toBe(0)
    expect(attendanceFlowStepIndex("photo")).toBe(1)
    expect(attendanceFlowStepIndex("confirm")).toBe(2)
    expect(attendanceFlowStepIndex("result")).toBe(2)
  })

  it("keeps the confirmation step current while submitting", () => {
    // A3TMy draws step 3 as the current blue step, not a completed check.
    expect(
      attendanceTrailState({ stage: "submitting", submission: "sending" })
    ).toEqual({
      activeIndex: 2,
      complete: false,
    })
    expect(
      attendanceTrailState({ stage: "result", submission: "sending" })
    ).toEqual({
      activeIndex: 2,
      complete: false,
    })
    expect(
      attendanceTrailState({ stage: "result", submission: "success" })
    ).toEqual({
      activeIndex: 2,
      complete: true,
    })
    expect(
      attendanceTrailState({ stage: "result", submission: "checking" })
    ).toEqual({
      activeIndex: 2,
      complete: false,
    })
  })

  it("leaves the out-of-range trail to the location step, which owns that state", () => {
    // The app rejects out of range before any photo exists, so a result-stage
    // branch would be dead code. The location step paints its own error index.
    expect(
      attendanceTrailState({ stage: "location", submission: "idle" })
    ).toEqual({
      activeIndex: 0,
      complete: false,
    })
  })

  it("names the recorded facts per outcome", () => {
    expect(
      attendanceResultCopy({
        submission: "success",
        operation: "check_in",
        message: "",
      })?.detailsTitle
    ).toBe("Data yang tercatat")
    expect(
      attendanceResultCopy({
        submission: "lost",
        operation: "check_in",
        message: "",
      })?.detailsTitle
    ).toBe("Data yang dikirim")
    expect(
      attendanceResultCopy({
        submission: "out_of_range",
        operation: "check_in",
        message: "",
      })?.detailsTitle
    ).toBe("Lokasi yang ditolak")
    expect(
      attendanceResultCopy({
        submission: "sending",
        operation: "check_in",
        message: "",
      })?.detailsTitle
    ).toBeNull()
  })

  it("builds summary rows from supplied facts only", () => {
    const rows = confirmationRows({
      operation: "check_in",
      outletName: "Outlet Pusat",
      scheduleWindow: "08.00–17.00",
      locationCopy: "12 m dari Outlet",
      distanceMeters: 12.4,
      hasPhoto: true,
      photoRequired: true,
    })
    expect(rows.map((row) => row.label)).toEqual([
      "Jenis aksi",
      "Waktu",
      "Lokasi",
      "Outlet",
    ])
    expect(rows[1].value).toBe("08.00–17.00")
    expect(rows[2].value).toBe("12 m dari Outlet")
    expect(rows[3]).toEqual({
      key: "outlet",
      label: "Outlet",
      value: "Outlet Pusat",
      emphasis: true,
    })
  })

  it("omits an unknown distance and labels a skipped photo", () => {
    const rows = confirmationRows({
      operation: "check_out",
      outletName: null,
      scheduleWindow: null,
      locationCopy: null,
      distanceMeters: null,
      hasPhoto: false,
      photoRequired: false,
    })
    expect(rows.some((row) => row.label === "Jarak")).toBe(false)
    expect(rows.find((row) => row.label === "Foto bukti")?.value).toBe(
      "Dilewati"
    )
    expect(rows.find((row) => row.label === "Outlet")?.value).toBe(
      "Outlet belum tersedia"
    )
  })

  it("marks a required but missing photo", () => {
    const rows = confirmationRows({
      operation: "check_in",
      outletName: "Outlet Pusat",
      scheduleWindow: null,
      locationCopy: null,
      distanceMeters: null,
      hasPhoto: false,
      photoRequired: true,
    })
    expect(rows.find((row) => row.label === "Foto bukti")?.value).toBe(
      "Belum diambil"
    )
  })

  it("returns null while the flow has no outcome to report", () => {
    expect(
      attendanceResultCopy({
        submission: "idle",
        operation: "check_in",
        message: "",
      })
    ).toBeNull()
  })

  it("never claims success without the completed outcome", () => {
    const sending = attendanceResultCopy({
      submission: "sending",
      operation: "check_in",
      message: "",
    })
    expect(sending?.variant).toBe("progress")
    expect(sending?.headline).toBe("Mengirim Check-in")
    expect(sending?.primaryLabel).toBeNull()

    const checking = attendanceResultCopy({
      submission: "checking",
      operation: "check_out",
      message: "",
    })
    expect(checking?.variant).toBe("checking")
    expect(checking?.headline).toBe("Memeriksa Check-out")
  })

  it("reports success as recorded by the server", () => {
    const copy = attendanceResultCopy({
      submission: "success",
      operation: "check_out",
      message: "",
    })
    expect(copy?.variant).toBe("success")
    expect(copy?.headline).toBe("Check-out berhasil")
    expect(copy?.caption).toContain("server")
    expect(copy?.primaryLabel).toBe("Kembali ke Hari Ini")
    expect(copy?.secondaryLabel).toBe("Lihat riwayat absensi")
  })

  it("shows the transport message only inside a failure state", () => {
    const copy = attendanceResultCopy({
      submission: "lost",
      operation: "check_in",
      message:
        "Hasil permintaan belum pasti. Periksa status sebelum mengulang.",
    })
    expect(copy?.variant).toBe("lost")
    expect(copy?.description).toBe(
      "Hasil permintaan belum pasti. Periksa status sebelum mengulang."
    )
    expect(copy?.caption).toContain("tidak tercatat dua kali")
  })

  it("falls back to its own copy when no failure message is supplied", () => {
    const copy = attendanceResultCopy({
      submission: "lost",
      operation: "check_out",
      message: "",
    })
    expect(copy?.description).toContain(
      "Hasil Check-out belum dapat dipastikan"
    )
  })

  it("keeps the out-of-range recovery steps", () => {
    const copy = attendanceResultCopy({
      submission: "out_of_range",
      operation: "check_in",
      message: "",
    })
    expect(copy?.headline).toBe("Di luar area absensi")
    expect(copy?.recoverySteps).toHaveLength(2)
    expect(copy?.primaryLabel).toBe("Coba lagi dengan lokasi baru")
    expect(copy?.secondaryLabel).toBe("Kembali ke Hari Ini")
  })
})
