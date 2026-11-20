export type AttendanceOperation = "check_in" | "check_out"

export type AttendanceFlowStage =
  | "destination"
  | "location"
  | "photo"
  | "confirm"
  | "submitting"
  | "result"

export type AttendanceSubmissionState =
  | "idle"
  | "sending"
  | "checking"
  | "success"
  | "lost"
  | "out_of_range"

/** Which canonical fact a summary row carries. The route maps these to icons. */
export type AttendanceSummaryKey =
  | "operation"
  | "time"
  | "location"
  | "distance"
  | "outlet"
  | "photo"

export type AttendanceSummaryRowData = {
  key: AttendanceSummaryKey
  label: string
  value: string
  /** The orchid #E79FF5 row (uqxF6). */
  emphasis?: boolean
}

export type AttendanceStepData = { id: string; label: string; number: string }

const FLOW_STEPS: AttendanceStepData[] = [
  { id: "location", label: "Lokasi", number: "1" },
  { id: "photo", label: "Foto", number: "2" },
  { id: "confirm", label: "Konfirmasi", number: "3" },
]

export function attendanceFlowSteps(): AttendanceStepData[] {
  return FLOW_STEPS.map((step) => ({ ...step }))
}

export function operationNoun(operation: AttendanceOperation): string {
  return operation === "check_in" ? "Check-in" : "Check-out"
}

/**
 * Dialog title. Mirrors the pen.dev frames: the step screens name the operation,
 * confirmation names itself, submission and results name the outcome.
 */
export function attendanceFlowTitle(input: {
  stage: AttendanceFlowStage
  operation: AttendanceOperation
  submission: AttendanceSubmissionState
}): string {
  switch (input.stage) {
    case "confirm":
      return "Konfirmasi absensi"
    case "submitting":
      return "Mengirim absensi"
    case "result":
      return input.submission === "checking"
        ? "Memeriksa absensi"
        : input.submission === "sending"
          ? "Mengirim absensi"
          : "Hasil absensi"
    default:
      return operationNoun(input.operation)
  }
}

/** Index into `attendanceFlowSteps()` for the current stage. */
export function attendanceFlowStepIndex(stage: AttendanceFlowStage): number {
  switch (stage) {
    case "destination":
    case "location":
      return 0
    case "photo":
      return 1
    default:
      return 2
  }
}

/**
 * Step trail state per frame: submitting and success mark every step done,
 * an out-of-range result paints the location step as failed while keeping the
 * confirmation step current (DBvSR).
 */
export function attendanceTrailState(input: {
  stage: AttendanceFlowStage
  submission: AttendanceSubmissionState
}): { activeIndex: number; complete: boolean; errorIndex?: number } {
  // wdXB0: a confirmed success completes every step.
  if (input.submission === "success") return { activeIndex: 2, complete: true }
  // A3TMy: while the request is in flight the confirmation step is still the
  // current one, not a completed check.
  if (input.stage === "submitting" || input.submission === "sending") {
    return { activeIndex: 2, complete: false }
  }
  return { activeIndex: attendanceFlowStepIndex(input.stage), complete: false }
}

export type AttendanceConfirmationInput = {
  operation: AttendanceOperation
  outletName: string | null
  /** Shift window from the schedule, e.g. "08.00–17.00"; null when unknown. */
  scheduleWindow: string | null
  /** What the client can honestly say about where it is; null when unknown. */
  locationCopy: string | null
  distanceMeters: number | null
  hasPhoto: boolean
  photoRequired: boolean
}

/**
 * Rows for the confirmation screen and the result screen. Values are the
 * server-owned facts the client is about to send; nothing here is inferred.
 * Order follows canonical node uqxF6. The photo row only appears when no photo
 * block can be shown, so the summary never states the same fact twice.
 */
export function confirmationRows(
  input: AttendanceConfirmationInput
): AttendanceSummaryRowData[] {
  const rows: AttendanceSummaryRowData[] = [
    {
      key: "operation",
      label: "Jenis aksi",
      value: operationNoun(input.operation),
    },
  ]
  if (input.scheduleWindow) {
    rows.push({ key: "time", label: "Waktu", value: input.scheduleWindow })
  }
  // The frames show a street address. This client holds coordinates and a
  // measured distance, never an address, so it reports the fact it has rather
  // than inventing one.
  if (input.locationCopy) {
    rows.push({ key: "location", label: "Lokasi", value: input.locationCopy })
  }
  rows.push({
    key: "outlet",
    label: "Outlet",
    value: input.outletName ?? "Outlet belum tersedia",
    emphasis: true,
  })
  if (!input.hasPhoto) {
    rows.push({
      key: "photo",
      label: "Foto bukti",
      value: input.photoRequired ? "Belum diambil" : "Dilewati",
    })
  }
  return rows
}

export type AttendanceResultVariant =
  | "progress"
  | "success"
  | "lost"
  | "checking"
  | "out_of_range"

export type AttendanceResultCopy = {
  variant: AttendanceResultVariant
  headline: string
  description: string
  /** Section title above the summary card; absent while the request is in flight. */
  detailsTitle: string | null
  primaryLabel: string | null
  secondaryLabel: string | null
  recoveryTitle: string | null
  recoverySteps: string[]
  help: string | null
  caption: string
}

/**
 * Result screen copy. `message` is the server/transport reason and is only ever
 * displayed verbatim inside a failure state, never turned into a success claim.
 */
export function attendanceResultCopy(input: {
  submission: AttendanceSubmissionState
  operation: AttendanceOperation
  message: string
}): AttendanceResultCopy | null {
  const verb = operationNoun(input.operation)

  if (input.submission === "sending")
    return {
      variant: "progress",
      headline: `Mengirim ${verb}`,
      description: "Tunggu hingga hasil pengiriman muncul.",
      detailsTitle: null,
      primaryLabel: null,
      secondaryLabel: null,
      recoveryTitle: null,
      recoverySteps: [],
      help: null,
      caption: "Status dan riwayat diperbarui setelah server mengonfirmasi.",
    }

  if (input.submission === "checking")
    return {
      variant: "checking",
      headline: `Memeriksa ${verb}`,
      description: "Kami memeriksa hasil pengiriman sebelumnya.",
      detailsTitle: null,
      primaryLabel: null,
      secondaryLabel: null,
      recoveryTitle: null,
      recoverySteps: [],
      help: null,
      caption: "Data yang sudah tercatat tidak dikirim ulang.",
    }

  if (input.submission === "success")
    return {
      variant: "success",
      headline: `${verb} berhasil`,
      description:
        "Absensi sudah tercatat. Status Hari Ini dan riwayatmu sudah diperbarui.",
      detailsTitle: "Data yang tercatat",
      primaryLabel: "Kembali ke Hari Ini",
      secondaryLabel: "Lihat riwayat absensi",
      recoveryTitle: null,
      recoverySteps: [],
      help: null,
      caption: "Tercatat oleh server, bukan perkiraan aplikasi.",
    }

  if (input.submission === "out_of_range")
    return {
      variant: "out_of_range",
      headline: "Di luar area absensi",
      description: `Lokasimu di luar batas jarak outlet. ${verb} belum dicatat.`,
      detailsTitle: "Lokasi yang ditolak",
      primaryLabel: "Coba lagi dengan lokasi baru",
      secondaryLabel: "Kembali ke Hari Ini",
      recoveryTitle: "Sebelum mencoba lagi",
      recoverySteps: [
        "Dekati outlet yang ditugaskan.",
        "Aktifkan lokasi presisi dan cari tempat dengan sinyal GPS yang baik.",
      ],
      help: "Sudah di outlet? Minta penanggung jawab memeriksa pengaturan area.",
      caption: `${verb} belum dikirim.`,
    }

  if (input.submission === "lost")
    return {
      variant: "lost",
      headline: "Koneksi terputus",
      description:
        input.message ||
        `Hasil ${verb} belum dapat dipastikan. Sambungkan internet, lalu coba lagi.`,
      detailsTitle: "Data yang dikirim",
      primaryLabel: "Coba lagi",
      secondaryLabel: null,
      recoveryTitle: null,
      recoverySteps: [],
      help: null,
      caption:
        "Kami cek statusnya dahulu agar absensi tidak tercatat dua kali.",
    }

  return null
}
