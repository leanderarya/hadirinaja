import { createFileRoute } from "@tanstack/react-router"
import { useCallback, useEffect, useRef, useState } from "react"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { ApiError, apiRequest } from "@/lib/api"

type Summary = { email: string; expires_at: string; role_unchanged: boolean }
export const Route = createFileRoute("/reset-password")({
  head: () => ({ meta: [{ name: "referrer", content: "no-referrer" }] }),
  component: ResetPasswordPage,
})
function ResetPasswordPage() {
  const value = useRef<string | null>(null)
  const inspection = useRef<Promise<Summary> | null>(null)
  const [summary, setSummary] = useState<Summary | null>(null)
  const [token, setToken] = useState("")
  const [password, setPassword] = useState("")
  const [confirmation, setConfirmation] = useState("")
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [done, setDone] = useState(false)
  const failure = useCallback((e: unknown) => {
    setError(
      e instanceof ApiError && e.errors
        ? Object.values(e.errors).flat().join(" ")
        : e instanceof Error
          ? e.message
          : "Tautan reset tidak tersedia."
    )
  }, [])
  useEffect(() => {
    if (value.current === null) {
      value.current = window.location.hash.slice(1)
      window.history.replaceState(
        window.history.state,
        "",
        window.location.pathname
      )
    }
    const captured = value.current
    if (!/^[a-f0-9]{64}$/.test(captured)) {
      setError("Tautan reset tidak lengkap atau tidak valid.")
      setLoading(false)
      return
    }
    setToken(captured)
    let active = true
    inspection.current ??= apiRequest<Summary>("/password-resets/inspect", {
      method: "POST",
      body: { token: captured },
    })
    inspection.current
      .then((s) => {
        if (active) setSummary(s)
      })
      .catch((e) => {
        if (active) failure(e)
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [failure])
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (busy || !summary) return
    setBusy(true)
    setError("")
    try {
      await apiRequest("/password-resets/complete", {
        method: "POST",
        body: { token, password, password_confirmation: confirmation },
      })
      setDone(true)
      setToken("")
      value.current = ""
      inspection.current = null
      setSummary(null)
    } catch (e) {
      failure(e)
    } finally {
      setPassword("")
      setConfirmation("")
      setBusy(false)
    }
  }
  return (
    <main className="flex min-h-dvh items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Reset password HadirinAja</CardTitle>
          <CardDescription>
            Isi password baru sendiri. Tautan hanya dapat digunakan sekali.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {loading && <p role="status">Memeriksa tautan…</p>}
          {error && (
            <Alert variant="destructive">
              <AlertDescription role="alert">{error}</AlertDescription>
            </Alert>
          )}
          {done ? (
            <>
              <Alert>
                <AlertDescription role="status">
                  Password berhasil diganti. Sesi lama sudah dicabut. Role dan
                  data tetap; bila akses dicabut, minta Owner mengaktifkannya
                  kembali.
                </AlertDescription>
              </Alert>
              <a className="text-body underline" href="/login">
                Masuk ke HadirinAja
              </a>
            </>
          ) : (
            summary && (
              <form onSubmit={(e) => void submit(e)}>
                <FieldGroup>
                  <p className="text-body">Akun: {summary.email}</p>
                  <Field>
                    <FieldLabel htmlFor="reset-new-password">
                      Password baru
                    </FieldLabel>
                    <Input
                      id="reset-new-password"
                      type="password"
                      autoComplete="new-password"
                      minLength={8}
                      maxLength={255}
                      required
                      value={password}
                      disabled={busy}
                      onChange={(e) => setPassword(e.target.value)}
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="reset-confirm-password">
                      Konfirmasi password baru
                    </FieldLabel>
                    <Input
                      id="reset-confirm-password"
                      type="password"
                      autoComplete="new-password"
                      minLength={8}
                      maxLength={255}
                      required
                      value={confirmation}
                      disabled={busy}
                      onChange={(e) => setConfirmation(e.target.value)}
                    />
                  </Field>
                  <Button
                    type="submit"
                    disabled={
                      busy || password.length < 8 || password !== confirmation
                    }
                  >
                    {busy ? "Menyimpan…" : "Simpan password baru"}
                  </Button>
                </FieldGroup>
              </form>
            )
          )}
        </CardContent>
      </Card>
    </main>
  )
}
