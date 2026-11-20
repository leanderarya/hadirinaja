import { useId, useState } from "react"
import { Alert, AlertDescription } from "@/components/ui/alert"
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Separator } from "@/components/ui/separator"
import { ApiError, apiRequest } from "@/lib/api"
import { passwordResetLink } from "@/lib/password-reset-link"

type IssuedReset = {
  reset_token: string
  reset_id: number
  email: string
  expires_at: string
}
export function OwnerPasswordReset({
  membership,
  email,
}: {
  membership: number
  email: string
}) {
  const uid = useId()
  const [password, setPassword] = useState("")
  const [issued, setIssued] = useState<IssuedReset | null>(null)
  const [link, setLink] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [confirmation, setConfirmation] = useState<"issue" | "revoke" | null>(
    null
  )
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")
  function failed(e: unknown) {
    setError(
      e instanceof ApiError && e.errors
        ? Object.values(e.errors).flat().join(" ")
        : e instanceof Error
          ? e.message
          : "Reset password gagal diproses."
    )
  }
  async function execute() {
    if (pending || !confirmation || !password) return
    setPending(true)
    setError("")
    setNotice("")
    try {
      if (confirmation === "issue") {
        setLink(null)
        const result = await apiRequest<IssuedReset>(
          `/management/access/members/${membership}/password-reset`,
          { method: "POST", body: { password } }
        )
        const url = passwordResetLink(
          window.location.origin,
          result.reset_token
        )
        setIssued({ ...result, reset_token: "" })
        setLink(url)
        if (!url)
          throw Error(
            "Tautan harus dibuka melalui HTTPS. Terbitkan ulang pada alamat yang benar."
          )
        setNotice(
          "Tautan baru siap. Tautan reset sebelumnya sudah tidak berlaku."
        )
      } else if (issued) {
        await apiRequest(
          `/management/access/password-resets/${issued.reset_id}/revoke`,
          { method: "POST", body: { password } }
        )
        setIssued(null)
        setLink(null)
        setNotice("Tautan reset sudah dicabut.")
      }
    } catch (e) {
      failed(e)
    } finally {
      setPassword("")
      setPending(false)
      setConfirmation(null)
    }
  }
  async function copy() {
    if (!link) return
    try {
      await navigator.clipboard.writeText(link)
      setNotice("Tautan reset disalin. Bagikan hanya kepada pemilik akun.")
    } catch {
      setError("Tidak dapat menyalin. Salin tautan yang tampil secara manual.")
    }
  }
  return (
    <section className="flex flex-col gap-4" aria-label="Reset password akun">
      <h3 className="text-subtitle">Reset password</h3>
      <p className="text-caption text-muted-foreground">
        Buat tautan sekali pakai untuk {email}. Pemilik akun mengisi password
        baru sendiri. Data dan role tetap; akses yang dicabut harus diaktifkan
        kembali secara terpisah. Sesi lama dicabut setelah password diganti.
      </p>
      {error && (
        <Alert variant="destructive">
          <AlertDescription role="alert">{error}</AlertDescription>
        </Alert>
      )}
      {notice && (
        <Alert>
          <AlertDescription role="status">{notice}</AlertDescription>
        </Alert>
      )}
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor={`${uid}-reset-password`}>
            Password Owner untuk reset
          </FieldLabel>
          <Input
            id={`${uid}-reset-password`}
            type="password"
            autoComplete="current-password"
            value={password}
            disabled={pending}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>
        <Button
          type="button"
          variant="outline"
          disabled={pending || !password}
          onClick={() => setConfirmation("issue")}
        >
          {issued
            ? "Buat tautan reset pengganti"
            : "Buat tautan reset password"}
        </Button>
        {issued && (
          <>
            <p className="text-caption">
              Berlaku sampai{" "}
              {new Date(issued.expires_at).toLocaleString("id-ID", {
                timeZone: "Asia/Jakarta",
              })}{" "}
              WIB.
            </p>
            {link && (
              <>
                <Field>
                  <FieldLabel htmlFor={`${uid}-reset-link`}>
                    Tautan reset privat
                  </FieldLabel>
                  <Input id={`${uid}-reset-link`} value={link} readOnly />
                </Field>
                <Button
                  type="button"
                  variant="outline"
                  disabled={pending}
                  onClick={() => void copy()}
                >
                  Salin tautan reset
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  disabled={pending}
                  onClick={() => setLink(null)}
                >
                  Sembunyikan tautan reset
                </Button>
              </>
            )}
            <Button
              type="button"
              variant="outline"
              disabled={pending || !password}
              onClick={() => setConfirmation("revoke")}
            >
              Cabut tautan reset
            </Button>
          </>
        )}
      </FieldGroup>
      <Separator />
      <AlertDialog
        open={confirmation !== null}
        onOpenChange={(open) => {
          if (!open && !pending) setConfirmation(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirmation === "issue"
                ? "Terbitkan tautan reset?"
                : "Cabut tautan reset?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {email}.{" "}
              {confirmation === "issue"
                ? "Tautan sebelumnya akan dicabut. Jangan bagikan tautan baru kepada orang lain. Password baru ditentukan pemilik akun saat tautan digunakan."
                : "Tautan ini tidak dapat digunakan lagi setelah dicabut."}{" "}
              Role dan data tetap.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Batal</AlertDialogCancel>
            <Button
              type="button"
              disabled={pending}
              onClick={() => void execute()}
            >
              {pending ? "Memproses…" : "Konfirmasi reset"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}
