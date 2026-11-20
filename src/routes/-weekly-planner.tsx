import { useCallback, useEffect, useRef, useState } from "react"
import { WeeklyPlannerBoard } from "@/components/weekly-planner-board"
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
import { Checkbox } from "@/components/ui/checkbox"
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
import { Skeleton } from "@/components/ui/skeleton"
import { apiRequest, ApiError } from "@/lib/api"
import type { ShiftTemplate } from "@/lib/shift-templates"
import { useConfigurationDraft } from "@/lib/use-configuration-draft"
import {
  plannerDateLabel,
  replacePlannerEntry,
  staffingLabels,
  staffingOptions,
  staffingRoles,
  staffingTimes,
  type PlannerEntry,
  type PlannerWeek,
  type Staffing,
  type StaffingReport,
} from "@/lib/weekly-planner"

type Command = { path: string; method: string; body: unknown; key: string }
type Modal = "staffing" | "entry" | "copy" | "publish" | null
function message(error: unknown) {
  if (error instanceof ApiError && error.errors)
    return Object.values(error.errors).flat().join(" ")
  return error instanceof Error ? error.message : "Permintaan belum berhasil."
}

export function WeeklyPlanner({
  outletId,
  outletName,
  weekStart,
  templates,
  onBusyChange,
  onPublished,
}: {
  outletId: number
  outletName: string
  weekStart: string
  templates: ShiftTemplate[]
  onBusyChange: (busy: boolean) => void
  onPublished: () => void
}) {
  const base = `/management/scheduling/planner/outlets/${outletId}/weeks/${weekStart}`
  const [data, setData] = useState<PlannerWeek | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")
  const [stale, setStale] = useState(false)
  const [uncertain, setUncertain] = useState(false)
  const [modal, setModal] = useState<Modal>(null)
  const [reason, setReason] = useState("")
  const [configuration, setConfiguration] = useState<Staffing>({
    morning: 0,
    middle: 0,
    evening: 0,
  })
  const [editingExisting, setEditingExisting] = useState(false)
  const [employeeId, setEmployeeId] = useState("")
  const [date, setDate] = useState(weekStart)
  const [assignment, setAssignment] = useState("rest")
  const [sourceWeek, setSourceWeek] = useState("")
  const [preview, setPreview] = useState<{
    version: number
    staffing_report: StaffingReport
  } | null>(null)
  const [acknowledged, setAcknowledged] = useState(false)
  const pending = useRef<Command | null>(null)
  const alive = useRef(true)
  const actionLock = useRef(false)
  const guard = useConfigurationDraft(busy || uncertain)
  const callbacks = useRef({ onBusyChange, onPublished })
  callbacks.current = { onBusyChange, onPublished }
  const refresh = useCallback(async () => {
    const next = await apiRequest<PlannerWeek>(base)
    if (next.outlet.id !== outletId || next.week_start !== weekStart)
      throw new Error("Konteks roster tidak sesuai. Muat ulang.")
    if (alive.current) {
      setData(next)
      setPreview(null)
      setAcknowledged(false)
      setStale(false)
    }
  }, [base, outletId, weekStart])
  useEffect(() => {
    alive.current = true
    void refresh()
      .catch((caught) => {
        if (alive.current) setError(message(caught))
      })
      .finally(() => {
        if (alive.current) setLoading(false)
      })
    return () => {
      alive.current = false
      callbacks.current.onBusyChange(false)
    }
  }, [refresh])
  useEffect(() => {
    callbacks.current.onBusyChange(busy || uncertain || modal !== null)
  }, [busy, uncertain, modal])
  const current = data?.draft ?? data?.published
  const entries = current?.entries ?? []
  const staffing = current?.staffing
  const disabled = loading || busy || stale || uncertain
  const shiftLabels = Object.fromEntries(
    templates.flatMap((template) =>
      template.versions.map((version) => [
        version.id,
        `${template.name} · ${version.start_time.slice(0, 5)}–${version.end_time.slice(0, 5)} · v${version.revision}`,
      ])
    )
  )

  function close() {
    setModal(null)
    guard.clear()
    setReason("")
    setAcknowledged(false)
  }
  function open(next: Modal) {
    setError("")
    setNotice("")
    setReason("")
    setAcknowledged(false)
    setConfiguration(staffing ?? { morning: 0, middle: 0, evening: 0 })
    setModal(next)
  }
  async function send(command: Command) {
    if (actionLock.current) return
    actionLock.current = true
    setBusy(true)
    setError("")
    pending.current = command
    try {
      await apiRequest(command.path, {
        method: command.method,
        body: command.body,
        headers: { "Idempotency-Key": command.key },
      })
      if (!alive.current) return
      pending.current = null
      setUncertain(false)
      close()
      setNotice("Perubahan roster tersimpan.")
      await refresh()
      if (alive.current && command.path.endsWith("/publish"))
        callbacks.current.onPublished()
    } catch (caught) {
      if (!alive.current) return
      setError(message(caught))
      if (!pending.current) setStale(true)
      if (
        caught instanceof ApiError &&
        caught.status >= 400 &&
        caught.status < 500
      ) {
        pending.current = null
        setUncertain(false)
        if (caught.status === 409) {
          setStale(true)
          setPreview(null)
          setAcknowledged(false)
        }
      } else if (pending.current) {
        setUncertain(true)
      }
    } finally {
      actionLock.current = false
      if (alive.current) setBusy(false)
    }
  }
  function save(nextEntries: PlannerEntry[], nextStaffing: Staffing) {
    if (!data) return
    void send({
      path: `${base}/draft`,
      method: "PUT",
      key: crypto.randomUUID(),
      body: {
        expected_version: data.version,
        entries: nextEntries,
        staffing: nextStaffing,
        reason,
      },
    })
  }
  async function checkPublication() {
    if (!data?.draft || actionLock.current) return
    actionLock.current = true
    setBusy(true)
    setError("")
    setAcknowledged(false)
    try {
      const result = await apiRequest<{
        version: number
        staffing_report: StaffingReport
      }>(`${base}/validate`, {
        method: "POST",
        body: { expected_version: data.version },
      })
      if (alive.current) {
        setPreview(result)
        open("publish")
      }
    } catch (caught) {
      if (alive.current) {
        setError(message(caught))
        if (caught instanceof ApiError && caught.status === 409) setStale(true)
      }
    } finally {
      actionLock.current = false
      if (alive.current) setBusy(false)
    }
  }
  if (loading)
    return (
      <div role="status" aria-label="Memuat planner">
        <Skeleton className="h-24 w-full" />
      </div>
    )
  if (!data)
    return (
      <Alert variant="destructive">
        <AlertTitle>Planner belum tersedia</AlertTitle>
        <AlertDescription>
          {error}
          <Button
            variant="outline"
            onClick={() => {
              setLoading(true)
              void refresh()
                .catch((caught) => setError(message(caught)))
                .finally(() => setLoading(false))
            }}
          >
            Coba lagi
          </Button>
        </AlertDescription>
      </Alert>
    )

  return (
    <section
      className="flex min-w-0 flex-col gap-4"
      aria-label={`Planner ${outletName}`}
    >
      {guard.dialog}
      <Card>
        <CardHeader>
          <CardTitle>Planner mingguan</CardTitle>
          <CardDescription>
            {outletName} · {plannerDateLabel(weekStart)} sampai Minggu · edit
            penugasan saat diperlukan.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-2">
            <Badge variant="outline">
              Draf {data.draft ? `#${data.draft.revision_id}` : "belum ada"}
            </Badge>
            <Badge variant="secondary">
              Published{" "}
              {data.published ? `#${data.published.revision_id}` : "belum ada"}
            </Badge>
            <Badge variant="outline">Versi {data.version}</Badge>
          </div>
          <p className="text-caption text-muted-foreground">
            {data.outlet.weekly_planner_start_on
              ? `Roster berlaku mulai ${data.outlet.weekly_planner_start_on}.`
              : "Publikasi menyiapkan roster. Aktivasi sebagai sumber absensi adalah langkah Owner terpisah dan tidak dilakukan di sini."}{" "}
            Draf tidak mengubah jadwal karyawan atau absensi.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              disabled={disabled}
              onClick={() => open("staffing")}
            >
              {staffing ? "Konfigurasi shift" : "Siapkan shift staffing"}
            </Button>
            <Button
              variant="outline"
              disabled={disabled || !data.published_weeks.length}
              onClick={() => {
                setSourceWeek(data.published_weeks[0]?.week_start ?? "")
                open("copy")
              }}
            >
              Salin minggu published
            </Button>
            <Button
              disabled={disabled || !data.draft || !staffing}
              onClick={() => void checkPublication()}
            >
              Periksa dan publikasikan
            </Button>
          </div>
          <p className="text-caption">
            Hari kerja: 1 pagi, 1 tengah, 1 sore. Akhir pekan: 2 pagi, 2 sore,
            tanpa tengah.
          </p>
        </CardContent>
      </Card>
      {error ? (
        <Alert variant="destructive">
          <AlertTitle>
            {stale
              ? "Versi roster berubah"
              : uncertain
                ? "Hasil perubahan belum pasti"
                : "Perubahan belum dapat dilanjutkan"}
          </AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {uncertain ? (
        <Button
          variant="outline"
          disabled={busy}
          onClick={() => {
            if (pending.current) void send(pending.current)
          }}
        >
          Periksa hasil dengan kunci yang sama
        </Button>
      ) : null}
      {stale ? (
        <Button
          variant="outline"
          disabled={busy}
          onClick={() => {
            close()
            void refresh().catch((caught) => setError(message(caught)))
          }}
        >
          Muat versi terbaru
        </Button>
      ) : null}
      {notice ? (
        <p role="status" className="text-body">
          {notice}
        </p>
      ) : null}
      {data.staffing_report?.conflicts.length ? (
        <Alert variant="destructive">
          <AlertTitle>Konflik staffing</AlertTitle>
          <AlertDescription>
            {data.staffing_report.conflicts.join(" ")}
          </AlertDescription>
        </Alert>
      ) : null}
      {data.staffing_report?.deficits.length ? (
        <Alert>
          <AlertTitle>
            {data.staffing_report.deficits.length} kebutuhan shift belum
            terpenuhi
          </AlertTitle>
          <AlertDescription>
            Kekurangan staf tidak menghalangi publikasi setelah ditinjau dan
            diakui. Penugasan tidak valid tetap ditolak.
          </AlertDescription>
        </Alert>
      ) : null}
      <WeeklyPlannerBoard
        weekStart={weekStart}
        entries={entries}
        employees={data.employees}
        report={data.staffing_report}
        shiftLabels={shiftLabels}
        disabled={disabled || !staffing}
        onEdit={(day, entry) => {
          setDate(day)
          setEditingExisting(Boolean(entry))
          setEmployeeId(entry ? String(entry.employee_id) : "")
          setAssignment(
            entry?.status === "work"
              ? String(entry.shift_template_version_id)
              : (entry?.status ?? "rest")
          )
          open("entry")
        }}
      />
      <Dialog
        open={modal !== null}
        onOpenChange={(value) => {
          if (!value && !busy && !uncertain) guard.attempt(close)
        }}
      >
        <DialogContent
          className="max-h-[85dvh] overflow-y-auto"
          showCloseButton={!busy && !uncertain}
        >
          <DialogHeader>
            <DialogTitle>
              {modal === "staffing"
                ? "Pemetaan shift staffing"
                : modal === "copy"
                  ? "Salin minggu published"
                  : modal === "publish"
                    ? "Tinjau publikasi"
                    : "Atur penugasan"}
            </DialogTitle>
            <DialogDescription>
              {outletName} · minggu {weekStart}. Perubahan dicatat beserta
              alasan.
            </DialogDescription>
          </DialogHeader>
          {error ? (
            <Alert variant="destructive">
              <AlertTitle>Periksa kembali</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          {stale ? (
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                close()
                void refresh().catch((caught) => setError(message(caught)))
              }}
            >
              Muat versi terbaru
            </Button>
          ) : null}
          {uncertain ? (
            <Alert>
              <AlertTitle>Jangan kirim perubahan baru</AlertTitle>
              <AlertDescription>
                Periksa hasil permintaan yang sama sebelum melanjutkan.
              </AlertDescription>
            </Alert>
          ) : null}
          <form
            onSubmit={(event) => {
              event.preventDefault()
              if (disabled || reason.trim().length < 3) return
              if (modal === "staffing") save(entries, configuration)
              if (modal === "entry" && staffing && employeeId)
                save(
                  replacePlannerEntry(entries, {
                    employee_id: Number(employeeId),
                    work_date: date,
                    status:
                      assignment === "rest" || assignment === "unscheduled"
                        ? assignment
                        : "work",
                    shift_template_version_id:
                      assignment === "rest" || assignment === "unscheduled"
                        ? null
                        : Number(assignment),
                  }),
                  staffing
                )
              if (modal === "copy") {
                const source = data.published_weeks.find(
                  (item) => item.week_start === sourceWeek
                )
                if (source)
                  void send({
                    path: `${base}/copy`,
                    method: "POST",
                    key: crypto.randomUUID(),
                    body: {
                      expected_version: data.version,
                      source_week_start: sourceWeek,
                      source_revision_id: source.published_revision_id,
                      ...(staffing ? { staffing } : {}),
                      reason,
                    },
                  })
              }
              if (
                modal === "publish" &&
                preview?.version === data.version &&
                (!preview.staffing_report.deficits.length || acknowledged)
              )
                void send({
                  path: `${base}/publish`,
                  method: "POST",
                  key: crypto.randomUUID(),
                  body: {
                    expected_version: data.version,
                    expected_published_revision_id:
                      data.published?.revision_id ?? null,
                    warnings_checksum: acknowledged
                      ? preview.staffing_report.checksum
                      : null,
                    reason,
                  },
                })
            }}
          >
            <FieldGroup>
              {modal === "staffing"
                ? staffingRoles.map((role) => (
                    <Field key={role}>
                      <FieldLabel htmlFor={`planner-${role}`}>
                        {staffingLabels[role]} · {staffingTimes[role].join("–")}
                      </FieldLabel>
                      <NativeSelect
                        id={`planner-${role}`}
                        required
                        disabled={disabled}
                        value={configuration[role] || ""}
                        onChange={(event) => {
                          setConfiguration((current) => ({
                            ...current,
                            [role]: Number(event.target.value),
                          }))
                          guard.mark()
                        }}
                      >
                        <NativeSelectOption value="">
                          Pilih versi shift
                        </NativeSelectOption>
                        {staffingOptions(templates, role, weekStart).map(
                          (version) => (
                            <NativeSelectOption
                              value={version.id}
                              key={version.id}
                            >
                              {version.name} · v{version.revision}
                            </NativeSelectOption>
                          )
                        )}
                      </NativeSelect>
                    </Field>
                  ))
                : null}
              {modal === "staffing" ? (
                <p className="text-caption">
                  Jika versi yang sesuai belum tersedia, Owner perlu
                  menyiapkannya melalui Template shift.
                </p>
              ) : null}
              {modal === "entry" ? (
                <>
                  <Field>
                    <FieldLabel htmlFor="planner-employee">
                      Karyawan · {plannerDateLabel(date)}
                    </FieldLabel>
                    <NativeSelect
                      id="planner-employee"
                      required
                      value={employeeId}
                      disabled={disabled || editingExisting}
                      onChange={(event) => {
                        setEmployeeId(event.target.value)
                        guard.mark()
                      }}
                    >
                      <NativeSelectOption value="">
                        Pilih karyawan
                      </NativeSelectOption>
                      {data.employees.map((employee) => (
                        <NativeSelectOption
                          key={employee.id}
                          value={employee.id}
                        >
                          {employee.name}
                        </NativeSelectOption>
                      ))}
                    </NativeSelect>
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="planner-assignment">
                      Penugasan
                    </FieldLabel>
                    <NativeSelect
                      id="planner-assignment"
                      value={assignment}
                      disabled={disabled}
                      onChange={(event) => {
                        setAssignment(event.target.value)
                        guard.mark()
                      }}
                    >
                      <NativeSelectOption value="rest">
                        Istirahat
                      </NativeSelectOption>
                      <NativeSelectOption value="unscheduled">
                        Tidak dijadwalkan
                      </NativeSelectOption>
                      {staffingRoles
                        .filter(
                          (role) =>
                            role !== "middle" ||
                            (new Date(`${date}T12:00:00Z`).getUTCDay() !== 0 &&
                              new Date(`${date}T12:00:00Z`).getUTCDay() !== 6)
                        )
                        .map((role) => (
                          <NativeSelectOption
                            key={role}
                            value={staffing?.[role] ?? ""}
                          >
                            {staffingLabels[role]} ·{" "}
                            {staffingTimes[role].join("–")}
                          </NativeSelectOption>
                        ))}
                    </NativeSelect>
                  </Field>
                </>
              ) : null}
              {modal === "copy" ? (
                <>
                  <Field>
                    <FieldLabel htmlFor="planner-source">
                      Minggu sumber
                    </FieldLabel>
                    <NativeSelect
                      id="planner-source"
                      value={sourceWeek}
                      disabled={disabled}
                      required
                      onChange={(event) => {
                        setSourceWeek(event.target.value)
                        guard.mark()
                      }}
                    >
                      {data.published_weeks.map((source) => (
                        <NativeSelectOption
                          key={source.week_start}
                          value={source.week_start}
                        >
                          {source.week_start} · revisi #
                          {source.published_revision_id}
                        </NativeSelectOption>
                      ))}
                    </NativeSelect>
                  </Field>
                  <p className="text-body">
                    Salinan menggantikan isi draf minggu ini. Published tetap
                    tersimpan. Semua penugasan diperiksa kembali; karyawan tidak
                    ditambahkan otomatis.
                  </p>
                </>
              ) : null}
              {modal === "publish" && preview ? (
                <>
                  <p className="text-body">
                    Validasi penugasan lolos untuk versi {preview.version}.
                  </p>
                  {preview.staffing_report.deficits.length ? (
                    <>
                      <ul className="flex max-h-48 flex-col gap-1 overflow-y-auto text-caption">
                        {preview.staffing_report.deficits.map((item) => (
                          <li key={`${item.work_date}-${item.role}`}>
                            {plannerDateLabel(item.work_date)} ·{" "}
                            {staffingLabels[item.role]}: {item.assigned}/
                            {item.required}, kurang {item.missing}
                          </li>
                        ))}
                      </ul>
                      <Field orientation="horizontal">
                        <Checkbox
                          id="planner-ack"
                          checked={acknowledged}
                          disabled={disabled}
                          onCheckedChange={(value) =>
                            setAcknowledged(value === true)
                          }
                        />
                        <FieldLabel htmlFor="planner-ack">
                          Saya memahami kekurangan staf pada daftar ini dan
                          tetap memublikasikan.
                        </FieldLabel>
                      </Field>
                    </>
                  ) : (
                    <p className="text-body">
                      Seluruh target staffing terpenuhi.
                    </p>
                  )}
                </>
              ) : null}
              <Field>
                <FieldLabel htmlFor="planner-reason">
                  Alasan perubahan
                </FieldLabel>
                <Input
                  id="planner-reason"
                  required
                  minLength={3}
                  maxLength={1000}
                  value={reason}
                  disabled={disabled}
                  onChange={(event) => {
                    setReason(event.target.value)
                    guard.mark()
                  }}
                />
              </Field>
            </FieldGroup>
            <DialogFooter className="mt-4 flex-wrap">
              {modal === "entry" && editingExisting && staffing ? (
                <Button
                  type="button"
                  variant="outline"
                  disabled={disabled || reason.trim().length < 3}
                  onClick={() =>
                    save(
                      entries.filter(
                        (entry) =>
                          entry.employee_id !== Number(employeeId) ||
                          entry.work_date !== date
                      ),
                      staffing
                    )
                  }
                >
                  Hapus dari draf
                </Button>
              ) : null}
              <Button
                type="button"
                variant="outline"
                disabled={busy || uncertain}
                onClick={() => guard.attempt(close)}
              >
                Batal
              </Button>
              <Button
                type="submit"
                disabled={
                  disabled ||
                  reason.trim().length < 3 ||
                  (modal === "publish" &&
                    (!preview ||
                      preview.version !== data.version ||
                      (preview.staffing_report.deficits.length > 0 &&
                        !acknowledged)))
                }
              >
                {busy
                  ? "Memproses…"
                  : modal === "publish"
                    ? "Publikasikan roster"
                    : "Simpan draf"}
              </Button>
            </DialogFooter>
          </form>
          {uncertain ? (
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => {
                if (pending.current) void send(pending.current)
              }}
            >
              Periksa hasil dengan kunci yang sama
            </Button>
          ) : null}
        </DialogContent>
      </Dialog>
    </section>
  )
}
