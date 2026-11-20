import { AlertDialog as AlertDialogPrimitive } from "@base-ui/react/alert-dialog"
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog"
import {
  ArrowUpRight,
  Check,
  ChevronRight,
  Info,
  RefreshCw,
  UserRound,
  X,
} from "lucide-react"
import {
  cloneElement,
  useId,
  type FormEventHandler,
  type ReactElement,
  type ReactNode,
} from "react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { TableCell, TableRow } from "@/components/ui/table"
import { cn } from "@/lib/utils"

export { EmployeeNavigation as EmployeeDock } from "@/components/employee-shell"

type ControlProps = {
  id?: string
  disabled?: boolean
  "aria-invalid"?: boolean
  "aria-describedby"?: string
}

export function LabeledControl({
  label,
  control,
  helper,
  error,
  disabled = false,
}: {
  label: string
  control: ReactElement<ControlProps>
  helper?: ReactNode
  error?: string
  disabled?: boolean
}) {
  const generatedId = useId()
  const id = control.props.id ?? generatedId
  const descriptionId = `${id}-description`
  return (
    <Field
      data-pen-origin="jr3jc"
      data-invalid={Boolean(error)}
      data-disabled={disabled}
    >
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      {cloneElement(control, {
        id,
        disabled: disabled || control.props.disabled,
        "aria-invalid": Boolean(error),
        "aria-describedby":
          [
            control.props["aria-describedby"],
            (error || helper) && descriptionId,
          ]
            .filter(Boolean)
            .join(" ") || undefined,
      })}
      {error || helper ? (
        <FieldDescription
          id={descriptionId}
          className={cn(error && "text-danger-strong")}
          role={error ? "alert" : undefined}
        >
          {error || helper}
        </FieldDescription>
      ) : null}
    </Field>
  )
}

export type StatusTone = "success" | "warning" | "info" | "neutral" | "danger"

export function StatusBadge({
  children,
  tone = "success",
  className,
}: {
  children: ReactNode
  tone?: StatusTone
  className?: string
}) {
  return (
    <Badge
      data-pen-origin="Y3PHCj"
      className={cn("border-0 leading-[1.2]", className)}
      variant={tone === "danger" ? "destructive" : tone}
    >
      <span
        aria-hidden="true"
        className="size-1.5 shrink-0 rounded-full bg-current"
      />
      {children}
    </Badge>
  )
}

export function ContextAlert({
  title,
  children,
  tone = "info",
  action,
  icon,
}: {
  title: string
  children: ReactNode
  tone?: "info" | "success" | "warning" | "neutral" | "danger"
  action?: ReactNode
  icon?: ReactNode
}) {
  return (
    <Alert
      data-pen-origin="zsZmf"
      variant={
        tone === "danger" ? "destructive" : tone === "info" ? "default" : tone
      }
      role={tone === "danger" ? "alert" : "status"}
    >
      <div className="flex items-center gap-2">
        {icon ?? <Info aria-hidden="true" size={18} className="shrink-0" />}
        <AlertTitle>{title}</AlertTitle>
      </div>
      <AlertDescription>
        {children}
        {action ? <div className="mt-3">{action}</div> : null}
      </AlertDescription>
    </Alert>
  )
}

export function OperationalMetric({
  label,
  value,
  context,
}: {
  label: string
  value: ReactNode
  context: string
}) {
  return (
    <Card data-pen-origin="lTQMf" className="gap-2 p-5">
      <p className="text-body text-muted-foreground">{label}</p>
      <p className="text-display">{value}</p>
      <p className="text-caption">{context}</p>
    </Card>
  )
}

export function RecordCard({
  title,
  metadata,
  result,
  status,
  actions,
}: {
  title: string
  metadata: ReactNode
  result: ReactNode
  status?: ReactNode
  actions?: ReactNode
}) {
  return (
    <Card data-pen-origin="a4hb0r" className="gap-2">
      <CardHeader className="gap-2">
        <CardTitle>{title}</CardTitle>
        <CardDescription>{metadata}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col items-start gap-2">
        <div className="whitespace-pre-line text-body">{result}</div>
        {status}
      </CardContent>
      {actions ? (
        <CardFooter className="flex-wrap gap-2">{actions}</CardFooter>
      ) : null}
    </Card>
  )
}

export function ContextFilterBar({
  context = "work-date",
  children,
  actions,
  className,
}: {
  context?: "work-date" | "audit-utc"
  children: ReactNode
  actions?: ReactNode
  className?: string
}) {
  return (
    <Card data-pen-origin="fDh72" className={cn("gap-3", className)}>
      <CardHeader className="sr-only">
        <CardTitle>Filter laporan</CardTitle>
      </CardHeader>
      <CardContent>
        <FieldGroup className="grid gap-3 md:grid-cols-3">
          {children}
        </FieldGroup>
      </CardContent>
      <CardFooter className="flex-wrap justify-between gap-3">
        <p className="text-caption text-[13px] text-brand-700">
          {context === "audit-utc"
            ? "Waktu audit ditampilkan dalam UTC · aktivitas yang telah tercatat"
            : "Tanggal kerja diproses sesuai zona Outlet · nilai efektif saat ini"}
        </p>
        {actions}
      </CardFooter>
    </Card>
  )
}

export function EmployeeHeader({
  tenantName,
  employeeName,
  roles,
  onProfile,
}: {
  tenantName: string
  employeeName: string
  roles: string
  onProfile: () => void
}) {
  return (
    <header
      data-pen-origin="NHK6a"
      className="flex h-16 min-w-0 items-center gap-3 border-b border-border bg-surface px-4"
    >
      <div className="min-w-0 flex-1">
        <p className="truncate text-label">{tenantName}</p>
        <p className="truncate text-caption">
          {employeeName} · {roles}
        </p>
      </div>
      <Button variant="outline" onClick={onProfile}>
        <UserRound data-icon="inline-start" aria-hidden="true" />
        Profil
      </Button>
    </header>
  )
}

export function MembershipContext({
  roles,
  tenantName,
  children,
}: {
  roles: readonly string[]
  tenantName: string
  children?: ReactNode
}) {
  return (
    <Card data-pen-origin="C8qqXO">
      <CardHeader>
        <CardTitle>Akses organisasi</CardTitle>
        <CardDescription>{tenantName}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="text-label text-brand-700">{roles.join(" · ")}</p>
        <p className="text-body text-muted-foreground">
        Menu dan tindakan mengikuti hak akses dan Outlet yang ditetapkan. Peran
        yang ditampilkan bukan kontrol untuk mengubah hak akses.
        </p>
        {children}
      </CardContent>
      <CardFooter>
        <Button variant="outline" render={<a href="/select-tenant" />}>
          Ganti organisasi
        </Button>
      </CardFooter>
    </Card>
  )
}

export interface RosterRecord {
  name: string
  employeeId: string
  placement: string
  effectiveFrom?: string
  placementContext?: string
  accountHelper?: string
  accessLabel: string
  accessTone: StatusTone
  actions?: ReactNode
}

export function EmployeeRosterRow({
  record,
  layout = "table",
}: {
  record: RosterRecord
  layout?: "table" | "collection"
}) {
  const cells = [
    <div key="identity" className="flex min-w-0 flex-col gap-1">
      <p className="break-words text-label text-[15px]">{record.name}</p>
      <p className="text-caption">{record.employeeId}</p>
    </div>,
    <div key="placement" className="flex min-w-0 flex-col gap-1">
      <p className="break-words text-body">{record.placement}</p>
      {record.effectiveFrom ? (
        <p className="text-caption">Berlaku {record.effectiveFrom}</p>
      ) : record.placementContext ? (
        <p className="text-caption">{record.placementContext}</p>
      ) : null}
    </div>,
    <div key="account" className="flex min-w-0 flex-col items-start gap-1">
      <StatusBadge tone={record.accessTone}>{record.accessLabel}</StatusBadge>
      <p className="text-caption">
        {record.accountHelper ?? "Profil tersimpan"}
      </p>
    </div>,
    <div key="actions" className="flex items-center justify-end gap-2">
      {record.actions}
    </div>,
  ]
  if (layout === "collection")
    return (
      <div
        role="row"
        data-pen-origin="QLaDT"
        className="flex min-h-32 items-center gap-4 border-b border-border bg-surface p-4 last:border-b-0"
      >
        {cells.map((cell, index) => (
          <div
            key={cell.key}
            role="cell"
            className={
              index === 3
                ? "shrink-0"
                : index === 2
                  ? "w-[170px] shrink-0"
                  : "min-w-0 flex-1"
            }
          >
            {cell}
          </div>
        ))}
      </div>
    )
  return (
    <TableRow data-pen-origin="QLaDT">
      {cells.map((cell) => (
        <TableCell key={cell.key} className="h-32 whitespace-normal p-4">
          {cell}
        </TableCell>
      ))}
    </TableRow>
  )
}

export function EmployeeRosterCard({ record }: { record: RosterRecord }) {
  return (
    <Card data-pen-origin="A4gpGf" className="gap-2">
      <CardHeader className="gap-2">
        <CardTitle className="text-[17px]">{record.name}</CardTitle>
        <CardDescription>
          {record.employeeId} · {record.placement}
          {record.effectiveFrom ? (
            <>
              <br />
              Penempatan berlaku {record.effectiveFrom}
            </>
          ) : record.placementContext ? (
            <>
              <br />
              {record.placementContext}
            </>
          ) : null}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <StatusBadge tone={record.accessTone}>{record.accessLabel}</StatusBadge>
      </CardContent>
      {record.actions ? (
        <CardFooter className="flex-wrap gap-2">{record.actions}</CardFooter>
      ) : null}
    </Card>
  )
}

export function ApprovalQueueItem({
  subject,
  requestType,
  context,
  status,
  selected = false,
  tone = "warning",
  disabled = false,
  onSelect,
}: {
  subject: string
  requestType: string
  context: string
  status: string
  selected?: boolean
  tone?: StatusTone
  disabled?: boolean
  onSelect: () => void
}) {
  return (
    <button
      data-pen-origin="g50DaL"
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      disabled={disabled}
      className={cn(
        "flex w-full flex-col items-start gap-[7px] rounded-[16px] border bg-surface p-4 text-start focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
        selected ? "border-primary" : "border-border"
      )}
    >
      <span className="max-w-full text-label text-base wrap-anywhere">{subject}</span>
      <span className="max-w-full text-body wrap-anywhere">{requestType}</span>
      <span className="max-w-full text-caption wrap-anywhere">{context}</span>
      <StatusBadge tone={tone}>{status}</StatusBadge>
    </button>
  )
}

export function EvidenceAccess({
  onOpen,
  disabled = false,
  actions,
}: {
  onOpen?: () => void
  disabled?: boolean
  actions?: ReactNode
}) {
  return (
    <section
      data-pen-origin="Qo03c"
      className="flex flex-col items-start gap-2.5 rounded-[16px] bg-brand-50 p-4"
    >
      <h3 className="text-label text-base text-brand-700">
        Akses bukti dicatat
      </h3>
      <p className="text-body text-muted-foreground">
        Foto dan lokasi adalah bukti sensitif. Membuka atau mengunduh bukti
        mencatat aktivitas audit dan tetap mengikuti izin akses Anda.
      </p>
      {actions ?? (
        <Button
          variant="outline"
          disabled={disabled || !onOpen}
          onClick={onOpen}
        >
          <ArrowUpRight aria-hidden="true" data-icon="inline-start" />
          Buka bukti
        </Button>
      )}
    </section>
  )
}

export function AttendanceRecovery({
  onCheck,
  busy = false,
  children,
}: {
  onCheck: () => void
  busy?: boolean
  children?: ReactNode
}) {
  return (
    <section
      data-pen-origin="I7nVX"
      role="status"
      className="flex flex-col items-start gap-3 rounded-[16px] bg-warning-soft p-4"
    >
      <h3 className="text-subtitle text-warning-strong">
        Hasil presensi belum dapat dipastikan
      </h3>
      <p className="text-body">
        Operasi ini mungkin sudah diterima. Periksa statusnya sebelum memulai
        operasi baru.
      </p>
      <Button onClick={onCheck} disabled={busy}>
        <RefreshCw aria-hidden="true" data-icon="inline-start" />
        {busy ? "Memeriksa status…" : "Periksa status"}
      </Button>
      <p className="text-caption">
        Presensi berikutnya dikunci sampai status ini dipastikan.
      </p>
      {children}
    </section>
  )
}

export function SettingsSection({
  title,
  summary,
  href,
  readOnly = false,
  icon,
}: {
  title: string
  summary: string
  href: string
  icon?: ReactNode
  readOnly?: boolean
}) {
  return (
    <a
      data-pen-origin="WnmUr"
      href={href}
      className="flex min-w-0 items-center gap-3 border-b border-border bg-surface p-4 last:border-b-0 focus-visible:outline-2 focus-visible:outline-primary"
    >
      {icon ? <span className="shrink-0 text-primary" aria-hidden="true">{icon}</span> : null}
      <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
        <p className="text-label text-[15px]">{title}</p>
        <p className="text-body text-[13px] text-muted-foreground">{summary}</p>
      </div>
      {readOnly ? <StatusBadge tone="neutral">Hanya lihat</StatusBadge> : null}
      <ChevronRight
        size={18}
        aria-hidden="true"
        className="shrink-0 text-muted-foreground"
      />
    </a>
  )
}

export function DatedPlacementDrawer({
  open,
  onOpenChange,
  employeeContext,
  children,
  history,
  onSubmit,
  busy = false,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  employeeContext: ReactNode
  children: ReactNode
  history?: ReactNode
  onSubmit: FormEventHandler<HTMLFormElement>
  busy?: boolean
}) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop className="fixed inset-0 z-50 bg-[var(--owner-drawer-scrim)]" />
        <DialogPrimitive.Popup
          data-pen-origin="H0W8gW"
          className="fixed inset-y-0 end-0 z-50 flex w-full max-w-[480px] flex-col border-s border-border bg-surface outline-none"
        >
          <div className="flex min-h-[72px] shrink-0 items-center gap-3 border-b border-border px-5">
            <DialogPrimitive.Title className="flex-1 text-subtitle text-[21px]">
              Ubah penempatan
            </DialogPrimitive.Title>
            <DialogPrimitive.Close render={<Button variant="outline" />}>
              <X aria-hidden="true" data-icon="inline-start" />
              Tutup
            </DialogPrimitive.Close>
          </div>
          <form onSubmit={onSubmit} className="flex min-h-0 flex-1 flex-col">
            <div className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto p-5">
              <DialogPrimitive.Description className="text-body text-muted-foreground">
                {employeeContext}
              </DialogPrimitive.Description>
              <FieldGroup className="gap-3.5">{children}</FieldGroup>
              {history ? (
                <div className="flex flex-col gap-1.5 rounded-[12px] bg-canvas p-3.5">
                  {history}
                </div>
              ) : null}
            </div>
            <div className="flex flex-wrap justify-end gap-2.5 border-t border-border p-5">
              <DialogPrimitive.Close
                render={<Button variant="outline" disabled={busy} />}
              >
                <X aria-hidden="true" data-icon="inline-start" />
                Batal
              </DialogPrimitive.Close>
              <Button type="submit" disabled={busy}>
                <Check aria-hidden="true" data-icon="inline-start" />
                {busy ? "Menyimpan…" : "Simpan penempatan"}
              </Button>
            </div>
          </form>
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}

export function ConsequenceDialog({
  open,
  onOpenChange,
  title,
  consequence,
  actionLabel,
  actionIcon,
  onConfirm,
  busy = false,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  consequence: ReactNode
  actionLabel: string
  actionIcon?: ReactNode
  onConfirm: () => void
  busy?: boolean
}) {
  return (
    <AlertDialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <AlertDialogPrimitive.Portal>
        <AlertDialogPrimitive.Backdrop className="fixed inset-0 z-50 bg-[var(--owner-drawer-scrim)]" />
        <AlertDialogPrimitive.Popup
          data-pen-origin="L4B4w"
          className="fixed start-1/2 top-1/2 z-50 flex max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-[420px] -translate-x-1/2 -translate-y-1/2 flex-col gap-4 overflow-y-auto rounded-[18px] border border-border bg-surface p-6 shadow-[var(--shadow-overlay)] outline-none"
        >
          <AlertDialogPrimitive.Title className="text-subtitle text-xl">
            {title}
          </AlertDialogPrimitive.Title>
          <AlertDialogPrimitive.Description className="text-body text-muted-foreground">
            {consequence}
          </AlertDialogPrimitive.Description>
          <div className="flex flex-wrap justify-end gap-2.5">
            <AlertDialogPrimitive.Close
              render={<Button variant="outline" disabled={busy} />}
            >
              <X aria-hidden="true" data-icon="inline-start" />
              Batal
            </AlertDialogPrimitive.Close>
            <Button variant="destructive" disabled={busy} onClick={onConfirm}>
              {actionIcon}
              {busy ? "Menyimpan…" : actionLabel}
            </Button>
          </div>
        </AlertDialogPrimitive.Popup>
      </AlertDialogPrimitive.Portal>
    </AlertDialogPrimitive.Root>
  )
}

export function AttendanceProjection({
  original,
  effective,
  proposed,
  pending = true,
}: {
  original: string
  effective: string
  proposed?: string
  pending?: boolean
}) {
  return (
    <Card data-pen-origin="dexBR">
      <CardHeader>
        <CardTitle className="text-subtitle">Waktu presensi</CardTitle>
      </CardHeader>
      <CardContent>
        <dl className="grid gap-3 sm:grid-cols-3">
          {[
            ["Catatan asli", original],
            ["Efektif saat ini", effective],
            ...(proposed ? [["Usulan koreksi", proposed]] : []),
          ].map(([label, value]) => (
            <div key={label} className="flex flex-col gap-1">
              <dt className="text-caption">{label}</dt>
              <dd className="text-label text-[15px]">{value}</dd>
            </div>
          ))}
        </dl>
      </CardContent>
      <CardFooter>
        <p className="text-caption">
          {pending && proposed
            ? "Usulan yang menunggu keputusan belum mengubah nilai efektif. "
            : ""}
          Koreksi yang disetujui tetap mempertahankan catatan asli.
        </p>
      </CardFooter>
    </Card>
  )
}
