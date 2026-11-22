import { ArrowLeft01Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import type { ReactNode, Ref } from "react"
import { Button, buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"

export function EmployeeAttendanceVerificationHeader({
  title,
  headingRef,
  onBack,
  backHref,
  disabled = false,
  children,
}: {
  title: string
  headingRef?: Ref<HTMLHeadingElement>
  onBack?: () => void
  backHref?: string
  disabled?: boolean
  children?: ReactNode
}) {
  const backButton = backHref ? (
    <a
      aria-label="Kembali ke halaman presensi"
      className={cn(
        buttonVariants({ size: "icon", variant: "ghost" }),
        "absolute left-2 top-1/2 -translate-y-1/2 hover:bg-transparent"
      )}
      href={backHref}
    >
      <HugeiconsIcon aria-hidden="true" icon={ArrowLeft01Icon} />
    </a>
  ) : (
    <Button
      aria-label="Kembali ke halaman presensi"
      className="absolute left-2 top-1/2 -translate-y-1/2 hover:bg-transparent"
      disabled={disabled}
      onClick={onBack}
      size="icon"
      variant="ghost"
    >
      <HugeiconsIcon aria-hidden="true" icon={ArrowLeft01Icon} />
    </Button>
  )

  return (
    <header className="shrink-0 border-b border-border bg-surface pt-[env(safe-area-inset-top)]">
      <div className="relative mx-auto flex min-h-14 w-full max-w-2xl items-center justify-center px-14">
        {backButton}
        <h1
          className="text-subtitle text-center outline-none focus-visible:ring-2 focus-visible:ring-ring"
          ref={headingRef}
          tabIndex={headingRef ? -1 : undefined}
        >
          {title}
        </h1>
      </div>
      {children}
    </header>
  )
}
