import { Dialog } from "@base-ui/react/dialog"
import { ArrowUpRight, ChevronDown, X } from "lucide-react"
import { useEffect, useId, useRef, useState, type ReactNode } from "react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import { REPORT_DATE_PRESETS, reportDateRange } from "@/lib/report-date-presets"
import {
  formatWorkDateRange,
  validateWorkDateRange,
} from "@/lib/owner-screen-presentation"

export interface PageHeadingProps {
  title: string
  mobileTitle?: string
  description: string
  role?: string
  actions?: ReactNode
  compact?: boolean
  minimal?: boolean
  className?: string
}

export function PageHeading({
  title,
  mobileTitle,
  description,
  role = "Owner",
  actions,
  compact = false,
  minimal = false,
  className,
}: PageHeadingProps) {
  return (
    <div
      className={cn(
        "flex min-w-0 flex-wrap items-start justify-between gap-4 md:flex-nowrap md:gap-6",
        className
      )}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        {!minimal ? <p
          className={cn(
            "hidden text-caption text-primary md:block",
            compact && "[--type-caption-size:11px]"
          )}
        >
          {role.toUpperCase()} / {title.toUpperCase()}
        </p> : null}
        <h1 className="text-title md:[--type-title-leading:1.2]">
          {mobileTitle ? (
            <>
              <span className="hidden md:inline">{title}</span>
              <span className="md:hidden">{mobileTitle}</span>
            </>
          ) : (
            title
          )}
        </h1>
        {!minimal ? <p className="hidden text-body text-muted-foreground md:block">
          {description}
        </p> : null}
      </div>
      {actions ? (
        <div className="hidden shrink-0 items-center gap-2 md:flex">
          {actions}
        </div>
      ) : null}
    </div>
  )
}

export function ReportSectionNavigation({
  active,
}: {
  active: "attendance" | "audit"
}) {
  const items = [
    { id: "attendance", label: "Kehadiran", href: "/reports/attendance" },
    { id: "audit", label: "Audit", href: "/reports/audit" },
  ] as const

  return (
    <nav aria-label="Navigasi laporan" className="r2c-report-navigation">
      {items.map((item) => (
        <Button
          key={item.id}
          className={cn(
            "r2c-report-navigation-item",
            active === item.id && "is-active"
          )}
          render={
            <a
              href={item.href}
              aria-current={active === item.id ? "page" : undefined}
            />
          }
          variant="outline"
        >
          {item.label}
        </Button>
      ))}
    </nav>
  )
}

export function ScopeBanner({
  title,
  children,
  purpose = "scope",
}: {
  title: string
  children: ReactNode
  purpose?: "scope" | "provisioning"
}) {
  return (
    <Alert
      role="status"
      className={cn(
        "gap-[3px] px-4 py-3",
        purpose === "provisioning" && "py-3.5"
      )}
    >
      <AlertTitle
        className={purpose === "provisioning" ? "text-[15px]" : undefined}
      >
        {title}
      </AlertTitle>
      <AlertDescription
        className={purpose === "provisioning" ? "text-sm" : undefined}
      >
        {children}
      </AlertDescription>
    </Alert>
  )
}

export interface ContextDrawerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: ReactNode
  children: ReactNode
  footer?: ReactNode
  busy?: boolean
  finalFocus?: Dialog.Popup.Props["finalFocus"]
}

export function ContextDrawer({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  busy = false,
  finalFocus,
}: ContextDrawerProps) {
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(value) => {
        if (!busy) onOpenChange(value)
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-[var(--owner-drawer-scrim)]" />
        <Dialog.Popup
          finalFocus={finalFocus}
          className="fixed inset-y-0 end-0 z-50 flex w-full max-w-[440px] flex-col border-s border-border bg-surface outline-none"
        >
          <div className="flex min-h-[72px] shrink-0 items-center gap-3 border-b border-border px-5 py-2">
            <Dialog.Title className="min-w-0 flex-1 text-subtitle [font-size:21px]">
              {title}
            </Dialog.Title>
            <Dialog.Close render={<Button variant="outline" disabled={busy} />}>
              <X aria-hidden="true" data-icon="inline-start" />
              Tutup
            </Dialog.Close>
          </div>
          <div className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto p-5">
            <Dialog.Description className="text-body text-muted-foreground">
              {description}
            </Dialog.Description>
            {children}
          </div>
          {footer ? (
            <div className="flex shrink-0 flex-wrap justify-end gap-2.5 border-t border-border p-5 pb-[max(20px,env(safe-area-inset-bottom))]">
              {footer}
            </div>
          ) : null}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

export interface WorkDateRangeControlProps {
  from: string
  to: string
  maximumDays?: number
  onApply: (range: { from: string; to: string }) => void
  disabled?: boolean
}

export function WorkDateRangeControl({
  from,
  to,
  maximumDays = 31,
  onApply,
  disabled = false,
}: WorkDateRangeControlProps) {
  const id = useId()
  const details = useRef<HTMLDetailsElement>(null)
  const summary = useRef<HTMLElement>(null)
  const fromInput = useRef<HTMLInputElement>(null)
  const [draftFrom, setDraftFrom] = useState(from)
  const [draftTo, setDraftTo] = useState(to)
  const [error, setError] = useState("")
  useEffect(() => {
    setDraftFrom(from)
    setDraftTo(to)
  }, [from, to])
  useEffect(() => {
    const close = (event: PointerEvent) => {
      if (
        details.current?.open &&
        !details.current.contains(event.target as Node)
      )
        details.current.open = false
    }
    document.addEventListener("pointerdown", close)
    return () => document.removeEventListener("pointerdown", close)
  }, [])
  const close = () => {
    if (details.current) details.current.open = false
    summary.current?.focus()
  }
  return (
    <Field>
      <FieldLabel id={`${id}-label`}>Tanggal kerja Outlet</FieldLabel>
      <details
        ref={details}
        className="relative"
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault()
            close()
          }
        }}
      >
        <summary
          role="button"
          ref={summary}
          aria-labelledby={`${id}-label ${id}-value`}
          className="flex h-11 cursor-pointer list-none items-center justify-between gap-2 rounded-[9px] border border-border bg-canvas px-3 text-body focus-visible:outline-2 focus-visible:outline-primary [&::-webkit-details-marker]:hidden"
          onClick={(event) => {
            if (disabled) event.preventDefault()
          }}
          aria-disabled={disabled}
        >
          <span id={`${id}-value`}>{formatWorkDateRange(from, to)}</span>
          <ChevronDown
            size={14}
            aria-hidden="true"
            className="shrink-0 text-muted-foreground"
          />
        </summary>
        <form
          className="absolute start-0 top-[calc(100%+8px)] z-40 flex w-full flex-col gap-4 rounded-[16px] border border-border bg-surface p-4 shadow-[var(--shadow-overlay)] md:w-[360px]"
          onSubmit={(event) => {
            event.preventDefault()
            const message = validateWorkDateRange(
              draftFrom,
              draftTo,
              maximumDays
            )
            setError(message)
            if (message) fromInput.current?.focus()
            if (!message) {
              onApply({ from: draftFrom, to: draftTo })
              close()
            }
          }}
        >
          <div
            className="flex flex-wrap gap-2"
            role="group"
            aria-label="Preset periode laporan"
          >
            {REPORT_DATE_PRESETS.map((preset) => (
              <Button
                key={preset.value}
                variant="outline"
                onClick={() => {
                  const range = reportDateRange(preset.value)
                  setDraftFrom(range.from)
                  setDraftTo(range.to)
                  setError("")
                }}
              >
                {preset.label}
              </Button>
            ))}
          </div>
          <FieldGroup className="gap-3 sm:grid sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor={`${id}-from`}>Dari tanggal</FieldLabel>
              <Input
                ref={fromInput}
                id={`${id}-from`}
                type="date"
                required
                value={draftFrom}
                onChange={(e) => setDraftFrom(e.target.value)}
                aria-invalid={!!error}
                aria-describedby={error ? `${id}-error` : undefined}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor={`${id}-to`}>Sampai tanggal</FieldLabel>
              <Input
                id={`${id}-to`}
                type="date"
                required
                value={draftTo}
                onChange={(e) => setDraftTo(e.target.value)}
                aria-invalid={!!error}
                aria-describedby={error ? `${id}-error` : undefined}
              />
            </Field>
          </FieldGroup>
          {error ? (
            <p
              id={`${id}-error`}
              role="alert"
              className="text-caption text-danger-strong"
            >
              {error}
            </p>
          ) : null}
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="outline" onClick={close}>
              Batal
            </Button>
            <Button type="submit" disabled={disabled}>
              Terapkan periode
            </Button>
          </div>
        </form>
      </details>
      <p className="text-caption">Rentang maksimal {maximumDays} hari.</p>
    </Field>
  )
}

export interface FollowupItem {
  title: string
  description: string
  href: string
  action: string
}

export function FollowupCard({ items }: { items: FollowupItem[] }) {
  return (
    <Card className="gap-4 p-6">
      <CardHeader className="p-0">
        <CardTitle
          role="heading"
          aria-level={2}
          className="text-subtitle [font-size:20px]"
        >
          Perlu perhatian
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 p-0">
        {items.map((item) => (
          <div
            key={item.title}
            className="flex min-w-0 flex-wrap items-center justify-between gap-3 border-b border-border py-3 md:flex-nowrap"
          >
            <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
              <p className="text-label [font-size:15px]">{item.title}</p>
              <p className="text-body text-[13px] text-muted-foreground">
                {item.description}
              </p>
            </div>
            <Button
              variant="outline"
              className="text-[13px]"
              render={<a href={item.href} />}
            >
              <ArrowUpRight
                aria-hidden="true"
                data-icon="inline-start"
                className="text-brand-700"
              />
              {item.action}
            </Button>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}
