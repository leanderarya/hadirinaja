import { createFileRoute } from "@tanstack/react-router"
import { useCallback, useEffect, useMemo, useState } from "react"

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
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { Textarea } from "@/components/ui/textarea"
import { ApiError, type AuthSession, apiRequest } from "@/lib/api"

export const Route = createFileRoute("/requests")({ component: RequestsPage })

type RequestType = "leave" | "overtime" | "attendance_correction"
type RequestRecord = {
  id: number
  type: RequestType | "attendance_review"
  status: "pending" | "approved" | "rejected" | "cancelled"
  work_date: string | null
  starts_on: string | null
  ends_on: string | null
  reason: string | null
  details: Record<string, unknown>
  classification: string | null
  correction?: {
    original_values: Record<string, unknown>
    proposed_values: Record<string, unknown>
  } | null
  decision_history: Array<{
    action: string
    reason: string | null
    actor_user_id: number
    acted_at: string
  }>
}
type EffectiveSession = {
  id: number
  original: {
    check_in_at: string | null
    check_out_at: string | null
    events: Array<{ id: number }>
  }
  effective: {
    check_in_at: string | null
    check_out_at: string | null
    duration_seconds: number | null
  }
  correction: { request_id: number; reason: string | null } | null
}
type EffectiveDay = {
  work_date: string
  outcome: string
  sessions: EffectiveSession[]
  actual_duration_seconds: number | null
  effective_duration_seconds: number | null
  approved_leave: { category?: string } | null
  overtime_requests: Array<{ status: string; details: Record<string, unknown> }>
  review: { status: string; indicators: string[]; cases: RequestRecord[] }
  unresolved_conflicts: string[]
  is_finalized: boolean
}
type PageData = {
  session: AuthSession
  requests: RequestRecord[]
  attendance: EffectiveDay[]
}

function localDate(daysAgo = 0) {
  const date = new Date()
  date.setDate(date.getDate() - daysAgo)
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-")
}

function shiftDate(value: string, days: number) {
  const [year, month, day] = value.split("-").map(Number)
  const date = new Date(year, month - 1, day)
  date.setDate(date.getDate() + days)
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-")
}

function RequestsPage() {
  const [data, setData] = useState<PageData | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")
  const [type, setType] = useState<RequestType>("leave")
  const [category, setCategory] = useState("permission")
  const [startsOn, setStartsOn] = useState(localDate())
  const [endsOn, setEndsOn] = useState(localDate())
  const [workDate, setWorkDate] = useState(localDate())
  const [startsAt, setStartsAt] = useState("17:00")
  const [endsAt, setEndsAt] = useState("19:00")
  const [sessionId, setSessionId] = useState("")
  const [effectiveCheckIn, setEffectiveCheckIn] = useState("")
  const [effectiveCheckOut, setEffectiveCheckOut] = useState("")
  const [reason, setReason] = useState("")

  const refresh = useCallback(async () => {
    setError("")
    try {
      const session = await apiRequest<AuthSession>("/auth/me")
      if (!session.active_membership) {
        window.location.assign("/select-tenant")
        return
      }
      const [requestPayload, attendancePayload] = await Promise.all([
        apiRequest<{ requests: RequestRecord[] }>("/attendance/me/requests"),
        apiRequest<{ attendance: EffectiveDay[] }>(
          `/attendance/me/effective?from=${localDate(13)}&to=${localDate()}`
        ),
      ])
      setData({
        session,
        requests: requestPayload.requests,
        attendance: attendancePayload.attendance,
      })
      setSessionId(
        (current) =>
          current ||
          String(
            attendancePayload.attendance.flatMap((day) => day.sessions)[0]
              ?.id ?? ""
          )
      )
    } catch (caught) {
      if (
        caught instanceof ApiError &&
        (caught.status === 401 || caught.status === 419)
      ) {
        window.location.assign("/login?expired=1")
        return
      }
      setError(
        caught instanceof ApiError
          ? caught.message
          : "Data permintaan belum dapat dimuat."
      )
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const sessions = useMemo(
    () =>
      data?.attendance.flatMap((day) =>
        day.sessions.map((session) => ({ ...session, workDate: day.work_date }))
      ) ?? [],
    [data?.attendance]
  )
  const selectedSession = sessions.find(
    (session) => String(session.id) === sessionId
  )

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setError("")
    setNotice("")
    try {
      let body: Record<string, unknown>
      if (type === "leave") {
        body = { type, category, starts_on: startsOn, ends_on: endsOn, reason }
      } else if (type === "overtime") {
        body = {
          type,
          work_date: workDate,
          starts_at: `${workDate}T${startsAt}`,
          ends_at: `${endsAt <= startsAt ? shiftDate(workDate, 1) : workDate}T${endsAt}`,
          reason,
          ...(sessionId ? { attendance_session_id: Number(sessionId) } : {}),
        }
      } else {
        body = {
          type,
          attendance_session_id: Number(sessionId),
          ...(effectiveCheckIn
            ? {
                effective_check_in_at: new Date(effectiveCheckIn).toISOString(),
              }
            : {}),
          ...(effectiveCheckOut
            ? {
                effective_check_out_at: new Date(
                  effectiveCheckOut
                ).toISOString(),
              }
            : {}),
          reason,
        }
      }
      await apiRequest("/attendance/me/requests", {
        method: "POST",
        headers: { "Idempotency-Key": window.crypto.randomUUID() },
        body,
      })
      setReason("")
      setEffectiveCheckIn("")
      setEffectiveCheckOut("")
      setNotice("Permintaan terkirim dan menunggu peninjau independen.")
      await refresh()
    } catch (caught) {
      if (
        caught instanceof ApiError &&
        (caught.status === 401 || caught.status === 419)
      ) {
        window.location.assign("/login?expired=1")
        return
      }
      setError(
        caught instanceof ApiError
          ? caught.message
          : "Permintaan belum dapat dikirim."
      )
    } finally {
      setBusy(false)
    }
  }

  async function cancelRequest(id: number) {
    setBusy(true)
    setError("")
    try {
      await apiRequest(`/attendance/me/requests/${id}/cancel`, {
        method: "POST",
        headers: { "Idempotency-Key": window.crypto.randomUUID() },
      })
      setNotice("Permintaan dibatalkan dan riwayatnya tetap tersimpan.")
      await refresh()
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught.message
          : "Permintaan belum dapat dibatalkan."
      )
    } finally {
      setBusy(false)
    }
  }

  async function logout() {
    await apiRequest("/auth/logout", { method: "POST" }).catch(() => undefined)
    window.location.assign("/login")
  }

  if (loading && !data) {
    return (
      <main className="flex min-h-svh items-center justify-center text-body text-muted-foreground">
        Memuat permintaan…
      </main>
    )
  }

  return (
    <main className="mx-auto flex min-h-svh w-full max-w-5xl flex-col gap-5 px-4 py-6 sm:px-6 lg:py-10">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1">
          <p className="text-label text-muted-foreground">
            HadirinAja · Karyawan
          </p>
          <h1 className="text-title">Permintaan saya</h1>
          <p className="text-body text-muted-foreground">
            Ajukan izin, lembur, atau koreksi. Keputusan selalu dibuat oleh
            identitas lain yang berwenang.
          </p>
        </div>
        <nav className="flex flex-wrap gap-2" aria-label="Navigasi karyawan">
          <Button render={<a href="/attendance" />} variant="outline">
            Kehadiran
          </Button>
          <Button
            onClick={() => window.location.assign("/select-tenant")}
            variant="outline"
          >
            Ganti organisasi
          </Button>
          <Button onClick={logout} variant="ghost">
            Keluar
          </Button>
        </nav>
      </header>

      {error ? (
        <Alert variant="destructive">
          <AlertTitle>Belum berhasil</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {notice ? (
        <Alert>
          <AlertTitle>Status permintaan</AlertTitle>
          <AlertDescription>{notice}</AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <Card>
          <CardHeader>
            <CardTitle>Buat permintaan</CardTitle>
            <CardDescription>
              Data diproses oleh organisasi aktif Anda.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form className="space-y-5" onSubmit={submit}>
              <Field>
                <FieldLabel htmlFor="request-type">Jenis permintaan</FieldLabel>
                <NativeSelect
                  id="request-type"
                  onChange={(event) =>
                    setType(event.target.value as RequestType)
                  }
                  value={type}
                >
                  <NativeSelectOption value="leave">
                    Izin, sakit, atau cuti
                  </NativeSelectOption>
                  <NativeSelectOption value="overtime">
                    Lembur
                  </NativeSelectOption>
                  <NativeSelectOption value="attendance_correction">
                    Koreksi kehadiran
                  </NativeSelectOption>
                </NativeSelect>
              </Field>

              {type === "leave" ? (
                <>
                  <Field>
                    <FieldLabel htmlFor="leave-category">Kategori</FieldLabel>
                    <NativeSelect
                      id="leave-category"
                      onChange={(event) => setCategory(event.target.value)}
                      value={category}
                    >
                      <NativeSelectOption value="permission">
                        Izin
                      </NativeSelectOption>
                      <NativeSelectOption value="sick">
                        Sakit
                      </NativeSelectOption>
                      <NativeSelectOption value="annual">
                        Cuti
                      </NativeSelectOption>
                    </NativeSelect>
                  </Field>
                  <FieldGroup className="grid grid-cols-2 gap-3">
                    <Field>
                      <FieldLabel htmlFor="starts-on">Mulai</FieldLabel>
                      <Input
                        id="starts-on"
                        onChange={(event) => setStartsOn(event.target.value)}
                        required
                        type="date"
                        value={startsOn}
                      />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="ends-on">Sampai</FieldLabel>
                      <Input
                        id="ends-on"
                        onChange={(event) => setEndsOn(event.target.value)}
                        required
                        type="date"
                        value={endsOn}
                      />
                    </Field>
                  </FieldGroup>
                </>
              ) : null}

              {type === "overtime" ? (
                <>
                  <Field>
                    <FieldLabel htmlFor="overtime-date">
                      Tanggal kerja
                    </FieldLabel>
                    <Input
                      id="overtime-date"
                      onChange={(event) => setWorkDate(event.target.value)}
                      required
                      type="date"
                      value={workDate}
                    />
                  </Field>
                  <FieldGroup className="grid grid-cols-2 gap-3">
                    <Field>
                      <FieldLabel htmlFor="overtime-start">
                        Mulai lembur
                      </FieldLabel>
                      <Input
                        id="overtime-start"
                        onChange={(event) => setStartsAt(event.target.value)}
                        required
                        type="time"
                        value={startsAt}
                      />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="overtime-end">
                        Selesai lembur
                      </FieldLabel>
                      <Input
                        id="overtime-end"
                        onChange={(event) => setEndsAt(event.target.value)}
                        required
                        type="time"
                        value={endsAt}
                      />
                    </Field>
                  </FieldGroup>
                  <p className="text-caption text-muted-foreground">
                    Persetujuan lembur dicatat terpisah dan tidak menambah
                    durasi kerja aktual.
                  </p>
                </>
              ) : null}

              {type === "attendance_correction" ? (
                <>
                  <Field>
                    <FieldLabel htmlFor="correction-session">
                      Sesi kehadiran
                    </FieldLabel>
                    <NativeSelect
                      id="correction-session"
                      onChange={(event) => setSessionId(event.target.value)}
                      required
                      value={sessionId}
                    >
                      <NativeSelectOption value="" disabled>
                        Pilih sesi
                      </NativeSelectOption>
                      {sessions.map((session) => (
                        <NativeSelectOption
                          key={session.id}
                          value={String(session.id)}
                        >
                          {session.workDate} · sesi #{session.id}
                        </NativeSelectOption>
                      ))}
                    </NativeSelect>
                  </Field>
                  <FieldGroup className="grid gap-3 sm:grid-cols-2">
                    <Field>
                      <FieldLabel htmlFor="correct-checkin">
                        Check-in efektif
                      </FieldLabel>
                      <Input
                        id="correct-checkin"
                        onChange={(event) =>
                          setEffectiveCheckIn(event.target.value)
                        }
                        type="datetime-local"
                        value={effectiveCheckIn}
                      />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="correct-checkout">
                        Check-out efektif
                      </FieldLabel>
                      <Input
                        id="correct-checkout"
                        onChange={(event) =>
                          setEffectiveCheckOut(event.target.value)
                        }
                        required={
                          selectedSession?.original.check_out_at === null
                        }
                        type="datetime-local"
                        value={effectiveCheckOut}
                      />
                    </Field>
                  </FieldGroup>
                  <p className="text-caption text-muted-foreground">
                    Check-in dan checkout asli tetap tersimpan sebagai fakta
                    sumber.
                  </p>
                </>
              ) : null}

              <Field>
                <FieldLabel htmlFor="request-reason">Alasan</FieldLabel>
                <Textarea
                  id="request-reason"
                  maxLength={1000}
                  onChange={(event) => setReason(event.target.value)}
                  required
                  value={reason}
                />
                <p className="text-caption text-muted-foreground">
                  Hindari mengirim diagnosis atau informasi kesehatan yang tidak
                  diperlukan.
                </p>
              </Field>
              <Button
                className="w-full"
                disabled={
                  busy || (type === "attendance_correction" && !sessionId)
                }
                type="submit"
              >
                {busy ? "Mengirim…" : "Kirim untuk ditinjau"}
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Riwayat keputusan</CardTitle>
            <CardDescription>
              Permintaan Anda dan permintaan yang terkait dengan identitas
              karyawan Anda.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {data?.requests.length ? (
              data.requests.map((request) => (
                <article className="rounded-2xl border p-4" key={request.id}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="text-label">{requestTitle(request)}</p>
                      <p className="text-caption text-muted-foreground">
                        {request.work_date ??
                          `${request.starts_on ?? ""} – ${request.ends_on ?? ""}`}
                      </p>
                    </div>
                    <Badge variant={statusVariant(request.status)}>
                      {statusLabel(request.status)}
                    </Badge>
                  </div>
                  <p className="mt-3 text-body">{request.reason}</p>
                  {request.type === "attendance_correction" ? (
                    <CorrectionComparison request={request} />
                  ) : null}
                  {request.type === "overtime" ? (
                    <p className="mt-2 text-caption text-muted-foreground">
                      Persetujuan ini tidak mengubah durasi kehadiran aktual.
                    </p>
                  ) : null}
                  {request.decision_history.length ? (
                    <ol className="mt-3 space-y-2 border-l pl-3">
                      {request.decision_history.map((decision, index) => (
                        <li
                          className="text-caption"
                          key={`${decision.acted_at}-${index}`}
                        >
                          <span className="font-medium">
                            {decisionLabel(decision.action)}
                          </span>{" "}
                          · {formatDate(decision.acted_at)}
                          {decision.reason ? (
                            <p className="text-muted-foreground">
                              {decision.reason}
                            </p>
                          ) : null}
                        </li>
                      ))}
                    </ol>
                  ) : (
                    <p className="mt-3 text-caption text-muted-foreground">
                      Belum ada keputusan. Status masih menunggu.
                    </p>
                  )}
                  {request.status === "pending" &&
                  request.type !== "attendance_review" ? (
                    <Button
                      className="mt-3"
                      disabled={busy}
                      onClick={() => void cancelRequest(request.id)}
                      size="sm"
                      variant="outline"
                    >
                      Batalkan permintaan
                    </Button>
                  ) : null}
                </article>
              ))
            ) : (
              <p className="rounded-2xl border border-dashed p-6 text-center text-body text-muted-foreground">
                Belum ada permintaan.
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Proyeksi kehadiran efektif</CardTitle>
          <CardDescription>
            Catatan asli, koreksi yang disetujui, review, dan finalisasi
            ditampilkan terpisah.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          {data?.attendance.map((day) => (
            <article className="rounded-2xl border p-4" key={day.work_date}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-label">{day.work_date}</p>
                <Badge
                  variant={
                    day.review.status === "pending" ? "outline" : "secondary"
                  }
                >
                  {day.review.status === "pending"
                    ? "Perlu ditinjau"
                    : outcomeLabel(day.outcome)}
                </Badge>
              </div>
              {day.sessions.length ? (
                day.sessions.map((session) => (
                  <div className="mt-3 border-t pt-3" key={session.id}>
                    <p className="text-caption">
                      Asli: {formatDate(session.original.check_in_at)} —{" "}
                      {session.original.check_out_at
                        ? formatDate(session.original.check_out_at)
                        : "checkout belum dicatat"}
                    </p>
                    <p className="text-caption">
                      Efektif: {formatDate(session.effective.check_in_at)} —{" "}
                      {session.effective.check_out_at
                        ? formatDate(session.effective.check_out_at)
                        : "belum ditentukan"}
                    </p>
                    {session.correction ? (
                      <p className="mt-1 text-caption text-muted-foreground">
                        Koreksi dari keputusan #{session.correction.request_id}
                      </p>
                    ) : null}
                  </div>
                ))
              ) : (
                <p className="mt-2 text-caption text-muted-foreground">
                  Belum ada sesi kehadiran.
                </p>
              )}
              {day.approved_leave ? (
                <p className="mt-2 text-caption">
                  Persetujuan:{" "}
                  {categoryLabel(day.approved_leave.category ?? "permission")}
                </p>
              ) : null}
              {day.overtime_requests.some(
                (item) => item.status === "approved"
              ) ? (
                <p className="mt-1 text-caption">
                  Lembur disetujui · tidak menambah durasi aktual.
                </p>
              ) : null}
              {day.review.indicators.length ? (
                <p className="mt-2 text-caption text-muted-foreground">
                  Indikator:{" "}
                  {day.review.indicators.map(indicatorLabel).join(", ")}
                </p>
              ) : null}
              <p className="mt-2 text-caption text-muted-foreground">
                Durasi aktual {formatDuration(day.actual_duration_seconds)} ·
                efektif {formatDuration(day.effective_duration_seconds)} ·{" "}
                {day.is_finalized ? "sudah difinalisasi" : "belum difinalisasi"}
              </p>
            </article>
          ))}
        </CardContent>
      </Card>
    </main>
  )
}

function CorrectionComparison({ request }: { request: RequestRecord }) {
  const originalValue =
    (request.details.original as Record<string, unknown> | undefined) ??
    request.correction?.original_values
  const original =
    (originalValue?.recorded as Record<string, unknown> | undefined) ??
    originalValue
  const proposed =
    (request.details.proposed as Record<string, unknown> | undefined) ??
    request.correction?.proposed_values
  if (!original && !proposed) return null
  return (
    <div className="mt-3 grid gap-2 rounded-xl bg-muted/40 p-3 sm:grid-cols-2">
      <div>
        <p className="text-caption font-medium">Nilai sebelumnya</p>
        <p className="text-caption">
          Check-in: {formatDate(String(original?.check_in_at ?? ""))}
        </p>
        <p className="text-caption">
          Check-out: {formatDate(String(original?.check_out_at ?? ""))}
        </p>
      </div>
      <div>
        <p className="text-caption font-medium">Usulan efektif</p>
        <p className="text-caption">
          Check-in: {formatDate(String(proposed?.check_in_at ?? ""))}
        </p>
        <p className="text-caption">
          Check-out: {formatDate(String(proposed?.check_out_at ?? ""))}
        </p>
      </div>
    </div>
  )
}

function requestTitle(request: RequestRecord) {
  if (request.type === "attendance_correction") return "Koreksi kehadiran"
  if (request.type === "overtime") return "Permintaan lembur"
  if (request.type === "attendance_review") return "Review kehadiran"
  return `Permintaan ${categoryLabel(String(request.details.category ?? "permission"))}`
}
function categoryLabel(category: string) {
  return (
    (
      { permission: "izin", sick: "sakit", annual: "cuti" } as Record<
        string,
        string
      >
    )[category] ?? category
  )
}
function statusLabel(status: RequestRecord["status"]) {
  return (
    {
      pending: "Menunggu",
      approved: "Disetujui",
      rejected: "Ditolak",
      cancelled: "Dibatalkan",
    } as const
  )[status]
}
function statusVariant(
  status: RequestRecord["status"]
): "default" | "destructive" | "outline" | "secondary" {
  return status === "approved"
    ? "default"
    : status === "rejected"
      ? "destructive"
      : status === "pending"
        ? "outline"
        : "secondary"
}
function decisionLabel(action: string) {
  return (
    (
      {
        approved: "Disetujui",
        rejected: "Ditolak",
        cancelled: "Dibatalkan",
        routine_applied: "Koreksi rutin diterapkan",
        review_accepted: "Review diterima",
        review_rejected: "Review ditolak",
      } as Record<string, string>
    )[action] ?? action
  )
}
function outcomeLabel(outcome: string) {
  return (
    (
      {
        present: "Hadir",
        leave: "Cuti",
        sick: "Sakit",
        permission: "Izin",
        exceptional_attendance: "Kehadiran khusus",
        potential_absence: "Potensi tidak hadir",
        confirmed_absence_pending_finalization: "Ketidakhadiran ditinjau",
        no_recorded_outcome: "Belum ada hasil",
      } as Record<string, string>
    )[outcome] ?? outcome
  )
}
function indicatorLabel(indicator: string) {
  return (
    (
      {
        missing_checkout: "checkout belum tercatat",
        unscheduled_work: "kerja di luar jadwal",
        rest_day_work: "kerja pada hari libur",
        outlet_closed: "outlet tutup",
        location_outside_range: "lokasi di luar area",
        approved_leave_with_recorded_attendance:
          "izin berbenturan dengan kehadiran",
      } as Record<string, string>
    )[indicator] ?? indicator.replaceAll("_", " ")
  )
}
function formatDate(value: string | null) {
  if (!value) return "—"
  const date = new Date(value)
  return Number.isNaN(date.valueOf())
    ? "—"
    : date.toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" })
}
function formatDuration(seconds: number | null) {
  return seconds === null
    ? "belum ditentukan"
    : `${Math.floor(seconds / 3600)}j ${Math.floor((seconds % 3600) / 60)}m`
}
