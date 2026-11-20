import { useCallback, useEffect, useRef, useState } from "react"
import { apiRequest } from "@/lib/api"
import { useConfigurationDraft } from "@/lib/use-configuration-draft"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"

type Shift = {
  name: string | null
  start_time: string
  end_time: string
  crosses_midnight: boolean
}
type RequestRow = {
  id: number
  kind: "swap" | "replacement"
  status: "pending" | "accepted" | "rejected" | "cancelled" | "expired"
  requester_id: number
  recipient_id: number
  requester_name: string
  recipient_name: string
  outlet_name: string
  source_date: string
  target_date: string | null
  source_shift: Shift
  target_shift: Shift | null
  reason: string
  expires_at?: string
}
export type PublishedShiftDay = {
  work_date: string
  scheduled_start: string | null
  status: string
  outlet: { name: string } | null
  shift: Shift | null
  provenance: { source: string; entry_id?: number | null }
}
type Recipient = {
  id: number
  name: string
  shifts: Array<{ entry_id: number; date: string; shift: Shift }>
}
const base = "/management/scheduling/me/changes"
const labels = {
  pending: "Menunggu penerima",
  accepted: "Diterima",
  rejected: "Ditolak",
  cancelled: "Dibatalkan",
  expired: "Kedaluwarsa",
}
function shiftLabel(shift: Shift | null) {
  return shift
    ? `${shift.name ?? "Shift"} · ${shift.start_time.slice(0, 5)}–${shift.end_time.slice(0, 5)}${shift.crosses_midnight ? " (+1 hari)" : ""}`
    : ""
}
function message(error: unknown) {
  return error instanceof Error
    ? error.message
    : "Permintaan belum berhasil. Coba lagi."
}

export function ShiftChanges({
  employeeId,
  days,
  onChanged,
}: {
  employeeId: number
  days: PublishedShiftDay[]
  onChanged: () => void
}) {
  const [requests, setRequests] = useState<RequestRow[]>([])
  const [clock, setClock] = useState(Date.now)
  const [serverOffset, setServerOffset] = useState(0)
  const effectiveStatus = (row: RequestRow) =>
    row.status === "pending" &&
    row.expires_at &&
    Date.parse(row.expires_at) <= clock + serverOffset
      ? ("expired" as const)
      : row.status
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const lock = useRef(false)
  const alive = useRef(true)
  const [sourceId, setSourceId] = useState("")
  const [kind, setKind] = useState<"swap" | "replacement">("swap")
  const [recipients, setRecipients] = useState<Recipient[]>([])
  const [optionsLoading, setOptionsLoading] = useState(false)
  const [recipientId, setRecipientId] = useState("")
  const [targetId, setTargetId] = useState("")
  const [reason, setReason] = useState("")
  const pending = useRef<{ payload: string; key: string } | null>(null)
  const guard = useConfigurationDraft(busy, () => setOpen(false))
  const future = days.filter(
    (day) =>
      day.status === "scheduled" &&
      day.provenance.source === "published_roster" &&
      day.provenance.entry_id &&
      day.scheduled_start &&
      new Date(day.scheduled_start).getTime() > Date.now()
  )
  const reload = useCallback(async () => {
    const result = await apiRequest<{
      requests: RequestRow[]
      server_now?: string
    }>(base)
    if (alive.current) {
      setRequests(result.requests)
      setClock(Date.now())
      if (result.server_now)
        setServerOffset(Date.parse(result.server_now) - Date.now())
    }
  }, [])
  useEffect(() => {
    alive.current = true
    void reload()
      .catch((caught) => {
        if (alive.current) setError(message(caught))
      })
      .finally(() => {
        if (alive.current) setLoading(false)
      })
    return () => {
      alive.current = false
    }
  }, [reload])
  useEffect(() => {
    const next = requests
      .filter((row) => row.status === "pending" && row.expires_at)
      .map((row) => Date.parse(row.expires_at ?? ""))
      .filter((at) => at > clock + serverOffset)
      .sort((a, b) => a - b)[0]
    if (next === undefined) return
    const timer = window.setTimeout(
      () => setClock(Date.now()),
      Math.min(next - Date.now() - serverOffset + 25, 2_147_483_647)
    )
    return () => window.clearTimeout(timer)
  }, [requests, clock, serverOffset])
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "visible") {
        setClock(Date.now())
        void reload().catch((caught) => setError(message(caught)))
      }
    }
    document.addEventListener("visibilitychange", refresh)
    return () => document.removeEventListener("visibilitychange", refresh)
  }, [reload])
  useEffect(() => {
    if (!open || !sourceId) return
    let current = true
    setOptionsLoading(true)
    setRecipients([])
    setRecipientId("")
    setTargetId("")
    void apiRequest<{ recipients: Recipient[] }>(
      `${base}/options?entry_id=${sourceId}`
    )
      .then((result) => {
        if (current) setRecipients(result.recipients)
      })
      .catch((caught) => {
        if (current) setError(message(caught))
      })
      .finally(() => {
        if (current) setOptionsLoading(false)
      })
    return () => {
      current = false
    }
  }, [open, sourceId])
  async function submit() {
    if (lock.current) return
    const body = {
      kind,
      source_entry_id: Number(sourceId),
      recipient_id: Number(recipientId),
      ...(kind === "swap" ? { target_entry_id: Number(targetId) } : {}),
      reason: reason.trim(),
    }
    const payload = JSON.stringify(body)
    if (pending.current?.payload !== payload)
      pending.current = { payload, key: crypto.randomUUID() }
    lock.current = true
    setBusy(true)
    setError("")
    try {
      await apiRequest(base, {
        method: "POST",
        body,
        headers: { "Idempotency-Key": pending.current.key },
      })
      guard.clear()
      pending.current = null
      setOpen(false)
      setNotice(
        "Permintaan dikirim. Jadwal belum berubah sampai penerima menyetujui."
      )
      await reload()
    } catch (caught) {
      setError(message(caught))
    } finally {
      lock.current = false
      if (alive.current) setBusy(false)
    }
  }
  async function respond(
    row: RequestRow,
    action: "accept" | "reject" | "cancel"
  ) {
    if (lock.current) return
    lock.current = true
    setBusy(true)
    setError("")
    try {
      const result = await apiRequest<RequestRow>(`${base}/${row.id}/respond`, {
        method: "POST",
        body: { action },
      })
      setNotice(`Permintaan ${labels[result.status].toLowerCase()}.`)
      await reload()
      onChanged()
    } catch (caught) {
      setError(message(caught))
    } finally {
      lock.current = false
      if (alive.current) setBusy(false)
    }
  }
  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Perubahan shift</CardTitle>
          <CardDescription>
            Tukar atau minta pengganti pada Outlet yang sama. Jadwal berubah
            setelah penerima menyetujui, tanpa persetujuan atasan.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {error && !open ? (
            <Alert variant="destructive">
              <AlertTitle>Perubahan belum berhasil</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => {
                  setError("")
                  void reload().catch((caught) => setError(message(caught)))
                }}
              >
                Muat ulang permintaan
              </Button>
            </Alert>
          ) : null}
          {notice ? (
            <p role="status" className="text-caption">
              {notice}
            </p>
          ) : null}
          <Button
            variant="outline"
            disabled={busy || loading || !future.length}
            onClick={() => {
              setSourceId(String(future[0].provenance.entry_id))
              setReason("")
              setKind("swap")
              setError("")
              guard.clear()
              setOpen(true)
            }}
          >
            Ajukan perubahan shift
          </Button>
          {!future.length ? (
            <p className="text-caption text-muted-foreground">
              Pilih minggu dengan shift published yang belum dimulai untuk
              mengajukan perubahan.
            </p>
          ) : null}
          {loading ? (
            <p role="status">Memuat permintaan…</p>
          ) : requests.length ? (
            <ul className="flex flex-col gap-4">
              {requests.map((row) => (
                <li
                  key={row.id}
                  className="flex flex-col gap-2 rounded-lg border p-4"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-label">
                      {row.kind === "swap"
                        ? "Tukar shift"
                        : "Penggantian shift"}
                    </span>
                    <Badge variant="outline">
                      {labels[effectiveStatus(row)]}
                    </Badge>
                  </div>
                  <p className="text-body">
                    {row.requester_name} → {row.recipient_name} ·{" "}
                    {row.outlet_name}
                  </p>
                  <p className="text-caption">
                    {row.source_date} · {shiftLabel(row.source_shift)}
                    {row.target_date
                      ? ` ↔ ${row.target_date} · ${shiftLabel(row.target_shift)}`
                      : ""}
                  </p>
                  <p className="text-caption">Alasan: {row.reason}</p>
                  {effectiveStatus(row) === "pending" ? (
                    <div className="flex flex-wrap gap-2">
                      {row.recipient_id === employeeId ? (
                        <>
                          <Button
                            disabled={busy}
                            onClick={() => void respond(row, "accept")}
                          >
                            Terima perubahan
                          </Button>
                          <Button
                            variant="outline"
                            disabled={busy}
                            onClick={() => void respond(row, "reject")}
                          >
                            Tolak
                          </Button>
                        </>
                      ) : (
                        <Button
                          variant="outline"
                          disabled={busy}
                          onClick={() => void respond(row, "cancel")}
                        >
                          Batalkan permintaan
                        </Button>
                      )}
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-caption text-muted-foreground">
              Belum ada permintaan.
            </p>
          )}
        </CardContent>
      </Card>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!next) guard.attempt(() => setOpen(false))
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Ajukan perubahan shift</DialogTitle>
            <DialogDescription>
              Shift harus pada Outlet yang sama dan belum dimulai. Penerima
              wajib menyetujui sebelum jadwal berubah.
            </DialogDescription>
          </DialogHeader>
          {error ? (
            <Alert variant="destructive">
              <AlertTitle>Permintaan belum berhasil</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          <form
            onSubmit={(event) => {
              event.preventDefault()
              void submit()
            }}
          >
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="change-source">Shift saya</FieldLabel>
                <NativeSelect
                  id="change-source"
                  value={sourceId}
                  disabled={busy}
                  onChange={(event) => {
                    setSourceId(event.target.value)
                    guard.mark()
                  }}
                >
                  {future.map((day) => (
                    <NativeSelectOption
                      key={day.provenance.entry_id}
                      value={day.provenance.entry_id ?? ""}
                    >
                      {day.work_date} · {day.outlet?.name} ·{" "}
                      {shiftLabel(day.shift)}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </Field>
              <Field>
                <FieldLabel htmlFor="change-kind">Jenis perubahan</FieldLabel>
                <NativeSelect
                  id="change-kind"
                  disabled={busy}
                  value={kind}
                  onChange={(event) => {
                    setKind(event.target.value as "swap" | "replacement")
                    setTargetId("")
                    guard.mark()
                  }}
                >
                  <NativeSelectOption value="swap">
                    Tukar shift
                  </NativeSelectOption>
                  <NativeSelectOption value="replacement">
                    Minta pengganti
                  </NativeSelectOption>
                </NativeSelect>
              </Field>
              <Field>
                <FieldLabel htmlFor="change-recipient">Penerima</FieldLabel>
                <NativeSelect
                  id="change-recipient"
                  required
                  disabled={busy || optionsLoading}
                  value={recipientId}
                  onChange={(event) => {
                    setRecipientId(event.target.value)
                    setTargetId("")
                    guard.mark()
                  }}
                >
                  <NativeSelectOption value="">
                    {optionsLoading ? "Memuat penerima…" : "Pilih penerima"}
                  </NativeSelectOption>
                  {recipients.map((person) => (
                    <NativeSelectOption key={person.id} value={person.id}>
                      {person.name}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </Field>
              {kind === "swap" ? (
                <Field>
                  <FieldLabel htmlFor="change-target">
                    Shift penerima
                  </FieldLabel>
                  <NativeSelect
                    id="change-target"
                    required
                    disabled={busy || !recipientId}
                    value={targetId}
                    onChange={(event) => {
                      setTargetId(event.target.value)
                      guard.mark()
                    }}
                  >
                    <NativeSelectOption value="">
                      Pilih shift untuk ditukar
                    </NativeSelectOption>
                    {recipients
                      .find((person) => person.id === Number(recipientId))
                      ?.shifts.map((shift) => (
                        <NativeSelectOption
                          key={shift.entry_id}
                          value={shift.entry_id}
                        >
                          {shift.date} · {shiftLabel(shift.shift)}
                        </NativeSelectOption>
                      ))}
                  </NativeSelect>
                </Field>
              ) : null}
              <Field>
                <FieldLabel htmlFor="change-reason">Alasan</FieldLabel>
                <Input
                  id="change-reason"
                  required
                  maxLength={1000}
                  disabled={busy}
                  value={reason}
                  onChange={(event) => {
                    setReason(event.target.value)
                    guard.mark()
                  }}
                />
              </Field>
            </FieldGroup>
            <DialogFooter className="mt-4">
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => guard.attempt(() => setOpen(false))}
              >
                Batal
              </Button>
              <Button
                type="submit"
                disabled={
                  busy ||
                  optionsLoading ||
                  !sourceId ||
                  !recipientId ||
                  !reason.trim() ||
                  (kind === "swap" && !targetId)
                }
              >
                Kirim permintaan
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      {guard.dialog}
    </>
  )
}
