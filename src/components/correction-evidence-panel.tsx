import { type FormEvent, useEffect, useId, useRef, useState } from "react"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { Textarea } from "@/components/ui/textarea"
import { ApiError, apiRequest, downloadApiFile } from "@/lib/api"

const extensions = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "application/pdf": "pdf",
} as const

type Evidence = {
  id: number
  mime_type: keyof typeof extensions
  size_bytes: number
  available: boolean
  hold_state: "held" | "pending" | null
  expires_at: string
  decision_id: number | null
}

type EvidenceData = {
  files: Evidence[]
  supplement: { reason: string; satisfied: boolean } | null
}

export function CorrectionEvidencePanel({
  requestId,
  canRequireSupplement = false,
  decisions = [],
  preview,
  onSupplementChange,
}: {
  requestId?: number
  canRequireSupplement?: boolean
  decisions?: { id: number; action: string }[]
  preview?: EvidenceData
  onSupplementChange?: (required: boolean) => void
}) {
  const fieldId = useId()
  const [data, setData] = useState<EvidenceData | null>(preview ?? null)
  const [file, setFile] = useState<File | null>(null)
  const [decision, setDecision] = useState("")
  const [reason, setReason] = useState("")
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")
  const [busy, setBusy] = useState(false)
  const [reload, setReload] = useState(0)
  const fileInput = useRef<HTMLInputElement>(null)
  const uploadAttempt = useRef<{
    file: File
    decision: string
    key: string
  } | null>(null)
  const path = requestId ? `/correction-evidence/${requestId}` : null

  useEffect(() => {
    if (!path) return
    const controller = new AbortController()
    apiRequest<EvidenceData>(path, { signal: controller.signal })
      .then((result) => {
        if (controller.signal.aborted) return
        setData(result)
        onSupplementChange?.(
          Boolean(result.supplement && !result.supplement.satisfied)
        )
      })
      .catch((caught: unknown) => {
        if (controller.signal.aborted) return
        setData(null)
        setError(
          caught instanceof ApiError
            ? caught.message
            : "Bukti belum dapat dimuat."
        )
      })
    return () => controller.abort()
  }, [path, reload, onSupplementChange])

  async function run(action: () => Promise<void>) {
    if (busy) return
    setBusy(true)
    setError("")
    setNotice("")
    try {
      await action()
    } catch (caught) {
      if (caught instanceof ApiError && [401, 403, 419].includes(caught.status))
        setData(null)
      setError(
        caught instanceof ApiError
          ? caught.message
          : "Tindakan gagal. Coba lagi."
      )
    } finally {
      setBusy(false)
    }
  }

  function upload(event: FormEvent) {
    event.preventDefault()
    if (!path || !file) return
    if (file.size > 5 * 1024 * 1024 || file.size === 0) {
      setError("Pilih berkas berukuran lebih dari 0 byte dan maksimal 5 MB.")
      return
    }
    void run(async () => {
      if (
        uploadAttempt.current?.file !== file ||
        uploadAttempt.current.decision !== decision
      ) {
        uploadAttempt.current = { file, decision, key: crypto.randomUUID() }
      }
      const body = new FormData()
      body.set("file", file)
      body.set("key", uploadAttempt.current.key)
      if (decision) body.set("decision_id", decision)
      await apiRequest(path, { method: "POST", body })
      uploadAttempt.current = null
      setFile(null)
      if (fileInput.current) fileInput.current.value = ""
      setNotice("Lampiran tersimpan.")
      setReload((value) => value + 1)
    })
  }

  function requireSupplement(event: FormEvent) {
    event.preventDefault()
    if (!requestId || !reason.trim()) return
    void run(async () => {
      await apiRequest(
        `/management/approvals/${requestId}/evidence/requirement`,
        {
          method: "POST",
          body: { reason: reason.trim() },
        }
      )
      setReason("")
      onSupplementChange?.(true)
      setNotice("Permintaan bukti tambahan tersimpan.")
      setReload((value) => value + 1)
    })
  }

  return (
    <section
      aria-labelledby={`${fieldId}-heading`}
      className="flex flex-col gap-3"
    >
      <h3 id={`${fieldId}-heading`} className="text-label">
        Bukti koreksi
      </h3>
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {notice ? (
        <p role="status" className="text-caption">
          {notice}
        </p>
      ) : null}
      {data?.supplement ? (
        <Alert>
          <AlertDescription>
            {data.supplement.satisfied
              ? "Bukti tambahan tersedia."
              : "Bukti tambahan diperlukan sebelum persetujuan."}
            <p className="whitespace-pre-wrap">{data.supplement.reason}</p>
          </AlertDescription>
        </Alert>
      ) : null}
      {data ? (
        data.files.length ? (
          <ul className="flex flex-col gap-2">
            {data.files.map((item) => (
              <li
                key={item.id}
                className="flex flex-wrap items-center gap-2 text-caption"
              >
                <span>
                  Lampiran #{item.id} ·{" "}
                  {extensions[item.mime_type]?.toUpperCase()} ·{" "}
                  {Math.ceil(item.size_bytes / 1024)} KB
                </span>
                {item.decision_id ? (
                  <span>Keputusan #{item.decision_id}</span>
                ) : null}
                <span>Retensi hingga {item.expires_at.slice(0, 10)} UTC</span>
                {item.hold_state === "held" ? (
                  <Badge variant="secondary">Ditahan (Legal Hold)</Badge>
                ) : null}
                {item.hold_state === "pending" ? (
                  <Badge variant="secondary">
                    Penahanan menunggu keputusan
                  </Badge>
                ) : null}
                {!item.available ? (
                  <Badge variant="secondary">Berkas tidak tersedia</Badge>
                ) : null}
                {item.available && path ? (
                  <Button
                    className="min-h-11 min-w-11"
                    variant="outline"
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      void run(() =>
                        downloadApiFile(
                          `${path}/${item.id}`,
                          `bukti-koreksi-${item.id}.${extensions[item.mime_type]}`,
                          "application/octet-stream"
                        )
                      )
                    }
                  >
                    Unduh lampiran #{item.id}
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-caption text-muted-foreground">
            Belum ada lampiran.
          </p>
        )
      ) : path ? (
        error ? (
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              setError("")
              setReload((value) => value + 1)
            }}
          >
            Muat ulang bukti
          </Button>
        ) : (
          <p role="status" className="text-caption">
            Memuat bukti…
          </p>
        )
      ) : null}
      {path && data && data.files.length < 3 ? (
        <form onSubmit={upload} className="flex flex-col gap-2">
          <FieldGroup className="gap-3">
            <Field>
              <FieldLabel htmlFor={`${fieldId}-file`}>
                Lampiran{" "}
                {data.supplement && !data.supplement.satisfied
                  ? "tambahan"
                  : "opsional"}
              </FieldLabel>
              <Input
                id={`${fieldId}-file`}
                ref={fileInput}
                type="file"
                disabled={busy}
                accept={Object.keys(extensions).join(",")}
                aria-describedby={`${fieldId}-limits`}
                onChange={(event) => setFile(event.target.files?.[0] ?? null)}
              />
              <p
                id={`${fieldId}-limits`}
                className="text-caption text-muted-foreground"
              >
                JPEG, PNG, WebP, atau PDF. Maksimal 5 MB per berkas dan 3
                lampiran per permintaan.
              </p>
            </Field>
            {decisions.length ? (
              <Field>
                <FieldLabel htmlFor={`${fieldId}-decision`}>
                  Kaitkan lampiran dengan
                </FieldLabel>
                <NativeSelect
                  id={`${fieldId}-decision`}
                  value={decision}
                  disabled={busy}
                  onChange={(event) => setDecision(event.target.value)}
                >
                  <NativeSelectOption value="">
                    Permintaan koreksi
                  </NativeSelectOption>
                  {decisions.map((item) => (
                    <NativeSelectOption key={item.id} value={item.id}>
                      {item.action === "reversed" ? "Pembalikan" : "Keputusan"}{" "}
                      #{item.id}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </Field>
            ) : null}
          </FieldGroup>
          <Button
            className="min-h-11 min-w-11 self-start"
            type="submit"
            variant="outline"
            disabled={!file || busy}
          >
            Unggah lampiran
          </Button>
        </form>
      ) : null}
      {path &&
      canRequireSupplement &&
      data &&
      !data.supplement &&
      data.files.length < 3 ? (
        <details>
          <summary className="min-h-11 min-w-11 content-center cursor-pointer text-label">
            Minta bukti tambahan
          </summary>
          <form
            onSubmit={requireSupplement}
            className="mt-3 flex flex-col gap-2"
          >
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor={`${fieldId}-reason`}>
                  Alasan dan bukti yang diperlukan
                </FieldLabel>
                <Textarea
                  id={`${fieldId}-reason`}
                  value={reason}
                  maxLength={1000}
                  required
                  disabled={busy}
                  onChange={(event) => setReason(event.target.value)}
                />
              </Field>
            </FieldGroup>
            <Button
              className="min-h-11 min-w-11 self-start"
              type="submit"
              variant="outline"
              disabled={!reason.trim() || busy}
            >
              Kirim permintaan bukti
            </Button>
          </form>
        </details>
      ) : null}
    </section>
  )
}
