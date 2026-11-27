import { useId, useState } from "react"
import { Alert, AlertDescription } from "@/components/ui/alert"
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { ApiError, apiRequest } from "@/lib/api"
import {
  emailChangeLink as buildEmailChangeLink,
  emailChangeWhatsAppUrl,
} from "@/lib/email-change-link"

export type EmailChangeLinkMetadata = {
  id: number
  expires_at: string
  issued_by: { id: number; name: string }
} | null

type IssuedLinkResponse = {
  token: string
  link_id: number
  expires_at: string
  email_masked: string
}

type GeneratedLink = {
  id: number
  expires_at: string
  email_masked: string
  url: string
}

export function EmailChangeLinkManager({
  membership,
  memberName,
  emailChangeLink,
  actorMembershipId,
  isOwner,
  onChanged,
}: {
  membership: number
  memberName: string
  emailChangeLink: EmailChangeLinkMetadata
  actorMembershipId: number | undefined
  isOwner: boolean
  onChanged: () => Promise<void>
}) {
  const uid = useId()
  const [password, setPassword] = useState("")
  const [generated, setGenerated] = useState<GeneratedLink | null>(null)
  const [pending, setPending] = useState(false)
  const [action, setAction] = useState<"issue" | "revoke" | null>(null)
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")
  const canRevoke =
    emailChangeLink !== null &&
    (isOwner || emailChangeLink.issued_by.id === actorMembershipId)

  function openIssue() {
    setPassword("")
    setError("")
    setNotice("")
    setAction("issue")
  }

  function failed(caught: unknown) {
    setError(
      caught instanceof ApiError && caught.errors
        ? Object.values(caught.errors).flat().join(" ")
        : caught instanceof Error
          ? caught.message
          : "Tautan ubah email belum dapat diproses."
    )
  }

  async function issue(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pending) return
    if (!buildEmailChangeLink(window.location.origin, "0".repeat(64))) {
      setError(
        "Buka aplikasi melalui HTTPS atau localhost sebelum menerbitkan tautan."
      )
      setAction(null)
      return
    }
    setPending(true)
    setError("")
    setNotice("")
    setGenerated(null)
    try {
      const result = await apiRequest<IssuedLinkResponse>(
        `/management/access/members/${membership}/email-change-link`,
        { method: "POST", body: { password } }
      )
      const url = buildEmailChangeLink(window.location.origin, result.token)
      if (!url) {
        throw Error(
          "Tautan tidak dapat dibuat. Hubungi pengelola sebelum menerbitkan ulang."
        )
      }
      setGenerated({
        id: result.link_id,
        expires_at: result.expires_at,
        email_masked: result.email_masked,
        url,
      })
      setNotice("Tautan baru siap dibagikan. Tautan lama sudah dicabut.")
      setAction(null)
      try {
        await onChanged()
      } catch (caught) {
        failed(caught)
      }
    } catch (caught) {
      failed(caught)
      setAction(null)
    } finally {
      setPassword("")
      setPending(false)
    }
  }

  async function revoke() {
    if (pending || !emailChangeLink) return
    setPending(true)
    setError("")
    setNotice("")
    try {
      await apiRequest(
        `/management/access/email-change-links/${emailChangeLink.id}/revoke`,
        { method: "POST" }
      )
      setGenerated(null)
      setNotice("Tautan ubah email sudah dicabut.")
      setAction(null)
      await onChanged()
    } catch (caught) {
      failed(caught)
    } finally {
      setPending(false)
    }
  }

  async function copyLink() {
    if (!generated) return
    try {
      await navigator.clipboard.writeText(generated.url)
      setNotice("Tautan disalin. Bagikan hanya kepada pemilik akun.")
    } catch {
      setError(
        "Tautan tidak dapat disalin. Salin tautan yang tampil secara manual."
      )
    }
  }

  function shareOnWhatsApp() {
    if (!generated) return
    window.open(
      emailChangeWhatsAppUrl(generated.url),
      "_blank",
      "noopener,noreferrer"
    )
  }

  const visibleLink = generated?.url

  return (
    <section className="flex flex-col gap-3" aria-label="Tautan ubah email">
      <div className="flex flex-col gap-1">
        <h3 className="text-subtitle">Ubah email akun</h3>
        <p className="text-caption text-muted-foreground">
          Terbitkan tautan untuk {memberName}. Pemilik akun mengisi email baru
          dan password saat ini sendiri. Tautan berlaku 24 jam, hanya dapat
          digunakan sekali, dan tidak dikirim melalui email.
        </p>
      </div>

      {emailChangeLink ? (
        <Alert>
          <AlertDescription>
            Tautan aktif diterbitkan oleh {emailChangeLink.issued_by.name} dan
            berlaku sampai{" "}
            {new Date(emailChangeLink.expires_at).toLocaleString("id-ID", {
              timeZone: "Asia/Jakarta",
            })}{" "}
            WIB.
          </AlertDescription>
        </Alert>
      ) : null}

      {error ? (
        <Alert variant="destructive">
          <AlertDescription role="alert">{error}</AlertDescription>
        </Alert>
      ) : null}
      <p role="status" className="text-caption text-muted-foreground">
        {notice}
      </p>

      {generated ? (
        <>
          <p className="text-caption">
            Tautan untuk {generated.email_masked} berlaku sampai{" "}
            {new Date(generated.expires_at).toLocaleString("id-ID", {
              timeZone: "Asia/Jakarta",
            })}{" "}
            WIB.
          </p>
          {visibleLink ? (
            <Field>
              <FieldLabel htmlFor={`${uid}-link`}>Tautan ubah email</FieldLabel>
              <Input id={`${uid}-link`} value={visibleLink} readOnly />
              <FieldDescription>
                Salin atau bagikan tautan ini sendiri melalui kanal tepercaya.
              </FieldDescription>
            </Field>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => void copyLink()}
            >
              Salin tautan ubah email
            </Button>
            <Button type="button" variant="outline" onClick={shareOnWhatsApp}>
              Bagikan lewat WhatsApp
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setGenerated(null)}
            >
              Sembunyikan tautan
            </Button>
          </div>
        </>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" onClick={openIssue}>
          {emailChangeLink
            ? "Terbitkan tautan pengganti"
            : "Terbitkan tautan ubah email"}
        </Button>
        {canRevoke ? (
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setError("")
              setNotice("")
              setAction("revoke")
            }}
          >
            Cabut tautan
          </Button>
        ) : null}
      </div>

      <AlertDialog
        open={action !== null}
        onOpenChange={(open) => {
          if (!open && !pending) setAction(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {action === "issue"
                ? "Terbitkan tautan ubah email?"
                : "Cabut tautan ubah email?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {action === "issue"
                ? "Tautan lama akan dicabut. Pemilik akun harus memasukkan password saat ini sebelum mengganti email."
                : "Tautan ini tidak dapat digunakan lagi setelah dicabut."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {action === "issue" ? (
            <form
              className="flex flex-col gap-4"
              onSubmit={(event) => void issue(event)}
            >
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor={`${uid}-password`}>
                    Password Anda
                  </FieldLabel>
                  <Input
                    id={`${uid}-password`}
                    type="password"
                    autoComplete="current-password"
                    required
                    maxLength={255}
                    value={password}
                    disabled={pending}
                    onChange={(event) => setPassword(event.target.value)}
                  />
                </Field>
              </FieldGroup>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={pending}>Batal</AlertDialogCancel>
                <Button type="submit" disabled={pending}>
                  {pending ? "Menerbitkan…" : "Terbitkan tautan"}
                </Button>
              </AlertDialogFooter>
            </form>
          ) : (
            <AlertDialogFooter>
              <AlertDialogCancel disabled={pending}>Batal</AlertDialogCancel>
              <Button
                type="button"
                disabled={pending}
                onClick={() => void revoke()}
              >
                {pending ? "Mencabut…" : "Cabut tautan"}
              </Button>
            </AlertDialogFooter>
          )}
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}
