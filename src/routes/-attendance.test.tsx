// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import type { ComponentType } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const { apiRequest, toast, storedPhotos, storedMetadata } = vi.hoisted(() => ({
  apiRequest: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
  storedPhotos: new Map<string, unknown>(),
  storedMetadata: new Map<string, unknown>(),
}))

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: { component: () => React.ReactNode }) => ({
    options,
  }),
}))
vi.mock("@/components/employee-shell", () => ({
  EmployeeShell: ({ children }: { children: React.ReactNode }) => (
    <main>
      <nav aria-label="Navigasi karyawan">
        <a href="/scheduling">Jadwal</a>
      </nav>
      {children}
    </main>
  ),
}))
vi.mock("@/components/employee-attendance-history", () => ({
  EmployeeAttendanceHistory: () => (
    <section aria-label="Riwayat minggu ini">
      <h2>Riwayat minggu ini</h2>
    </section>
  ),
}))
vi.mock("@/lib/api", () => ({
  ApiError: class ApiError extends Error {
    constructor(
      message: string,
      readonly status: number,
      readonly code?: string
    ) {
      super(message)
    }
  },
  apiRequest,
}))
vi.mock("@/lib/attendance-photo-recovery", () => ({
  loadPendingAttendancePhoto: vi.fn(
    async (
      key: string,
      identity: { userId: number; tenantId: number; employeeId: number }
    ) => {
      const stored = storedPhotos.get(key) as
        | Record<string, unknown>
        | undefined
      return stored &&
        stored.userId === identity.userId &&
        stored.tenantId === identity.tenantId &&
        stored.employeeId === identity.employeeId
        ? stored
        : null
    }
  ),
  removePendingAttendancePhoto: vi.fn(async (key: string) => {
    storedPhotos.delete(key)
  }),
  loadPendingAttendanceMetadata: vi.fn(
    (identity: { userId: number; tenantId: number; employeeId: number }) =>
      storedMetadata.get(
        `${identity.userId}.${identity.tenantId}.${identity.employeeId}`
      ) ?? null
  ),
  savePendingAttendanceMetadata: vi.fn(
    (record: { userId: number; tenantId: number; employeeId: number }) => {
      storedMetadata.set(
        `${record.userId}.${record.tenantId}.${record.employeeId}`,
        record
      )
    }
  ),
  removePendingAttendanceMetadata: vi.fn(
    (identity: { userId: number; tenantId: number; employeeId: number }) => {
      storedMetadata.delete(
        `${identity.userId}.${identity.tenantId}.${identity.employeeId}`
      )
    }
  ),
  removePhotosOutsideIdentity: vi.fn(
    async (
      identity: { userId: number; tenantId: number; employeeId: number } | null,
      protectedKey: string | null = null
    ) => {
      for (const [key, record] of storedPhotos) {
        const photo = record as {
          userId?: number
          tenantId?: number
          employeeId?: number
        }
        if (
          !identity ||
          photo.userId !== identity.userId ||
          photo.tenantId !== identity.tenantId ||
          photo.employeeId !== identity.employeeId ||
          key !== protectedKey
        ) {
          storedPhotos.delete(key)
        }
      }
    }
  ),
  clearAllPendingAttendancePhotos: vi.fn(async () => storedPhotos.clear()),
  captureLegacyPendingMetadata: vi.fn(),
  attendanceIdentityChangeEventName: vi.fn(
    () => "hadirinaja:attendance-identity-changing"
  ),
  attendanceIdentityChangeSignalKey: vi.fn(
    () => "hadirinaja.attendance.identity-change"
  ),
  prepareAttendanceIdentityChange: vi.fn(async () => {
    storedPhotos.clear()
    window.dispatchEvent(new Event("hadirinaja:attendance-identity-changing"))
  }),
  removeStaleAttendancePhotos: vi.fn(async () => undefined),
  savePendingAttendancePhoto: vi.fn(async (record: { key: string }) => {
    storedPhotos.set(record.key, record)
  }),
}))
vi.mock("@/lib/notifications", () => ({ notifications: toast }))

import { prepareAttendanceIdentityChange } from "@/lib/attendance-photo-recovery"
import { ApiError } from "@/lib/api"
import { Route } from "./attendance"

const AttendancePage = Route.options.component as ComponentType

const employee = { id: 17, name: "Rani" }
const readyAttendance = {
  eligibility: { status: "eligible" },
  server_time: "2026-10-25T08:00:00Z",
  employee,
  outlets: [{ id: 3, name: "Outlet Pusat" }],
  selected_outlet_id: 3,
  schedule: {
    work_date: "2026-10-25",
    status: "scheduled",
    outlet: { id: 3, name: "Outlet Pusat" },
    timezone: "Asia/Jakarta",
    shift: { name: "Pagi", start_time: "08:00", end_time: "17:00" },
    scheduled_start: "2026-10-25T08:00:00+07:00",
    scheduled_end: "2026-10-25T17:00:00+07:00",
    outlet_operating: true,
    conflicts: [],
  },
  active_session: null,
  allowed_next_operation: "check_in",
  personal_location: {
    required: false,
    radius_meters: null,
    geofence_configured: false,
  },
  effective_attendance: [],
  recent_history: [],
}

const checkoutSession = {
  id: 51,
  status: "active",
  work_date: "2026-10-25",
  timezone: "Asia/Jakarta",
  check_in_at: "2026-10-25T08:05:00Z",
  check_out_at: null,
  outlet: readyAttendance.outlets[0],
  review_indicators: [],
}

const checkoutDestination = {
  id: 6,
  name: "Outlet Makassar",
  timezone: "Asia/Makassar",
  mode_allowed: true,
  personal_location: {
    required: true,
    radius_meters: 80,
    geofence_configured: true,
    latitude: -5.15,
    longitude: 119.43,
  },
}

const ineligibleCheckoutDestination = {
  id: 3,
  name: "Outlet Pusat",
  timezone: "Asia/Jakarta",
  mode_allowed: false,
  personal_location: {
    required: true,
    radius_meters: null,
    geofence_configured: false,
  },
}

const activeCheckout = {
  ...readyAttendance,
  outlets: [...readyAttendance.outlets, checkoutDestination],
  active_session: checkoutSession,
  allowed_next_operation: null,
  checkout_destination: null,
}

const track = { stop: vi.fn() }
const stream = { getTracks: () => [track] } as unknown as MediaStream
let videoReadyState: number = HTMLMediaElement.HAVE_ENOUGH_DATA

function setViewport(width: number) {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    value: width,
  })
}

function installCamera() {
  videoReadyState = HTMLMediaElement.HAVE_ENOUGH_DATA
  Object.defineProperty(window, "isSecureContext", {
    configurable: true,
    value: true,
  })
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia: vi.fn(async () => stream) },
  })
  Object.defineProperty(HTMLVideoElement.prototype, "videoWidth", {
    configurable: true,
    get: () => 640,
  })
  Object.defineProperty(HTMLVideoElement.prototype, "videoHeight", {
    configurable: true,
    get: () => 480,
  })
  Object.defineProperty(HTMLVideoElement.prototype, "readyState", {
    configurable: true,
    get: () => videoReadyState,
  })
  vi.spyOn(HTMLVideoElement.prototype, "play").mockResolvedValue(undefined)
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    drawImage: vi.fn(),
  } as unknown as CanvasRenderingContext2D)
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(
    (callback) => {
      callback(new Blob(["synthetic-camera-frame"], { type: "image/jpeg" }))
    }
  )
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:attendance-preview")
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined)
}

beforeEach(() => {
  vi.clearAllMocks()
  storedPhotos.clear()
  storedMetadata.clear()
  window.sessionStorage.clear()
  window.localStorage.clear()
  setViewport(390)
  videoReadyState = HTMLMediaElement.HAVE_ENOUGH_DATA
  apiRequest.mockImplementation(async (path: string) => {
    if (path === "/auth/me") {
      return {
        user: { id: 7, name: "Rani", email: "rani@example.test" },
        active_membership: {
          id: 19,
          tenant: { id: 2, name: "Tenant Uji" },
          roles: ["employee"],
        },
      }
    }
    if (path === "/attendance/me") return readyAttendance
    if (path.startsWith("/attendance/me?checkout_outlet_id=")) {
      const outletId = Number(path.split("=").at(-1))
      return {
        ...activeCheckout,
        checkout_destination:
          outletId === checkoutDestination.id
            ? checkoutDestination
            : ineligibleCheckoutDestination,
      }
    }
    return {
      operation: { key: "server-key", type: "check_in", state: "completed" },
      event: { id: 44, type: "check_in", recorded_at: "2026-10-25T08:05:00Z" },
      session: {
        id: 51,
        status: "active",
        work_date: "2026-10-25",
        timezone: "Asia/Jakarta",
        check_in_at: "2026-10-25T08:05:00Z",
        check_out_at: null,
        outlet: { id: 3, name: "Outlet Pusat" },
        review_indicators: [],
      },
    }
  })
})

afterEach(() => {
  cleanup()
  Reflect.deleteProperty(navigator, "geolocation")
  vi.restoreAllMocks()
})

async function enabledButton(name: string) {
  return waitFor(() => {
    const button = screen.getByRole<HTMLButtonElement>("button", { name })
    expect(button.disabled).toBe(false)
    return button
  })
}

// The capture button only exists once the camera dialog reaches its photo
// stage, and stays disabled until the mocked video reports readiness.
async function captureButton() {
  const capture = await screen.findByRole<HTMLButtonElement>("button", {
    name: "Ambil foto",
  })
  fireEvent.loadedData(screen.getByLabelText("Pratinjau kamera karyawan"))
  await waitFor(() => expect(capture.disabled).toBe(false))
  return capture
}

// Closing the dialog only stops a camera whose stream has already been
// attached, so wait for readiness before asserting cleanup.
async function cameraReady() {
  await waitFor(() => {
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalled()
    expect(
      screen.getByLabelText<HTMLVideoElement>("Pratinjau kamera karyawan")
        .srcObject
    ).not.toBeNull()
  })
}

describe("Employee attendance camera", () => {
  it("keeps both actions disabled when an Outlet eligibility read fails", async () => {
    const defaultRequest = apiRequest.getMockImplementation()
    apiRequest.mockImplementation(async (path: string) => {
      if (path === "/attendance/me") {
        return {
          ...readyAttendance,
          outlets: [...readyAttendance.outlets, checkoutDestination],
        }
      }
      if (path === "/attendance/me?outlet_id=6")
        throw new ApiError("Unavailable", 503)
      return defaultRequest?.(path)
    })
    render(<AttendancePage />)
    await screen.findByRole("button", { name: "Muat Ulang Status" })
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "Absen Masuk" })
        .disabled
    ).toBe(true)
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "Absen Keluar" })
        .disabled
    ).toBe(true)
    expect(
      apiRequest.mock.calls.some(([, options]) => options?.method === "POST")
    ).toBe(false)
  })

  it("uses the active-session response if another session appears during Outlet checks", async () => {
    const defaultRequest = apiRequest.getMockImplementation()
    apiRequest.mockImplementation(async (path: string) => {
      if (path === "/attendance/me") {
        return {
          ...readyAttendance,
          outlets: [...readyAttendance.outlets, checkoutDestination],
        }
      }
      if (path === "/attendance/me?outlet_id=6") return activeCheckout
      return defaultRequest?.(path)
    })
    render(<AttendancePage />)
    await screen.findByText("Sedang bekerja")
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "Absen Masuk" })
        .disabled
    ).toBe(true)
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "Absen Keluar" })
        .disabled
    ).toBe(true)
    expect(
      screen.queryByRole("combobox", { name: "Pilih Outlet tujuan checkout" })
    ).toBeNull()
  })

  it("selects the sole backend-eligible Outlet among several assignments", async () => {
    const defaultRequest = apiRequest.getMockImplementation()
    apiRequest.mockImplementation(async (path: string) => {
      if (path === "/attendance/me") {
        return {
          ...readyAttendance,
          outlets: [...readyAttendance.outlets, checkoutDestination],
          allowed_next_operation: null,
          eligibility: { status: "kiosk_only" },
        }
      }
      if (path === "/attendance/me?outlet_id=6") {
        return {
          ...readyAttendance,
          outlets: [...readyAttendance.outlets, checkoutDestination],
          selected_outlet_id: 6,
          schedule: {
            ...readyAttendance.schedule,
            status: "unscheduled",
            outlet: checkoutDestination,
          },
        }
      }
      return defaultRequest?.(path)
    })
    render(<AttendancePage />)
    await enabledButton("Absen Masuk")
    expect(screen.getByText("Outlet aktif · Outlet Makassar")).toBeTruthy()
    expect(
      screen.queryByRole("combobox", { name: "Outlet presensi" })
    ).toBeNull()
  })

  it("disables both actions when every assigned Outlet is ineligible", async () => {
    const defaultRequest = apiRequest.getMockImplementation()
    apiRequest.mockImplementation(async (path: string) => {
      if (
        path.startsWith("/attendance/me") &&
        path !== "/attendance/me/requests"
      ) {
        return {
          ...readyAttendance,
          outlets: [...readyAttendance.outlets, checkoutDestination],
          selected_outlet_id: path.includes("outlet_id=6") ? 6 : 3,
          allowed_next_operation: null,
          eligibility: { status: "kiosk_only" },
        }
      }
      return defaultRequest?.(path)
    })
    render(<AttendancePage />)
    await screen.findByRole("region", { name: "Status kehadiran hari ini" })
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "Absen Masuk" })
        .disabled
    ).toBe(true)
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "Absen Keluar" })
        .disabled
    ).toBe(true)
    expect(
      screen.queryByRole("combobox", { name: "Outlet presensi" })
    ).toBeNull()
    expect(
      screen.queryByText(
        "Kebijakan Outlet tujuan tidak mengizinkan presensi personal."
      )
    ).toBeNull()
  })

  it("requires an explicit Outlet when the server default has no decisive schedule", async () => {
    const fallback = {
      ...readyAttendance,
      outlets: [...readyAttendance.outlets, checkoutDestination],
      schedule: { ...readyAttendance.schedule, status: "unscheduled" },
    }
    const defaultRequest = apiRequest.getMockImplementation()
    apiRequest.mockImplementation(async (path: string) => {
      if (path === "/attendance/me") return fallback
      if (path === "/attendance/me?outlet_id=6") {
        return { ...fallback, selected_outlet_id: 6 }
      }
      if (path === "/attendance/me?outlet_id=3") return fallback
      return defaultRequest?.(path)
    })
    render(<AttendancePage />)
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "Absen Masuk" })
        .disabled
    ).toBe(true)
    const select = await screen.findByRole<HTMLSelectElement>("combobox", {
      name: "Outlet presensi",
    })
    expect(select.value).toBe("")
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "Absen Keluar" })
        .disabled
    ).toBe(true)
    fireEvent.change(select, { target: { value: "6" } })
    await enabledButton("Absen Masuk")
    expect(screen.getByText("Outlet aktif · Outlet Makassar")).toBeTruthy()
  })

  it("keeps a prior Work Date open while its correction is pending", async () => {
    const defaultRequest = apiRequest.getMockImplementation()
    apiRequest.mockImplementation(async (path: string) => {
      if (path === "/attendance/me") {
        return {
          ...activeCheckout,
          active_session: { ...checkoutSession, work_date: "2026-10-24" },
        }
      }
      if (path === "/attendance/me/requests") {
        return {
          requests: [
            {
              id: 27,
              type: "attendance_correction",
              status: "pending",
              details: { attendance_session_id: checkoutSession.id },
            },
          ],
        }
      }
      return defaultRequest?.(path)
    })
    render(<AttendancePage />)
    const link = await screen.findByRole("link", {
      name: "Lihat koreksi yang menunggu",
    })
    expect(link.getAttribute("href")).toBe("/requests#request-27")
    expect(screen.getByText("Sesi sebelumnya masih terbuka")).toBeTruthy()
    expect(
      screen.getByText("Koreksi menunggu keputusan. Sesi tetap terbuka.")
    ).toBeTruthy()
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "Absen Masuk" })
        .disabled
    ).toBe(true)
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "Absen Keluar" })
        .disabled
    ).toBe(false)
    expect(apiRequest.mock.calls.map(([path]) => path)).toEqual(
      expect.arrayContaining([
        "/auth/me",
        "/attendance/me",
        "/attendance/me/requests",
        "/attendance/me?checkout_outlet_id=6",
      ])
    )
  })

  it("shows the effective result and both attendance buttons", async () => {
    const days = [
      ["2026-10-19", "present"],
      ["2026-10-20", "leave"],
      ["2026-10-21", "sick"],
      ["2026-10-22", "present"],
      ["2026-10-23", "permission"],
      ["2026-10-24", "absence"],
      ["2026-10-25", "sick"],
    ].map(([work_date, outcome]) => ({
      work_date,
      outcome,
      sessions: [],
      review: { status: "none", indicators: [] },
      unresolved_conflicts: [],
      is_finalized: false,
    }))
    apiRequest.mockImplementation(async (path: string) => {
      if (path === "/auth/me") {
        return {
          user: { id: 7, name: "Rani", email: "rani@example.test" },
          active_membership: {
            id: 19,
            tenant: { id: 2, name: "Tenant Uji" },
            roles: ["employee"],
          },
        }
      }
      if (path === "/attendance/me") {
        return { ...readyAttendance, effective_attendance: days }
      }
      return readyAttendance
    })

    render(<AttendancePage />)
    expect(
      await screen.findByRole("region", { name: "Status kehadiran hari ini" })
    ).toBeTruthy()
    expect(
      screen.getByRole("heading", { name: "Status kehadiran hari ini" })
    ).toBeTruthy()
    expect(screen.getByRole("status").textContent).toBe("Sakit disetujui")
    expect(
      (
        screen.getByRole("button", {
          name: "Absen Keluar",
        }) as HTMLButtonElement
      ).disabled
    ).toBe(true)
    expect(screen.getAllByText(/Outlet Pusat/).length).toBeGreaterThan(0)
    expect(screen.getByRole("button", { name: "Absen Masuk" })).toBeTruthy()
  })

  it("renders the live clock in the scheduled Outlet timezone", async () => {
    render(<AttendancePage />)

    expect(
      await screen.findByRole("region", { name: "Status kehadiran hari ini" })
    ).toBeTruthy()
    expect(screen.getByRole("timer").textContent).toMatch(/^\d{2}:\d{2}:\d{2}$/)
    expect(screen.getByText("Zona waktu Outlet · Asia/Jakarta")).toBeTruthy()
    expect(
      screen.getByRole("button", { name: "Absen Masuk" }).className
    ).toContain("w-full")
    expect(
      screen.getByRole("button", { name: "Absen Keluar" }).className
    ).toContain("w-full")
  })

  it("keeps weekly history flat immediately after the centered Home actions", async () => {
    render(<AttendancePage />)

    const status = await screen.findByRole("region", {
      name: "Status kehadiran hari ini",
    })
    expect(
      screen.queryByRole("combobox", { name: "Pilih Outlet tujuan checkout" })
    ).toBeNull()
    expect(screen.getByRole("button", { name: "Absen Masuk" })).toBeTruthy()
    expect(screen.getByRole("button", { name: "Absen Keluar" })).toBeTruthy()

    const historyHeading = screen.getByRole("heading", {
      name: "Riwayat minggu ini",
    })
    const historyBoundary = historyHeading.closest(".border-t")
    expect(historyBoundary).toBe(status.nextElementSibling)
    expect(historyBoundary?.className).toContain("pt-4")
  })

  it.each([
    320, 390, 768, 1440,
  ])("opens an accessible Focus Mode with the sticky verification bar at %i CSS px", async (width) => {
    setViewport(width)
    installCamera()
    render(<AttendancePage />)

    expect(
      await screen.findByRole("region", { name: "Status kehadiran hari ini" })
    ).toBeTruthy()
    fireEvent.click(await enabledButton("Absen Masuk"))
    const dialog = await screen.findByRole("dialog", { name: "Absen Masuk" })
    expect(dialog.textContent).toContain("Work Date · Minggu, 25 Oktober")
    expect(dialog.querySelector('time[datetime="2026-10-25"]')).toBeTruthy()
    expect(screen.getByLabelText("Pratinjau kamera karyawan")).toBeTruthy()
    expect(screen.getByRole("button", { name: "Ambil foto" })).toBeTruthy()
    expect(
      screen.getByRole("button", { name: "Kembali ke halaman presensi" })
    ).toBeTruthy()
    expect(
      screen.getByRole("region", { name: "Peta batas lokasi Outlet Pusat" })
    ).toBeTruthy()
    expect(screen.queryByRole("link", { name: "Jadwal" })).toBeNull()
    expect(dialog.className).toContain("grid-rows-[auto_minmax(0,1fr)_auto]")
    expect(dialog.className).toContain("rounded-none")
    expect(dialog.lastElementChild?.className).toContain(
      "safe-area-inset-bottom"
    )
  })

  it("submits the captured Blob as multipart and shows only server-confirmed success", async () => {
    installCamera()
    render(<AttendancePage />)

    fireEvent.click(await enabledButton("Absen Masuk"))
    const capture = await screen.findByRole("button", { name: "Ambil foto" })
    fireEvent.loadedData(screen.getByLabelText("Pratinjau kamera karyawan"))
    await waitFor(() =>
      expect((capture as HTMLButtonElement).disabled).toBe(false)
    )
    fireEvent.click(capture)
    expect(
      await screen.findByRole("img", { name: "Pratinjau foto bukti presensi" })
    ).toBeTruthy()
    fireEvent.click(
      screen.getByRole("button", { name: "Gunakan Foto dan Absen Masuk" })
    )

    await waitFor(() =>
      expect(
        screen.getByText(/Presensi masuk dikonfirmasi oleh server/)
      ).toBeTruthy()
    )
    const mutation = apiRequest.mock.calls.find(
      ([path]) => path === "/attendance/me/check-in"
    )
    expect(mutation?.[1].body).toBeInstanceOf(FormData)
    expect((mutation?.[1].body as FormData).get("photo")).toBeInstanceOf(Blob)
    expect((mutation?.[1].body as FormData).get("outlet_id")).toBe("3")
    expect(mutation?.[1].headers["Idempotency-Key"]).toMatch(/^[0-9a-f-]{36}$/i)
    expect(storedPhotos.size).toBe(0)
    expect(toast.success).toHaveBeenCalledOnce()
    expect(track.stop).toHaveBeenCalled()
  })

  it("keeps confirmed success when Home refresh fails and reload never resubmits", async () => {
    installCamera()
    const normal = apiRequest.getMockImplementation()
    let confirmed = false
    apiRequest.mockImplementation(async (path: string, options?: unknown) => {
      if (path === "/attendance/me" && confirmed)
        throw new Error("Home unavailable")
      const result = await normal?.(path, options)
      if (path === "/attendance/me/check-in") confirmed = true
      return result
    })
    render(<AttendancePage />)
    fireEvent.click(await enabledButton("Absen Masuk"))
    fireEvent.click(await captureButton())
    const submit = await screen.findByRole("button", {
      name: "Gunakan Foto dan Absen Masuk",
    })
    fireEvent.click(submit)
    fireEvent.click(submit)
    await screen.findByText(/Presensi masuk dikonfirmasi oleh server/)
    await screen.findByText(
      "Status terbaru belum dapat dimuat. Muat ulang status sebelum mencatat lagi."
    )
    expect(toast.success).toHaveBeenCalledOnce()
    expect(storedPhotos.size).toBe(0)
    fireEvent.click(screen.getByRole("button", { name: "Muat Ulang Status" }))
    await waitFor(() =>
      expect(
        apiRequest.mock.calls.filter(([path]) => path === "/attendance/me")
          .length
      ).toBeGreaterThan(3)
    )
    expect(
      apiRequest.mock.calls.filter(
        ([path]) => path === "/attendance/me/check-in"
      )
    ).toHaveLength(1)
  })

  it("skips a failed optional camera and reconciles a lost response without another POST", async () => {
    installCamera()
    vi.mocked(navigator.mediaDevices.getUserMedia).mockRejectedValue(
      new DOMException("Denied", "NotAllowedError")
    )
    const normal = apiRequest.getMockImplementation()
    let key = ""
    apiRequest.mockImplementation(
      async (path: string, options?: { headers?: Record<string, string> }) => {
        if (path === "/attendance/me")
          return { ...readyAttendance, require_personal_photo: false }
        if (path === "/attendance/me/check-in") {
          key = options?.headers?.["Idempotency-Key"] ?? ""
          throw new TypeError("Response lost")
        }
        if (path.startsWith("/attendance/me/operations/check_in/")) {
          expect(path.endsWith(key)).toBe(true)
          return {
            state: "completed",
            result: await normal?.("/attendance/me/check-in"),
          }
        }
        return normal?.(path, options)
      }
    )
    render(<AttendancePage />)
    fireEvent.click(await enabledButton("Absen Masuk"))
    await screen.findByText(/Izin kamera ditolak/)
    fireEvent.click(
      screen.getByRole("button", { name: "Lewati Foto dan Absen Masuk" })
    )
    await screen.findByText(/Presensi masuk dikonfirmasi oleh server/)
    const posts = apiRequest.mock.calls.filter(
      ([path]) => path === "/attendance/me/check-in"
    )
    expect(posts).toHaveLength(1)
    expect(posts[0][1].body.get("photo")).toBeNull()
    expect(storedPhotos.size).toBe(0)
  })

  it("shows camera preparation and blocks capture until a usable frame is ready", async () => {
    installCamera()
    videoReadyState = HTMLMediaElement.HAVE_NOTHING
    render(<AttendancePage />)
    fireEvent.click(await enabledButton("Absen Masuk"))

    expect(await screen.findByText("Menyiapkan kamera…")).toBeTruthy()
    const capture = await screen.findByRole("button", { name: "Ambil foto" })
    expect((capture as HTMLButtonElement).disabled).toBe(true)

    videoReadyState = HTMLMediaElement.HAVE_CURRENT_DATA
    fireEvent.loadedData(screen.getByLabelText("Pratinjau kamera karyawan"))
    await waitFor(() =>
      expect((capture as HTMLButtonElement).disabled).toBe(false)
    )
    expect(screen.queryByText("Menyiapkan kamera…")).toBeNull()
  })

  it("does not present a device clock as the confirmed attendance timestamp", async () => {
    render(<AttendancePage />)
    expect(
      await screen.findByRole("region", { name: "Status kehadiran hari ini" })
    ).toBeTruthy()
    expect(screen.queryByText(/Jam perangkat/)).toBeNull()
  })

  it("supports retake and releases camera tracks when the dialog is cancelled", async () => {
    installCamera()
    render(<AttendancePage />)
    fireEvent.click(await enabledButton("Absen Masuk"))
    const capture = await screen.findByRole("button", { name: "Ambil foto" })
    fireEvent.loadedData(screen.getByLabelText("Pratinjau kamera karyawan"))
    await waitFor(() =>
      expect((capture as HTMLButtonElement).disabled).toBe(false)
    )
    fireEvent.click(capture)
    fireEvent.click(
      await screen.findByRole("button", { name: "Ambil ulang foto" })
    )
    expect(
      await screen.findByLabelText("Pratinjau kamera karyawan")
    ).toBeTruthy()
    fireEvent.click(
      screen.getByRole("button", { name: "Kembali ke halaman presensi" })
    )
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
    expect(track.stop).toHaveBeenCalled()
    expect(
      apiRequest.mock.calls.some(([path]) => path === "/attendance/me/check-in")
    ).toBe(false)
  })

  it("keeps background navigation hidden and restores focus on Escape", async () => {
    installCamera()
    render(<AttendancePage />)
    const trigger = await enabledButton("Absen Masuk")
    trigger.focus()
    fireEvent.click(trigger)

    const dialog = await screen.findByRole("dialog")
    await waitFor(() =>
      expect(dialog.contains(document.activeElement)).toBe(true)
    )
    await cameraReady()
    expect(screen.queryByRole("link", { name: "Jadwal" })).toBeNull()

    fireEvent.keyDown(document.activeElement ?? dialog, { key: "Escape" })
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
    expect(document.activeElement).toBe(trigger)
    expect(track.stop).toHaveBeenCalled()
  })

  it("keeps an interrupted request uncertain and retries only after status says not found", async () => {
    installCamera()
    const keyPattern = /\/attendance\/me\/operations\/check_in\/(.+)$/
    apiRequest.mockImplementation(
      async (path: string, options?: { body?: unknown }) => {
        if (path === "/auth/me")
          return {
            user: { id: 7, name: "Rani", email: "rani@example.test" },
            active_membership: {
              id: 19,
              tenant: { id: 2, name: "Tenant Uji" },
              roles: ["employee"],
            },
          }
        if (path === "/attendance/me") return readyAttendance
        if (path === "/attendance/me/check-in") {
          if (
            apiRequest.mock.calls.filter(([callPath]) => callPath === path)
              .length === 1
          ) {
            throw new TypeError("network interrupted")
          }
          expect(options?.body).toBeInstanceOf(FormData)
          return {
            operation: {
              key: "retry-key",
              type: "check_in",
              state: "completed",
            },
            event: {
              id: 44,
              type: "check_in",
              recorded_at: "2026-10-25T08:05:00Z",
            },
            session: {
              id: 51,
              status: "active",
              work_date: "2026-10-25",
              timezone: "Asia/Jakarta",
              check_in_at: "2026-10-25T08:05:00Z",
              check_out_at: null,
              outlet: { id: 3, name: "Outlet Pusat" },
              review_indicators: [],
            },
          }
        }
        if (keyPattern.test(path)) return { state: "not_found" }
        return readyAttendance
      }
    )
    render(<AttendancePage />)
    fireEvent.click(await enabledButton("Absen Masuk"))
    fireEvent.click(await captureButton())
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Gunakan Foto dan Absen Masuk",
      })
    )

    expect(
      (await screen.findAllByText(/Hasil presensi belum dapat dipastikan/))
        .length
    ).toBeGreaterThan(0)
    expect(toast.success).not.toHaveBeenCalled()
    const retry = await screen.findByRole("button", {
      name: "Periksa lalu kirim ulang",
    })
    fireEvent.click(retry)
    await waitFor(() => expect(toast.success).toHaveBeenCalledOnce())

    const mutations = apiRequest.mock.calls.filter(
      ([path]) => path === "/attendance/me/check-in"
    )
    const statuses = apiRequest.mock.calls.filter(
      ([path]) => typeof path === "string" && keyPattern.test(path)
    )
    expect(statuses.length).toBeGreaterThanOrEqual(2)
    expect(mutations).toHaveLength(2)
    expect(mutations[0][1].headers["Idempotency-Key"]).toBe(
      mutations[1][1].headers["Idempotency-Key"]
    )
    const originalPhoto = (mutations[0][1].body as FormData).get(
      "photo"
    ) as Blob
    const retriedPhoto = (mutations[1][1].body as FormData).get("photo") as Blob
    expect(await originalPhoto.text()).toBe(await retriedPhoto.text())
  })

  it("selects the destination, handles denied GPS, and retries the original checkout after a reload", async () => {
    installCamera()
    const getCurrentPosition = vi.fn()
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      value: { getCurrentPosition },
    })
    getCurrentPosition.mockImplementationOnce((_, deny) =>
      deny({ code: 1, PERMISSION_DENIED: 1 })
    )
    getCurrentPosition.mockImplementation((allow) =>
      allow({ coords: { latitude: -5.15, longitude: 119.43, accuracy: 10 } })
    )
    const defaultRequest = apiRequest.getMockImplementation()
    const posts: Array<{ body: FormData; headers: Record<string, string> }> = []
    apiRequest.mockImplementation(async (path: string, options) => {
      if (path === "/attendance/me") return activeCheckout
      if (path === "/attendance/me?checkout_outlet_id=6") {
        return { ...activeCheckout, checkout_destination: checkoutDestination }
      }
      if (path.startsWith("/attendance/me/operations/check_out/")) {
        return { state: "not_found" }
      }
      if (path === "/attendance/me/check-out") {
        posts.push(options)
        if (posts.length === 1) throw new TypeError("network interrupted")
        return {
          operation: {
            key: options.headers["Idempotency-Key"],
            type: "check_out",
            state: "completed",
          },
          event: {
            id: 52,
            type: "check_out",
            recorded_at: "2026-10-25T09:00:00Z",
          },
          session: {
            ...checkoutSession,
            status: "closed",
            check_out_at: "2026-10-25T09:00:00Z",
          },
        }
      }
      return defaultRequest?.(path)
    })
    const view = render(<AttendancePage />)
    expect(
      screen.queryByRole("combobox", { name: "Pilih Outlet tujuan checkout" })
    ).toBeNull()
    const checkout = await enabledButton("Absen Keluar")
    fireEvent.click(checkout)
    const dialog = await screen.findByRole("dialog", { name: "Absen Keluar" })
    const select = within(dialog).getByRole<HTMLSelectElement>("combobox", {
      name: "Pilih Outlet tujuan checkout",
    })
    fireEvent.change(select, { target: { value: "6" } })
    expect(
      (await screen.findAllByText(/Izin lokasi ditolak/)).length
    ).toBeGreaterThan(0)
    expect(screen.queryByLabelText("Pratinjau kamera karyawan")).toBeNull()
    expect(posts).toHaveLength(0)

    fireEvent.click(
      screen.getByRole("button", { name: "Perbarui lokasi saya" })
    )
    expect(
      await screen.findByLabelText("Pratinjau kamera karyawan")
    ).toBeTruthy()
    const origin = screen.getByRole("region", { name: "Sesi asal checkout" })
    expect(within(origin).getByRole("time").getAttribute("datetime")).toBe(
      "2026-10-25"
    )
    expect(within(origin).getByText("Outlet Pusat")).toBeTruthy()
    const destination = screen.getByRole("region", {
      name: "Outlet tujuan checkout",
    })
    expect(within(destination).getByText("Outlet Makassar")).toBeTruthy()
    fireEvent.click(await captureButton())
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Gunakan Foto dan Absen Keluar",
      })
    )
    await screen.findByRole("button", { name: "Periksa lalu kirim ulang" })
    expect(storedMetadata.get("7.2.17")).toMatchObject({
      outletId: 6,
      checkoutSessionId: 51,
    })
    view.unmount()

    render(<AttendancePage />)
    const retry = await screen.findByRole("button", {
      name: "Periksa lalu kirim ulang",
    })
    expect(
      screen.queryByRole("combobox", { name: "Pilih Outlet tujuan checkout" })
    ).toBeNull()
    expect(
      (
        screen.getByRole("button", {
          name: "Absen Keluar",
        }) as HTMLButtonElement
      ).disabled
    ).toBe(true)
    fireEvent.click(retry)
    await waitFor(() => expect(toast.success).toHaveBeenCalledOnce())
    expect(posts).toHaveLength(2)
    expect(posts[0].headers["Idempotency-Key"]).toBe(
      posts[1].headers["Idempotency-Key"]
    )
    for (const { body } of posts) {
      expect(body.get("checkout_outlet_id")).toBe("6")
      expect(body.get("checkout_session_id")).toBe("51")
      expect(body.get("location[longitude]")).toBe("119.43")
    }
    expect(getCurrentPosition).toHaveBeenCalledTimes(2)
    expect(storedMetadata.size).toBe(0)
  })

  it.each([
    "eligible",
    "mode revoked",
    "geofence missing",
    "wrong destination",
    "new session",
    "forbidden",
    "offline",
  ])("revalidates the selected checkout destination after rejection (%s)", async (outcome) => {
    installCamera()
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      value: {
        getCurrentPosition: (allow: PositionCallback) =>
          allow({
            coords: { latitude: -5.15, longitude: 119.43, accuracy: 10 },
          } as GeolocationPosition),
      },
    })
    const origin = { ...checkoutDestination, ...checkoutSession.outlet }
    const home = {
      ...activeCheckout,
      require_personal_photo: false,
      checkout_destination: origin,
    }
    const target = { ...home, checkout_destination: checkoutDestination }
    const defaultRequest = apiRequest.getMockImplementation()
    let rejected = false
    let restored = false
    apiRequest.mockImplementation(async (path: string) => {
      if (path === "/attendance/me/check-out") {
        rejected = true
        throw new ApiError("Checkout ditolak.", 422)
      }
      if (path === "/attendance/me") {
        if (rejected && !restored && outcome === "offline")
          throw new TypeError("Offline")
        return home
      }
      if (path === "/attendance/me?checkout_outlet_id=6") {
        if (
          !rejected ||
          outcome === "eligible" ||
          (restored && outcome !== "new session")
        )
          return target
        if (outcome === "mode revoked")
          return {
            ...target,
            checkout_destination: {
              ...checkoutDestination,
              mode_allowed: false,
            },
          }
        if (outcome === "geofence missing")
          return {
            ...target,
            checkout_destination: {
              ...checkoutDestination,
              personal_location: {
                ...checkoutDestination.personal_location,
                geofence_configured: false,
              },
            },
          }
        if (outcome === "wrong destination") return home
        if (outcome === "new session")
          return { ...target, active_session: { ...checkoutSession, id: 52 } }
        if (outcome === "offline") throw new TypeError("Offline")
        throw new ApiError("Outlet unavailable", 403)
      }
      return defaultRequest?.(path)
    })

    render(<AttendancePage />)
    const checkoutAction = await enabledButton("Absen Keluar")
    fireEvent.click(checkoutAction)
    const dialog = await screen.findByRole("dialog", { name: "Absen Keluar" })
    const select = within(dialog).getByRole<HTMLSelectElement>("combobox", {
      name: "Pilih Outlet tujuan checkout",
    })
    fireEvent.change(select, { target: { value: "6" } })
    const destination = await screen.findByRole("region", {
      name: "Outlet tujuan checkout",
    })
    expect(within(destination).getByText("Outlet Makassar")).toBeTruthy()
    const originRegion = screen.getByRole("region", {
      name: "Sesi asal checkout",
    })
    expect(within(originRegion).getByText("Outlet Pusat")).toBeTruthy()
    fireEvent.click(
      screen.getByRole("button", { name: "Lewati Foto dan Absen Keluar" })
    )
    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledOnce()
      expect(select.disabled).toBe(false)
    })
    expect(
      apiRequest.mock.calls.filter(
        ([path]) => path === "/attendance/me?checkout_outlet_id=6"
      ).length
    ).toBeGreaterThanOrEqual(3)
    const checkout = screen.getByRole<HTMLButtonElement>("button", {
      name: "Absen Keluar",
    })
    expect(
      screen.queryByRole("combobox", { name: "Pilih Outlet tujuan checkout" })
    ).toBeNull()
    await waitFor(() =>
      expect(checkout.disabled).toBe(
        outcome === "new session" || outcome === "offline"
      )
    )

    if (outcome === "offline") {
      expect(screen.getByText(/Status terbaru belum dapat dimuat/)).toBeTruthy()
      restored = true
      fireEvent.click(screen.getByRole("button", { name: "Muat Ulang Status" }))
      await waitFor(() => expect(checkout.disabled).toBe(false))
    }
    if (outcome === "eligible" || outcome === "offline") {
      const retryCheckout = await enabledButton("Absen Keluar")
      fireEvent.click(retryCheckout)
      const retryDialog = await screen.findByRole("dialog", {
        name: "Absen Keluar",
      })
      const retrySelect = within(retryDialog).getByRole<HTMLSelectElement>(
        "combobox",
        { name: "Pilih Outlet tujuan checkout" }
      )
      if (outcome === "eligible") {
        expect(retrySelect.value).toBe("6")
      } else {
        expect(retrySelect.value).toBe("")
        expect(
          within(retryDialog).getByRole("option", { name: "Outlet Makassar" })
        ).toBeTruthy()
      }
    } else if (outcome !== "new session") {
      restored = true
      const retryCheckout = await enabledButton("Absen Keluar")
      fireEvent.click(retryCheckout)
      const retryDialog = await screen.findByRole("dialog", {
        name: "Absen Keluar",
      })
      const retrySelect = within(retryDialog).getByRole<HTMLSelectElement>(
        "combobox",
        { name: "Pilih Outlet tujuan checkout" }
      )
      expect(retrySelect.value).toBe("")
      expect(
        within(retryDialog).getByRole("option", { name: "Outlet Pusat" })
      ).toBeTruthy()
      expect(
        within(retryDialog).queryByRole("option", { name: "Outlet Makassar" })
      ).toBeNull()
    }
    expect(
      apiRequest.mock.calls.filter(
        ([path]) => path === "/attendance/me/check-out"
      )
    ).toHaveLength(1)
  })

  it.each([
    true,
    false,
  ])("requires a session binding to restore a recovered checkout destination (%s)", async (bound) => {
    const key = "e7b4e8f7-9c4b-4a2a-9ca4-0cb0cd4d8263"
    storedMetadata.set("7.2.17", {
      key,
      operation: "check_out",
      userId: 7,
      tenantId: 2,
      employeeId: 17,
      outletId: 6,
      checkoutSessionId: bound ? 51 : undefined,
      savedAt: Date.now(),
    })
    const defaultRequest = apiRequest.getMockImplementation()
    apiRequest.mockImplementation(async (path: string) => {
      if (path === "/attendance/me") {
        return {
          ...activeCheckout,
          checkout_destination: {
            ...checkoutDestination,
            ...checkoutSession.outlet,
          },
        }
      }
      if (path === "/attendance/me?checkout_outlet_id=6") {
        return { ...activeCheckout, checkout_destination: checkoutDestination }
      }
      if (path === `/attendance/me/operations/check_out/${key}`) {
        return {
          state: "rejected",
          contract_version: 3,
          checkout_outlet_id: 6,
          checkout_session_id: 51,
          result: { message: "Checkout ditolak." },
        }
      }
      return defaultRequest?.(path)
    })
    render(<AttendancePage />)
    if (bound) {
      await enabledButton("Absen Keluar")
    } else {
      await screen.findByText("Checkout ditolak.")
      await waitFor(() => expect(storedMetadata.size).toBe(0))
    }
    expect(
      screen.queryByRole("combobox", { name: "Pilih Outlet tujuan checkout" })
    ).toBeNull()
    const checkout = screen.getByRole<HTMLButtonElement>("button", {
      name: "Absen Keluar",
    })
    expect(checkout.disabled).toBe(!bound)
    expect(toast.error).toHaveBeenCalledOnce()
    expect(
      apiRequest.mock.calls.some(
        ([path]) => path === "/attendance/me/check-out"
      )
    ).toBe(false)
    if (bound) {
      fireEvent.click(checkout)
      const dialog = await screen.findByRole("dialog", { name: "Absen Keluar" })
      expect(
        within(dialog).getByRole<HTMLSelectElement>("combobox", {
          name: "Pilih Outlet tujuan checkout",
        }).value
      ).toBe("6")
    }
  })

  it("blocks capture when a destination disappears before the preview loads", async () => {
    const defaultRequest = apiRequest.getMockImplementation()
    let destinationChecks = 0
    apiRequest.mockImplementation(async (path: string) => {
      if (path === "/attendance/me") return activeCheckout
      if (path === "/attendance/me?checkout_outlet_id=6") {
        destinationChecks += 1
        if (destinationChecks === 1) {
          return {
            ...activeCheckout,
            checkout_destination: checkoutDestination,
          }
        }
        throw new ApiError("Outlet unavailable", 403)
      }
      return defaultRequest?.(path)
    })
    render(<AttendancePage />)
    const checkout = await enabledButton("Absen Keluar")
    fireEvent.click(checkout)
    const dialog = await screen.findByRole("dialog", { name: "Absen Keluar" })
    fireEvent.change(
      within(dialog).getByRole("combobox", {
        name: "Pilih Outlet tujuan checkout",
      }),
      {
        target: { value: "6" },
      }
    )
    expect(
      await screen.findByText(/Outlet tujuan checkout tidak lagi tersedia/)
    ).toBeTruthy()
    expect(screen.getByRole("dialog", { name: "Absen Keluar" })).toBeTruthy()
    expect(
      within(dialog).getByRole<HTMLSelectElement>("combobox", {
        name: "Pilih Outlet tujuan checkout",
      }).value
    ).toBe("")
    expect(
      within(dialog).queryByRole("option", { name: "Outlet Makassar" })
    ).toBeNull()
    expect(screen.queryByLabelText("Pratinjau kamera karyawan")).toBeNull()
    fireEvent.click(
      within(dialog).getByRole("button", {
        name: "Kembali ke halaman presensi",
      })
    )
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
    expect(
      (
        screen.getByRole("button", {
          name: "Absen Keluar",
        }) as HTMLButtonElement
      ).disabled
    ).toBe(true)
    expect(
      apiRequest.mock.calls.some(
        ([path]) => path === "/attendance/me/check-out"
      )
    ).toBe(false)
  })

  it.each([
    true,
    false,
  ])("reconciles a recovered checkout only when its destination matches (%s)", async (matches) => {
    const key = "e7b4e8f7-9c4b-4a2a-9ca4-0cb0cd4d8263"
    storedMetadata.set("7.2.17", {
      key,
      operation: "check_out",
      userId: 7,
      tenantId: 2,
      employeeId: 17,
      outletId: 6,
      checkoutSessionId: 51,
      savedAt: Date.now(),
    })
    const defaultRequest = apiRequest.getMockImplementation()
    apiRequest.mockImplementation(async (path: string) => {
      if (path === "/attendance/me") return activeCheckout
      if (path === `/attendance/me/operations/check_out/${key}`) {
        return {
          state: "completed",
          operation: "check_out",
          contract_version: 3,
          checkout_session_id: 51,
          checkout_outlet_id: matches ? 6 : 3,
          result: {
            operation: { key, type: "check_out", state: "completed" },
            event: {
              id: 52,
              type: "check_out",
              recorded_at: "2026-10-25T09:00:00Z",
            },
            session: { ...checkoutSession, status: "closed" },
          },
        }
      }
      return defaultRequest?.(path)
    })
    render(<AttendancePage />)
    if (matches) {
      await waitFor(() => expect(storedMetadata.size).toBe(0))
      expect(toast.success).toHaveBeenCalledOnce()
    } else {
      expect(
        await screen.findByText(/Tujuan atau sesi dari server berbeda/)
      ).toBeTruthy()
      expect(storedMetadata.size).toBe(1)
      expect(toast.success).not.toHaveBeenCalled()
    }
    expect(
      apiRequest.mock.calls.some(
        ([path]) => path === "/attendance/me/check-out"
      )
    ).toBe(false)
  })

  it("explains a denied camera and never sends attendance without captured evidence", async () => {
    Object.defineProperty(window, "isSecureContext", {
      configurable: true,
      value: true,
    })
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: vi.fn(async () => {
          throw new DOMException("Permission denied", "NotAllowedError")
        }),
      },
    })
    render(<AttendancePage />)
    fireEvent.click(await enabledButton("Absen Masuk"))
    expect(await screen.findByText(/Izin kamera ditolak/)).toBeTruthy()
    expect(
      apiRequest.mock.calls.some(([path]) => path === "/attendance/me/check-in")
    ).toBe(false)
  })

  it("blocks a new mutation when reauthentication finds an uncertain operation without its photo", async () => {
    const key = "e7b4e8f7-9c4b-4a2a-9ca4-0cb0cd4d8263"
    storedMetadata.set("7.2.17", {
      key,
      operation: "check_in",
      userId: 7,
      tenantId: 2,
      employeeId: 17,
      outletId: 3,
      savedAt: Date.now(),
    })
    apiRequest.mockImplementation(async (path: string) => {
      if (path === "/auth/me") {
        return {
          user: { id: 7, name: "Rani", email: "rani@example.test" },
          active_membership: {
            id: 19,
            tenant: { id: 2, name: "Tenant Uji" },
            roles: ["employee"],
          },
        }
      }
      if (path === "/attendance/me") return readyAttendance
      if (path === `/attendance/me/operations/check_in/${key}`)
        return { state: "not_found" }
      return readyAttendance
    })
    render(<AttendancePage />)

    expect(
      await screen.findByRole("button", { name: "Periksa status lagi" })
    ).toBeTruthy()
    expect(await screen.findByText(/foto lokal tidak tersedia/i)).toBeTruthy()
    expect(
      screen.queryByRole("button", { name: "Periksa lalu kirim ulang" })
    ).toBeNull()
    expect(
      (
        screen.getByRole("button", {
          name: /^Absen Masuk/,
        }) as HTMLButtonElement
      ).disabled
    ).toBe(true)
    expect(
      apiRequest.mock.calls.some(([path]) => path === "/attendance/me/check-in")
    ).toBe(false)
  })

  it("stops the camera and clears local photos when identity change begins", async () => {
    installCamera()
    storedPhotos.set("old-key", {
      key: "old-key",
      userId: 8,
      tenantId: 4,
      employeeId: 21,
      photo: new Blob(["private-image"], { type: "image/jpeg" }),
    })
    render(<AttendancePage />)
    fireEvent.click(await enabledButton("Absen Masuk"))
    expect(await screen.findByRole("dialog")).toBeTruthy()
    await waitFor(() =>
      expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledOnce()
    )
    await cameraReady()

    await prepareAttendanceIdentityChange()

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
    expect(track.stop).toHaveBeenCalled()
    expect(storedPhotos.size).toBe(0)
  })

  it("does not load a cached photo belonging to another account", async () => {
    const otherPhoto = new Blob(["other-account-photo"], {
      type: "image/jpeg",
    })
    storedPhotos.set("other-account-key", {
      key: "other-account-key",
      userId: 8,
      tenantId: 4,
      employeeId: 21,
      operation: "check_in",
      outletId: 3,
      location: { status: "unavailable" },
      photo: otherPhoto,
      savedAt: Date.now(),
    })
    render(<AttendancePage />)

    expect(await enabledButton("Absen Masuk")).toBeTruthy()
    expect(storedPhotos.size).toBe(0)
    expect(
      screen.queryByRole("img", { name: "Pratinjau foto bukti presensi" })
    ).toBeNull()
  })
})
