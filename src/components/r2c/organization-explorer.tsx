import {
  ArrowLeft,
  Building2,
  ChevronRight,
  MapPin,
  Pencil,
  Plus,
} from "lucide-react"
import { useEffect, useId, useRef, useState } from "react"
import { ConsequenceDialog } from "@/components/r2c/components"
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
import { Textarea } from "@/components/ui/textarea"
import { ApiError, type OrganizationSummary } from "@/lib/api"
import {
  type OrganizationCommand,
  type OrganizationSelection,
  organizationUnits,
  selectedOrganization,
} from "@/lib/organization-explorer"
import { cn } from "@/lib/utils"

type Editor = {
  kind: OrganizationCommand["kind"]
  id?: number
  unitId?: number
  original: string
  originalAddress?: string | null
}

export interface OrganizationExplorerProps {
  organization: OrganizationSummary
  canManage: boolean
  selection: OrganizationSelection
  query: string
  onSelect: (selection: OrganizationSelection, afterSave?: boolean) => void
  onQuery: (query: string) => void
  onSave: (command: OrganizationCommand) => Promise<OrganizationSelection>
  onDirtyChange: (dirty: boolean) => void
}

export function OrganizationExplorer({
  organization,
  canManage,
  selection,
  query,
  onSelect,
  onQuery,
  onSave,
  onDirtyChange,
}: OrganizationExplorerProps) {
  const { unit, outlet, invalid } = selectedOrganization(
    organization,
    selection
  )
  const units = organizationUnits(organization, query)
  const [editor, setEditor] = useState<Editor | null>(null)
  const [name, setName] = useState("")
  const [address, setAddress] = useState("")
  const [error, setError] = useState("")
  const [errorField, setErrorField] = useState<"name" | "address">("name")
  const [busy, setBusy] = useState(false)
  const [discard, setDiscard] = useState(false)
  const trigger = useRef<HTMLElement | null>(null)
  const saved = useRef(false)
  const detailHeading = useRef<HTMLHeadingElement | null>(null)
  const nameInput = useRef<HTMLInputElement | null>(null)
  const addressInput = useRef<HTMLTextAreaElement | null>(null)
  const submitting = useRef(false)
  const fieldId = useId()
  const outletEditor =
    editor?.kind === "create-outlet" || editor?.kind === "rename-outlet"
  const dirty = Boolean(
    editor &&
      (name !== editor.original ||
        (outletEditor && address !== (editor.originalAddress ?? "")))
  )
  const hasSelection = Boolean(selection.unitId || selection.outletId)
  const selectedId = outlet?.id ?? unit?.id

  useEffect(() => {
    onDirtyChange(dirty || busy)
  }, [dirty, busy, onDirtyChange])
  useEffect(() => () => onDirtyChange(false), [onDirtyChange])
  useEffect(() => {
    if (selectedId) detailHeading.current?.focus({ preventScroll: true })
  }, [selectedId])

  useEffect(() => {
    if (saved.current && !editor && selectedId)
      detailHeading.current?.focus({ preventScroll: true })
  }, [editor, selectedId])

  function open(next: Editor, button: HTMLElement) {
    saved.current = false
    trigger.current = button
    setEditor(next)
    setName(next.original)
    setAddress(next.originalAddress ?? "")
    setError("")
    setErrorField("name")
  }

  function requestClose() {
    if (busy) return
    if (dirty) setDiscard(true)
    else setEditor(null)
  }

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!editor || !canManage || submitting.current) return
    if (!name.trim() || name.trim().length > 120) {
      setError("Nama wajib diisi, maksimal 120 karakter.")
      setErrorField("name")
      nameInput.current?.focus()
      return
    }
    if (outletEditor && address.trim().length > 500) {
      setError("Alamat maksimal 500 karakter.")
      setErrorField("address")
      addressInput.current?.focus()
      return
    }
    let command: OrganizationCommand
    if (editor.kind === "create-unit")
      command = { kind: editor.kind, name: name.trim() }
    else if (editor.kind === "create-outlet" && editor.unitId)
      command = {
        kind: editor.kind,
        unitId: editor.unitId,
        name: name.trim(),
        address: address.trim(),
      }
    else if (
      (editor.kind === "rename-unit" || editor.kind === "rename-outlet") &&
      editor.id
    )
      command =
        editor.kind === "rename-outlet"
          ? {
              kind: editor.kind,
              id: editor.id,
              name: name.trim(),
              address: address.trim(),
            }
          : { kind: editor.kind, id: editor.id, name: name.trim() }
    else return
    submitting.current = true
    setBusy(true)
    setError("")
    try {
      const next = await onSave(command)
      saved.current = true
      onDirtyChange(false)
      setEditor(null)
      onSelect(next, true)
    } catch (caught) {
      const nameError =
        caught instanceof ApiError ? caught.errors?.name?.[0] : undefined
      const addressError =
        caught instanceof ApiError ? caught.errors?.address?.[0] : undefined
      setErrorField(addressError ? "address" : "name")
      setError(
        nameError ??
          addressError ??
          (caught instanceof ApiError
            ? caught.message
            : "Perubahan belum tersimpan. Coba lagi tanpa menutup editor.")
      )
      if (addressError) addressInput.current?.focus()
      else nameInput.current?.focus()
    } finally {
      submitting.current = false
      setBusy(false)
    }
  }

  const title =
    editor?.kind === "create-unit"
      ? "Tambah unit bisnis"
      : editor?.kind === "rename-unit"
        ? "Ubah nama unit bisnis"
        : editor?.kind === "create-outlet"
          ? "Tambah Outlet"
          : "Ubah detail Outlet"
  const editorParent = organization.business_units.find(
    (item) => item.id === editor?.unitId
  )

  return (
    <div
      className="flex min-w-0 flex-col gap-5 [overflow-wrap:anywhere]"
      data-organization-explorer
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-body text-muted-foreground">
          {organization.business_units.length} unit bisnis{" "}
          <span aria-hidden="true">·</span> {organization.outlets.length} Outlet
          yang dapat Anda akses
        </p>
        {canManage ? (
          <Button
            onClick={(event) =>
              open({ kind: "create-unit", original: "" }, event.currentTarget)
            }
          >
            <Plus data-icon="inline-start" />
            Tambah unit bisnis
          </Button>
        ) : (
          <Badge variant="secondary">Hanya lihat</Badge>
        )}
      </div>
      <div className="grid min-w-0 items-start gap-5 md:grid-cols-[240px_minmax(0,1fr)] lg:grid-cols-[300px_minmax(0,1fr)]">
        <Card className={cn("min-w-0", hasSelection && "hidden md:flex")}>
          <CardHeader>
            <CardTitle>Unit bisnis</CardTitle>
            <CardDescription>
              Pilih unit untuk menelusuri Outlet.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <Field>
              <FieldLabel htmlFor={`${fieldId}-search`}>
                Cari organisasi
              </FieldLabel>
              <Input
                id={`${fieldId}-search`}
                placeholder="Unit bisnis atau Outlet"
                value={query}
                maxLength={120}
                onChange={(event) => onQuery(event.target.value)}
              />
            </Field>
            <p className="text-caption text-muted-foreground">
              {units.length} dari {organization.business_units.length} unit
              bisnis
            </p>
            <nav
              aria-label="Daftar unit bisnis"
              className="flex flex-col gap-2"
            >
              {units.map((item) => (
                <Button
                  key={item.id}
                  variant={unit?.id === item.id ? "secondary" : "outline"}
                  aria-current={unit?.id === item.id ? "page" : undefined}
                  className="h-auto min-h-16 w-full justify-start whitespace-normal p-3 text-start"
                  onClick={() => onSelect({ unitId: item.id })}
                >
                  <Building2 aria-hidden="true" data-icon="inline-start" />
                  <span className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className="text-label [overflow-wrap:anywhere]">
                      {item.name}
                    </span>
                    <span className="text-caption text-muted-foreground">
                      {item.outlets.length} Outlet
                    </span>
                  </span>
                  <ChevronRight aria-hidden="true" />
                </Button>
              ))}
            </nav>
            {!units.length ? (
              <Empty className="p-2">
                <EmptyHeader>
                  <EmptyTitle>
                    {query ? "Tidak ada hasil" : "Belum ada unit bisnis"}
                  </EmptyTitle>
                  <EmptyDescription>
                    {query
                      ? "Coba nama unit atau Outlet lain."
                      : canManage
                        ? "Tambahkan unit bisnis untuk mulai menyusun organisasi."
                        : "Struktur organisasi belum tersedia untuk akun Anda."}
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
        <section
          className={cn(
            "flex min-w-0 flex-col gap-4",
            !hasSelection && "hidden md:flex"
          )}
          aria-label="Detail organisasi"
        >
          {hasSelection ? (
            <Button
              variant="ghost"
              className="w-fit max-w-full whitespace-normal text-start"
              onClick={() =>
                onSelect(outlet && unit ? { unitId: unit.id } : {})
              }
            >
              <ArrowLeft data-icon="inline-start" />
              {outlet && unit ? `Kembali ke ${unit.name}` : "Semua unit bisnis"}
            </Button>
          ) : null}
          {invalid ? (
            <Alert variant="destructive">
              <AlertTitle>Pilihan tidak tersedia</AlertTitle>
              <AlertDescription>
                Unit atau Outlet ini tidak tersedia untuk organisasi atau akses
                Anda saat ini. Pilih kembali dari daftar unit bisnis.
              </AlertDescription>
            </Alert>
          ) : unit ? (
            <>
              <Card>
                <CardHeader>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex min-w-0 flex-1 flex-col gap-2">
                      <p className="text-caption text-muted-foreground">
                        {outlet ? "Outlet" : "Unit bisnis"}
                      </p>
                      <h2
                        ref={detailHeading}
                        tabIndex={-1}
                        className="text-title [overflow-wrap:anywhere] outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        {outlet?.name ?? unit.name}
                      </h2>
                    </div>
                    {canManage ? (
                      <Button
                        variant="outline"
                        onClick={(event) =>
                          open(
                            outlet
                              ? {
                                  kind: "rename-outlet",
                                  id: outlet.id,
                                  unitId: unit.id,
                                  original: outlet.name,
                                  originalAddress: outlet.address,
                                }
                              : {
                                  kind: "rename-unit",
                                  id: unit.id,
                                  original: unit.name,
                                },
                            event.currentTarget
                          )
                        }
                      >
                        <Pencil data-icon="inline-start" />
                        {outlet ? "Ubah detail" : "Ubah nama"}
                      </Button>
                    ) : null}
                  </div>
                  <CardDescription>
                    {outlet
                      ? "Informasi Outlet dalam organisasi aktif."
                      : `${organization.outlets.filter((item) => item.business_unit_id === unit.id).length} Outlet terhubung ke unit bisnis ini.`}
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-4">
                  <dl className="flex flex-col gap-1">
                    <dt className="text-caption text-muted-foreground">
                      Organisasi
                    </dt>
                    <dd className="text-body [overflow-wrap:anywhere]">
                      {organization.tenant.name}
                    </dd>
                  </dl>
                  {outlet ? (
                    <dl className="flex flex-col gap-1">
                      <dt className="text-caption text-muted-foreground">
                        Unit bisnis induk
                      </dt>
                      <dd>
                        <Button
                          variant="link"
                          className="h-auto max-w-full whitespace-normal p-0 text-start"
                          onClick={() => onSelect({ unitId: unit.id })}
                        >
                          {unit.name}
                        </Button>
                      </dd>
                    </dl>
                  ) : null}
                  {outlet ? (
                    <dl className="flex flex-col gap-1">
                      <dt className="text-caption text-muted-foreground">
                        Alamat Outlet
                      </dt>
                      <dd className="text-body [overflow-wrap:anywhere]">
                        {outlet.address || "Belum ada alamat."}
                      </dd>
                    </dl>
                  ) : null}
                  {outlet ? (
                    <p className="text-body text-muted-foreground">
                      Profil dan penempatan karyawan tetap dikelola melalui Tim.
                    </p>
                  ) : null}
                </CardContent>
              </Card>
              {!outlet ? (
                <Card>
                  <CardHeader>
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <CardTitle>Outlet di {unit.name}</CardTitle>
                      {canManage ? (
                        <Button
                          variant="outline"
                          onClick={(event) =>
                            open(
                              {
                                kind: "create-outlet",
                                unitId: unit.id,
                                original: "",
                              },
                              event.currentTarget
                            )
                          }
                        >
                          <Plus data-icon="inline-start" />
                          Tambah Outlet
                        </Button>
                      ) : null}
                    </div>
                    <CardDescription>
                      Pilih Outlet untuk melihat informasi dan tindakan yang
                      tersedia.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="flex flex-col gap-2">
                    {organization.outlets
                      .filter((item) => item.business_unit_id === unit.id)
                      .map((item) => (
                        <Button
                          key={item.id}
                          variant="outline"
                          className="h-auto min-h-14 justify-start whitespace-normal text-start"
                          onClick={() =>
                            onSelect({ unitId: unit.id, outletId: item.id })
                          }
                        >
                          <MapPin aria-hidden="true" data-icon="inline-start" />
                          <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">
                            {item.name}
                          </span>
                          <ChevronRight aria-hidden="true" />
                        </Button>
                      ))}
                    {!organization.outlets.some(
                      (item) => item.business_unit_id === unit.id
                    ) ? (
                      <Empty className="p-4">
                        <EmptyHeader>
                          <EmptyTitle>Belum ada Outlet</EmptyTitle>
                          <EmptyDescription>
                            {canManage
                              ? "Tambahkan Outlet pertama di unit bisnis ini."
                              : "Anda tidak memiliki akses ke Outlet di unit ini."}
                          </EmptyDescription>
                        </EmptyHeader>
                      </Empty>
                    ) : null}
                  </CardContent>
                </Card>
              ) : null}
            </>
          ) : (
            <Card>
              <CardHeader>
                <CardTitle>Jelajahi organisasi</CardTitle>
                <CardDescription>
                  Pilih unit bisnis di sebelah kiri untuk melihat daftar Outlet
                  dan detailnya.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Building2
                  className="size-12 text-muted-foreground"
                  aria-hidden="true"
                />
              </CardContent>
            </Card>
          )}
        </section>
      </div>
      <Dialog
        open={Boolean(editor)}
        onOpenChange={(open) => {
          if (!open) requestClose()
        }}
      >
        <DialogContent
          showCloseButton={!busy}
          finalFocus={() =>
            saved.current ? false : (trigger.current ?? false)
          }
          initialFocus={nameInput}
          className="max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] overflow-y-auto p-4 [overflow-wrap:anywhere] sm:max-w-[480px] md:p-8"
        >
          <DialogHeader className="min-w-0">
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>
              {editorParent
                ? `Unit bisnis: ${editorParent.name}. Hubungan induk tetap dipertahankan.`
                : "Unit bisnis akan berada dalam organisasi aktif."}
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={save}
            className="flex flex-col gap-5"
            aria-busy={busy}
          >
            <FieldGroup>
              <Field data-invalid={errorField === "name" && Boolean(error)}>
                <FieldLabel htmlFor={`${fieldId}-name`}>
                  Nama{" "}
                  {editor?.kind.endsWith("unit") ? "unit bisnis" : "Outlet"}
                </FieldLabel>
                <Input
                  ref={nameInput}
                  id={`${fieldId}-name`}
                  value={name}
                  maxLength={120}
                  required
                  disabled={busy}
                  aria-invalid={errorField === "name" && Boolean(error)}
                  aria-describedby={
                    errorField === "name" && error
                      ? `${fieldId}-name-error`
                      : undefined
                  }
                  onChange={(event) => {
                    onDirtyChange(
                      event.target.value !== editor?.original ||
                        (outletEditor &&
                          address !== (editor?.originalAddress ?? ""))
                    )
                    setName(event.target.value)
                    setError("")
                  }}
                />
                {error && errorField === "name" ? (
                  <FieldError id={`${fieldId}-name-error`} role="alert">
                    {error}
                  </FieldError>
                ) : null}
              </Field>
              {outletEditor ? (
                <Field
                  data-invalid={
                    errorField === "address" && Boolean(error)
                  }
                >
                  <FieldLabel htmlFor={`${fieldId}-address`}>
                    Alamat Outlet (opsional)
                  </FieldLabel>
                  <Textarea
                    ref={addressInput}
                    id={`${fieldId}-address`}
                    value={address}
                    maxLength={500}
                    rows={3}
                    disabled={busy}
                    aria-invalid={
                      errorField === "address" && Boolean(error)
                    }
                    aria-describedby={
                      errorField === "address" && error
                        ? `${fieldId}-address-error`
                        : undefined
                    }
                    onChange={(event) => {
                      onDirtyChange(
                        name !== editor?.original ||
                          event.target.value !==
                            (editor?.originalAddress ?? "")
                      )
                      setAddress(event.target.value)
                      setError("")
                    }}
                  />
                  {error && errorField === "address" ? (
                    <FieldError id={`${fieldId}-address-error`} role="alert">
                      {error}
                    </FieldError>
                  ) : null}
                </Field>
              ) : null}
            </FieldGroup>
            {dirty ? (
              <p className="text-caption text-muted-foreground" role="status">
                Ada perubahan yang belum disimpan.
              </p>
            ) : null}
            <div className="flex flex-col gap-2 sm:flex-row-reverse">
              <Button type="submit" disabled={busy}>
                {busy ? "Menyimpan…" : "Simpan perubahan"}
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={requestClose}
              >
                Batal
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
      <ConsequenceDialog
        open={discard}
        onOpenChange={setDiscard}
        title="Buang perubahan?"
        consequence="Perubahan organisasi belum disimpan. Buang perubahan untuk menutup editor."
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
