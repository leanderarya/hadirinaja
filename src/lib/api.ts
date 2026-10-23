export type ApiHealthResponse = {
  status: "healthy" | "unhealthy"
  checks: {
    database: "available" | "unavailable"
  }
}

export type ApiHealthResult = ApiHealthResponse & {
  httpStatus: number
}

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || "/api/v1").replace(
  /\/+$/,
  ""
)
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"])

export type TenantMembership = {
  id: number
  tenant: { id: number; name: string }
  roles: Array<"owner" | "supervisor" | "employee">
}

export type AuthSession = {
  user: { id: number; name: string; email: string }
  memberships: TenantMembership[]
  active_membership: TenantMembership | null
}

export type OrganizationSummary = {
  tenant: { id: number; name: string }
  roles: Array<"owner" | "supervisor" | "employee">
  business_units: Array<{ id: number; name: string }>
  outlets: Array<{ id: number; name: string; business_unit_id: number }>
  employee_count: number
}

export type KioskDevice = {
  id: number
  name: string
  outlet_id: number
  outlet_name: string
  paired_at: string
  last_seen_at: string | null
  revoked_at: string | null
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string
  ) {
    super(message)
    this.name = "ApiError"
  }
}

export async function apiRequest<T>(
  path: string,
  options: { method?: string; body?: unknown; headers?: HeadersInit } = {}
): Promise<T> {
  const method = (options.method || "GET").toUpperCase()
  const unsafe = !SAFE_METHODS.has(method)

  if (unsafe) {
    await ensureCsrfCookie()
  }

  let response = await sendRequest(path, method, options)

  if (response.status === 419 && unsafe) {
    await ensureCsrfCookie(true)
    response = await sendRequest(path, method, options)
  }

  if (
    (response.status === 401 || response.status === 419) &&
    path.startsWith("/management/")
  ) {
    window.dispatchEvent(new Event("hadirinaja:session-expired"))
  }

  const payload: unknown = await response.json().catch(() => null)

  if (!response.ok) {
    const error =
      typeof payload === "object" && payload !== null
        ? (payload as { message?: unknown; code?: unknown })
        : {}
    throw new ApiError(
      typeof error.message === "string"
        ? error.message
        : "Permintaan tidak dapat diproses.",
      response.status,
      typeof error.code === "string" ? error.code : undefined
    )
  }

  return payload as T
}

let csrfRequest: Promise<void> | undefined

async function ensureCsrfCookie(force = false): Promise<void> {
  if (typeof document === "undefined") {
    throw new Error("Session requests are only available in the browser.")
  }

  if (!force && readCookie("XSRF-TOKEN")) {
    return
  }

  if (!csrfRequest || force) {
    const base = new URL(API_BASE_URL, window.location.origin)
    base.pathname = base.pathname.replace(/\/api\/v1\/?$/, "")
    const csrfUrl = new URL("/sanctum/csrf-cookie", base)

    const request = fetch(csrfUrl, {
      credentials: "include",
      cache: "no-store",
      headers: { Accept: "application/json" },
    }).then((response) => {
      if (!response.ok) {
        throw new ApiError("Tidak dapat memulai sesi aman.", response.status)
      }
    })
    let pendingRequest: Promise<void>
    pendingRequest = request.finally(() => {
      if (csrfRequest === pendingRequest) {
        csrfRequest = undefined
      }
    })
    csrfRequest = pendingRequest
  }

  await csrfRequest
}

async function sendRequest(
  path: string,
  method: string,
  options: { body?: unknown; headers?: HeadersInit }
): Promise<Response> {
  const headers = new Headers(options.headers)
  headers.set("Accept", "application/json")

  const init: RequestInit = {
    method,
    credentials: "include",
    cache: "no-store",
    headers,
  }

  if (options.body !== undefined) {
    const isFormData =
      typeof FormData !== "undefined" && options.body instanceof FormData

    if (isFormData) {
      headers.delete("Content-Type")
      init.body = options.body as FormData
    } else {
      headers.set("Content-Type", "application/json")
      init.body = JSON.stringify(options.body)
    }
  }

  if (!SAFE_METHODS.has(method)) {
    const csrfToken = readCookie("XSRF-TOKEN")
    if (csrfToken) {
      headers.set("X-XSRF-TOKEN", csrfToken)
    }
  }

  return fetch(`${API_BASE_URL}${path}`, init)
}

function readCookie(name: string): string | undefined {
  const prefix = `${name}=`
  const cookie = document.cookie
    .split(";")
    .map((value) => value.trim())
    .find((value) => value.startsWith(prefix))

  return cookie ? decodeURIComponent(cookie.slice(prefix.length)) : undefined
}

export async function fetchApiHealth(): Promise<ApiHealthResult> {
  const response = await fetch(`${API_BASE_URL}/health`, {
    credentials: "include",
    cache: "no-store",
    headers: { Accept: "application/json" },
  })
  const payload: unknown = await response.json().catch(() => null)

  if (!isApiHealthResponse(payload)) {
    throw new Error("The API returned an unexpected health response.")
  }

  return { ...payload, httpStatus: response.status }
}

function isApiHealthResponse(value: unknown): value is ApiHealthResponse {
  if (typeof value !== "object" || value === null) {
    return false
  }

  const response = value as Record<string, unknown>
  const checks = response.checks

  return (
    (response.status === "healthy" || response.status === "unhealthy") &&
    typeof checks === "object" &&
    checks !== null &&
    "database" in checks &&
    (checks.database === "available" || checks.database === "unavailable")
  )
}
