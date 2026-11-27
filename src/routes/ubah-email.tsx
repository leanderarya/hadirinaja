import { createFileRoute } from "@tanstack/react-router"
import { useCallback, useEffect, useRef, useState } from "react"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { ApiError, apiRequest } from "@/lib/api"

type LinkSummary = { email_masked: string; expires_at: string }

const unavailableMessage =
  "Tautan sudah kedaluwarsa, digunakan, atau dicabut. Minta pengelola menerbitkan tautan baru."

export const Route = createFileRoute("/ubah-email")({
  head: () => ({
    meta: [
      { title: "Ubah email | HadirinAja" },
      { name: "referrer", content: "no-referrer" },
    ],
  }),
  component: ChangeEmailPage,
})

function ChangeEmailPage() {
  const tokenRef = useRef<string | null>(null)
  const inspection = useRef<Promise<LinkSummary> | null>(null)
  const [token, setToken] = useState("")
  const [summary, setSummary] = useState<LinkSummary | null>(null)
  const [email, setEmail] = useState("")
  const [emailConfirmation, setEmailConfirmation] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [done, setDone] = useState(false)

  const failure = useCallback((caught: unknown) => {
    if (caught instanceof ApiError && caught.status === 410) {
      setError(unavailableMessage)
      return
    }
    setError(
      caught instanceof ApiError && caught.errors
        ? Object.values(caught.errors).flat().join(" ")
        : caught instanceof Error
          ? caught.message
          : "Tautan ubah email tidak tersedia."
    )
  }, [])

  useEffect(() => {
    if (tokenRef.current === null) {
      const fragment = new URLSearchParams(window.location.hash.slice(1))
      tokenRef.current = fragment.get("token") ?? ""
      window.history.replaceState(
        window.history.state,
        "",
        `${window.location.pathname}${window.location.search}`
      )
    }

    const captured = tokenRef.current
    if (!/^[a-f0-9]{64}$/.test(captured)) {
      setError("Tautan ubah email tidak lengkap atau tidak valid.")
      setLoading(false)
      return
    }

    setToken(captured)
    let active = true
    inspection.current ??= apiRequest<LinkSummary>(
      "/email-change-links/inspect",
      {
        method: "POST",
        body: { token: captured },
      }
    )
    inspection.current
      .then((linkSummary) => {
        if (active) setSummary(linkSummary)
      })
      .catch((caught) => {
        if (active) failure(caught)
      })
      .finally(() => {
        if (active) setLoading(false)
      })

    return () => {
      active = false
    }
  }, [failure])

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy || !summary) return
    const normalizedEmail = email.trim().toLowerCase()
    const normalizedConfirmation = emailConfirmation.trim().toLowerCase()
    if (normalizedEmail !== normalizedConfirmation) {
      setError("Konfirmasi email harus sama dengan email baru.")
      return
    }

    setBusy(true)
    setError("")
    try {
      await apiRequest("/email-change-links/consume", {
        method: "POST",
        body: {
          token,
          email: normalizedEmail,
          email_confirmation: normalizedConfirmation,
          password,
        },
      })
      setDone(true)
      setToken("")
      tokenRef.current = ""
      inspection.current = null
      setSummary(null)
      setEmail("")
      setEmailConfirmation("")
    } catch (caught) {
      failure(caught)
    } finally {
      setPassword("")
      setBusy(false)
    }
  }

  return (
    <main className="flex min-h-dvh items-center justify-center bg-canvas p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Ubah email HadirinAja</CardTitle>
          <CardDescription>
            Isi email baru dan password saat ini untuk menyelesaikan perubahan.
            Tautan hanya dapat digunakan sekali.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {loading ? <p role="status">Memeriksa tautan ubah email…</p> : null}
          {error ? (
            <Alert variant="destructive">
              <AlertDescription role="alert">{error}</AlertDescription>
            </Alert>
          ) : null}
          {done ? (
            <>
              <Alert>
                <AlertDescription role="status">
                  Email berhasil diganti. Sesi dan tautan reset password lama
                  sudah dicabut. Masuk kembali dengan email baru.
                </AlertDescription>
              </Alert>
              <a className="text-body underline" href="/login">
                Masuk ke HadirinAja
              </a>
            </>
          ) : summary ? (
            <form onSubmit={(event) => void submit(event)}>
              <FieldGroup>
                <p className="text-body">Akun: {summary.email_masked}</p>
                <Field>
                  <FieldLabel htmlFor="change-email-new">Email baru</FieldLabel>
                  <Input
                    id="change-email-new"
                    type="email"
                    autoComplete="email"
                    maxLength={255}
                    required
                    value={email}
                    disabled={busy}
                    onChange={(event) => setEmail(event.target.value)}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="change-email-confirmation">
                    Konfirmasi email baru
                  </FieldLabel>
                  <Input
                    id="change-email-confirmation"
                    type="email"
                    autoComplete="email"
                    maxLength={255}
                    required
                    value={emailConfirmation}
                    disabled={busy}
                    onChange={(event) =>
                      setEmailConfirmation(event.target.value)
                    }
                  />
                  <FieldDescription>
                    Tautan berlaku sampai{" "}
                    {new Date(summary.expires_at).toLocaleString("id-ID", {
                      timeZone: "Asia/Jakarta",
                    })}{" "}
                    WIB.
                  </FieldDescription>
                </Field>
                <Field>
                  <FieldLabel htmlFor="change-email-password">
                    Password saat ini
                  </FieldLabel>
                  <Input
                    id="change-email-password"
                    type="password"
                    autoComplete="current-password"
                    required
                    maxLength={255}
                    value={password}
                    disabled={busy}
                    onChange={(event) => setPassword(event.target.value)}
                  />
                </Field>
                <Button type="submit" disabled={busy}>
                  {busy ? "Menyimpan…" : "Simpan email baru"}
                </Button>
              </FieldGroup>
            </form>
          ) : null}
        </CardContent>
      </Card>
    </main>
  )
}
