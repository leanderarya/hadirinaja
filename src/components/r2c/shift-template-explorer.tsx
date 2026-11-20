import { ChevronRight, Clock3, Plus } from "lucide-react"
import { useCallback, useEffect, useId, useRef, useState } from "react"
import { ConsequenceDialog } from "@/components/r2c/components"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "@/components/ui/alert-dialog"
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
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty"
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  ShiftSaveError,
  selectedShift,
  utcDate,
  validateShift,
  type ShiftCommand,
  type ShiftDraft,
  type ShiftSelection,
  type ShiftTemplate,
} from "@/lib/shift-templates"
import { cn } from "@/lib/utils"

export interface ShiftTemplateExplorerProps {
  templates: ShiftTemplate[]
  canManage: boolean
  compact?: boolean
  selection: ShiftSelection
  query: string
  onSelect: (selection: ShiftSelection, saved?: boolean) => void
  onQuery: (query: string) => void
  onSave: (command: ShiftCommand) => Promise<ShiftSelection>
  onInspect: () => void
  onDirtyChange: (value: boolean) => void
}
const blank: ShiftDraft = {
  name: "",
  start_time: "",
  end_time: "",
  crosses_midnight: false,
  effective_from: "",
  reason: "",
}

export function ShiftTemplateExplorer({
  templates,
  canManage,
  compact = false,
  selection,
  query,
  onSelect,
  onQuery,
  onSave,
  onInspect,
  onDirtyChange,
}: ShiftTemplateExplorerProps) {
  const { template, version, invalid } = selectedShift(templates, selection)
  const [editor, setEditor] = useState<{
    templateId?: number
    seed: ShiftDraft
  } | null>(null)
  const [draft, setDraft] = useState<ShiftDraft>(blank)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [error, setError] = useState("")
  const [uncertain, setUncertain] = useState(false)
  const [busy, setBusy] = useState(false)
  const [discard, setDiscard] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const confirmationFocus = useRef<HTMLElement | null>(null)
  const trigger = useRef<HTMLElement | null>(null)
  const heading = useRef<HTMLHeadingElement | null>(null)
  const focusAfterSelection = useRef(false)
  const saved = useRef(false)
  const posting = useRef(false)
  const form = useRef<HTMLFormElement | null>(null)
  const fieldId = useId()
  const dirty = Boolean(
    editor && JSON.stringify(draft) !== JSON.stringify(editor.seed)
  )
  const hasSelection = Boolean(selection.templateId || selection.versionId)
  const filtered = templates.filter((item) =>
    item.name
      .toLocaleLowerCase("id-ID")
      .includes(query.trim().toLocaleLowerCase("id-ID"))
  )
  const selectedId = template?.id

  useEffect(() => {
    onDirtyChange(dirty || busy)
  }, [dirty, busy, onDirtyChange])
  useEffect(() => () => onDirtyChange(false), [onDirtyChange])
  useEffect(() => {
    if (focusAfterSelection.current && selectedId) {
      focusAfterSelection.current = false
      heading.current?.focus({ preventScroll: true })
    }
  }, [selectedId])
  useEffect(() => {
    if (saved.current && !editor && selectedId)
      heading.current?.focus({ preventScroll: true })
  }, [editor, selectedId])

  function update<K extends keyof ShiftDraft>(key: K, value: ShiftDraft[K]) {
    const next = { ...draft, [key]: value }
    onDirtyChange(
      Boolean(editor && JSON.stringify(next) !== JSON.stringify(editor.seed))
    )
    setDraft(next)
    setErrors({})
    setError("")
  }
  function open(button: HTMLElement, revision: boolean) {
    if (!canManage || (revision && !template)) return
    const seed =
      revision && template
        ? (version ??
          [...template.versions].sort((a, b) => b.revision - a.revision)[0])
        : undefined
    const initial =
      seed && template
        ? {
            ...blank,
            name: template.name,
            start_time: seed.start_time,
            end_time: seed.end_time,
            crosses_midnight: seed.crosses_midnight,
          }
        : { ...blank }
    trigger.current = button
    saved.current = false
    setEditor({
      templateId: revision ? template?.id : undefined,
      seed: initial,
    })
    setDraft(initial)
    setErrors({})
    setError("")
    setUncertain(false)
  }
  function close() {
    if (busy) return
    if (dirty) setDiscard(true)
    else setEditor(null)
  }
  const focusError = useCallback((fields: Record<string, string>) => {
    const first = Object.keys(fields)[0]
    const control = first
      ? form.current?.querySelector<HTMLElement>(`[name="${first}"]`)
      : null
    if (control) {
      confirmationFocus.current = control
      control.focus()
    }
  }, [])
  useEffect(() => {
    if (busy) return
    if (uncertain) {
      const recovery = form.current?.querySelector<HTMLElement>(
        "[data-uncertain-recovery]"
      )
      if (recovery) {
        confirmationFocus.current = recovery
        recovery.focus()
      }
    } else focusError(errors)
  }, [busy, uncertain, errors, focusError])
  function valid() {
    const fields = validateShift(draft, !editor?.templateId)
    setErrors(fields)
    focusError(fields)
    return Object.keys(fields).length === 0
  }
  async function save() {
    if (!editor || !canManage || posting.current || uncertain || !valid())
      return
    posting.current = true
    setBusy(true)
    setConfirm(false)
    setError("")
    try {
      const payload = {
        ...draft,
        name: draft.name.trim(),
        reason: draft.reason.trim(),
      }
      const next = await onSave(
        editor.templateId
          ? { kind: "revision", templateId: editor.templateId, draft: payload }
          : { kind: "create", draft: payload }
      )
      saved.current = true
      onDirtyChange(false)
      setEditor(null)
      onSelect(next, true)
    } catch (caught) {
      const failure =
        caught instanceof ShiftSaveError
          ? caught
          : new ShiftSaveError("Perubahan belum dapat disimpan.")
      setUncertain(failure.uncertain)
      setError(failure.message)
      const fields = Object.fromEntries(
        Object.entries(failure.fields).map(([key, value]) => [key, value[0]])
      )
      setErrors(fields)
      focusError(fields)
    } finally {
      posting.current = false
      setBusy(false)
    }
  }
  function field(
    key: "name" | "start_time" | "end_time" | "effective_from" | "reason",
    label: string,
    type: "text" | "time" | "date" = "text"
  ) {
    return (
      <Field data-invalid={Boolean(errors[key])}>
        <FieldLabel htmlFor={`${fieldId}-${key}`}>{label}</FieldLabel>
        <Input
          id={`${fieldId}-${key}`}
          name={key}
          type={type}
          value={draft[key]}
          required
          disabled={busy || uncertain}
          maxLength={key === "name" ? 120 : key === "reason" ? 1000 : undefined}
          minLength={key === "name" ? 2 : key === "reason" ? 3 : undefined}
          min={type === "date" ? utcDate() : undefined}
          aria-invalid={Boolean(errors[key])}
          aria-describedby={errors[key] ? `${fieldId}-${key}-error` : undefined}
          onChange={(event) => update(key, event.target.value)}
        />
        {errors[key] ? (
          <FieldError id={`${fieldId}-${key}-error`} role="alert">
            {errors[key]}
          </FieldError>
        ) : null}
      </Field>
    )
  }

  return (
    <div
      className="flex min-w-0 flex-col gap-5 [overflow-wrap:anywhere]"
      data-shift-explorer
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-body text-muted-foreground">
          {templates.length} template · {compact ? "seluruh organisasi" : "berlaku untuk organisasi, tanpa filter Outlet"}
        </p>
        {canManage ? (
          <Button onClick={(event) => open(event.currentTarget, false)}>
            <Plus data-icon="inline-start" />
            Buat template
          </Button>
        ) : (
          <Badge variant="secondary">Hanya lihat · template organisasi</Badge>
        )}
      </div>
      <div className="grid min-w-0 items-start gap-5 md:grid-cols-[240px_minmax(0,1fr)] lg:grid-cols-[300px_minmax(0,1fr)]">
        <Card className="min-w-0">
          <CardHeader>
            <CardTitle>{compact ? "Daftar template" : "Template shift"}</CardTitle>
            {!compact ? <CardDescription>
              Pilih template untuk membaca definisi dan revisinya.
            </CardDescription> : null}
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <Field>
              <FieldLabel className="sr-only" htmlFor={`${fieldId}-search`}>
                Cari template
              </FieldLabel>
              <Input
                id={`${fieldId}-search`}
                value={query}
                placeholder="Nama template"
                maxLength={120}
                onChange={(event) => onQuery(event.target.value)}
              />
            </Field>
            <nav
              aria-label="Daftar template shift"
              className="flex flex-col gap-2"
            >
              {filtered.map((item) => (
                <Button
                  key={item.id}
                  variant={item.id === template?.id ? "secondary" : "outline"}
                  className="h-auto min-h-16 justify-start whitespace-normal p-3 text-start"
                  aria-current={item.id === template?.id ? "page" : undefined}
                  onClick={() => {
                    if (item.id !== template?.id)
                      focusAfterSelection.current = true
                    onSelect({ templateId: item.id })
                  }}
                >
                  <Clock3 aria-hidden="true" data-icon="inline-start" />
                  <span className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className="text-label">{item.name}</span>
                    <span className="text-caption text-muted-foreground">
                      {item.versions.length} revisi tersimpan
                    </span>
                  </span>
                  <ChevronRight aria-hidden="true" />
                </Button>
              ))}
            </nav>
            {!filtered.length ? (
              <Empty className="p-3">
                <EmptyHeader>
                  <EmptyTitle>
                    {query ? "Tidak ada hasil" : "Belum ada template shift"}
                  </EmptyTitle>
                  <EmptyDescription>
                    {query
                      ? "Coba nama lain atau hapus pencarian."
                      : canManage
                        ? "Buat template pertama dengan jam dan tanggal yang dipilih secara eksplisit."
                        : "Template belum tersedia pada organisasi ini."}
                  </EmptyDescription>
                </EmptyHeader>
                {query ? (
                  <Button variant="outline" onClick={() => onQuery("")}>
                    Hapus pencarian
                  </Button>
                ) : null}
              </Empty>
            ) : null}
          </CardContent>
        </Card>
        {templates.length > 0 || hasSelection ? (
          <section
            aria-label="Detail template shift"
            className={cn(
              "flex min-w-0 flex-col gap-4",
              !hasSelection && "hidden md:flex"
            )}
          >
            {invalid ? (
              <Alert variant="destructive">
                <AlertTitle>Pilihan tidak tersedia</AlertTitle>
                <AlertDescription>
                  Template atau revisi tidak tersedia pada organisasi aktif. Pilih
                  kembali dari daftar.
                </AlertDescription>
              </Alert>
            ) : template ? (
              <>
                <Card>
                  <CardHeader>
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <h2
                        tabIndex={-1}
                        ref={heading}
                        className="text-title min-w-0 flex-1 outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        {template.name}
                      </h2>
                      {canManage ? (
                        <Button
                          variant="outline"
                          disabled={!template.versions.length}
                          onClick={(event) => open(event.currentTarget, true)}
                        >
                          <Plus data-icon="inline-start" />
                          Buat revisi
                        </Button>
                      ) : null}
                    </div>
                  </CardHeader>
                </Card>
                <Card>
                  <CardHeader>
                    <CardTitle>Revisi template</CardTitle>
                  </CardHeader>
                  <CardContent className="flex flex-col gap-3">
                    {[...template.versions]
                      .sort((a, b) => b.revision - a.revision)
                      .map((item) => (
                        <Button
                          key={item.id}
                          variant={
                            version?.id === item.id ? "secondary" : "outline"
                          }
                          aria-pressed={version?.id === item.id}
                          className="h-auto min-h-20 justify-start whitespace-normal p-4 text-start"
                          onClick={() =>
                            onSelect({
                              templateId: template.id,
                              versionId: item.id,
                            })
                          }
                        >
                          <span className="flex min-w-0 flex-col gap-1">
                            <span className="text-label">
                              Revisi {item.revision}
                              {version?.id === item.id ? " · dipilih" : ""}
                            </span>
                            <span className="text-body">
                              {item.start_time} → {item.end_time}
                              {item.crosses_midnight
                                ? " · hari berikutnya"
                                : " · hari yang sama"}
                            </span>
                            <span className="text-caption text-muted-foreground">
                              Tersedia mulai {item.effective_from} · batas tanggal
                              UTC
                            </span>
                            <span className="text-caption text-muted-foreground">
                              ID versi {item.id}
                            </span>
                          </span>
                        </Button>
                      ))}
                  </CardContent>
                </Card>
              </>
            ) : compact ? (
              <p className="text-body text-muted-foreground py-3">Pilih template untuk melihat revisi.</p>
            ) : (
              <Card>
                <CardHeader>
                  <CardTitle>Pilih template shift</CardTitle>
                  <CardDescription>
                    Gunakan daftar untuk membaca revisi sebelum membuat perubahan.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <Clock3
                    className="size-12 text-muted-foreground"
                    aria-hidden="true"
                  />
                </CardContent>
              </Card>
            )}
          </section>
        ) : null}
      </div>
      <Dialog
        open={Boolean(editor)}
        onOpenChange={(open) => {
          if (!open) close()
        }}
      >
        <DialogContent
          showCloseButton={!busy}
          finalFocus={() =>
            saved.current ? false : (trigger.current ?? false)
          }
          className="max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] overflow-y-auto p-4 [overflow-wrap:anywhere] sm:max-w-[480px] md:p-8"
        >
          <DialogHeader className="min-w-0">
            <DialogTitle>
              {editor?.templateId
                ? "Buat revisi template"
                : "Buat template shift"}
            </DialogTitle>
            <DialogDescription>
              Durasi definisi 15 menit–18 jam. Tanggal tersedia tidak boleh
              sebelum hari ini menurut UTC. Revisi historis dan penugasan tidak
              diubah.
            </DialogDescription>
          </DialogHeader>
          <form
            ref={form}
            onSubmit={(event) => {
              event.preventDefault()
              if (uncertain || busy || !valid()) return
              if (editor?.templateId) {
                confirmationFocus.current =
                  form.current?.querySelector<HTMLElement>(
                    'button[type="submit"]'
                  ) ?? null
                setConfirm(true)
              } else void save()
            }}
            className="flex min-w-0 flex-col gap-4"
            aria-busy={busy}
          >
            {error ? (
              <Alert variant="destructive">
                <AlertTitle>
                  {uncertain
                    ? "Hasil belum dapat dipastikan"
                    : "Perubahan belum tersimpan"}
                </AlertTitle>
                <AlertDescription role="alert">{error}</AlertDescription>
              </Alert>
            ) : null}
            {editor?.templateId ? (
              <p className="text-label">
                {editor.seed.name} · nama template tetap
              </p>
            ) : null}
            <FieldGroup>
              {!editor?.templateId ? field("name", "Nama template") : null}
              {field("start_time", "Jam mulai", "time")}
              {field("end_time", "Jam selesai", "time")}
              <Field orientation="horizontal">
                <Checkbox
                  id={`${fieldId}-overnight`}
                  checked={draft.crosses_midnight}
                  disabled={busy || uncertain}
                  onCheckedChange={(value) =>
                    update("crosses_midnight", Boolean(value))
                  }
                />
                <FieldLabel htmlFor={`${fieldId}-overnight`}>
                  Selesai pada hari berikutnya
                </FieldLabel>
              </Field>
              {field("effective_from", "Tanggal tersedia (UTC)", "date")}
              {field("reason", "Alasan perubahan")}
            </FieldGroup>
            {dirty ? (
              <p className="text-caption text-muted-foreground" role="status">
                Ada perubahan yang belum disimpan.
              </p>
            ) : null}
            {uncertain ? (
              <Button
                data-uncertain-recovery
                type="button"
                variant="outline"
                onClick={() => {
                  onDirtyChange(false)
                  setEditor(null)
                  onInspect()
                }}
              >
                Tutup editor dan periksa daftar
              </Button>
            ) : (
              <Button type="submit" disabled={busy}>
                {busy
                  ? "Menyimpan…"
                  : editor?.templateId
                    ? "Tinjau revisi"
                    : "Simpan template"}
              </Button>
            )}
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={close}
            >
              Batal
            </Button>
          </form>
        </DialogContent>
      </Dialog>
      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent finalFocus={confirmationFocus}>
          <AlertDialogHeader>
            <AlertDialogTitle>Buat revisi baru?</AlertDialogTitle>
            <AlertDialogDescription>
              {`${draft.start_time} → ${draft.end_time}${draft.crosses_midnight ? " hari berikutnya" : ""}, tersedia mulai ${draft.effective_from} UTC. Versi lama dan penugasan yang sudah ada tetap dipertahankan.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction onClick={() => void save()}>
              Simpan revisi
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <ConsequenceDialog
        open={discard}
        onOpenChange={setDiscard}
        title="Buang perubahan?"
        consequence="Draf template belum disimpan. Buang draf untuk menutup editor."
        actionLabel="Buang perubahan"
        onConfirm={() => {
          setDiscard(false)
          onDirtyChange(false)
          setEditor(null)
        }}
      />
    </div>
  )
}
