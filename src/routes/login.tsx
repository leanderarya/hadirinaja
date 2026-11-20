import { createFileRoute } from "@tanstack/react-router"
import { useEffect, useState } from "react"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { type AuthSession, apiRequest } from "@/lib/api"
import { getAuthenticatedEntryPath } from "@/lib/auth-navigation"

export const Route = createFileRoute("/login")({ component: LoginPage })

function LoginPage() {
  const [identifier, setIdentifier] = useState("")
  const [password, setPassword] = useState("")
  const [loading, setLoading] = useState(false)
  const [checkingSession, setCheckingSession] = useState(true)
  const [error, setError] = useState("")
  const [expired, setExpired] = useState(false)

  useEffect(() => {
    let active = true
    setExpired(new URLSearchParams(window.location.search).has("expired"))

    apiRequest<AuthSession>("/auth/me")
      .then((session) => {
        if (active) {
          window.location.assign(
            getAuthenticatedEntryPath(session.active_membership)
          )
        }
      })
      .catch(() => undefined)
      .finally(() => {
        if (active) setCheckingSession(false)
      })

    return () => {
      active = false
    }
  }, [])

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setLoading(true)
    setError("")

    try {
      const session = await apiRequest<AuthSession>("/auth/login", {
        method: "POST",
        body: { identifier, password },
      })
      window.location.assign(
        getAuthenticatedEntryPath(session.active_membership)
      )
    } catch {
      setError("Email/nomor telepon atau kata sandi tidak valid. Coba lagi.")
      setLoading(false)
    }
  }

  return (
    <main className="flex min-h-svh items-center justify-center bg-muted/20 px-4 py-10">
      <Card className="w-full max-w-md">
        <CardHeader>
          <p className="text-label text-muted-foreground">HadirinAja</p>
          <CardTitle className="text-title">Masuk ke akun</CardTitle>
          <CardDescription>
            Gunakan email atau nomor telepon yang terdaftar.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {expired && (
            <p
              className="mb-5 rounded-2xl border border-border bg-muted/40 px-4 py-3 text-body"
              role="status"
            >
              Sesi Anda berakhir. Silakan masuk kembali.
            </p>
          )}
          <form className="space-y-6" onSubmit={submit}>
            <FieldGroup className="gap-4">
              <Field>
                <FieldLabel htmlFor="identifier">
                  Email atau nomor telepon
                </FieldLabel>
                <Input
                  autoComplete="username"
                  autoFocus
                  id="identifier"
                  name="identifier"
                  onChange={(event) => setIdentifier(event.target.value)}
                  required
                  value={identifier}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="password">Kata sandi</FieldLabel>
                <Input
                  autoComplete="current-password"
                  id="password"
                  name="password"
                  onChange={(event) => setPassword(event.target.value)}
                  required
                  type="password"
                  value={password}
                />
              </Field>
            </FieldGroup>
            {error && (
              <p className="text-body text-destructive" role="alert">
                {error}
              </p>
            )}
            <Button
              className="w-full"
              disabled={loading || checkingSession}
              isLoading={loading}
              type="submit"
            >
              {loading ? "Memeriksa akun…" : "Masuk"}
            </Button>
            <p
              aria-live="polite"
              className="text-caption text-muted-foreground"
            >
              {checkingSession
                ? "Memeriksa sesi…"
                : "Sesi dilindungi dan dikelola oleh server."}
            </p>
          </form>
        </CardContent>
      </Card>
    </main>
  )
}
