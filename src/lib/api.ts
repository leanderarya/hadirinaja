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

export async function fetchApiHealth(): Promise<ApiHealthResult> {
  const response = await fetch(`${API_BASE_URL}/health`, {
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
