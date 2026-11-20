import { createFileRoute } from "@tanstack/react-router"
import { useEffect, useState } from "react"

import { LogoIcon } from "@/components/logo"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { ApiError, type AuthSession, apiRequest } from "@/lib/api"
import { getAuthenticatedEntryPath } from "@/lib/auth-navigation"

export const Route = createFileRoute("/")({ component: AppEntry })

function AppEntry() {
  const [error, setError] = useState(false)

  useEffect(() => {
    let active = true

    apiRequest<AuthSession>("/auth/me")
      .then((session) => {
        if (active) {
          window.location.replace(
            getAuthenticatedEntryPath(session.active_membership)
          )
        }
      })
      .catch((caught: unknown) => {
        if (!active) return

        if (caught instanceof ApiError && caught.status === 401) {
          window.location.replace("/login")
          return
        }

        if (caught instanceof ApiError && caught.status === 419) {
          window.location.replace("/login?expired=1")
          return
        }

        setError(true)
      })

    return () => {
      active = false
    }
  }, [])

  return (
    <main className="flex min-h-svh items-center justify-center bg-muted/20 px-4 py-10">
      <Card className="w-full max-w-md">
        <CardHeader>
          <div className="flex items-center gap-3">
            <LogoIcon className="size-10" />
            <p className="text-label text-muted-foreground">HadirinAja</p>
          </div>
          <CardTitle className="text-title">
            {error ? "Belum dapat membuka aplikasi" : "Menyiapkan aplikasi"}
          </CardTitle>
          <CardDescription>
            {error
              ? "Sesi belum dapat diperiksa. Buka halaman masuk atau muat ulang halaman ini."
              : "Memeriksa sesi dan menyiapkan halaman sesuai akses akun Anda."}
          </CardDescription>
        </CardHeader>
        {error && (
          <CardContent className="flex flex-col gap-4">
            <Alert variant="destructive">
              <AlertTitle>Koneksi belum tersedia</AlertTitle>
              <AlertDescription>
                Data akun tidak ditampilkan sampai sesi berhasil diperiksa.
              </AlertDescription>
            </Alert>
            <a
              className="text-body text-primary underline-offset-4 hover:underline"
              href="/login"
            >
              Buka halaman masuk
            </a>
          </CardContent>
        )}
        {!error && (
          <CardContent>
            <p className="text-body text-muted-foreground" role="status">
              Memeriksa sesi…
            </p>
          </CardContent>
        )}
      </Card>
    </main>
  )
}
