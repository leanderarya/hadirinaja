import { createFileRoute } from "@tanstack/react-router"
import { useState } from "react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { fetchApiHealth } from "@/lib/api"

export const Route = createFileRoute("/api-health")({
  component: ApiHealthPage,
})

type CheckState =
  | { status: "idle" | "checking" }
  | { status: "healthy" | "unhealthy"; httpStatus: number }
  | { status: "unreachable" }

function ApiHealthPage() {
  const [check, setCheck] = useState<CheckState>({ status: "idle" })

  async function checkApi() {
    setCheck({ status: "checking" })

    try {
      const result = await fetchApiHealth()
      const healthy =
        result.httpStatus === 200 &&
        result.status === "healthy" &&
        result.checks.database === "available"

      setCheck({
        status: healthy ? "healthy" : "unhealthy",
        httpStatus: result.httpStatus,
      })
    } catch {
      setCheck({ status: "unreachable" })
    }
  }

  const badgeVariant =
    check.status === "healthy"
      ? "secondary"
      : check.status === "unhealthy" || check.status === "unreachable"
        ? "destructive"
        : "outline"

  const statusLabel = {
    idle: "Not checked",
    checking: "Checking",
    healthy: "Healthy",
    unhealthy: "Unhealthy",
    unreachable: "Unreachable",
  }[check.status]

  const statusMessage = {
    idle: "Run a browser-side check against the configured Laravel API.",
    checking: "Checking the API and its database connection…",
    healthy: "Laravel responded and its read-only database check succeeded.",
    unhealthy: "The API responded, but its database health check failed.",
    unreachable:
      "The browser could not receive a valid response. Check the API server, URL, and CORS configuration.",
  }[check.status]

  return (
    <main className="mx-auto flex w-full max-w-3xl justify-center px-6 py-16">
      <Card className="w-full">
        <CardHeader>
          <CardTitle>API connection</CardTitle>
          <CardDescription>
            Verify browser access to Laravel and its configured database.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <div className="flex flex-wrap items-center gap-3">
            <Badge variant={badgeVariant}>{statusLabel}</Badge>
            {"httpStatus" in check && (
              <span className="text-caption text-muted-foreground">
                HTTP {check.httpStatus}
              </span>
            )}
          </div>
          <p aria-live="polite" className="text-body text-muted-foreground">
            {statusMessage}
          </p>
          <div>
            <Button
              disabled={check.status === "checking"}
              onClick={checkApi}
              type="button"
            >
              {check.status === "checking" ? "Checking…" : "Check API"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </main>
  )
}
