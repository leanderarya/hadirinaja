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
    idle: "Belum diperiksa",
    checking: "Sedang diperiksa",
    healthy: "Berfungsi",
    unhealthy: "Bermasalah",
    unreachable: "Tidak terjangkau",
  }[check.status]

  const statusMessage = {
    idle: "Periksa koneksi browser ke API dan basis data.",
    checking: "Memeriksa koneksi API dan basis data…",
    healthy: "API merespons dan pemeriksaan koneksi basis data berhasil.",
    unhealthy: "API merespons, tetapi pemeriksaan koneksi basis data gagal.",
    unreachable:
      "Browser tidak menerima respons yang valid. Periksa server API, alamat, dan konfigurasi CORS.",
  }[check.status]

  return (
    <main className="mx-auto flex w-full max-w-3xl justify-center px-6 py-16">
      <Card className="w-full">
        <CardHeader>
          <CardTitle>Koneksi API</CardTitle>
          <CardDescription>
            Periksa akses browser ke API dan basis datanya.
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
              {check.status === "checking" ? "Memeriksa…" : "Periksa koneksi"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </main>
  )
}
