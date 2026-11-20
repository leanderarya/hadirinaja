import {
  attendanceIdentityChangeEventName,
  attendanceIdentityChangeSignalKey,
} from "@/lib/attendance-photo-recovery"
import Swal, { type SweetAlertIcon } from "sweetalert2"
import "sweetalert2/dist/sweetalert2.min.css"

export type NotificationOptions = { id?: string }
const storageKey = "hadirinaja.notifications.v1"
const seen = new Set<string>()
let confirmation: Promise<boolean> | null = null
let generation = 0
let listening = false

function watchIdentity() {
  if (listening) return
  listening = true
  const dismiss = () => {
    generation++
    void renderer()
      .then((swal) => {
        if (swal.getPopup()?.classList.contains("hadirin-notification"))
          swal.close()
      })
      .catch(() => undefined)
  }
  window.addEventListener(attendanceIdentityChangeEventName(), dismiss)
  window.addEventListener("storage", (event) => {
    if (event.key === attendanceIdentityChangeSignalKey()) dismiss()
  })
}
const renderer = () => Promise.resolve(Swal)

function claim(id?: string): boolean {
  if (!id) return true
  if (seen.has(id)) return false
  try {
    const saved = JSON.parse(sessionStorage.getItem(storageKey) ?? "[]")
    if (Array.isArray(saved)) {
      for (const value of saved) if (typeof value === "string") seen.add(value)
    }
  } catch {}
  if (seen.has(id)) return false
  seen.add(id)
  while (seen.size > 200) seen.delete(seen.values().next().value as string)
  try {
    sessionStorage.setItem(storageKey, JSON.stringify([...seen]))
  } catch {}
  return true
}

function notice(
  icon: Extract<SweetAlertIcon, "success" | "error" | "warning">,
  message: string,
  options: NotificationOptions = {}
): void {
  if (typeof window === "undefined" || !claim(options.id)) return
  watchIdentity()
  const identityGeneration = generation
  void renderer()
    .then(async (swal) => {
      if (confirmation) await confirmation
      if (identityGeneration !== generation) return
      await swal.fire({
        toast: true,
        position: "top-end",
        icon,
        iconColor: {
          success: "var(--success-strong)",
          error: "var(--danger-strong)",
          warning: "var(--warning-strong)",
        }[icon],
        titleText: message,
        showConfirmButton: false,
        showCloseButton: true,
        closeButtonAriaLabel: "Tutup pemberitahuan",
        timer: 6000,
        timerProgressBar: true,
        customClass: {
          popup: "hadirin-notification",
          container: "hadirin-notification-container",
        },
        showClass: { popup: "", icon: "" },
        hideClass: { popup: "" },
        didOpen: (popup) => {
          popup.setAttribute("aria-live", "polite")
          popup.addEventListener("mouseenter", () => swal.stopTimer())
          popup.addEventListener("mouseleave", () => swal.resumeTimer())
          popup.addEventListener("focusin", () => swal.stopTimer())
          popup.addEventListener("focusout", () => swal.resumeTimer())
        },
      })
    })
    .catch(() => {
      if (options.id) {
        seen.delete(options.id)
        try {
          sessionStorage.setItem(storageKey, JSON.stringify([...seen]))
        } catch {}
      }
    })
}

export const notifications = {
  success: (message: string, options?: NotificationOptions) =>
    notice("success", message, options),
  error: (message: string, options?: NotificationOptions) =>
    notice("error", message, options),
  warning: (message: string, options?: NotificationOptions) =>
    notice("warning", message, options),
  confirm: (message: string, confirmText: string): Promise<boolean> => {
    if (typeof window === "undefined" || confirmation)
      return Promise.resolve(false)
    watchIdentity()
    const identityGeneration = generation
    confirmation = renderer()
      .then(async (swal) => {
        if (identityGeneration !== generation) return false
        if (
          swal.isVisible() &&
          swal.getPopup()?.classList.contains("swal2-toast")
        )
          swal.close()
        const result = await swal.fire({
          titleText: "Konfirmasi tindakan",
          text: message,
          icon: "warning",
          iconColor: "var(--warning-strong)",
          confirmButtonText: "Lanjutkan",
          didOpen: () => {
            const button = swal.getConfirmButton()
            if (button) button.textContent = confirmText
          },
          cancelButtonText: "Kembali",
          showCancelButton: true,
          focusCancel: true,
          returnFocus: true,
          heightAuto: false,
          allowOutsideClick: false,
          keydownListenerCapture: true,
          buttonsStyling: false,
          customClass: {
            popup: "hadirin-notification",
            container: "hadirin-notification-container",
            confirmButton: "hadirin-notification-confirm",
            cancelButton: "hadirin-notification-cancel",
          },
          showClass: { popup: "", icon: "", backdrop: "swal2-backdrop-show" },
          hideClass: { popup: "" },
        })
        return result.isConfirmed
      })
      .catch(() => false)
      .finally(() => {
        confirmation = null
      })
    return confirmation
  },
}
