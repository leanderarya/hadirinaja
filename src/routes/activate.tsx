import { createFileRoute } from "@tanstack/react-router"
import { useEffect, useRef, useState } from "react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
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
import { Spinner } from "@/components/ui/spinner"
import { ApiError, type AuthSession, apiRequest } from "@/lib/api"

type InvitationSummary = {
  status: "pending" | "expired" | "revoked" | "accepted"
  invitee_email: string
  tenant: { name: string }
  inviter: { name: string }
  role: "employee" | "supervisor"
  employee: { name: string } | null
  outlets: Array<{ id: number; name: string }>
  expires_at: string
}

export const Route = createFileRoute("/activate")({
  head: () => ({ meta: [{ name: "referrer", content: "no-referrer" }] }),
  component: InvitationActivationPage,
})

function InvitationActivationPage() {
  const [token, setToken] = useState("")
  const tokenFromUrl = useRef<string | null>(null)
  const invitationInspection = useRef<Promise<
    [InvitationSummary, AuthSession | null]
  > | null>(null)
  const [invitation, setInvitation] = useState<InvitationSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")
  const [name, setName] = useState("")
  const [identifier, setIdentifier] = useState("")
  const [password, setPassword] = useState("")
  const [passwordConfirmation, setPasswordConfirmation] = useState("")
  const [authenticated, setAuthenticated] = useState(false)
  const [newAccountActivated, setNewAccountActivated] = useState(false)
  const [accepted, setAccepted] = useState(false)
  const [showExistingAccount, setShowExistingAccount] = useState(false)
  const [showPassword, setShowPassword] = useState(false)

  useEffect(() => {
    let value = tokenFromUrl.current
    if (value === null) {
      value = window.location.hash.slice(1)
      tokenFromUrl.current = value
      window.history.replaceState(
        window.history.state,
        "",
        `${window.location.pathname}${window.location.search}`
      )
    }
    setToken(value)
    if (!value) {
      setError("Tautan aktivasi tidak lengkap.")
      setLoading(false)
      return
    }

    let active = true
    invitationInspection.current ??= Promise.all([
      apiRequest<InvitationSummary>("/invitations/inspect", {
        method: "POST",
        body: { token: value },
      }),
      apiRequest<AuthSession>("/auth/me").catch(() => null),
    ])
    invitationInspection.current
      .then(([summary, session]) => {
        if (!active) return
        setInvitation(summary)
        setName(summary.employee?.name ?? "")
        setIdentifier(session?.user.email ?? summary.invitee_email)
        setAuthenticated(Boolean(session))
      })
      .catch((caught) => {
        if (active)
          setError(errorMessage(caught, "Tautan aktivasi tidak tersedia."))
      })
      .finally(() => {
        if (active) setLoading(false)
      })

    return () => {
      active = false
    }
  }, [])

  async function activateNewAccount(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setError("")
    setNotice("")
    try {
      await apiRequest("/invitations/activate", {
        method: "POST",
        body: {
          token,
          name,
          password,
          password_confirmation: passwordConfirmation,
        },
      })
      setNewAccountActivated(true)
      setPassword("")
      setPasswordConfirmation("")
      setToken("")
      setNotice(
        "Akun aktif! Masuk dengan email dan kata sandi yang baru Anda buat."
      )
    } catch (caught) {
      setError(errorMessage(caught, "Aktivasi akun tidak dapat diselesaikan."))
    } finally {
      setBusy(false)
    }
  }

  async function authenticateExistingAccount(
    event: React.FormEvent<HTMLFormElement>
  ) {
    event.preventDefault()
    setBusy(true)
    setError("")
    setNotice("")
    try {
      await apiRequest("/invitations/login", {
        method: "POST",
        body: { token, identifier, password },
      })
      setAuthenticated(true)
      setPassword("")
      setNotice(
        "Akun terautentikasi. Tinjau detail lalu pilih Terima undangan."
      )
    } catch (caught) {
      setError(
        errorMessage(
          caught,
          "Akun tidak dapat diautentikasi untuk undangan ini."
        )
      )
    } finally {
      setBusy(false)
    }
  }

  async function acceptInvitation() {
    setBusy(true)
    setError("")
    setNotice("")
    try {
      await apiRequest("/invitations/accept", {
        method: "POST",
        body: { token },
      })
      setAccepted(true)
      setNotice("Undangan diterima. Pilih organisasi untuk melanjutkan.")
    } catch (caught) {
      setError(
        errorMessage(caught, "Undangan tidak dapat diterima oleh akun ini.")
      )
    } finally {
      setBusy(false)
    }
  }

  if (loading) {
    return (
      <main className="flex min-h-svh items-center justify-center gap-3 text-body text-muted-foreground">
        <Spinner />
        Memeriksa undangan…
      </main>
    )
  }

  const passwordMismatch =
    Boolean(password && passwordConfirmation) &&
    password !== passwordConfirmation

  return (
    <main className="flex min-h-svh items-center justify-center bg-muted/20 px-4 py-10">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-title">Aktifkan akun Anda</CardTitle>
          <CardDescription>
            {invitation?.employee
              ? `Halo, ${invitation.employee.name}. Buat kata sandi untuk mulai absen di ${invitation.outlets[0]?.name ?? invitation.tenant.name}.`
              : invitation
                ? `Buat kata sandi untuk masuk ke ${invitation.tenant.name}.`
                : ""}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          {error ? (
            <Alert variant="destructive">
              <AlertTitle>Undangan belum dapat diproses</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          {notice && !newAccountActivated ? (
            <Alert>
              <AlertTitle>Status aktivasi</AlertTitle>
              <AlertDescription>{notice}</AlertDescription>
            </Alert>
          ) : null}

          {invitation ? (
            <details className="rounded-xl border px-4 py-3">
              <summary className="cursor-pointer text-label">
                Detail undangan
              </summary>
              <div className="mt-4 flex flex-col gap-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <Info label="Organisasi" value={invitation.tenant.name} />
                  <Info label="Diundang oleh" value={invitation.inviter.name} />
                  <Info label="Peran" value={roleLabel(invitation.role)} />
                  <Info label="Akun tujuan" value={invitation.invitee_email} />
                  {invitation.employee ? (
                    <Info
                      label="Identitas karyawan"
                      value={invitation.employee.name}
                    />
                  ) : null}
                </div>
                {invitation.outlets.length ? (
                  <Info
                    label="Outlet yang dapat diakses"
                    value={invitation.outlets
                      .map((outlet) => outlet.name)
                      .join(", ")}
                  />
                ) : null}
                <Info
                  label="Berlaku sampai"
                  value={formatDate(invitation.expires_at)}
                />
              </div>
            </details>
          ) : null}
          {invitation && invitation.status !== "pending" ? (
            <p className="text-body">
              {invitation.status === "expired"
                ? "Tautan ini sudah kedaluwarsa. Minta Owner mengirim tautan baru."
                : invitation.status === "revoked"
                  ? "Tautan ini sudah dibatalkan. Minta Owner mengirim tautan baru."
                  : "Tautan ini sudah dipakai. Silakan masuk."}
            </p>
          ) : null}

          {invitation?.status === "pending" &&
          !newAccountActivated &&
          !accepted ? (
            authenticated ? (
              <section className="flex flex-col gap-3 rounded-2xl border p-4">
                <div>
                  <h2 className="text-label">Terima akses dengan akun ini</h2>
                  <p className="text-caption text-muted-foreground">
                    Menerima undangan akan menambahkan keanggotaan Anda di
                    organisasi tersebut.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    disabled={busy}
                    onClick={() => void acceptInvitation()}
                    type="button"
                  >
                    {busy ? <Spinner data-icon="inline-start" /> : null}
                    Terima undangan
                  </Button>
                  <Button
                    onClick={() => setAuthenticated(false)}
                    type="button"
                    variant="outline"
                  >
                    Gunakan akun lain
                  </Button>
                </div>
              </section>
            ) : null
          ) : null}

          {invitation?.status === "pending" &&
          !authenticated &&
          !newAccountActivated &&
          !accepted ? (
            <div className="flex flex-col gap-4">
              {!showExistingAccount ? (
                <form
                  className="flex flex-col gap-4"
                  onSubmit={activateNewAccount}
                >
                  <FieldGroup className="gap-4">
                    <Field>
                      <FieldLabel htmlFor="activation-name">
                        Nama lengkap
                      </FieldLabel>
                      <Input
                        autoComplete="name"
                        id="activation-name"
                        onChange={(event) => setName(event.target.value)}
                        required
                        value={name}
                      />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="activation-email">
                        Email akun
                      </FieldLabel>
                      <Input
                        autoComplete="email"
                        id="activation-email"
                        readOnly
                        value={invitation.invitee_email}
                      />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="activation-password">
                        Kata sandi baru
                      </FieldLabel>
                      <Input
                        autoComplete="new-password"
                        id="activation-password"
                        onChange={(event) => setPassword(event.target.value)}
                        required
                        type={showPassword ? "text" : "password"}
                        value={password}
                      />
                      <FieldDescription>Minimal 8 karakter.</FieldDescription>
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="activation-password-confirmation">
                        Ulangi kata sandi
                      </FieldLabel>
                      <Input
                        autoComplete="new-password"
                        id="activation-password-confirmation"
                        onChange={(event) =>
                          setPasswordConfirmation(event.target.value)
                        }
                        required
                        type={showPassword ? "text" : "password"}
                        value={passwordConfirmation}
                      />
                      {passwordMismatch ? (
                        <FieldDescription>
                          Kata sandi belum sama.
                        </FieldDescription>
                      ) : null}
                    </Field>
                  </FieldGroup>
                  <label className="flex items-center gap-2 text-body">
                    <input
                      checked={showPassword}
                      onChange={(event) =>
                        setShowPassword(event.target.checked)
                      }
                      type="checkbox"
                    />
                    Tampilkan kata sandi
                  </label>
                  <Button
                    className="w-full"
                    disabled={busy || passwordMismatch}
                    type="submit"
                  >
                    {busy ? <Spinner data-icon="inline-start" /> : null}
                    Aktifkan akun
                  </Button>
                </form>
              ) : (
                <form
                  className="flex flex-col gap-4"
                  onSubmit={authenticateExistingAccount}
                >
                  <div>
                    <h2 className="text-label">Masuk dengan akun Anda</h2>
                    <p className="text-caption text-muted-foreground">
                      Gunakan akun yang akan menerima undangan ini.
                    </p>
                  </div>
                  <FieldGroup className="gap-4">
                    <Field>
                      <FieldLabel htmlFor="existing-identifier">
                        Email atau nomor telepon
                      </FieldLabel>
                      <Input
                        autoComplete="username"
                        id="existing-identifier"
                        onChange={(event) => setIdentifier(event.target.value)}
                        required
                        value={identifier}
                      />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="existing-password">
                        Kata sandi
                      </FieldLabel>
                      <Input
                        autoComplete="current-password"
                        id="existing-password"
                        onChange={(event) => setPassword(event.target.value)}
                        required
                        type="password"
                        value={password}
                      />
                    </Field>
                  </FieldGroup>
                  <Button disabled={busy} type="submit" variant="outline">
                    {busy ? <Spinner data-icon="inline-start" /> : null}
                    Masuk
                  </Button>
                </form>
              )}
              {!authenticated ? (
                <Button
                  className="w-full"
                  onClick={() => setShowExistingAccount(!showExistingAccount)}
                  type="button"
                  variant="link"
                >
                  {showExistingAccount
                    ? "Kembali buat akun"
                    : "Sudah punya akun HadirinAja? Masuk di sini"}
                </Button>
              ) : null}
            </div>
          ) : null}

          {newAccountActivated ? (
            <>
              <p className="text-body">{notice}</p>
              <Button
                className="w-full"
                render={<a href="/login?activated=1" />}
              >
                Masuk sekarang
              </Button>
            </>
          ) : null}
          {accepted ? (
            <Button render={<a href="/select-tenant" />}>
              Pilih organisasi
            </Button>
          ) : null}
          {!invitation ? (
            <Button
              onClick={() => window.location.assign("/login")}
              variant="outline"
            >
              Kembali ke halaman masuk
            </Button>
          ) : null}
        </CardContent>
      </Card>
    </main>
  )
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1">
      <p className="text-caption text-muted-foreground">{label}</p>
      <p className="break-words text-label">{value}</p>
    </div>
  )
}

function roleLabel(role: InvitationSummary["role"]): string {
  return role === "employee" ? "Karyawan" : "Supervisor"
}

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError) {
    if (error.status === 404)
      return "Undangan tidak tersedia atau tautannya tidak valid."
    if (error.status === 410)
      return "Undangan sudah kedaluwarsa, dibatalkan, atau digunakan."
    return error.message
  }
  return fallback
}

function formatDate(value: string): string {
  return new Date(value).toLocaleString("id-ID", {
    dateStyle: "medium",
    timeStyle: "short",
  })
}
