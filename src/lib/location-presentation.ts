/**
 * Compact Location step copy, transcribed from the eight authoritative frames
 * (`TE8Jj`, `JKJG0`, `T4IMBd`, `VfOVV`, `x7J5WC`, `CUETL`, `vJp1S`, `zLn5t`)
 * described in `docs/SLICING-INDEX.md` §9.
 *
 * This module only maps state → presentation. Eligibility is never decided here:
 * `locationEligibility()` owns that, and the route passes its verdict in.
 */

export type LocationStageState =
  | "permission_requested"
  | "acquiring"
  | "permission_denied"
  | "unavailable"
  | "acquired"
  | "out_of_range"
  | "not_required"

export type LocationMapVariant =
  | "resolved"
  | "loading"
  | "unavailable"
  | "permission_denied"

export type LocationStageView = {
  state: LocationStageState
  /** Which `LocationMapPreview` variant the frame pairs with this state. */
  mapVariant: LocationMapVariant
  tone: "neutral" | "error"
  /** 14/700 status line. */
  title: string
  /** 12/500 facts line. */
  facts: string
  /** Collapsed recovery disclosure; null when the frame has none. */
  recoveryTitle: string | null
  recoverySteps: string[]
  primaryLabel: string
  primaryDisabled: boolean
  secondaryLabel: string | null
  caption: string
}

export const LOCATION_NOT_SENT_CAPTION = "Check-in belum dikirim."

const RECOVERY: Record<
  "permission_denied" | "unavailable" | "out_of_range",
  { title: string; steps: string[] }
> = {
  permission_denied: {
    title: "Cara memperbaiki",
    steps: [
      "Buka setelan browser, pilih izin lokasi.",
      "Pilih Izinkan untuk situs HadirinAja.",
      "Muat ulang halaman, lalu ketuk Coba lagi.",
    ],
  },
  unavailable: {
    title: "Cara memperbaiki",
    steps: [
      "Dekatkan diri ke jendela atau area terbuka.",
      "Matikan lalu nyalakan GPS perangkat.",
      "Ketuk Coba lagi setelah 10 detik.",
    ],
  },
  out_of_range: {
    title: "Cara memperbaiki",
    steps: [
      "Dekati outlet sampai penanda perangkat masuk lingkaran.",
      "Tunggu akurasi di bawah 30 m.",
      "Ketuk Coba lokasi lagi.",
    ],
  },
}

export function locationRecoverySteps(state: LocationStageState): string[] {
  if (
    state === "permission_denied" ||
    state === "unavailable" ||
    state === "out_of_range"
  )
    return [...RECOVERY[state].steps]
  return []
}

export function locationRecoveryTitle(
  state: LocationStageState
): string | null {
  if (
    state === "permission_denied" ||
    state === "unavailable" ||
    state === "out_of_range"
  )
    return RECOVERY[state].title
  return null
}

const BACK_TO_TODAY = "Kembali ke Hari Ini"

/**
 * Distances read as metres close in and kilometres far out, so a raw four-digit
 * metre value never looks like a decimal ("116.237 m" is 116 km, not 116 metres).
 */
function formatDistance(meters: number | null): string {
  if (meters == null) return "0 m"
  if (meters < 1000) return `${Math.ceil(meters)} m`
  return `${new Intl.NumberFormat("id-ID", { maximumFractionDigits: 1 }).format(meters / 1000)} km`
}

/** "Outlet Sudirman · ± 18 m · akurasi ± 8 m" (frame `T4IMBd`). */
function factsLine(input: {
  outletName: string | null
  distanceMeters: number | null
  accuracyMeters: number | null
}): string {
  const parts: string[] = [input.outletName ?? "Outlet belum tersedia"]
  if (input.distanceMeters != null)
    parts.push(`± ${Math.ceil(input.distanceMeters)} m`)
  if (input.accuracyMeters != null)
    parts.push(`akurasi ± ${Math.ceil(input.accuracyMeters)} m`)
  return parts.join(" · ")
}

/**
 * Maps the eligibility result onto the compact screen copy. `eligible` and
 * `message` come from `locationEligibility`; nothing is recomputed here.
 */
export function locationStageView(input: {
  operation: "check_in" | "check_out"
  required: boolean
  eligible: boolean
  message: string
  locating: boolean
  /** True while the browser permission prompt is still unanswered. */
  permissionPending: boolean
  location: {
    status: "provided" | "unavailable" | "permission_denied"
    accuracy_meters?: number
  } | null
  radiusMeters: number | null
  outletName: string | null
  distanceMeters: number | null
  accuracyMeters: number | null
}): LocationStageView {
  const state = resolveState(input)
  const checkout = input.operation === "check_out"
  const caption = checkout
    ? "Check-out belum dikirim."
    : LOCATION_NOT_SENT_CAPTION
  const recovery = locationRecoverySteps(state)

  const base = {
    state,
    recoveryTitle: locationRecoveryTitle(state),
    recoverySteps: recovery,
    caption,
  }

  switch (state) {
    case "not_required":
      return {
        ...base,
        mapVariant: "resolved",
        tone: "neutral",
        title: "Lokasi tidak diwajibkan",
        facts: "Absensi di outlet ini tidak memerlukan pemeriksaan lokasi.",
        primaryLabel: checkout ? "Lanjut ke foto check-out" : "Lanjut ke foto",
        primaryDisabled: false,
        secondaryLabel: null,
      }
    case "permission_requested":
      return {
        ...base,
        mapVariant: "permission_denied",
        tone: "neutral",
        title: "Butuh izin lokasi",
        facts: "Browser meminta izin; pilih Izinkan.",
        primaryLabel: checkout ? "Lanjut ke foto check-out" : "Lanjut ke foto",
        primaryDisabled: true,
        secondaryLabel: null,
      }
    case "acquiring":
      return {
        ...base,
        mapVariant: "loading",
        tone: "neutral",
        title: "Mencari lokasi…",
        facts: "Biasanya selesai dalam 5–10 detik.",
        primaryLabel: checkout ? "Lanjut ke foto check-out" : "Lanjut ke foto",
        primaryDisabled: true,
        secondaryLabel: null,
      }
    case "permission_denied":
      return {
        ...base,
        mapVariant: "permission_denied",
        tone: "error",
        title: "Izin lokasi ditolak",
        facts: "Tanpa izin, absensi belum bisa dilanjutkan.",
        primaryLabel: "Coba lagi",
        primaryDisabled: false,
        secondaryLabel: BACK_TO_TODAY,
      }
    case "unavailable":
      return {
        ...base,
        mapVariant: "unavailable",
        tone: "error",
        title: "Lokasi belum terbaca",
        facts: "GPS lemah atau akurasi rendah. Coba di area terbuka.",
        primaryLabel: "Coba lagi",
        primaryDisabled: false,
        secondaryLabel: BACK_TO_TODAY,
      }
    case "acquired":
      return {
        ...base,
        mapVariant: "resolved",
        tone: "neutral",
        title: checkout ? "Lokasi check-out ditemukan" : "Lokasi ditemukan",
        facts: factsLine(input),
        primaryLabel: checkout ? "Lanjut ke foto check-out" : "Lanjut ke foto",
        primaryDisabled: false,
        secondaryLabel: null,
      }
    case "out_of_range":
      return {
        ...base,
        // Frame `CUETL` keeps the resolved map and moves the device dot beyond the
        // radius field, so the rejection is spatial rather than a greyed-out map.
        mapVariant: "resolved",
        tone: "error",
        title: checkout ? "Check-out di luar area" : "Di luar area outlet",
        facts: checkout
          ? `Belum terkirim · ± ${formatDistance(input.distanceMeters)} dari outlet.`
          : `Kamu ± ${formatDistance(input.distanceMeters)} dari ${input.outletName ?? "outlet"}.`,
        primaryLabel: "Coba lokasi lagi",
        primaryDisabled: false,
        secondaryLabel: BACK_TO_TODAY,
      }
  }
}

function resolveState(input: {
  required: boolean
  eligible: boolean
  locating: boolean
  permissionPending: boolean
  location: { status: "provided" | "unavailable" | "permission_denied" } | null
}): LocationStageState {
  if (!input.required) return "not_required"
  if (input.location?.status === "permission_denied") return "permission_denied"
  // A denied prompt is checked first: it outlives the locating flag.
  if (input.permissionPending) return "permission_requested"
  if (input.locating) return "acquiring"
  if (input.location?.status !== "provided") return "unavailable"
  return input.eligible ? "acquired" : "out_of_range"
}

/**
 * Device dot position inside the preview, derived from the real offset so the
 * preview never invents a position. Returns null when there is nothing to show.
 *
 * `fe6li` places the dot at scene x=216..230 inside a 402-wide scene whose
 * radius field is centred at 201 with diameter 132.
 */
export function locationDeviceOffset(input: {
  distanceMeters: number | null
  radiusMeters: number | null
}): { x: number; y: number } | null {
  if (input.distanceMeters == null || input.radiusMeters == null) return null
  if (input.radiusMeters <= 0) return null
  // 0.5 is the field centre (where the outlet marker sits), 1.0 the field edge.
  // Above 1 the dot moves outside the field, which is how the out-of-range
  // frames (`CUETL`, `zLn5t`) show a rejection without recolouring the map.
  // `fe6li` draws the in-radius dot at scene x 223 → ~0.56.
  // Fractions of the 402-wide scene. `fe6li` draws the in-radius dot at scene
  // x≈223 (0.555); `CUETL` draws the out-of-range dot at ≈345 (0.86), just past
  // the radius field and still inside the 362px crop.
  const ratio = Math.max(0, input.distanceMeters / input.radiusMeters)
  const inside = Math.min(ratio, 1)
  const beyond = Math.max(0, Math.min(ratio - 1, 1))
  return {
    x: 0.555 + inside * 0.05 + beyond * 0.2,
    y: 0.55 + inside * 0.01,
  }
}
