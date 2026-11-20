export type AttendanceEligibilityStatus =
  | "employee_link_required"
  | "employee_unavailable"
  | "employee_role_required"
  | "assignment_unavailable"
  | "policy_unavailable"
  | "kiosk_only"
  | "personal_mode_unavailable"
  | "eligible"

export type RequestAccessStatus =
  | "employee_link_required"
  | "employee_unavailable"
  | "employee_role_required"
  | "available"

export type RequestAccess = {
  status: RequestAccessStatus
  linked: boolean
  can_submit: boolean
}

export function canSubmitPersonalRequests(
  access: RequestAccess | null | undefined
): boolean {
  return access?.status === "available" && access.can_submit
}

export function attendanceEligibilityCopy(
  status: AttendanceEligibilityStatus
): { title: string; description: string } | null {
  switch (status) {
    case "employee_link_required":
      return {
        title: "Identitas karyawan belum terhubung",
        description:
          "Presensi personal memerlukan akun yang terhubung ke identitas karyawan di organisasi aktif.",
      }
    case "employee_unavailable":
      return {
        title: "Identitas karyawan tidak tersedia",
        description:
          "Akun tidak dapat terhubung ke data karyawan. Minta Owner organisasi memeriksanya.",
      }
    case "employee_role_required":
      return {
        title: "Peran karyawan diperlukan",
        description:
          "Akun ini sudah terhubung, tetapi peran Karyawan belum tersedia untuk melihat atau mencatat presensi personal.",
      }
    case "assignment_unavailable":
      return {
        title: "Penempatan Outlet belum tersedia",
        description:
          "Belum ada penempatan Outlet yang berlaku untuk presensi personal. Minta Owner organisasi memeriksa penempatan Anda.",
      }
    case "policy_unavailable":
      return {
        title: "Kebijakan presensi belum tersedia",
        description:
          "Kebijakan yang berlaku belum mengizinkan presensi melalui perangkat pribadi. Hubungi Owner organisasi.",
      }
    case "kiosk_only":
      return {
        title: "Pencatatan harus melalui kiosk",
        description:
          "Kebijakan Outlet hanya mengizinkan presensi melalui kiosk.",
      }
    case "personal_mode_unavailable":
      return {
        title: "Mode perangkat pribadi tidak diizinkan",
        description:
          "Kebijakan Outlet aktif tidak mengizinkan presensi melalui perangkat pribadi.",
      }
    case "eligible":
      return null
  }
}

export function requestEligibilityCopy(
  status: Exclude<RequestAccessStatus, "available">
): { title: string; description: string } {
  switch (status) {
    case "employee_link_required":
      return {
        title: "Identitas karyawan belum terhubung",
        description:
          "Permintaan harus terkait dengan identitas karyawan di organisasi aktif agar dapat diajukan dan ditinjau.",
      }
    case "employee_unavailable":
      return {
        title: "Identitas karyawan tidak tersedia",
        description:
          "Akun tidak dapat terhubung ke data karyawan. Minta Owner organisasi memeriksanya.",
      }
    case "employee_role_required":
      return {
        title: "Peran karyawan diperlukan",
        description:
          "Akun ini sudah terhubung, tetapi peran Karyawan belum tersedia untuk mengajukan permintaan.",
      }
  }
}
