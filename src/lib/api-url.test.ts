import { afterEach, expect, it, vi } from "vitest"

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
})

it("keeps protected evidence on the configured API origin", async () => {
  vi.stubEnv("VITE_API_BASE_URL", "https://api.example.test/api/v1/")
  vi.resetModules()
  const { apiUrl } = await import("./api")
  expect(apiUrl("/management/attendance/events/15/evidence")).toBe(
    "https://api.example.test/api/v1/management/attendance/events/15/evidence"
  )
})

it("preserves the existing relative API topology when no origin is configured", async () => {
  vi.stubEnv("VITE_API_BASE_URL", "")
  vi.resetModules()
  const { apiUrl } = await import("./api")
  expect(apiUrl("/management/attendance/events/15/evidence")).toBe(
    "/api/v1/management/attendance/events/15/evidence"
  )
})
