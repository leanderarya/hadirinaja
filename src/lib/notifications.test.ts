// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest"
import { waitFor } from "@testing-library/react"

const swal = vi.hoisted(() => ({
  fire: vi.fn(),
  close: vi.fn(),
  isVisible: vi.fn(() => false),
  getPopup: vi.fn(() => null),
  getConfirmButton: vi.fn(() => null),
  stopTimer: vi.fn(),
  resumeTimer: vi.fn(),
}))
vi.mock("sweetalert2", () => ({ default: swal }))

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  sessionStorage.clear()
  swal.fire.mockResolvedValue({ isConfirmed: false })
})

async function service() {
  return (await import("./notifications")).notifications
}

describe("notification foundation", () => {
  it("suppresses repeated operation results and treats backend messages as text", async () => {
    const n = await service()
    n.success("<img src=x onerror=alert(1)>", {
      id: "tenant:employee:key:completed",
    })
    n.success("Replay", { id: "tenant:employee:key:completed" })
    await waitFor(() => expect(swal.fire).toHaveBeenCalledOnce())
    expect(swal.fire.mock.calls[0][0]).toMatchObject({
      toast: true,
      titleText: "<img src=x onerror=alert(1)>",
      showConfirmButton: false,
      showCloseButton: true,
      closeButtonAriaLabel: "Tutup pemberitahuan",
    })
    expect(swal.fire.mock.calls[0][0]).not.toHaveProperty("html")
  })

  it("keeps receipts across module reloads while separating tenant identities and outcomes", async () => {
    sessionStorage.setItem(
      "hadirinaja.notifications.v1",
      JSON.stringify(["tenant1:key:completed"])
    )
    const n = await service()
    n.success("Replay", { id: "tenant1:key:completed" })
    n.error("Ditolak", { id: "tenant1:key:rejected" })
    n.warning("Periksa", { id: "tenant2:key:completed" })
    await waitFor(() => expect(swal.fire).toHaveBeenCalledTimes(2))
    expect(swal.fire.mock.calls.map(([options]) => options.icon)).toEqual([
      "error",
      "warning",
    ])
  })

  it("defaults confirmation to cancellation, restores focus and never treats dismissal as approval", async () => {
    const n = await service()
    expect(await n.confirm("Batalkan pengajuan?", "Batalkan pengajuan")).toBe(
      false
    )
    expect(swal.fire.mock.calls[0][0]).toMatchObject({
      titleText: "Konfirmasi tindakan",
      text: "Batalkan pengajuan?",
      focusCancel: true,
      returnFocus: true,
      showCancelButton: true,
      cancelButtonText: "Kembali",
      keydownListenerCapture: true,
    })
    swal.fire.mockResolvedValueOnce({ isConfirmed: true })
    expect(await n.confirm("Batalkan pengajuan?", "Batalkan pengajuan")).toBe(
      true
    )
  })

  it("holds notifications until an open confirmation resolves and refuses a competing confirmation", async () => {
    let finish: (value: { isConfirmed: boolean }) => void = () => undefined
    swal.fire.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        })
    )
    const n = await service()
    const confirm = n.confirm("Batalkan?", "Batalkan")
    await waitFor(() => expect(swal.fire).toHaveBeenCalledOnce())
    n.success("Terkirim")
    expect(await n.confirm("Tindakan lain?", "Lanjutkan")).toBe(false)
    expect(swal.fire).toHaveBeenCalledOnce()
    finish({ isConfirmed: false })
    await confirm
    await waitFor(() => expect(swal.fire).toHaveBeenCalledTimes(2))
  })

  it("drops queued outcomes when the authenticated identity changes", async () => {
    const n = await service()
    n.success("Hasil akun sebelumnya", { id: "old:completed" })
    window.dispatchEvent(new Event("hadirinaja:attendance-identity-changing"))
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(swal.fire).not.toHaveBeenCalled()
  })

  it("allows another display attempt after a renderer failure without affecting the caller", async () => {
    swal.fire.mockRejectedValueOnce(new Error("Renderer unavailable"))
    const n = await service()
    n.success("Terkirim", { id: "recoverable" })
    await waitFor(() =>
      expect(sessionStorage.getItem("hadirinaja.notifications.v1")).toBe("[]")
    )
    n.success("Terkirim", { id: "recoverable" })
    await waitFor(() => expect(swal.fire).toHaveBeenCalledTimes(2))
  })
})
