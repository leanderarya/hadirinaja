import { type FormEvent, useCallback, useEffect, useRef, useState } from "react"
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
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { Skeleton } from "@/components/ui/skeleton"
import { WeeklyPlannerBoard } from "@/components/weekly-planner-board"
import { ApiError, apiRequest } from "@/lib/api"
import type { ShiftTemplate } from "@/lib/shift-templates"
import { useConfigurationDraft } from "@/lib/use-configuration-draft"
import {
  type PlannerEntry,
  type PlannerWeek,
  plannerDateLabel,
  plannerEntryKey,
  plannerRequestEntries,
  replacePlannerEntry,
  type Staffing,
  type StaffingReport,
  samePlannerEntries,
  shiftPlannerDate,
  staffingLabels,
  staffingOptions,
  staffingRoles,
  staffingTimes,
} from "@/lib/weekly-planner"

type Command = {
  path: string
  method: "PUT" | "POST"
  body: Record<string, unknown>
  key: string
  kind: "draft" | "copy" | "publish" | "save-changes"
}
type Modal =
  | "staffing"
  | "entry"
  | "copy"
  | "publish"
  | "save-draft"
  | "save-changes"
  | null
type ValidationPreview = {
  kind: "publish" | "save-changes"
  version: number
  entries: PlannerEntry[]
  staffing_report: StaffingReport
  valid: boolean
}
const emptyStaffing = (): Staffing => ({ morning: 0, middle: 0, evening: 0 })

function message(error: unknown) {
  if (error instanceof ApiError && error.errors)
    return Object.values(error.errors).flat().join(" ")
  return error instanceof Error ? error.message : "Permintaan belum berhasil."
}

function entryErrorsFrom(
  error: unknown,
  entries: PlannerEntry[]
): Record<string, string[]> {
  if (!(error instanceof ApiError) || !error.errors) return {}
  const result: Record<string, string[]> = {}
  for (const [field, messages] of Object.entries(error.errors)) {
    const match = field.match(/^entries\.(\d+)(?:\.|$)/)
    const entry = match ? entries[Number(match[1])] : undefined
    if (entry) result[plannerEntryKey(entry)] = messages
  }
  return result
}

function plannerEntrySummary(
  entry: PlannerEntry,
  employees: Array<{ id: number; name: string }>,
  shiftLabels: Record<number, string>
) {
  const employee =
    employees.find((item) => item.id === entry.employee_id)?.name ??
    "Karyawan tidak tersedia"
  const assignment =
    entry.status === "rest"
      ? "Istirahat"
      : entry.status === "unscheduled"
        ? "Tidak dijadwalkan"
        : (shiftLabels[entry.shift_template_version_id ?? 0] ??
          "Shift tidak tersedia")
  return `${plannerDateLabel(entry.work_date)} · ${employee} · ${assignment}`
}

function isCandidateDirty(
  data: PlannerWeek | null,
  entries: PlannerEntry[],
  staffing: Staffing,
  draftStarted: boolean
) {
  if (!data) return false
  const persisted = data.draft ?? data.published ?? null
  const persistedEntries = persisted?.entries ?? []
  if (data.draft || draftStarted) {
    const currentStaffing = persisted?.staffing ?? null
    const staffingMatches = currentStaffing
      ? JSON.stringify(staffing) === JSON.stringify(currentStaffing)
      : !staffingRoles.some((role) => staffing[role] > 0)
    return (
      (draftStarted && !data.draft) ||
      !samePlannerEntries(entries, persistedEntries) ||
      !staffingMatches
    )
  }
  return Boolean(
    data.published && !samePlannerEntries(entries, persistedEntries)
  )
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
  const [syncError, setSyncError] = useState("")
  const [notice, setNotice] = useState("")
  const [stale, setStale] = useState(false)
  const [latestData, setLatestData] = useState<PlannerWeek | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [scopeBlocked, setScopeBlocked] = useState(false)
  const [uncertain, setUncertain] = useState(false)
  const [modal, setModal] = useState<Modal>(null)
  const [reason, setReason] = useState("")
  const [reasonError, setReasonError] = useState("")
  const [candidateEntries, setCandidateEntries] = useState<PlannerEntry[]>([])
  const [candidateStaffing, setCandidateStaffing] =
    useState<Staffing>(emptyStaffing)
  const [draftStarted, setDraftStarted] = useState(false)
  const [entryErrors, setEntryErrors] = useState<Record<string, string[]>>({})
  const [configuration, setConfiguration] = useState<Staffing>(emptyStaffing)
  const [editingExisting, setEditingExisting] = useState(false)
  const [employeeId, setEmployeeId] = useState("")
  const [date, setDate] = useState(weekStart)
  const [assignment, setAssignment] = useState("rest")
  const [copyPreview, setCopyPreview] = useState<PlannerWeek | null>(null)
  const [copyLoading, setCopyLoading] = useState(false)
  const [copyError, setCopyError] = useState("")
  const [preview, setPreview] = useState<ValidationPreview | null>(null)
  const [acknowledged, setAcknowledged] = useState(false)
  const pending = useRef<Command | null>(null)
  const alive = useRef(true)
  const actionLock = useRef(false)
  const persisted = data?.draft ?? data?.published ?? null
  const persistedEntries = persisted?.entries ?? []
  const persistedStaffing = persisted?.staffing ?? null
  const draftMode = Boolean(data && (data.draft || draftStarted))
  const publishedEditMode = Boolean(data?.published && !data.draft)
  const candidateDirty = isCandidateDirty(
    data,
    candidateEntries,
    candidateStaffing,
    draftStarted
  )
  const guard = useConfigurationDraft(busy || uncertain, () => {
    setCandidateEntries(persistedEntries)
    setCandidateStaffing(persistedStaffing ?? emptyStaffing())
    setDraftStarted(false)
    setPreview(null)
    setLatestData(null)
    setEntryErrors({})
    setReason("")
    setReasonError("")
    setModal(null)
  })
  const clearGuard = useRef(guard.clear)
  clearGuard.current = guard.clear
  const callbacks = useRef({ onBusyChange, onPublished })
  callbacks.current = { onBusyChange, onPublished }
  const refresh = useCallback(async () => {
    const next = await apiRequest<PlannerWeek>(base)
    if (next.outlet.id !== outletId || next.week_start !== weekStart)
      throw new Error("Jadwal ini tidak cocok dengan Outlet. Muat ulang.")
    if (alive.current) {
      setData(next)
      setCandidateEntries(next.draft?.entries ?? next.published?.entries ?? [])
      setCandidateStaffing(
        next.draft?.staffing ?? next.published?.staffing ?? emptyStaffing()
      )
      setDraftStarted(false)
      setPreview(null)
      setAcknowledged(false)
      setStale(false)
      setLatestData(null)
      setEntryErrors({})
      setScopeBlocked(false)
      setError("")
      setSyncError("")
      clearGuard.current()
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
    callbacks.current.onBusyChange(
      busy || uncertain || modal !== null || candidateDirty
    )
  }, [busy, uncertain, modal, candidateDirty])
  const entries = candidateEntries
  const staffing = candidateStaffing
  const previousWeek = shiftPlannerDate(weekStart, -7)
  const previousPublishedWeek = data?.published_weeks.find(
    (item) => item.week_start === previousWeek
  )
  const hasStaffing = staffingRoles.every((role) => staffing[role] > 0)
  const showSecondaryActions =
    (!data?.draft &&
      !data?.published &&
      !draftStarted &&
      Boolean(previousPublishedWeek)) ||
    (draftMode && (hasStaffing || candidateDirty)) ||
    (publishedEditMode && candidateDirty)
  const disabled =
    loading || busy || refreshing || stale || uncertain || Boolean(syncError)
  const writesDisabled = disabled || scopeBlocked
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
    setReason("")
    setReasonError("")
    setAcknowledged(false)
    if (!candidateDirty) guard.clear()
  }
  function open(next: Modal) {
    setError("")
    setSyncError("")
    setNotice("")
    setReason("")
    setReasonError("")
    setAcknowledged(false)
    setConfiguration(staffing)
    setModal(next)
  }
  function updateCandidateEntries(next: PlannerEntry[]) {
    setCandidateEntries(next)
    setPreview(null)
    setAcknowledged(false)
    setEntryErrors({})
    setError("")
    setNotice("")
    if (isCandidateDirty(data, next, candidateStaffing, draftStarted))
      guard.mark()
    else guard.clear()
  }
  function updateCandidateStaffing(next: Staffing) {
    setCandidateStaffing(next)
    setPreview(null)
    setAcknowledged(false)
    setError("")
    setNotice("")
    if (isCandidateDirty(data, candidateEntries, next, draftStarted))
      guard.mark()
    else guard.clear()
  }
  async function loadLatestForConflict() {
    setRefreshing(true)
    setSyncError("")
    try {
      const next = await apiRequest<PlannerWeek>(base)
      if (next.outlet.id !== outletId || next.week_start !== weekStart)
        throw new Error("Jadwal terbaru tidak cocok dengan Outlet.")
      if (alive.current) setLatestData(next)
    } catch (caught) {
      if (!alive.current) return
      setSyncError(`Versi terbaru belum termuat. ${message(caught)}`)
      if (
        caught instanceof ApiError &&
        (caught.status === 403 || caught.status === 404)
      )
        setScopeBlocked(true)
    } finally {
      if (alive.current) setRefreshing(false)
    }
  }
  function adoptLatest(discardCandidate: boolean) {
    if (!latestData) return
    if (!discardCandidate && data?.published && !data.draft && latestData.draft)
      return
    const next = latestData
    setData(next)
    setLatestData(null)
    setStale(false)
    setError("")
    setSyncError("")
    setPreview(null)
    setAcknowledged(false)
    setEntryErrors({})
    setScopeBlocked(false)
    if (discardCandidate) {
      setReason("")
      setReasonError("")
      setModal(null)
      setCandidateEntries(next.draft?.entries ?? next.published?.entries ?? [])
      setCandidateStaffing(
        next.draft?.staffing ?? next.published?.staffing ?? emptyStaffing()
      )
      setDraftStarted(false)
      clearGuard.current()
      return
    }
    const nextStaffing = draftMode
      ? candidateStaffing
      : (next.draft?.staffing ?? next.published?.staffing ?? emptyStaffing())
    if (!draftMode) setCandidateStaffing(nextStaffing)
    setModal(null)
    if (
      isCandidateDirty(next, candidateEntries, nextStaffing, draftStarted) ||
      reason.trim().length > 0
    )
      guard.mark()
    else clearGuard.current()
  }
  function startEmpty() {
    if (!data || data.draft || data.published || writesDisabled) return
    setCandidateEntries([])
    setCandidateStaffing(emptyStaffing())
    setDraftStarted(true)
    setError("")
    setNotice("")
    guard.mark()
  }
  function discardLocalChanges() {
    guard.attempt(() => {
      setCandidateEntries(persistedEntries)
      setCandidateStaffing(persistedStaffing ?? emptyStaffing())
      setDraftStarted(false)
      setPreview(null)
      setEntryErrors({})
    })
  }
  async function openCopyPreview() {
    if (!data || !previousPublishedWeek || writesDisabled) return
    open("copy")
    guard.mark()
    setCopyPreview(null)
    setCopyError("")
    setCopyLoading(true)
    try {
      const source = await apiRequest<PlannerWeek>(
        `/management/scheduling/planner/outlets/${outletId}/weeks/${previousWeek}`
      )
      if (
        source.outlet.id !== outletId ||
        source.week_start !== previousWeek ||
        source.published?.revision_id !==
          previousPublishedWeek.published_revision_id
      )
        throw new Error("Jadwal minggu sebelumnya berubah. Muat ulang jadwal.")
      if (alive.current) setCopyPreview(source)
    } catch (caught) {
      if (alive.current) setCopyError(message(caught))
    } finally {
      if (alive.current) setCopyLoading(false)
    }
  }
  async function send(command: Command) {
    if (actionLock.current) return
    actionLock.current = true
    setBusy(true)
    setError("")
    setSyncError("")
    if (pending.current !== command) pending.current = command
    try {
      await apiRequest(command.path, {
        method: command.method,
        body: command.body,
        headers: { "Idempotency-Key": command.key },
      })
      if (!alive.current) return
      pending.current = null
      setUncertain(false)
      setModal(null)
      setReason("")
      setReasonError("")
      setAcknowledged(false)
      setPreview(null)
      setEntryErrors({})
      guard.clear()
      const successNotice =
        command.kind === "save-changes"
          ? "Perubahan jadwal berhasil disimpan."
          : command.kind === "publish"
            ? "Draf berhasil diterbitkan."
            : command.kind === "copy"
              ? "Salinan tersimpan sebagai draf."
              : "Draf berhasil disimpan."
      setNotice(successNotice)
      if (command.kind === "publish" || command.kind === "save-changes")
        callbacks.current.onPublished()
      try {
        await refresh()
      } catch (caught) {
        if (alive.current) {
          guard.mark()
          setSyncError(
            `${successNotice} Namun jadwal terbaru belum termuat. ${message(caught)}`
          )
        }
      }
    } catch (caught) {
      if (!alive.current) return
      setError(message(caught))
      if (
        caught instanceof ApiError &&
        caught.status >= 400 &&
        caught.status < 500
      ) {
        pending.current = null
        setUncertain(false)
        const requestEntries = Array.isArray(command.body.entries)
          ? (command.body.entries as PlannerEntry[])
          : []
        setEntryErrors(entryErrorsFrom(caught, requestEntries))
        if (caught.status === 409) {
          setStale(true)
          setPreview(null)
          setAcknowledged(false)
          setModal(null)
          await loadLatestForConflict()
        }
        if (caught.status === 403 || caught.status === 404)
          setScopeBlocked(true)
      } else if (pending.current) {
        setUncertain(true)
      }
    } finally {
      actionLock.current = false
      if (alive.current) setBusy(false)
    }
  }
  async function checkPublication() {
    if (
      !data?.draft ||
      candidateDirty ||
      !hasStaffing ||
      writesDisabled ||
      actionLock.current
    )
      return
    actionLock.current = true
    setBusy(true)
    setError("")
    setAcknowledged(false)
    setPreview(null)
    try {
      const result = await apiRequest<{
        valid?: boolean
        version: number
        staffing_report: StaffingReport
      }>(`${base}/validate`, {
        method: "POST",
        body: { expected_version: data.version },
      })
      if (!alive.current) return
      if (result.version !== data.version) {
        setError("Jadwal berubah saat diperiksa. Muat data terbaru.")
        setStale(true)
        await loadLatestForConflict()
        return
      }
      if (alive.current) {
        setPreview({
          kind: "publish",
          version: result.version,
          entries: data.draft.entries,
          staffing_report: result.staffing_report,
          valid: result.valid === true,
        })
        setModal("publish")
        guard.mark()
      }
    } catch (caught) {
      if (alive.current) {
        setError(message(caught))
        if (caught instanceof ApiError && caught.status === 409) {
          setStale(true)
          await loadLatestForConflict()
        }
        if (
          caught instanceof ApiError &&
          (caught.status === 403 || caught.status === 404)
        )
          setScopeBlocked(true)
      }
    } finally {
      actionLock.current = false
      if (alive.current) setBusy(false)
    }
  }
  async function checkDirectSave() {
    if (
      !data?.published ||
      data.draft ||
      !candidateDirty ||
      !hasStaffing ||
      writesDisabled ||
      actionLock.current
    )
      return
    const requestEntries = plannerRequestEntries(candidateEntries)
    actionLock.current = true
    setBusy(true)
    setError("")
    setAcknowledged(false)
    setPreview(null)
    try {
      const result = await apiRequest<{
        valid?: boolean
        version: number
        entry_count: number
        staffing_report: StaffingReport
      }>(`${base}/validate`, {
        method: "POST",
        body: {
          expected_version: data.version,
          expected_published_revision_id: data.published.revision_id,
          entries: requestEntries,
        },
      })
      if (!alive.current) return
      if (result.version !== data.version) {
        setError("Jadwal berubah saat diperiksa. Muat data terbaru.")
        setStale(true)
        await loadLatestForConflict()
        return
      }
      setPreview({
        kind: "save-changes",
        version: result.version,
        entries: candidateEntries,
        staffing_report: result.staffing_report,
        valid: result.valid === true,
      })
      setModal("save-changes")
      guard.mark()
    } catch (caught) {
      if (!alive.current) return
      setError(message(caught))
      setEntryErrors(entryErrorsFrom(caught, requestEntries))
      if (caught instanceof ApiError && caught.status === 409) {
        setStale(true)
        setPreview(null)
        await loadLatestForConflict()
      }
      if (
        caught instanceof ApiError &&
        (caught.status === 403 || caught.status === 404)
      )
        setScopeBlocked(true)
    } finally {
      actionLock.current = false
      if (alive.current) setBusy(false)
    }
  }
  function applyEntry(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (writesDisabled || !employeeId) return
    updateCandidateEntries(
      replacePlannerEntry(candidateEntries, {
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
      })
    )
    setModal(null)
  }
  function applyStaffing(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (writesDisabled) return
    updateCandidateStaffing(configuration)
    setModal(null)
  }
  function removeEntry() {
    if (writesDisabled || !employeeId) return
    updateCandidateEntries(
      candidateEntries.filter(
        (entry) =>
          entry.employee_id !== Number(employeeId) || entry.work_date !== date
      )
    )
    setModal(null)
  }
  function submitReason(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!data || writesDisabled) return
    const trimmedReason = reason.trim()
    if (trimmedReason.length < 3) {
      setReasonError("Alasan harus berisi minimal 3 karakter.")
      return
    }
    setReasonError("")
    guard.mark()
    if (modal === "save-draft" && draftMode && hasStaffing) {
      void send({
        path: `${base}/draft`,
        method: "PUT",
        key: crypto.randomUUID(),
        kind: "draft",
        body: {
          expected_version: data.version,
          entries: candidateEntries,
          staffing: candidateStaffing,
          reason: trimmedReason,
        },
      })
      return
    }
    if (modal === "copy" && copyPreview?.published && previousPublishedWeek) {
      void send({
        path: `${base}/copy`,
        method: "POST",
        key: crypto.randomUUID(),
        kind: "copy",
        body: {
          expected_version: data.version,
          source_week_start: previousWeek,
          source_revision_id: previousPublishedWeek.published_revision_id,
          ...(hasStaffing ? { staffing: candidateStaffing } : {}),
          reason: trimmedReason,
        },
      })
      return
    }
    if (modal === "publish" && data.draft && preview?.kind === "publish") {
      if (
        preview.version !== data.version ||
        preview.valid === false ||
        preview.staffing_report.conflicts.length > 0 ||
        (preview.staffing_report.deficits.length > 0 &&
          (!acknowledged || !preview.staffing_report.checksum))
      )
        return
      void send({
        path: `${base}/publish`,
        method: "POST",
        key: crypto.randomUUID(),
        kind: "publish",
        body: {
          expected_version: data.version,
          expected_published_revision_id: data.published?.revision_id ?? null,
          warnings_checksum: acknowledged
            ? preview.staffing_report.checksum
            : null,
          reason: trimmedReason,
        },
      })
      return
    }
    if (
      modal === "save-changes" &&
      data.published &&
      !data.draft &&
      preview?.kind === "save-changes"
    ) {
      const deficits = preview.staffing_report.deficits
      if (
        preview.version !== data.version ||
        !samePlannerEntries(preview.entries, candidateEntries) ||
        preview.valid === false ||
        preview.staffing_report.conflicts.length > 0 ||
        (deficits.length > 0 &&
          (!acknowledged || !preview.staffing_report.checksum))
      )
        return
      const entries = plannerRequestEntries(candidateEntries)
      const body: Record<string, unknown> = {
        expected_version: data.version,
        expected_published_revision_id: data.published.revision_id,
        reason: trimmedReason,
        entries,
      }
      if (deficits.length > 0)
        body.warnings_checksum = preview.staffing_report.checksum
      void send({
        path: `${base}/save-changes`,
        method: "POST",
        key: crypto.randomUUID(),
        kind: "save-changes",
        body,
      })
    }
  }
  if (loading)
    return (
      <div role="status" aria-label="Memuat jadwal">
        <Skeleton className="h-24 w-full" />
      </div>
    )
  if (!data)
    return (
      <Alert variant="destructive">
        <AlertTitle>Jadwal belum dapat dibuka</AlertTitle>
        <AlertDescription>
          {error}
          <Button
            variant="outline"
            disabled={loading}
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
      aria-label={`Jadwal ${outletName}`}
    >
      {guard.dialog}
      <Card>
        <CardHeader>
          <CardTitle>Jadwal mingguan</CardTitle>
          <CardDescription>
            {plannerDateLabel(weekStart)} sampai{" "}
            {plannerDateLabel(shiftPlannerDate(weekStart, 6))}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-2">
            {!data.draft && !data.published ? (
              <Badge variant="outline">Belum ada jadwal</Badge>
            ) : null}
            {data.draft ? (
              <Badge variant="outline">Draf #{data.draft.revision_id}</Badge>
            ) : null}
            {data.published ? (
              <Badge variant="secondary">
                Terbit #{data.published.revision_id}
              </Badge>
            ) : null}
            {candidateDirty ? (
              <Badge variant="outline">
                {draftStarted && !data.draft
                  ? "Draf belum disimpan"
                  : "Perubahan belum disimpan"}
              </Badge>
            ) : null}
          </div>
          <p className="text-caption text-muted-foreground">
            {data.draft || draftStarted
              ? "Draf belum mengubah jadwal yang berlaku."
              : data.published
                ? "Perubahan berlaku setelah Anda menyimpannya."
                : "Pilih cara memulai. Jadwal belum berubah."}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {!data.draft && !data.published && !draftStarted ? (
              <Button
                type="button"
                className="min-h-11"
                disabled={writesDisabled}
                onClick={startEmpty}
              >
                Mulai jadwal kosong
              </Button>
            ) : draftMode && !hasStaffing ? (
              <Button
                type="button"
                className="min-h-11"
                disabled={writesDisabled}
                onClick={() => open("staffing")}
              >
                Atur kebutuhan shift
              </Button>
            ) : draftMode && candidateDirty ? (
              <Button
                type="button"
                className="min-h-11"
                disabled={writesDisabled}
                onClick={() => open("save-draft")}
              >
                Simpan draf
              </Button>
            ) : data.draft ? (
              <Button
                type="button"
                className="min-h-11"
                disabled={writesDisabled || candidateDirty || !hasStaffing}
                onClick={() => void checkPublication()}
              >
                Periksa dan terbitkan
              </Button>
            ) : publishedEditMode && candidateDirty ? (
              <Button
                type="button"
                className="min-h-11"
                disabled={writesDisabled || !hasStaffing}
                onClick={() => void checkDirectSave()}
              >
                Simpan perubahan
              </Button>
            ) : null}
            {showSecondaryActions ? (
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={<Button variant="outline" className="min-h-11" />}
                >
                  Aksi lainnya
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  <DropdownMenuGroup>
                    {!data.draft && !data.published && !draftStarted ? (
                      <DropdownMenuItem
                        className="min-h-11 cursor-pointer"
                        disabled={writesDisabled || !previousPublishedWeek}
                        onClick={() => void openCopyPreview()}
                      >
                        Salin minggu sebelumnya
                      </DropdownMenuItem>
                    ) : null}
                    {draftMode && hasStaffing ? (
                      <DropdownMenuItem
                        className="min-h-11 cursor-pointer"
                        disabled={writesDisabled}
                        onClick={() => open("staffing")}
                      >
                        Atur kebutuhan shift
                      </DropdownMenuItem>
                    ) : null}
                    {draftMode && candidateDirty ? (
                      <DropdownMenuItem
                        className="min-h-11 cursor-pointer"
                        disabled={busy || uncertain}
                        onClick={discardLocalChanges}
                      >
                        Buang perubahan lokal
                      </DropdownMenuItem>
                    ) : null}
                    {publishedEditMode && candidateDirty ? (
                      <DropdownMenuItem
                        className="min-h-11 cursor-pointer"
                        disabled={busy || uncertain}
                        onClick={discardLocalChanges}
                      >
                        Buang perubahan lokal
                      </DropdownMenuItem>
                    ) : null}
                  </DropdownMenuGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
          </div>
          {draftMode && !hasStaffing ? (
            <p className="text-caption text-muted-foreground">
              Atur kebutuhan shift sebelum menambah penugasan atau menyimpan
              draf.
            </p>
          ) : null}
          {!previousPublishedWeek &&
          !data.draft &&
          !data.published &&
          !draftStarted ? (
            <p className="text-caption text-muted-foreground">
              Tidak ada jadwal minggu sebelumnya untuk disalin.
            </p>
          ) : null}
        </CardContent>
      </Card>
      {error ? (
        <Alert variant="destructive">
          <AlertTitle>
            {stale
              ? "Jadwal sudah berubah"
              : uncertain
                ? "Hasil simpan belum diketahui"
                : "Perubahan belum dapat disimpan"}
          </AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {scopeBlocked ? (
        <Alert variant="destructive">
          <AlertTitle>Akses ke jadwal ini tidak tersedia</AlertTitle>
          <AlertDescription>
            Perubahan dihentikan. Muat ulang Outlet atau hubungi Owner yang
            mengelola akses.
          </AlertDescription>
        </Alert>
      ) : null}
      {uncertain ? (
        <Alert>
          <AlertTitle>Hasil simpan belum diketahui</AlertTitle>
          <AlertDescription className="flex flex-col items-start gap-2">
            Jangan kirim perubahan lagi. Periksa hasil penyimpanan terlebih
            dahulu.
            <Button
              type="button"
              variant="outline"
              className="min-h-11"
              disabled={busy}
              onClick={() => {
                if (pending.current) void send(pending.current)
              }}
            >
              Periksa hasil penyimpanan
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}
      {stale ? (
        <Alert variant="destructive">
          <AlertTitle>Jadwal sudah diperbarui</AlertTitle>
          <AlertDescription className="flex flex-col gap-3">
            Perubahan lokal Anda tetap tersimpan di layar. Bandingkan dengan
            data terbaru sebelum melanjutkan.
            {syncError ? <p>{syncError}</p> : null}
            {latestData ? (
              <>
                <p className="text-label">
                  Data di layar: versi {data.version},{" "}
                  {data.draft
                    ? `draf #${data.draft.revision_id}`
                    : `terbit #${data.published?.revision_id ?? "tidak ada"}`}
                  , {persistedEntries.length} penugasan. Data terbaru: versi{" "}
                  {latestData.version},{" "}
                  {latestData.draft
                    ? `draf #${latestData.draft.revision_id}`
                    : `terbit #${latestData.published?.revision_id ?? "tidak ada"}`}
                  ,{" "}
                  {
                    (
                      latestData.draft?.entries ??
                      latestData.published?.entries ??
                      []
                    ).length
                  }{" "}
                  penugasan. Perubahan Anda: {candidateEntries.length}{" "}
                  penugasan.
                </p>
                <div className="grid min-w-0 grid-cols-1 gap-3 md:grid-cols-2">
                  <section className="flex min-w-0 flex-col gap-2">
                    <h3 className="text-label">Jadwal terbaru</h3>
                    {(
                      latestData.draft?.entries ??
                      latestData.published?.entries ??
                      []
                    ).length ? (
                      <ul className="flex max-h-40 min-w-0 flex-col gap-1 overflow-y-auto text-caption">
                        {(
                          latestData.draft?.entries ??
                          latestData.published?.entries ??
                          []
                        ).map((entry) => (
                          <li
                            key={plannerEntryKey(entry)}
                            className="wrap-anywhere"
                          >
                            {plannerEntrySummary(
                              entry,
                              latestData.employees,
                              shiftLabels
                            )}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-caption text-muted-foreground">
                        Jadwal terbaru belum berisi penugasan.
                      </p>
                    )}
                  </section>
                  <section className="flex min-w-0 flex-col gap-2">
                    <h3 className="text-label">Perubahan Anda</h3>
                    {candidateEntries.length ? (
                      <ul className="flex max-h-40 min-w-0 flex-col gap-1 overflow-y-auto text-caption">
                        {candidateEntries.map((entry) => (
                          <li
                            key={plannerEntryKey(entry)}
                            className="wrap-anywhere"
                          >
                            {plannerEntrySummary(
                              entry,
                              latestData.employees,
                              shiftLabels
                            )}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-caption text-muted-foreground">
                        Perubahan Anda belum berisi penugasan.
                      </p>
                    )}
                  </section>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    className="min-h-11"
                    disabled={refreshing || busy || uncertain}
                    onClick={() => guard.attempt(() => adoptLatest(true))}
                  >
                    Muat data terbaru dan buang perubahan
                  </Button>
                  {data.published && !data.draft && latestData.draft ? (
                    <p className="text-caption text-muted-foreground">
                      Draf baru dibuat saat Anda mengedit jadwal terbit.
                      Perubahan lama tidak dipindahkan agar edit orang lain
                      tetap aman. Muat draf terbaru, lalu tinjau ulang
                      perubahan.
                    </p>
                  ) : (
                    <Button
                      type="button"
                      variant="outline"
                      className="min-h-11"
                      disabled={refreshing || busy || uncertain}
                      onClick={() => adoptLatest(false)}
                    >
                      Pakai data terbaru, tinjau ulang perubahan saya
                    </Button>
                  )}
                </div>
              </>
            ) : (
              <Button
                type="button"
                variant="outline"
                className="min-h-11 self-start"
                disabled={refreshing || busy}
                onClick={() => void loadLatestForConflict()}
              >
                {refreshing ? "Memuat data terbaru…" : "Muat data terbaru"}
              </Button>
            )}
          </AlertDescription>
        </Alert>
      ) : null}
      {syncError && !stale ? (
        <Alert>
          <AlertTitle>Jadwal tersimpan, tetapi belum dimuat ulang</AlertTitle>
          <AlertDescription className="flex flex-col items-start gap-2">
            {syncError}
            <Button
              type="button"
              variant="outline"
              className="min-h-11"
              disabled={refreshing || busy}
              onClick={() => {
                setRefreshing(true)
                void refresh()
                  .catch((caught) => setSyncError(message(caught)))
                  .finally(() => setRefreshing(false))
              }}
            >
              {refreshing ? "Memuat jadwal…" : "Muat ulang jadwal"}
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}
      {notice ? (
        <p role="status" className="text-body">
          {notice}
        </p>
      ) : null}
      {!candidateDirty && data.staffing_report?.conflicts.length ? (
        <Alert variant="destructive">
          <AlertTitle>Konflik kebutuhan shift</AlertTitle>
          <AlertDescription>
            {data.staffing_report.conflicts.join(" ")}
          </AlertDescription>
        </Alert>
      ) : null}
      {!candidateDirty && data.staffing_report?.deficits.length ? (
        <Alert>
          <AlertTitle>
            {data.staffing_report.deficits.length} kebutuhan shift belum
            terpenuhi
          </AlertTitle>
          <AlertDescription>
            Kekurangan karyawan tidak menghentikan penerbitan setelah ditinjau
            dan disetujui. Penugasan yang tidak valid tetap ditolak.
          </AlertDescription>
        </Alert>
      ) : null}
      {data.draft || data.published || draftStarted ? (
        <WeeklyPlannerBoard
          weekStart={weekStart}
          entries={entries}
          employees={data.employees}
          report={candidateDirty ? undefined : data.staffing_report}
          staffing={staffing}
          shiftLabels={shiftLabels}
          entryErrors={entryErrors}
          disabled={writesDisabled || !hasStaffing}
          onEdit={(day, entry, role) => {
            setDate(day)
            setEditingExisting(Boolean(entry))
            setEmployeeId(entry ? String(entry.employee_id) : "")
            setAssignment(
              entry?.status === "work"
                ? String(entry.shift_template_version_id)
                : role
                  ? String(staffing[role])
                  : (entry?.status ?? "rest")
            )
            open("entry")
          }}
        />
      ) : (
        <Alert>
          <AlertTitle>Jadwal minggu ini belum tersedia</AlertTitle>
          <AlertDescription>
            Mulai dengan jadwal kosong atau salin minggu sebelumnya.
          </AlertDescription>
        </Alert>
      )}
      <Drawer
        open={modal === "entry" || modal === "staffing"}
        onOpenChange={(value) => {
          if (!value && !busy && !uncertain) close()
        }}
      >
        <DrawerContent className="max-h-[85dvh] overflow-y-auto">
          {modal === "entry" ? (
            <form className="flex min-h-0 flex-col" onSubmit={applyEntry}>
              <DrawerHeader>
                <DrawerTitle>
                  {editingExisting ? "Ubah penugasan" : "Tambah penugasan"}
                </DrawerTitle>
                <DrawerDescription>
                  {outletName} · {plannerDateLabel(date)}. Perubahan berlaku
                  setelah jadwal disimpan.
                </DrawerDescription>
              </DrawerHeader>
              <div className="flex flex-col gap-4 overflow-y-auto px-4">
                {error ? (
                  <Alert variant="destructive">
                    <AlertTitle>Periksa kembali</AlertTitle>
                    <AlertDescription>{error}</AlertDescription>
                  </Alert>
                ) : null}
                <FieldGroup>
                  <Field>
                    <FieldLabel htmlFor="planner-employee">
                      Karyawan · {plannerDateLabel(date)}
                    </FieldLabel>
                    <NativeSelect
                      id="planner-employee"
                      required
                      value={employeeId}
                      disabled={writesDisabled || editingExisting}
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
                      disabled={writesDisabled}
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
                          <NativeSelectOption key={role} value={staffing[role]}>
                            {staffingLabels[role]} ·{" "}
                            {staffingTimes[role].join("–")}
                          </NativeSelectOption>
                        ))}
                    </NativeSelect>
                  </Field>
                </FieldGroup>
              </div>
              <DrawerFooter className="flex-row flex-wrap justify-end">
                {editingExisting ? (
                  <Button
                    type="button"
                    variant="outline"
                    className="min-h-11"
                    disabled={writesDisabled}
                    onClick={removeEntry}
                  >
                    Hapus dari editor
                  </Button>
                ) : null}
                <Button
                  type="button"
                  variant="outline"
                  className="min-h-11"
                  disabled={busy || uncertain}
                  onClick={close}
                >
                  Batal
                </Button>
                <Button
                  type="submit"
                  className="min-h-11"
                  disabled={writesDisabled || !hasStaffing}
                >
                  Terapkan penugasan
                </Button>
              </DrawerFooter>
            </form>
          ) : (
            <form className="flex min-h-0 flex-col" onSubmit={applyStaffing}>
              <DrawerHeader>
                <DrawerTitle>Kebutuhan shift</DrawerTitle>
                <DrawerDescription>
                  {outletName} · minggu {weekStart}. Perubahan ini hanya berlaku
                  pada draf.
                </DrawerDescription>
              </DrawerHeader>
              <div className="flex flex-col gap-4 overflow-y-auto px-4">
                <FieldGroup>
                  {staffingRoles.map((role) => (
                    <Field key={role}>
                      <FieldLabel htmlFor={`planner-${role}`}>
                        {staffingLabels[role]} · {staffingTimes[role].join("–")}
                      </FieldLabel>
                      <NativeSelect
                        id={`planner-${role}`}
                        required
                        disabled={writesDisabled}
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
                          Pilih shift
                        </NativeSelectOption>
                        {staffingOptions(templates, role, weekStart).map(
                          (version) => (
                            <NativeSelectOption
                              value={version.id}
                              key={version.id}
                            >
                              {version.name} · revisi {version.revision}
                            </NativeSelectOption>
                          )
                        )}
                      </NativeSelect>
                    </Field>
                  ))}
                </FieldGroup>
                <p className="text-caption">
                  Jika versi shift yang sesuai belum tersedia, Owner perlu
                  menyiapkannya melalui Template shift.
                </p>
              </div>
              <DrawerFooter className="flex-row flex-wrap justify-end">
                <Button
                  type="button"
                  variant="outline"
                  className="min-h-11"
                  disabled={busy || uncertain}
                  onClick={close}
                >
                  Batal
                </Button>
                <Button
                  type="submit"
                  className="min-h-11"
                  disabled={writesDisabled}
                >
                  Terapkan pemetaan
                </Button>
              </DrawerFooter>
            </form>
          )}
        </DrawerContent>
      </Drawer>
      <Dialog
        open={
          modal === "copy" ||
          modal === "publish" ||
          modal === "save-draft" ||
          modal === "save-changes"
        }
        onOpenChange={(value) => {
          if (!value && !busy && !uncertain) close()
        }}
      >
        <DialogContent
          className="max-h-[85dvh] overflow-y-auto"
          showCloseButton={false}
        >
          <DialogHeader>
            <DialogTitle>
              {modal === "copy"
                ? "Salin minggu sebelumnya"
                : modal === "publish"
                  ? "Tinjau jadwal"
                  : modal === "save-changes"
                    ? "Tinjau perubahan"
                    : "Simpan draf"}
            </DialogTitle>
            <DialogDescription>
              {outletName} · {plannerDateLabel(weekStart)} sampai{" "}
              {plannerDateLabel(shiftPlannerDate(weekStart, 6))}. Isi alasan
              untuk melanjutkan.
            </DialogDescription>
          </DialogHeader>
          {error ? (
            <Alert variant="destructive">
              <AlertTitle>Periksa kembali</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          {uncertain ? (
            <Alert>
              <AlertTitle>Jangan kirim perubahan baru</AlertTitle>
              <AlertDescription className="flex flex-col items-start gap-2">
                Periksa hasil penyimpanan sebelum melanjutkan.
                <Button
                  type="button"
                  variant="outline"
                  className="min-h-11"
                  disabled={busy}
                  onClick={() => {
                    if (pending.current) void send(pending.current)
                  }}
                >
                  Periksa hasil penyimpanan
                </Button>
              </AlertDescription>
            </Alert>
          ) : null}
          <form onSubmit={submitReason}>
            <FieldGroup>
              {modal === "copy" ? (
                <div className="flex min-w-0 flex-col gap-3">
                  {previousPublishedWeek ? (
                    <p className="text-body">
                      Jadwal sumber: {plannerDateLabel(previousWeek)} sampai{" "}
                      {plannerDateLabel(shiftPlannerDate(previousWeek, 6))},
                      revisi {previousPublishedWeek.published_revision_id}.
                    </p>
                  ) : (
                    <p className="text-body">
                      Jadwal minggu sebelumnya tidak dapat disalin.
                    </p>
                  )}
                  {copyLoading ? (
                    <p role="status" className="text-caption">
                      Memuat jadwal sumber…
                    </p>
                  ) : null}
                  {copyError ? (
                    <Alert variant="destructive">
                      <AlertTitle>Pratinjau belum tersedia</AlertTitle>
                      <AlertDescription className="flex flex-col items-start gap-2">
                        {copyError}
                        <Button
                          type="button"
                          variant="outline"
                          className="min-h-11"
                          disabled={writesDisabled || copyLoading}
                          onClick={() => void openCopyPreview()}
                        >
                          Muat ulang pratinjau
                        </Button>
                      </AlertDescription>
                    </Alert>
                  ) : null}
                  {copyPreview?.published ? (
                    <>
                      <p className="text-label">
                        {copyPreview.published.entries.length} penugasan akan
                        dipetakan ke tanggal minggu ini.
                      </p>
                      {copyPreview.published.entries.length ? (
                        <ul className="flex max-h-52 min-w-0 flex-col gap-2 overflow-y-auto">
                          {copyPreview.published.entries.map((entry) => {
                            const targetDate = shiftPlannerDate(
                              entry.work_date,
                              7
                            )
                            const employee =
                              data.employees.find(
                                (item) => item.id === entry.employee_id
                              )?.name ?? "Karyawan tidak tersedia"
                            const assignmentLabel =
                              entry.status === "rest"
                                ? "Istirahat"
                                : entry.status === "unscheduled"
                                  ? "Tidak dijadwalkan"
                                  : (shiftLabels[
                                      entry.shift_template_version_id ?? 0
                                    ] ?? "Versi shift tidak tersedia")
                            return (
                              <li
                                key={plannerEntryKey(entry)}
                                className="flex min-w-0 flex-col gap-0.5 border-b border-border pb-2 last:border-b-0"
                              >
                                <span className="text-label wrap-anywhere">
                                  {employee}
                                </span>
                                <span className="text-caption wrap-anywhere">
                                  {plannerDateLabel(targetDate)} ·{" "}
                                  {assignmentLabel}
                                </span>
                              </li>
                            )
                          })}
                        </ul>
                      ) : (
                        <p className="text-caption text-muted-foreground">
                          Jadwal terbit sebelumnya belum berisi penugasan.
                        </p>
                      )}
                      <p className="text-caption text-muted-foreground">
                        Salinan menjadi draf. Jadwal terbit tidak berubah sampai
                        draf diterbitkan.
                      </p>
                    </>
                  ) : null}
                </div>
              ) : null}
              {modal === "save-draft" ? (
                <p className="text-body">
                  Simpan perubahan sebagai draf. Jadwal yang berlaku tidak
                  berubah sampai draf diterbitkan.
                </p>
              ) : null}
              {(modal === "publish" || modal === "save-changes") &&
              preview &&
              preview.kind === modal &&
              preview.version === data.version ? (
                <div className="flex min-w-0 flex-col gap-3">
                  <p className="text-body">
                    Pemeriksaan untuk {preview.entries.length} penugasan.
                  </p>
                  {preview.valid === false ||
                  preview.staffing_report.conflicts.length > 0 ? (
                    <Alert variant="destructive">
                      <AlertTitle>Konflik harus diperbaiki</AlertTitle>
                      <AlertDescription>
                        <ul className="flex flex-col gap-1">
                          {preview.staffing_report.conflicts.map((conflict) => (
                            <li key={conflict}>{conflict}</li>
                          ))}
                          {preview.valid === false &&
                          preview.staffing_report.conflicts.length === 0 ? (
                            <li>Jadwal belum lolos pemeriksaan.</li>
                          ) : null}
                        </ul>
                      </AlertDescription>
                    </Alert>
                  ) : preview.staffing_report.deficits.length ? (
                    <>
                      <Alert>
                        <AlertTitle>
                          Kekurangan kebutuhan shift harus disetujui
                        </AlertTitle>
                        <AlertDescription>
                          Persetujuan ini berlaku untuk perubahan yang tampil.
                        </AlertDescription>
                      </Alert>
                      <ul className="flex max-h-48 flex-col gap-1 overflow-y-auto text-caption">
                        {preview.staffing_report.deficits.map((item) => (
                          <li key={`${item.work_date}-${item.role}`}>
                            {plannerDateLabel(item.work_date)} ·{" "}
                            {staffingLabels[item.role]}: {item.assigned}/
                            {item.required}, kurang {item.missing}
                          </li>
                        ))}
                      </ul>
                      {preview.staffing_report.checksum ? (
                        <Field orientation="horizontal">
                          <Checkbox
                            id="planner-ack"
                            checked={acknowledged}
                            disabled={writesDisabled}
                            onCheckedChange={(value) =>
                              setAcknowledged(value === true)
                            }
                          />
                          <FieldLabel htmlFor="planner-ack">
                            Saya memahami kekurangan ini dan tetap{" "}
                            {modal === "publish"
                              ? "menerbitkan draf"
                              : "menyimpan perubahan jadwal"}
                            .
                          </FieldLabel>
                        </Field>
                      ) : (
                        <Alert variant="destructive">
                          <AlertTitle>
                            Rincian peringatan tidak tersedia
                          </AlertTitle>
                          <AlertDescription>
                            Jadwal belum dapat disimpan. Muat ulang dan periksa
                            kembali.
                          </AlertDescription>
                        </Alert>
                      )}
                    </>
                  ) : (
                    <p className="text-body">
                      Tidak ada kekurangan kebutuhan shift.
                    </p>
                  )}
                </div>
              ) : null}
              <Field data-invalid={Boolean(reasonError)}>
                <FieldLabel htmlFor="planner-reason">
                  Alasan perubahan
                </FieldLabel>
                <Input
                  id="planner-reason"
                  required
                  minLength={3}
                  maxLength={1000}
                  value={reason}
                  disabled={writesDisabled}
                  aria-invalid={Boolean(reasonError)}
                  aria-describedby={
                    reasonError ? "planner-reason-error" : undefined
                  }
                  onChange={(event) => {
                    setReason(event.target.value)
                    setReasonError("")
                    guard.mark()
                  }}
                />
                {reasonError ? (
                  <p
                    id="planner-reason-error"
                    className="text-caption text-destructive"
                  >
                    {reasonError}
                  </p>
                ) : null}
              </Field>
            </FieldGroup>
            <DialogFooter className="mt-4 flex-wrap">
              <Button
                type="button"
                variant="outline"
                className="min-h-11"
                disabled={busy || uncertain}
                onClick={close}
              >
                Batal
              </Button>
              <Button
                type="submit"
                className="min-h-11"
                disabled={
                  writesDisabled ||
                  (modal === "copy" &&
                    (!copyPreview?.published ||
                      copyLoading ||
                      !previousPublishedWeek)) ||
                  (modal === "save-draft" &&
                    (!draftMode || !candidateDirty || !hasStaffing)) ||
                  (modal === "publish" &&
                    (!data.draft ||
                      candidateDirty ||
                      preview?.kind !== "publish" ||
                      preview.version !== data.version ||
                      preview.valid === false ||
                      preview.staffing_report.conflicts.length > 0 ||
                      (preview.staffing_report.deficits.length > 0 &&
                        (!acknowledged ||
                          !preview.staffing_report.checksum)))) ||
                  (modal === "save-changes" &&
                    (!data.published ||
                      data.draft !== null ||
                      !candidateDirty ||
                      !hasStaffing ||
                      preview?.kind !== "save-changes" ||
                      preview.version !== data.version ||
                      !samePlannerEntries(preview.entries, candidateEntries) ||
                      preview.valid === false ||
                      preview.staffing_report.conflicts.length > 0 ||
                      (preview.staffing_report.deficits.length > 0 &&
                        (!acknowledged || !preview.staffing_report.checksum))))
                }
              >
                {busy
                  ? "Memproses…"
                  : modal === "copy"
                    ? "Salin sebagai draf"
                    : modal === "publish"
                      ? "Terbitkan jadwal"
                      : modal === "save-changes"
                        ? "Simpan perubahan"
                        : "Simpan draf"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  )
}
