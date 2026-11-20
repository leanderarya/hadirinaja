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
        "Akun dan akses organisasi berhasil diaktifkan. Masuk untuk melanjutkan."
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

  return (
    <main className="flex min-h-svh items-center justify-center bg-muted/20 px-4 py-10">
      <Card className="w-full max-w-2xl">
        <CardHeader>
          <p className="text-label text-muted-foreground">HadirinAja</p>
          <CardTitle className="text-title">
            Aktivasi akses organisasi
          </CardTitle>
          <CardDescription>
            Tinjau organisasi dan peran sebelum membuat akun atau menerima
            akses.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          {error ? (
            <Alert variant="destructive">
              <AlertTitle>Undangan belum dapat diproses</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          {notice ? (
            <Alert>
              <AlertTitle>Status aktivasi</AlertTitle>
              <AlertDescription>{notice}</AlertDescription>
            </Alert>
          ) : null}

          {invitation ? (
            <section
              className="flex flex-col gap-3 rounded-2xl border bg-muted/30 p-4"
              aria-label="Detail undangan"
            >
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
              {invitation.status !== "pending" ? (
                <Alert
                  variant={
                    invitation.status === "revoked" ? "destructive" : "default"
                  }
                >
                  <AlertTitle>{statusLabel(invitation.status)}</AlertTitle>
                  <AlertDescription>
                    {invitation.status === "expired"
                      ? "Minta Owner menerbitkan ulang undangan."
                      : invitation.status === "revoked"
                        ? "Minta Owner organisasi membuat undangan baru."
                        : "Undangan ini sudah pernah digunakan."}
                  </AlertDescription>
                </Alert>
              ) : null}
            </section>
          ) : null}

          {invitation?.status === "pending" &&
          !newAccountActivated &&
          !accepted ? (
            authenticated ? (
              <section className="flex flex-col gap-3 rounded-2xl border p-4">
                <div>
                  <h2 className="text-label">Terima akses dengan akun ini</h2>
                  <p className="text-caption text-muted-foreground">
            Menerima undangan akan menambahkan keanggotaan Anda di organisasi tersebut.
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
            <div className="grid gap-5 md:grid-cols-2">
              <form
                className="flex flex-col gap-4 rounded-2xl border p-4"
                onSubmit={activateNewAccount}
              >
                <div>
                  <h2 className="text-label">Buat akun baru</h2>
                  <p className="text-caption text-muted-foreground">
                    Buat kata sandi Anda sendiri untuk alamat undangan.
                  </p>
                </div>
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
                      type="password"
                      value={password}
                    />
                    <FieldDescription>
                      Gunakan kata sandi yang memenuhi aturan keamanan aplikasi.
                    </FieldDescription>
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
                      type="password"
                      value={passwordConfirmation}
                    />
                  </Field>
                </FieldGroup>
                <Button disabled={busy} type="submit">
                  {busy ? <Spinner data-icon="inline-start" /> : null}
                  Buat akun dan aktifkan
                </Button>
              </form>

              <form
                className="flex flex-col gap-4 rounded-2xl border p-4"
                onSubmit={authenticateExistingAccount}
              >
                <div>
                  <h2 className="text-label">Sudah punya akun?</h2>
                  <p className="text-caption text-muted-foreground">
                    Masuk menggunakan akun penerima sebelum menerima akses.
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
                  Masuk ke akun penerima
                </Button>
              </form>
            </div>
          ) : null}

          {newAccountActivated ? (
            <Button render={<a href="/login?activated=1" />}>
              Masuk ke HadirinAja
            </Button>
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

function statusLabel(status: InvitationSummary["status"]): string {
  return {
    pending: "Menunggu aktivasi",
    expired: "Undangan kedaluwarsa",
    revoked: "Undangan dibatalkan",
    accepted: "Undangan sudah digunakan",
  }[status]
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
