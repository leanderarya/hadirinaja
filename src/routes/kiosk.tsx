import { createFileRoute } from "@tanstack/react-router"
import { useCallback, useEffect, useState } from "react"

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
import { ApiError, apiRequest } from "@/lib/api"

export const Route = createFileRoute("/kiosk")({ component: KioskPage })

type KioskStatus = {
  status: "ready"
  device: { id: number; name: string }
  tenant: { id: number; name: string }
  outlet: { id: number; name: string }
}

function KioskPage() {
  const [status, setStatus] = useState<KioskStatus | null>(null)
  const [state, setState] = useState<
    "loading" | "unpaired" | "ready" | "revoked"
  >("loading")
  const [pairingCode, setPairingCode] = useState("")
  const [enrollmentCode, setEnrollmentCode] = useState("")
  const [pin, setPin] = useState("")
  const [pinConfirmation, setPinConfirmation] = useState("")
  const [employeeId, setEmployeeId] = useState("")
  const [verifyPin, setVerifyPin] = useState("")
  const [verifiedEmployee, setVerifiedEmployee] = useState("")
  const [message, setMessage] = useState("")
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)

  const loadStatus = useCallback(async () => {
    try {
      const result = await apiRequest<KioskStatus>("/kiosk/status")
      setStatus(result)
      setState("ready")
    } catch (caught) {
      setStatus(null)
      if (caught instanceof ApiError && caught.code === "kiosk_revoked") {
        setState("revoked")
      } else {
        setState("unpaired")
      }
    }
  }, [])

  useEffect(() => {
    void loadStatus()
  }, [loadStatus])

  async function submitPairing(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setError("")
    setMessage("")

    try {
      await apiRequest("/kiosk/pair", {
        method: "POST",
        body: { code: pairingCode },
      })
      setPairingCode("")
      setMessage("Perangkat berhasil dipasangkan.")
      await loadStatus()
    } catch {
      setError("Kode pemasangan tidak valid atau sudah kedaluwarsa.")
    } finally {
      setBusy(false)
    }
  }

  async function submitEnrollment(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setError("")
    setMessage("")

    try {
      await apiRequest("/kiosk/pin/enroll", {
        method: "POST",
        body: { code: enrollmentCode, pin, pin_confirmation: pinConfirmation },
      })
      setEnrollmentCode("")
      setPin("")
      setPinConfirmation("")
      setMessage("PIN berhasil diatur. Karyawan dapat menutup layar ini.")
    } catch {
      setError(
        "PIN belum dapat diatur. Periksa kode, format PIN, dan kecocokan kedua PIN."
      )
    } finally {
      setBusy(false)
    }
  }

  async function submitVerification(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setError("")
    setMessage("")
    setVerifiedEmployee("")

    try {
      const result = await apiRequest<{
        verified: true
        employee: { id: number; name: string }
      }>("/kiosk/pin/verify", {
        method: "POST",
        body: { employee_id: Number(employeeId), pin: verifyPin },
      })
      setVerifiedEmployee(result.employee.name)
      setVerifyPin("")
      setMessage("Identitas berhasil diverifikasi.")
    } catch {
      setVerifyPin("")
      setError("Identitas atau PIN tidak valid, atau percobaan terlalu sering.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="flex min-h-svh items-center justify-center bg-muted/20 px-4 py-8 sm:px-8">
      <div className="w-full max-w-3xl space-y-5">
        <header className="space-y-2 text-center">
          <p className="text-label text-muted-foreground">HadirinAja · Kiosk</p>
          <h1 className="text-title">Akses perangkat</h1>
          <p className="text-body text-muted-foreground">
            Perangkat ini terhubung ke satu outlet dan tidak dapat membuka ruang
            kerja manajemen.
          </p>
        </header>

        {error && (
          <p
            className="rounded-2xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-body text-destructive"
            role="alert"
          >
            {error}
          </p>
        )}
        {message && (
          <p
            className="rounded-2xl border border-border bg-card px-4 py-3 text-body"
            role="status"
          >
            {message}
          </p>
        )}

        {state === "loading" && (
          <p
            className="py-10 text-center text-body text-muted-foreground"
            role="status"
          >
            Memeriksa perangkat…
          </p>
        )}
        {state === "revoked" && (
          <Card>
            <CardHeader>
              <CardTitle>Akses perangkat dicabut</CardTitle>
              <CardDescription>
                Hubungi Owner untuk mendaftarkan perangkat ini kembali.
              </CardDescription>
            </CardHeader>
          </Card>
        )}
        {state === "unpaired" && (
          <Card>
            <CardHeader>
              <CardTitle>Pasangkan perangkat</CardTitle>
              <CardDescription>
                Minta Owner membuat kode pemasangan untuk outlet ini. Kode
                berlaku selama lima menit dan hanya dapat digunakan sekali.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form className="space-y-5" onSubmit={submitPairing}>
                <Field>
                  <FieldLabel htmlFor="pairing-code">
                    Kode pemasangan
                  </FieldLabel>
                  <Input
                    autoComplete="one-time-code"
                    autoCapitalize="characters"
                    className="h-12 text-center font-mono text-title tracking-widest"
                    id="pairing-code"
                    maxLength={12}
                    onChange={(event) =>
                      setPairingCode(event.target.value.toUpperCase())
                    }
                    required
                    value={pairingCode}
                  />
                </Field>
                <Button
                  className="h-12 w-full"
                  disabled={busy}
                  isLoading={busy}
                  size="lg"
                  type="submit"
                >
                  Pasangkan kiosk
                </Button>
              </form>
            </CardContent>
          </Card>
        )}
        {state === "ready" && status && (
          <div className="space-y-5">
            <Card>
              <CardHeader>
                <CardTitle>Perangkat siap</CardTitle>
                <CardDescription>
                  {status.device.name} · {status.outlet.name} ·{" "}
                  {status.tenant.name}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-caption text-muted-foreground">
                  Kiosk ini hanya dapat memverifikasi PIN karyawan yang aktif
                  dan ditugaskan pada outlet tersebut.
                </p>
              </CardContent>
            </Card>

            <div className="grid gap-5 md:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle>Atur PIN karyawan</CardTitle>
                  <CardDescription>
                    Karyawan memasukkan PIN baru sendiri menggunakan kode
                    aktivasi dari Owner.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <form className="space-y-4" onSubmit={submitEnrollment}>
                    <FieldGroup className="gap-4">
                      <Field>
                        <FieldLabel htmlFor="enrollment-code">
                          Kode aktivasi
                        </FieldLabel>
                        <Input
                          autoComplete="one-time-code"
                          className="h-11 font-mono tracking-widest"
                          id="enrollment-code"
                          maxLength={12}
                          onChange={(event) =>
                            setEnrollmentCode(event.target.value.toUpperCase())
                          }
                          required
                          value={enrollmentCode}
                        />
                      </Field>
                      <Field>
                        <FieldLabel htmlFor="new-pin">
                          PIN baru · 6–8 angka
                        </FieldLabel>
                        <Input
                          autoComplete="new-password"
                          className="h-11"
                          id="new-pin"
                          inputMode="numeric"
                          maxLength={8}
                          onChange={(event) => setPin(event.target.value)}
                          pattern="[0-9]{6,8}"
                          required
                          type="password"
                          value={pin}
                        />
                      </Field>
                      <Field>
                        <FieldLabel htmlFor="pin-confirmation">
                          Ulangi PIN
                        </FieldLabel>
                        <Input
                          autoComplete="new-password"
                          className="h-11"
                          id="pin-confirmation"
                          inputMode="numeric"
                          maxLength={8}
                          onChange={(event) =>
                            setPinConfirmation(event.target.value)
                          }
                          pattern="[0-9]{6,8}"
                          required
                          type="password"
                          value={pinConfirmation}
                        />
                      </Field>
                    </FieldGroup>
                    <Button
                      className="h-11 w-full"
                      disabled={busy}
                      isLoading={busy}
                      type="submit"
                      variant="outline"
                    >
                      Simpan PIN
                    </Button>
                  </form>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Verifikasi PIN</CardTitle>
                  <CardDescription>
                    Verifikasi identitas terbatas untuk persiapan alur kehadiran
                    mendatang.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <form className="space-y-4" onSubmit={submitVerification}>
                    <FieldGroup className="gap-4">
                      <Field>
                        <FieldLabel htmlFor="employee-id">
                          ID karyawan
                        </FieldLabel>
                        <Input
                          id="employee-id"
                          inputMode="numeric"
                          min="1"
                          onChange={(event) =>
                            setEmployeeId(event.target.value)
                          }
                          required
                          type="number"
                          value={employeeId}
                        />
                      </Field>
                      <Field>
                        <FieldLabel htmlFor="verify-pin">PIN</FieldLabel>
                        <Input
                          autoComplete="off"
                          className="h-11"
                          id="verify-pin"
                          inputMode="numeric"
                          maxLength={8}
                          onChange={(event) => setVerifyPin(event.target.value)}
                          pattern="[0-9]{6,8}"
                          required
                          type="password"
                          value={verifyPin}
                        />
                      </Field>
                    </FieldGroup>
                    <Button
                      className="h-11 w-full"
                      disabled={busy}
                      isLoading={busy}
                      type="submit"
                    >
                      Verifikasi
                    </Button>
                  </form>
                  {verifiedEmployee && (
                    <p
                      className="rounded-2xl bg-muted/40 px-4 py-3 text-label"
                      role="status"
                    >
                      Terverifikasi: {verifiedEmployee}
                    </p>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>
        )}
        <p className="text-center text-caption text-muted-foreground">
          Belum ada pencatatan hadir atau pulang pada tahap ini.
        </p>
      </div>
    </main>
  )
}
