import { ArrowLeft01Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { useEffect, useMemo, useRef, useState } from "react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { Separator } from "@/components/ui/separator"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Textarea } from "@/components/ui/textarea"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import {
  type CorrectionType,
  correctionTypeLabel,
} from "@/lib/attendance-correction-navigation"

type RequestFilter = "all" | "processing" | "completed"
type PrototypeScenario = "pending" | "expired" | "unavailable" | "uncertain"
type SessionCorrectionType = Exclude<CorrectionType, "reconstruction">
type CorrectionOption = {
  session_id: number
  work_date: string
  outlet: { id: number; name: string }
  correction_type: SessionCorrectionType
  can_start: boolean
  deadline: { exclusive_at: string; historical_timezone: string }
  original: { check_in_at: string; check_out_at: string | null }
}
type RequestStatus = "pending" | "approved" | "rejected"
type SyntheticRequest = {
  id: number
  type: "attendance_correction" | "leave" | "overtime"
  status: RequestStatus
  title: string
  work_date: string
  submitted_at: string
  reason: string
  outlet?: { id: number; name: string }
  session_id?: number
  correction_type?: SessionCorrectionType
  original?: { check_in_at: string | null; check_out_at: string | null }
  proposed?: { check_in_at: string | null; check_out_at: string | null }
  decision_reason?: string
  date_range?: string
}
type CorrectionDraft = {
  option: CorrectionOption
  proposed: { check_in_at: string | null; check_out_at: string | null }
  reason: string
}
type ComposerState =
  | { mode: "guided" }
  | { mode: "context"; option: CorrectionOption | null }
  | null

const scenarioLabels: Record<PrototypeScenario, string> = {
  pending: "Respons diterima · menunggu keputusan",
  expired: "Batas pengajuan terlewati",
  unavailable: "Opsi koreksi tidak tersedia",
  uncertain: "Respons pengiriman belum pasti",
}

const requestFilterLabels: Record<RequestFilter, string> = {
  all: "Semua",
  processing: "Diproses",
  completed: "Selesai",
}

function dateAtOffset(offset: number): string {
  const date = new Date()
  date.setDate(date.getDate() + offset)
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-")
}

function timestamp(workDate: string, time: string): string {
  return `${workDate}T${time}:00+07:00`
}

function toInputValue(value: string | null): string {
  return value ? value.slice(0, 16) : ""
}

function inputToInstant(value: string): string | null {
  return value ? `${value}:00+07:00` : null
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("id-ID", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${value}T12:00:00Z`))
}

function formatInstant(
  value: string | null,
  timezone = "Asia/Jakarta"
): string {
  if (!value) return "Belum tercatat"
  return new Intl.DateTimeFormat("id-ID", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: timezone,
  }).format(new Date(value))
}

function formatComparisonInstant(
  value: string | null,
  timezone = "Asia/Jakarta"
): string {
  if (!value) return "Belum tercatat"
  return new Intl.DateTimeFormat("id-ID", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: timezone,
  }).format(new Date(value))
}

function correctionOptions(scenario: PrototypeScenario): CorrectionOption[] {
  if (scenario === "unavailable") return []

  const definitions: Array<{
    session_id: number
    offset: number
    outlet: CorrectionOption["outlet"]
    correction_type: SessionCorrectionType
    checkIn: string
    checkOut: string | null
    deadlineOffset: number
  }> = [
    {
      session_id: 1041,
      offset: -2,
      outlet: { id: 1, name: "Outlet Menteng" },
      correction_type: "session",
      checkIn: "09:02",
      checkOut: "17:04",
      deadlineOffset: 4,
    },
    {
      session_id: 1048,
      offset: -1,
      outlet: { id: 3, name: "Outlet Kuningan" },
      correction_type: "missing_checkout",
      checkIn: "09:07",
      checkOut: null,
      deadlineOffset: 3,
    },
    {
      session_id: 1052,
      offset: 0,
      outlet: { id: 2, name: "Outlet Kemang" },
      correction_type: "check_in",
      checkIn: "08:58",
      checkOut: null,
      deadlineOffset: 2,
    },
  ]

  return definitions.map((definition) => {
    const workDate = dateAtOffset(definition.offset)
    const deadlineDate = dateAtOffset(
      scenario === "expired" ? -1 : definition.deadlineOffset
    )
    return {
      session_id: definition.session_id,
      work_date: workDate,
      outlet: definition.outlet,
      correction_type: definition.correction_type,
      can_start: scenario !== "expired",
      deadline: {
        exclusive_at: timestamp(deadlineDate, "23:59"),
        historical_timezone: "Asia/Jakarta",
      },
      original: {
        check_in_at: timestamp(workDate, definition.checkIn),
        check_out_at: definition.checkOut
          ? timestamp(workDate, definition.checkOut)
          : null,
      },
    }
  })
}

function requestFixtures(): SyntheticRequest[] {
  const options = correctionOptions("pending")
  const wholeSession = options[0]
  const missingCheckout = options[1]
  const today = dateAtOffset(0)
  const yesterday = dateAtOffset(-1)
  const twoDaysAgo = dateAtOffset(-2)
  const threeDaysAgo = dateAtOffset(-3)

  const fixtures: SyntheticRequest[] = [
    {
      id: 8104,
      type: "attendance_correction",
      status: "pending",
      title: "Koreksi presensi keluar",
      work_date: missingCheckout.work_date,
      submitted_at: timestamp(yesterday, "18:14"),
      reason: "Presensi keluar terlewat setelah pekerjaan selesai.",
      outlet: missingCheckout.outlet,
      session_id: missingCheckout.session_id,
      correction_type: missingCheckout.correction_type,
      original: missingCheckout.original,
      proposed: {
        check_in_at: missingCheckout.original.check_in_at,
        check_out_at: timestamp(yesterday, "17:12"),
      },
    },
    {
      id: 8103,
      type: "attendance_correction",
      status: "approved",
      title: "Koreksi waktu masuk dan keluar",
      work_date: wholeSession.work_date,
      submitted_at: timestamp(twoDaysAgo, "18:10"),
      reason: "Waktu pada perangkat tidak tersinkron.",
      outlet: wholeSession.outlet,
      session_id: wholeSession.session_id,
      correction_type: wholeSession.correction_type,
      original: wholeSession.original,
      proposed: {
        check_in_at: timestamp(wholeSession.work_date, "09:00"),
        check_out_at: timestamp(wholeSession.work_date, "17:00"),
      },
      decision_reason: "Data pendukung sesuai dengan catatan pengelola.",
    },
    {
      id: 8102,
      type: "leave",
      status: "rejected",
      title: "Permintaan izin",
      work_date: threeDaysAgo,
      submitted_at: timestamp(threeDaysAgo, "07:45"),
      reason: "Ada urusan keluarga yang perlu diselesaikan.",
      date_range: formatDate(threeDaysAgo),
      decision_reason: "Jadwal perlu dikonfirmasi dengan pengelola.",
    },
    {
      id: 8101,
      type: "overtime",
      status: "pending",
      title: "Permintaan lembur",
      work_date: today,
      submitted_at: timestamp(today, "00:15"),
      reason: "Menyelesaikan penutupan Outlet.",
      outlet: { id: 2, name: "Outlet Kemang" },
    },
  ]
  return fixtures.sort((left, right) =>
    right.submitted_at.localeCompare(left.submitted_at)
  )
}

function statusText(status: RequestStatus): string {
  return {
    pending: "Diproses",
    approved: "Disetujui",
    rejected: "Ditolak",
  }[status]
}

function statusVariant(
  status: RequestStatus
): "outline" | "default" | "destructive" {
  if (status === "approved") return "default"
  if (status === "rejected") return "destructive"
  return "outline"
}

function formatType(type: SyntheticRequest["type"]): string {
  return {
    attendance_correction: "Koreksi presensi",
    leave: "Izin",
    overtime: "Lembur",
  }[type]
}

function displayedDate(request: SyntheticRequest): string {
  return request.date_range ?? formatDate(request.work_date)
}

function RequestDetails({ request }: { request: SyntheticRequest }) {
  return (
    <div
      className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-[calc(1rem+env(safe-area-inset-bottom))]"
      data-request-detail-scroll="true"
    >
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 border-b border-border py-2">
        <div className="min-w-0">
          <dt className="text-caption text-muted-foreground">Status</dt>
          <dd className="break-words text-body">
            {statusText(request.status)}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-caption text-muted-foreground">Tanggal</dt>
          <dd className="break-words text-body">{displayedDate(request)}</dd>
        </div>
        {request.outlet ? (
          <div className="min-w-0">
            <dt className="text-caption text-muted-foreground">Outlet</dt>
            <dd className="break-words text-body">{request.outlet.name}</dd>
          </div>
        ) : null}
        {request.session_id ? (
          <div className="min-w-0">
            <dt className="text-caption text-muted-foreground">
              Sesi presensi
            </dt>
            <dd className="break-words text-body">#{request.session_id}</dd>
          </div>
        ) : null}
        {request.correction_type ? (
          <div className="min-w-0">
            <dt className="text-caption text-muted-foreground">
              Jenis koreksi
            </dt>
            <dd className="break-words text-body">
              {correctionTypeLabel(request.correction_type)}
            </dd>
          </div>
        ) : null}
      </dl>

      {request.original && request.proposed ? (
        <>
          <Separator />
          <TimeComparison
            original={request.original}
            proposed={request.proposed}
            title="Perbandingan waktu"
          />
        </>
      ) : null}

      <Separator />
      <section className="py-3">
        <h3 className="text-label">Alasan</h3>
        <p className="mt-1 text-body">{request.reason}</p>
      </section>
      {request.decision_reason ? (
        <>
          <Separator />
          <section className="py-3">
            <h3 className="text-label">
              {request.status === "rejected"
                ? "Catatan penolakan"
                : "Catatan keputusan"}
            </h3>
            <p className="mt-1 text-body">{request.decision_reason}</p>
          </section>
        </>
      ) : null}
      <p className="pb-2 text-caption text-muted-foreground">
        Diajukan {formatInstant(request.submitted_at)}
      </p>
    </div>
  )
}

function TimeComparison({
  title,
  original,
  proposed,
}: {
  title: string
  original: { check_in_at: string | null; check_out_at: string | null }
  proposed: { check_in_at: string | null; check_out_at: string | null }
}) {
  return (
    <table className="w-full table-fixed border-y border-border text-left">
      <caption className="py-2 text-left text-label">{title}</caption>
      <thead>
        <tr className="border-b border-border text-caption text-muted-foreground">
          <th className="w-[4.25rem] py-2 pr-2 font-normal" scope="col">
            Waktu
          </th>
          <th className="px-1 py-2 font-normal" scope="col">
            Asli
          </th>
          <th className="py-2 pl-1 font-normal" scope="col">
            Diajukan
          </th>
        </tr>
      </thead>
      <tbody className="divide-y divide-border">
        {(
          [
            ["Masuk", original.check_in_at, proposed.check_in_at],
            ["Keluar", original.check_out_at, proposed.check_out_at],
          ] as const
        ).map(([label, originalValue, proposedValue]) => (
          <tr key={label}>
            <th className="py-2 pr-2 text-caption font-normal" scope="row">
              {label}
            </th>
            <td className="break-words px-1 py-2 text-caption tabular-nums">
              {formatComparisonInstant(originalValue)}
            </td>
            <td className="break-words py-2 pl-1 text-caption tabular-nums">
              {formatComparisonInstant(proposedValue)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function RequestDetailOverlay({
  request,
  wide,
  onClose,
}: {
  request: SyntheticRequest
  wide: boolean
  onClose: () => void
}) {
  const title = request.title
  const content = <RequestDetails request={request} />

  if (wide) {
    return (
      <Sheet open onOpenChange={(open) => !open && onClose()}>
        <SheetContent
          className="w-full overflow-hidden pb-[env(safe-area-inset-bottom)] sm:max-w-md"
          side="right"
        >
          <SheetHeader className="gap-1 border-b border-border px-5 pb-3 pt-5 pr-14">
            <SheetTitle>{title}</SheetTitle>
            <SheetDescription>{formatType(request.type)}</SheetDescription>
          </SheetHeader>
          {content}
        </SheetContent>
      </Sheet>
    )
  }

  return (
    <Drawer open onOpenChange={(open) => !open && onClose()}>
      <DrawerContent className="max-h-[88dvh] overflow-hidden rounded-t-lg pb-0 before:rounded-lg">
        <DrawerHeader className="px-5 pb-2 pt-1 text-left">
          <DrawerTitle>{title}</DrawerTitle>
          <DrawerDescription>{formatType(request.type)}</DrawerDescription>
        </DrawerHeader>
        {content}
      </DrawerContent>
    </Drawer>
  )
}

function CorrectionSummary({ option }: { option: CorrectionOption }) {
  return (
    <dl className="grid gap-x-4 gap-y-2 border-y border-border py-3 sm:grid-cols-2">
      <SummaryField
        label="Tanggal kerja"
        value={formatDate(option.work_date)}
      />
      <SummaryField label="Outlet asal" value={option.outlet.name} />
      <SummaryField label="Sesi presensi" value={`#${option.session_id}`} />
      <SummaryField
        label="Jenis koreksi"
        value={correctionTypeLabel(option.correction_type)}
      />
      <SummaryField
        label="Batas pengajuan"
        value={formatInstant(
          option.deadline.exclusive_at,
          option.deadline.historical_timezone
        )}
      />
    </dl>
  )
}

function SummaryField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-caption text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-body">{value}</dd>
    </div>
  )
}

function CorrectionComposer({
  composer,
  options,
  scenario,
  onClose,
  onSubmit,
}: {
  composer: Exclude<ComposerState, null>
  options: CorrectionOption[]
  scenario: PrototypeScenario
  onClose: () => void
  onSubmit: (draft: CorrectionDraft) => Promise<void>
}) {
  const [sessionId, setSessionId] = useState("")
  const [showForm, setShowForm] = useState(composer.mode === "context")
  const titleRef = useRef<HTMLHeadingElement | null>(null)
  const eligibleOptions = options.filter((option) => option.can_start)
  const selectedOption = eligibleOptions.find(
    (option) => String(option.session_id) === sessionId
  )
  const option = composer.mode === "context" ? composer.option : selectedOption
  const title = showForm ? "Koreksi presensi" : "Buat permintaan"

  useEffect(() => {
    window.requestAnimationFrame(() => titleRef.current?.focus())
  }, [])

  function focusTitle() {
    window.requestAnimationFrame(() => titleRef.current?.focus())
  }

  function goBack() {
    if (composer.mode === "guided" && showForm) {
      setShowForm(false)
      focusTitle()
      return
    }
    onClose()
  }

  const body = (
    <>
      {composer.mode === "guided" && !showForm ? (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-3">
            {scenario === "unavailable" ? (
              <Empty
                className="min-h-40 rounded-lg border-0 px-0 py-8"
                role="status"
              >
                <EmptyHeader>
                  <EmptyTitle>Tidak ada opsi koreksi</EmptyTitle>
                  <EmptyDescription>
                    Data sintetis tidak menyediakan sesi yang dapat diajukan.
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : scenario === "expired" ? (
              <Alert className="rounded-lg">
                <AlertTitle>Tidak ada sesi yang dapat diajukan</AlertTitle>
                <AlertDescription>
                  Batas waktu opsi koreksi contoh telah terlewati.
                </AlertDescription>
              </Alert>
            ) : (
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="prototype-correction-session">
                    Sesi presensi yang dapat dikoreksi
                  </FieldLabel>
                  <NativeSelect
                    id="prototype-correction-session"
                    onChange={(event) => setSessionId(event.target.value)}
                    value={sessionId}
                  >
                    <NativeSelectOption value="" disabled>
                      Pilih sesi
                    </NativeSelectOption>
                    {eligibleOptions.map((item) => (
                      <NativeSelectOption
                        key={item.session_id}
                        value={String(item.session_id)}
                      >
                        {formatDate(item.work_date)} · sesi #{item.session_id} ·{" "}
                        {item.outlet.name}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                </Field>
                {selectedOption ? (
                  <div
                    aria-live="polite"
                    className="border-t border-border pt-3"
                  >
                    <p className="text-caption text-muted-foreground">
                      Koreksi yang tersedia untuk sesi ini
                    </p>
                    <p className="mt-1 text-label">
                      {correctionTypeLabel(selectedOption.correction_type)}
                    </p>
                    <p className="mt-1 text-caption text-muted-foreground">
                      Jenis ini mengikuti opsi contoh yang dievaluasi untuk sesi
                      terpilih.
                    </p>
                  </div>
                ) : null}
              </FieldGroup>
            )}
          </div>
          <div className="shrink-0 border-t border-border bg-background pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-3">
            <Button
              className="w-full"
              disabled={!selectedOption}
              onClick={() => {
                setShowForm(true)
                focusTitle()
              }}
              type="button"
            >
              Lanjutkan
            </Button>
          </div>
        </div>
      ) : option ? (
        <CorrectionDraftForm
          key={`${option.session_id}:${option.work_date}:${option.correction_type}`}
          onSubmit={onSubmit}
          option={option}
        />
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto pb-4">
          <Empty
            className="min-h-40 rounded-lg border-0 px-0 py-8"
            role="status"
          >
            <EmptyHeader>
              <EmptyTitle>Koreksi belum tersedia</EmptyTitle>
              <EmptyDescription>
                Tidak ada opsi koreksi contoh untuk konteks tanggal dan Outlet
                ini.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        </div>
      )}
    </>
  )

  return (
    <div
      className="flex h-dvh min-h-svh flex-col overflow-hidden bg-canvas text-foreground"
      data-correction-page="true"
    >
      <header className="shrink-0 border-b border-border bg-surface pt-[env(safe-area-inset-top)]">
        <div className="mx-auto grid min-h-14 w-full max-w-2xl grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center px-3">
          <Button
            aria-label={
              composer.mode === "guided" && showForm
                ? "Kembali ke pilihan sesi"
                : "Kembali ke Permintaan"
            }
            className="min-h-11 min-w-11 justify-self-start rounded-md px-2"
            onClick={goBack}
            variant="ghost"
          >
            <HugeiconsIcon aria-hidden="true" icon={ArrowLeft01Icon} />
          </Button>
          <h1
            className="min-w-0 truncate text-center text-subtitle"
            id="correction-page-title"
            ref={titleRef}
            tabIndex={-1}
          >
            {title}
          </h1>
          <span aria-hidden="true" />
        </div>
        <p className="px-4 pb-2 text-center text-caption text-muted-foreground">
          Jenis permintaan adalah contoh sintetis, bukan daftar kemampuan API.
        </p>
      </header>

      <main
        aria-labelledby="correction-page-title"
        className="mx-auto flex min-h-0 w-full max-w-2xl flex-1 flex-col px-4 pt-4"
      >
        {body}
      </main>
    </div>
  )
}

function CorrectionDraftForm({
  option,
  onSubmit,
}: {
  option: CorrectionOption
  onSubmit: (draft: CorrectionDraft) => Promise<void>
}) {
  const [checkIn, setCheckIn] = useState("")
  const [checkOut, setCheckOut] = useState("")
  const [reason, setReason] = useState("")
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const blocked = !option.can_start
  const showCheckIn = option.correction_type !== "missing_checkout"
  const showCheckOut = option.correction_type !== "check_in"

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (blocked || busy) return

    const nextErrors: Record<string, string> = {}
    if (showCheckIn && option.correction_type === "check_in" && !checkIn) {
      nextErrors.checkIn = "Isi waktu masuk yang diajukan."
    }
    if (
      showCheckOut &&
      option.correction_type === "missing_checkout" &&
      !checkOut
    ) {
      nextErrors.checkOut = "Isi waktu keluar yang diajukan."
    }
    if (option.correction_type === "session" && !checkIn && !checkOut) {
      nextErrors.values = "Isi setidaknya satu waktu yang akan dikoreksi."
    }
    if (!reason) nextErrors.reason = "Isi alasan pengajuan."
    if (reason.length > 1000)
      nextErrors.reason = "Alasan maksimal 1.000 karakter."

    const effectiveCheckIn =
      inputToInstant(checkIn) ?? option.original.check_in_at
    const effectiveCheckOut =
      inputToInstant(checkOut) ?? option.original.check_out_at
    const checkInTime = new Date(effectiveCheckIn).getTime()
    const checkOutTime = effectiveCheckOut
      ? new Date(effectiveCheckOut).getTime()
      : null
    if (checkInTime > Date.now()) {
      nextErrors.checkIn = "Waktu masuk tidak dapat berada di masa depan."
    }
    if (checkOutTime !== null && checkOutTime > Date.now()) {
      nextErrors.checkOut = "Waktu keluar tidak dapat berada di masa depan."
    }
    if (checkOutTime !== null && checkOutTime <= checkInTime) {
      nextErrors.values = "Waktu keluar harus setelah waktu masuk."
    }

    setErrors(nextErrors)
    if (Object.keys(nextErrors).length > 0) return

    setBusy(true)
    await new Promise((resolve) => window.setTimeout(resolve, 180))
    await onSubmit({
      option,
      proposed: {
        check_in_at: inputToInstant(checkIn) ?? option.original.check_in_at,
        check_out_at: inputToInstant(checkOut) ?? option.original.check_out_at,
      },
      reason,
    })
    setBusy(false)
  }

  if (blocked) {
    return (
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-4">
        <Alert className="rounded-lg" variant="destructive">
          <AlertTitle>Batas pengajuan telah terlewati</AlertTitle>
          <AlertDescription>
            Opsi koreksi ini tidak dapat diajukan pada skenario contoh. Batasnya{" "}
            {formatInstant(
              option.deadline.exclusive_at,
              option.deadline.historical_timezone
            )}
            .
          </AlertDescription>
        </Alert>
        <CorrectionSummary option={option} />
      </div>
    )
  }

  return (
    <form
      className="flex min-h-0 flex-1 flex-col"
      id="prototype-correction-form"
      onSubmit={(event) => void submit(event)}
    >
      <div
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-4"
        data-correction-form-scroll="true"
      >
        <CorrectionSummary option={option} />

        <FieldGroup className="mt-4">
          {showCheckIn ? (
            <Field data-invalid={Boolean(errors.checkIn)}>
              <FieldLabel htmlFor="prototype-effective-check-in">
                Waktu masuk yang diajukan
              </FieldLabel>
              <Input
                aria-invalid={Boolean(errors.checkIn)}
                id="prototype-effective-check-in"
                max={toInputValue(timestamp(dateAtOffset(0), "23:59"))}
                onChange={(event) => setCheckIn(event.target.value)}
                required={option.correction_type === "check_in"}
                type="datetime-local"
                value={checkIn}
              />
              {errors.checkIn ? (
                <p className="text-caption text-destructive" role="alert">
                  {errors.checkIn}
                </p>
              ) : null}
            </Field>
          ) : null}
          {showCheckOut ? (
            <Field data-invalid={Boolean(errors.checkOut)}>
              <FieldLabel htmlFor="prototype-effective-check-out">
                Waktu keluar yang diajukan
              </FieldLabel>
              <Input
                aria-invalid={Boolean(errors.checkOut)}
                id="prototype-effective-check-out"
                max={toInputValue(timestamp(dateAtOffset(0), "23:59"))}
                onChange={(event) => setCheckOut(event.target.value)}
                required={option.correction_type === "missing_checkout"}
                type="datetime-local"
                value={checkOut}
              />
              {errors.checkOut ? (
                <p className="text-caption text-destructive" role="alert">
                  {errors.checkOut}
                </p>
              ) : null}
            </Field>
          ) : null}
          {errors.values ? (
            <p className="text-caption text-destructive" role="alert">
              {errors.values}
            </p>
          ) : null}
          <Field data-invalid={Boolean(errors.reason)}>
            <FieldLabel htmlFor="prototype-correction-reason">
              Alasan
            </FieldLabel>
            <Textarea
              aria-invalid={Boolean(errors.reason)}
              id="prototype-correction-reason"
              maxLength={1000}
              onChange={(event) => setReason(event.target.value)}
              required
              value={reason}
            />
            {errors.reason ? (
              <p className="text-caption text-destructive" role="alert">
                {errors.reason}
              </p>
            ) : null}
          </Field>
        </FieldGroup>

        <Separator className="my-4" />
        <TimeComparison
          original={option.original}
          proposed={{
            check_in_at: inputToInstant(checkIn) ?? option.original.check_in_at,
            check_out_at:
              inputToInstant(checkOut) ?? option.original.check_out_at,
          }}
          title="Perbandingan waktu"
        />
        <p className="mt-3 text-caption text-muted-foreground">
          Waktu contoh mengikuti Asia/Jakarta. Alasan dibatasi 1.000 karakter.
        </p>
      </div>

      <div className="sticky bottom-0 shrink-0 border-t border-border bg-background pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-3">
        <Button className="w-full" disabled={busy} type="submit">
          {busy ? "Mengirim contoh…" : "Ajukan contoh"}
        </Button>
      </div>
    </form>
  )
}

export function EmployeeRequestsPrototype() {
  const [filter, setFilter] = useState<RequestFilter>("all")
  const [scenario, setScenario] = useState<PrototypeScenario>("pending")
  const [devPanelOpen, setDevPanelOpen] = useState(false)
  const [composer, setComposer] = useState<ComposerState>(null)
  const [selectedRequest, setSelectedRequest] =
    useState<SyntheticRequest | null>(null)
  const [notice, setNotice] = useState("")
  const [recovery, setRecovery] = useState<{
    key: string
    requestId: number
  } | null>(null)
  const [requests, setRequests] = useState(() => requestFixtures())
  const [wide, setWide] = useState(false)
  const detailOpener = useRef<HTMLButtonElement | null>(null)
  const composerOpener = useRef<HTMLButtonElement | null>(null)
  const syntheticStore = useRef(new Map<string, SyntheticRequest>())
  const nextRequestId = useRef(8200)
  const nextAttempt = useRef(0)

  const options = useMemo(() => correctionOptions(scenario), [scenario])
  const filteredRequests = requests.filter((request) => {
    if (filter === "processing") return request.status === "pending"
    if (filter === "completed") return request.status !== "pending"
    return true
  })

  useEffect(() => {
    const media = window.matchMedia("(min-width: 768px)")
    const update = () => setWide(media.matches)
    update()
    media.addEventListener("change", update)
    return () => media.removeEventListener("change", update)
  }, [])

  useEffect(() => {
    if (selectedRequest || !detailOpener.current) return
    window.requestAnimationFrame(() => detailOpener.current?.focus())
  }, [selectedRequest])

  useEffect(() => {
    if (composer || !composerOpener.current) return
    window.requestAnimationFrame(() => composerOpener.current?.focus())
  }, [composer])

  function openGuided(button: HTMLButtonElement) {
    composerOpener.current = button
    setNotice("")
    setComposer({ mode: "guided" })
  }

  function openContext(button: HTMLButtonElement) {
    composerOpener.current = button
    setNotice("")
    const option = options.find((item) => item.session_id === 1048) ?? null
    setComposer({ mode: "context", option })
  }

  async function submitDraft(draft: CorrectionDraft) {
    const attempt = ++nextAttempt.current
    const key = `synthetic-correction-${attempt}`
    const requestId = nextRequestId.current++
    const request: SyntheticRequest = {
      id: requestId,
      type: "attendance_correction",
      status: "pending",
      title: `Koreksi presensi · ${correctionTypeLabel(draft.option.correction_type)}`,
      work_date: draft.option.work_date,
      submitted_at: new Date().toISOString(),
      reason: draft.reason,
      outlet: draft.option.outlet,
      session_id: draft.option.session_id,
      correction_type: draft.option.correction_type,
      original: draft.option.original,
      proposed: draft.proposed,
    }
    syntheticStore.current.set(key, request)

    if (scenario === "uncertain") {
      setRecovery({ key, requestId })
      setNotice("")
      setComposer(null)
      return
    }

    setRequests((current) =>
      current.some((item) => item.id === requestId)
        ? current
        : [request, ...current]
    )
    setFilter("all")
    setNotice(
      "Contoh pengajuan tersimpan sebagai Diproses. Data tidak dikirim ke server."
    )
    setComposer(null)
  }

  function reconcileUncertain() {
    if (!recovery) return
    const request = syntheticStore.current.get(recovery.key)
    if (!request) {
      setNotice("Status contoh belum ditemukan. Tidak ada pengiriman ulang.")
      return
    }
    setRequests((current) =>
      current.some((item) => item.id === recovery.requestId)
        ? current
        : [request, ...current]
    )
    setFilter("all")
    setRecovery(null)
    setNotice(
      "Pengajuan contoh ditemukan dengan status Diproses. Duplikasi dicegah."
    )
  }

  return (
    <div
      className="min-h-svh bg-canvas text-foreground"
      data-requests-prototype="true"
    >
      <div hidden={Boolean(composer)}>
        <header className="sticky top-0 z-40 border-b border-border bg-surface pt-[env(safe-area-inset-top)]">
          <div className="relative mx-auto flex min-h-14 w-full max-w-2xl items-center justify-center px-3">
            <a
              aria-label="Kembali ke Presensi prototype"
              className="absolute left-3 inline-flex min-h-11 min-w-11 cursor-pointer items-center justify-center rounded-md px-2 text-caption outline-none hover:bg-muted active:bg-muted/70 focus-visible:ring-2 focus-visible:ring-ring"
              href="/dev-employee-mobile-prototype"
            >
              <span aria-hidden="true">‹</span>
              <span className="sr-only">Presensi</span>
            </a>
            <h1 className="text-subtitle">Permintaan</h1>
          </div>
          <p className="px-4 pb-2 text-center text-caption text-muted-foreground">
            Jenis permintaan adalah contoh sintetis, bukan daftar kemampuan API.
          </p>
        </header>

        <main className="mx-auto flex w-full max-w-2xl flex-col gap-5 px-4 pb-[max(2rem,env(safe-area-inset-bottom))] pt-4 sm:pt-6">
          {notice ? (
            <Alert aria-live="polite" className="rounded-lg" role="status">
              <AlertTitle>Status contoh</AlertTitle>
              <AlertDescription>{notice}</AlertDescription>
            </Alert>
          ) : null}

          {recovery ? (
            <Alert className="rounded-lg" role="alert">
              <AlertTitle>Respons pengajuan belum pasti</AlertTitle>
              <AlertDescription>
                Periksa status pengajuan contoh sebelum membuat pengajuan lain.
                Tidak ada kirim ulang.
              </AlertDescription>
              <Button
                className="mt-3 min-h-11"
                onClick={reconcileUncertain}
                variant="outline"
              >
                Periksa status contoh
              </Button>
            </Alert>
          ) : null}

          <section aria-label="Jalur pengajuan" className="flex flex-col gap-2">
            <Button
              className="min-h-11 w-full"
              disabled={Boolean(recovery)}
              onClick={(event) => openGuided(event.currentTarget)}
            >
              Buat permintaan baru
            </Button>
            <Button
              className="min-h-11 w-full"
              disabled={Boolean(recovery)}
              onClick={(event) => openContext(event.currentTarget)}
              variant="outline"
            >
              Simulasi koreksi dari Riwayat Presensi
            </Button>
          </section>

          <Separator />

          <section
            aria-labelledby="request-list-title"
            className="flex flex-col gap-3"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-subtitle" id="request-list-title">
                Riwayat permintaan
              </h2>
              <span className="text-caption text-muted-foreground">
                {filteredRequests.length} permintaan
              </span>
            </div>

            <ToggleGroup
              aria-label="Filter status permintaan"
              className="w-full"
              onValueChange={(values) =>
                setFilter((values[0] as RequestFilter | undefined) ?? "all")
              }
              value={[filter]}
            >
              {Object.entries(requestFilterLabels).map(([value, label]) => (
                <ToggleGroupItem
                  className="min-h-11 flex-1 rounded-md"
                  key={value}
                  value={value}
                  variant="outline"
                >
                  {label}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>

            {filteredRequests.length ? (
              <ol
                aria-label="Daftar permintaan"
                className="flex flex-col"
                data-request-list="true"
              >
                {filteredRequests.map((request, index) => (
                  <li key={request.id}>
                    <button
                      aria-label={`${request.title}. ${displayedDate(request)}. ${statusText(request.status)}. Lihat detail`}
                      className="flex min-h-[68px] w-full cursor-pointer items-center justify-between gap-3 rounded-md px-2 py-3 text-left outline-none hover:bg-muted/30 active:bg-muted/50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                      onClick={(event) => {
                        detailOpener.current = event.currentTarget
                        setSelectedRequest(request)
                      }}
                      type="button"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-label">
                          {request.title}
                        </span>
                        <span className="mt-0.5 block truncate text-caption text-muted-foreground">
                          {displayedDate(request)}
                          {request.outlet ? ` · ${request.outlet.name}` : ""}
                        </span>
                      </span>
                      <span className="flex shrink-0 items-center gap-2">
                        <Badge variant={statusVariant(request.status)}>
                          {statusText(request.status)}
                        </Badge>
                        <span
                          aria-hidden="true"
                          className="text-muted-foreground"
                        >
                          ›
                        </span>
                      </span>
                    </button>
                    {index < filteredRequests.length - 1 ? (
                      <Separator className="opacity-70" />
                    ) : null}
                  </li>
                ))}
              </ol>
            ) : (
              <Empty
                className="min-h-40 rounded-lg border-0 px-0 py-8"
                role="status"
              >
                <EmptyHeader>
                  <EmptyTitle>Belum ada permintaan</EmptyTitle>
                  <EmptyDescription>
                    Permintaan dengan status ini akan tampil di sini.
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            )}
          </section>

          <Separator />
          <section className="flex flex-col gap-2 pt-1">
            <button
              aria-controls="requests-prototype-controls"
              aria-expanded={devPanelOpen}
              className="flex min-h-11 w-full cursor-pointer items-center justify-between gap-3 rounded-md text-left text-label outline-none hover:bg-muted/30 active:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => setDevPanelOpen((open) => !open)}
              type="button"
            >
              <span>Panel pengembangan · skenario</span>
              <span aria-hidden="true">{devPanelOpen ? "−" : "+"}</span>
            </button>
            <div
              className="py-2"
              hidden={!devPanelOpen}
              id="requests-prototype-controls"
            >
              <Field className="max-w-sm">
                <FieldLabel htmlFor="requests-prototype-scenario">
                  Skenario respons sintetis
                </FieldLabel>
                <NativeSelect
                  id="requests-prototype-scenario"
                  onChange={(event) =>
                    setScenario(event.target.value as PrototypeScenario)
                  }
                  value={scenario}
                >
                  {Object.entries(scenarioLabels).map(([value, label]) => (
                    <NativeSelectOption key={value} value={value}>
                      {label}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </Field>
            </div>
          </section>
        </main>

        {selectedRequest ? (
          <RequestDetailOverlay
            onClose={() => setSelectedRequest(null)}
            request={selectedRequest}
            wide={wide}
          />
        ) : null}
      </div>
      {composer ? (
        <CorrectionComposer
          composer={composer}
          onClose={() => setComposer(null)}
          onSubmit={submitDraft}
          options={options}
          scenario={scenario}
        />
      ) : null}
    </div>
  )
}
