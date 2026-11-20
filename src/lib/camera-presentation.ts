// Copy and stage derivation for the personal attendance camera.
// The route owns the camera lifecycle; this module only turns its observable
// state into presentation values.

export type CameraStageState =
  | "waiting_permission"
  | "warming"
  | "permission_denied"
  | "failed"
  | "unsupported"
  | "ready"
  | "preview"

export type CameraStageView = {
  state: CameraStageState
  headline: string
  description: string
  tone: "accent" | "error" | "neutral"
  actionLabel: string
  secondaryLabel: string | null
  help: string | null
  recoveryTitle: string | null
  recoverySteps: string[]
  /** Advice block for states that need a note instead of numbered steps. */
  noteTitle: string | null
  note: string | null
}

export const CAMERA_NOT_SENT_CAPTION = "Check-in belum dikirim."

const PERMISSION_DENIED_PATTERN =
  /izin kamera ditolak|notallowed|securityerror/i

const RECOVERY: Record<
  "permission_denied" | "failed",
  { title: string; steps: string[] }
> = {
  permission_denied: {
    title: "Ubah izin kamera",
    steps: [
      "Buka pengaturan izin situs di browser.",
      "Ubah Kamera menjadi Izinkan.",
      "Kembali ke sini, lalu ketuk Coba lagi.",
    ],
  },
  failed: {
    title: "Periksa kamera perangkat",
    steps: [
      "Tutup aplikasi lain yang memakai kamera.",
      "Pastikan kamera tersedia dan izin browser aktif.",
      "Kembali ke halaman ini, lalu coba lagi.",
    ],
  },
}

export function cameraRecoverySteps(state: CameraStageState): string[] {
  if (state === "permission_denied" || state === "failed")
    return [...RECOVERY[state].steps]
  return []
}

export function cameraRecoveryTitle(state: CameraStageState): string | null {
  if (state === "permission_denied" || state === "failed")
    return RECOVERY[state].title
  return null
}

const STAGE_COPY: Record<
  CameraStageState,
  Pick<
    CameraStageView,
    "headline" | "tone" | "actionLabel" | "secondaryLabel" | "help"
  >
> = {
  waiting_permission: {
    headline: "Izinkan akses kamera",
    tone: "accent",
    actionLabel: "Menunggu izin kamera…",
    secondaryLabel: null,
    help: "Permintaan izin dikelola oleh browser.",
  },
  warming: {
    headline: "Ambil foto bukti",
    tone: "accent",
    // The capture action stays visible but disabled while the first frame
    // arrives; the "Menyiapkan kamera…" caption belongs to the media surface.
    actionLabel: "Ambil foto",
    secondaryLabel: null,
    help: "Pengambilan foto tersedia setelah kamera siap.",
  },
  permission_denied: {
    headline: "Izin kamera ditolak",
    tone: "error",
    actionLabel: "Coba lagi",
    secondaryLabel: null,
    help: "Jika tetap ditolak, periksa izin kamera aplikasi browser di pengaturan perangkat.",
  },
  failed: {
    headline: "Kamera tidak bisa dibuka",
    tone: "error",
    actionLabel: "Coba lagi",
    secondaryLabel: null,
    help: "Jika masih gagal, muat ulang halaman atau gunakan browser lain.",
  },
  unsupported: {
    headline: "Kamera tidak didukung",
    tone: "neutral",
    actionLabel: "",
    secondaryLabel: null,
    help: "Gunakan browser modern pada perangkat berkamera.",
  },
  ready: {
    headline: "Ambil foto bukti",
    tone: "accent",
    actionLabel: "Ambil foto",
    secondaryLabel: null,
    help: "Foto akan ditampilkan untuk diperiksa.",
  },
  preview: {
    headline: "Periksa foto bukti",
    tone: "accent",
    actionLabel: "Lanjut ke konfirmasi",
    secondaryLabel: "Ambil ulang foto",
    help: null,
  },
}

function descriptionFor(state: CameraStageState, secureContext: boolean) {
  switch (state) {
    case "waiting_permission":
      return "Browser memerlukan izin sebelum kamera perangkat dapat digunakan."
    case "warming":
      return "Kamera sedang disiapkan untuk pengambilan foto."
    case "permission_denied":
      return "Browser belum diizinkan memakai kamera. Foto belum bisa diambil."
    case "failed":
      return "Kamera mungkin sedang dipakai aplikasi lain atau belum tersedia."
    case "unsupported":
      return secureContext
        ? "Browser ini tidak mendukung kamera langsung. Gunakan browser modern pada perangkat berkamera."
        : "Kamera memerlukan koneksi aman. Buka HadirinAja melalui HTTPS atau localhost."
    case "ready":
      return "Pastikan foto terang dan tidak buram."
    case "preview":
      return "Pastikan hasil foto jelas sebelum melanjutkan."
  }
}

function noteFor(state: CameraStageState): {
  noteTitle: string | null
  note: string | null
} {
  if (state === "waiting_permission") {
    return {
      noteTitle: "Jawab permintaan browser",
      note: "Pilih Izinkan untuk membuka kamera. Jika izin sudah aktif, kamera langsung disiapkan.",
    }
  }
  return { noteTitle: null, note: null }
}

export function cameraStageView(input: {
  secureContext: boolean
  supported: boolean
  mode: "capture" | "preview"
  ready: boolean
  error: string
  hasPhoto: boolean
}): CameraStageView {
  const state = resolveState(input)
  const copy = STAGE_COPY[state]
  return {
    state,
    headline: copy.headline,
    description: descriptionFor(state, input.secureContext),
    tone: copy.tone,
    actionLabel: copy.actionLabel,
    secondaryLabel: copy.secondaryLabel,
    help: copy.help,
    recoveryTitle: cameraRecoveryTitle(state),
    recoverySteps: cameraRecoverySteps(state),
    ...noteFor(state),
  }
}

// Derivation order is fixed: capability first, then a captured photo, then the
// lifecycle error, then readiness, then preparation.
//
// "waiting_permission" cannot be distinguished from "warming" with this
// signature: both mean ready=false, no error, capture mode. The permission
// prompt is already being shown by the route's getUserMedia call, so a
// not-yet-answered request and an attaching stream are both reported as
// "warming". "waiting_permission" stays in the union for callers that can
// observe the prompt themselves, but cameraStageView never returns it.
function resolveState(input: {
  secureContext: boolean
  supported: boolean
  mode: "capture" | "preview"
  ready: boolean
  error: string
  hasPhoto: boolean
}): CameraStageState {
  if (!input.secureContext) return "unsupported"
  if (!input.supported) return "unsupported"
  if (input.hasPhoto || input.mode === "preview") return "preview"
  if (input.error) {
    return PERMISSION_DENIED_PATTERN.test(input.error)
      ? "permission_denied"
      : "failed"
  }
  if (input.ready) return "ready"
  return "warming"
}
