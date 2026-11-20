// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import type { ComponentType } from "react"
import { afterEach, beforeEach, expect, it, vi } from "vitest"

const { apiRequest } = vi.hoisted(() => ({ apiRequest: vi.fn() }))
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: { component: ComponentType }) => ({
    options,
  }),
}))
vi.mock("@/lib/api", () => ({ apiRequest, ApiError: class extends Error {} }))

import { Route } from "./kiosk"

beforeEach(() => {
  apiRequest.mockClear()
  window.sessionStorage.clear()
  apiRequest.mockImplementation(async (path: string) => {
    if (path === "/kiosk/status")
      return {
        device: { id: 1, name: "Tablet QA" },
        tenant: { id: 1, name: "Tenant QA" },
        outlet: { id: 1, name: "Outlet QA" },
        credential_expires_at: "2026-12-01T00:00:00Z",
      }
    if (path === "/kiosk/attendance/employees")
      return { employees: [{ id: 1, name: "Employee QA" }] }
    if (path === "/kiosk/attendance/next-operation")
      return { eligible: true, next_operation: "check_in" }
    throw Error(`Unexpected test request: ${path}`)
  })
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue()
  vi.stubGlobal("URL", {
    createObjectURL: vi.fn(() => "blob:qa"),
    revokeObjectURL: vi.fn(),
  })
})
afterEach(() => {
  cleanup()
  Reflect.deleteProperty(navigator, "geolocation")
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

it.each([
  1, 2, 4,
])("recovers checkout contract v%i from an existing pending kiosk operation", async (version) => {
  const storageKey = "hadirinaja.kiosk.attendance.pending"
  const key = "9a44f750-8644-4fb9-9339-ab6bccd01ea9"
  window.sessionStorage.setItem(
    storageKey,
    JSON.stringify({
      key,
      operation: "check_out",
      employeeId: 1,
      deviceId: 1,
      checkout:
        version === 4 ? { tenantId: 1, outletId: 1, sessionId: 51 } : undefined,
    })
  )
  const statusPath = `/kiosk/attendance/operations/check_out/${key}?employee_id=1${version === 4 ? "&expected_kiosk_device_id=1" : ""}`
  const defaultRequest = apiRequest.getMockImplementation()
  apiRequest.mockClear()
  apiRequest.mockImplementation(async (path: string) => {
    if (path !== statusPath) return defaultRequest?.(path)
    return {
      state: "completed",
      operation: "check_out",
      contract_version: version,
      checkout_session_id: version === 1 ? null : 51,
      checkout_outlet_id: version === 1 ? null : 1,
      result: { event: { recorded_at: "2026-11-05T08:00:00Z" } },
    }
  })

  const Page = Route.options.component as ComponentType
  render(<Page />)
  expect(
    await screen.findByText(/Presensi keluar dikonfirmasi oleh server/)
  ).toBeTruthy()
  expect(window.sessionStorage.getItem(storageKey)).toBeNull()
  expect(apiRequest).toHaveBeenCalledWith(statusPath)
  expect(
    apiRequest.mock.calls.some(
      ([path]) => path === "/kiosk/attendance/check-out"
    )
  ).toBe(false)
})

it("requires GPS before the kiosk camera, submits the session without an Outlet override, and recovers after reload", async () => {
  const getCurrentPosition = vi
    .fn()
    .mockImplementationOnce((_, deny) =>
      deny({ code: 1, PERMISSION_DENIED: 1 })
    )
    .mockImplementation((allow) =>
      allow({ coords: { latitude: -5.15, longitude: 119.43, accuracy: 10 } })
    )
  Object.defineProperty(navigator, "geolocation", {
    configurable: true,
    value: { getCurrentPosition },
  })
  const getUserMedia = vi
    .fn()
    .mockResolvedValue({ getTracks: () => [{ stop: vi.fn() }] })
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia },
  })
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    drawImage: vi.fn(),
  } as unknown as CanvasRenderingContext2D)
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(
    (callback) =>
      callback(new Blob([new Uint8Array(20 * 1024)], { type: "image/jpeg" }))
  )
  const defaultRequest = apiRequest.getMockImplementation()
  let reloaded = false
  apiRequest.mockImplementation(async (path: string) => {
    if (path === "/kiosk/attendance/next-operation")
      return {
        eligible: true,
        next_operation: "check_out",
        checkout_outlet_id: 1,
        checkout_session_id: 51,
        checkout_location: {
          required: true,
          radius_meters: 80,
          latitude: -5.15,
          longitude: 119.43,
        },
      }
    if (path === "/kiosk/attendance/check-out")
      throw new TypeError("Lost response")
    if (path.startsWith("/kiosk/attendance/operations/check_out/"))
      return {
        state: reloaded ? "completed" : "pending",
        contract_version: 4,
        checkout_outlet_id: 1,
        checkout_session_id: 51,
        result: reloaded
          ? { event: { recorded_at: "2026-11-05T08:00:00Z" } }
          : undefined,
      }
    return defaultRequest?.(path)
  })
  const Page = Route.options.component as ComponentType
  const page = render(<Page />)
  fireEvent.click(await screen.findByRole("button", { name: "Employee QA" }))
  fireEvent.change(screen.getByLabelText("PIN pribadi"), {
    target: { value: "123456" },
  })
  fireEvent.click(screen.getByRole("button", { name: "Lanjutkan ke kamera" }))
  expect(await screen.findByText(/Izin lokasi ditolak.*Lanjutkan ke kamera/)).toBeTruthy()
  expect(getUserMedia).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole("button", { name: "Lanjutkan ke kamera" }))
  const capture = await screen.findByRole("button", { name: "Ambil foto baru" })
  const video = screen.getByLabelText("Pratinjau kamera kiosk")
  for (const [key, value] of Object.entries({
    readyState: 4,
    currentTime: 1,
    videoWidth: 1280,
    videoHeight: 960,
  }))
    Object.defineProperty(video, key, { configurable: true, value })
  fireEvent.click(capture)
  fireEvent.click(
    await screen.findByRole("button", { name: "Konfirmasi dan catat" })
  )
  expect(
    await screen.findByText(/Server masih memproses operasi ini/)
  ).toBeTruthy()
  const storageKey = "hadirinaja.kiosk.attendance.pending"
  const serialized = window.sessionStorage.getItem(storageKey)
  const pending = JSON.parse(serialized ?? "{}")
  expect(pending).toEqual({
    key: expect.any(String),
    operation: "check_out",
    employeeId: 1,
    deviceId: 1,
    checkout: { tenantId: 1, outletId: 1, sessionId: 51 },
  })
  const mutation = apiRequest.mock.calls.find(
    ([path]) => path === "/kiosk/attendance/check-out"
  )?.[1]
  expect(mutation.headers["Idempotency-Key"]).toBe(pending.key)
  expect(mutation.body.get("checkout_session_id")).toBe("51")
  expect(mutation.body.get("expected_kiosk_device_id")).toBe("1")
  expect(mutation.body.get("checkout_outlet_id")).toBeNull()
  expect(mutation.body.get("location[longitude]")).toBe("119.43")

  page.unmount()
  reloaded = true
  render(<Page />)
  expect(
    await screen.findByText(/Presensi keluar dikonfirmasi oleh server/)
  ).toBeTruthy()
  expect(
    apiRequest.mock.calls.filter(
      ([path]) => path === "/kiosk/attendance/check-out"
    )
  ).toHaveLength(1)
  expect(window.sessionStorage.getItem(storageKey)).toBeNull()
})

it("keeps a pending checkout when the current pairing has a different Outlet", async () => {
  const storageKey = "hadirinaja.kiosk.attendance.pending"
  window.sessionStorage.setItem(
    storageKey,
    JSON.stringify({
      key: "9a44f750-8644-4fb9-9339-ab6bccd01ea9",
      operation: "check_out",
      employeeId: 1,
      deviceId: 1,
      checkout: { tenantId: 1, outletId: 2, sessionId: 51 },
    })
  )
  const Page = Route.options.component as ComponentType
  render(<Page />)
  expect(
    await screen.findByText(/tersimpan untuk pemasangan kiosk lain/)
  ).toBeTruthy()
  expect(window.sessionStorage.getItem(storageKey)).not.toBeNull()
  expect(
    apiRequest.mock.calls.some(([path]) =>
      path.startsWith("/kiosk/attendance/operations/")
    )
  ).toBe(false)
})

it("rechecks the original key before restarting a missing checkout after reload", async () => {
  const storageKey = "hadirinaja.kiosk.attendance.pending"
  const key = "9a44f750-8644-4fb9-9339-ab6bccd01ea9"
  window.sessionStorage.setItem(
    storageKey,
    JSON.stringify({
      key,
      operation: "check_out",
      employeeId: 1,
      deviceId: 1,
      checkout: { tenantId: 1, outletId: 1, sessionId: 51 },
    })
  )
  const statusPath = `/kiosk/attendance/operations/check_out/${key}?employee_id=1&expected_kiosk_device_id=1`
  const defaultRequest = apiRequest.getMockImplementation()
  apiRequest.mockImplementation(async (path: string) =>
    path === statusPath ? { state: "not_found" } : defaultRequest?.(path)
  )
  const Page = Route.options.component as ComponentType
  render(<Page />)
  const restart = await screen.findByRole("button", {
    name: "Periksa lalu mulai ulang",
  })
  expect(window.sessionStorage.getItem(storageKey)).not.toBeNull()
  expect(
    screen.queryByRole("button", { name: "Kirim ulang operasi yang sama" })
  ).toBeNull()
  fireEvent.click(restart)
  expect(
    await screen.findByRole("button", { name: "Employee QA" })
  ).toBeTruthy()
  expect(
    apiRequest.mock.calls.filter(([path]) => path === statusPath)
  ).toHaveLength(2)
  expect(
    apiRequest.mock.calls.some(
      ([path]) => path === "/kiosk/attendance/check-out"
    )
  ).toBe(false)
  expect(window.sessionStorage.getItem(storageKey)).toBeNull()
})

it("keeps camera retry available for an unready frame and undersized image, then accepts a valid capture", async () => {
  const stop = vi.fn()
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: {
      getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [{ stop }] }),
    },
  })
  const drawImage = vi.fn()
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    drawImage,
  } as unknown as CanvasRenderingContext2D)
  let bytes = 500
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(
    (callback) =>
      callback(new Blob([new Uint8Array(bytes)], { type: "image/jpeg" }))
  )
  const Page = Route.options.component as ComponentType
  const { container } = render(<Page />)
  fireEvent.click(await screen.findByRole("button", { name: "Employee QA" }))
  fireEvent.change(screen.getByLabelText("PIN pribadi"), {
    target: { value: "123456" },
  })
  fireEvent.click(screen.getByRole("button", { name: "Lanjutkan ke kamera" }))
  const capture = await screen.findByRole("button", { name: "Ambil foto baru" })
  fireEvent.click(capture)
  expect(
    await screen.findByText(/Kamera belum siap. Tunggu gambar/)
  ).toBeTruthy()
  expect(drawImage).not.toHaveBeenCalled()
  const video = container.querySelector("video") as HTMLVideoElement
  for (const [key, value] of Object.entries({
    readyState: 4,
    currentTime: 1,
    videoWidth: 1280,
    videoHeight: 960,
  }))
    Object.defineProperty(video, key, { configurable: true, value })
  fireEvent.click(capture)
  expect(await screen.findByText(/Foto terlalu kecil/)).toBeTruthy()
  expect(capture.hasAttribute("disabled")).toBe(false)
  expect(stop).not.toHaveBeenCalled()
  bytes = 20 * 1024
  fireEvent.click(capture)
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Konfirmasi dan catat" })
    ).toBeTruthy()
  )
  expect(stop).toHaveBeenCalled()
  expect(
    apiRequest.mock.calls.some(
      ([path]) => path === "/kiosk/attendance/check-in"
    )
  ).toBe(false)
})

it("retries denied camera access without selecting a new employee or starting an attendance write", async () => {
  const getUserMedia = vi
    .fn()
    .mockRejectedValueOnce(new DOMException("Denied", "NotAllowedError"))
    .mockResolvedValueOnce({ getTracks: () => [{ stop: vi.fn() }] })
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia },
  })
  const Page = Route.options.component as ComponentType
  render(<Page />)
  fireEvent.click(await screen.findByRole("button", { name: "Employee QA" }))
  fireEvent.change(screen.getByLabelText("PIN pribadi"), {
    target: { value: "123456" },
  })
  fireEvent.click(screen.getByRole("button", { name: "Lanjutkan ke kamera" }))
  await screen.findByText(/Izin kamera ditolak/)
  fireEvent.click(screen.getByRole("button", { name: "Coba kamera lagi" }))
  await waitFor(() => expect(getUserMedia).toHaveBeenCalledTimes(2))
  expect(screen.queryByText(/Izin kamera ditolak/)).toBeNull()
  expect(
    apiRequest.mock.calls.filter(
      ([path]) => path === "/kiosk/attendance/next-operation"
    )
  ).toHaveLength(1)
  expect(
    apiRequest.mock.calls.some(([path]) =>
      /\/attendance\/check-(in|out)$/.test(path)
    )
  ).toBe(false)
})
