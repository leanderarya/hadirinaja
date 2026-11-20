import { ArrowRight } from "lucide-react"
import type { ReactElement, ReactNode } from "react"

import { AttendanceLocationStatus } from "@/components/attendance/attendance-location-status"
import { AttendanceRecoveryDetail } from "@/components/attendance/attendance-recovery-detail"
import { RoamButton } from "@/components/roam/roam-button"
import { cn } from "@/lib/utils"

/**
 * Location step composition for the eight compact frames (SLICING-INDEX §9.2).
 *
 * Order is fixed: map → status → recovery (failures only) → primary → secondary
 * → caption, with 16 between blocks. The header and the three-step trail belong
 * to the route; the map arrives as a node so this component never owns the
 * preview internals.
 */
export function AttendanceLocationStep({
  operation,
  map,
  tone,
  title,
  facts,
  statusIcon,
  recovery = null,
  primary,
  secondary = null,
  caption,
}: {
  operation: "check_in" | "check_out"
  /** LocationMapPreview */
  map: ReactNode
  tone: "neutral" | "error"
  title: string
  facts: string
  statusIcon?: ReactNode
  recovery?: { title: string; steps: string[] } | null
  primary: {
    label: string
    onClick: () => void
    disabled?: boolean
    loading?: boolean
  }
  secondary?: { label: string; onClick: () => void } | null
  caption: string
}): ReactElement {
  // The frames carry the busy signal in the status line, so a disabled action
  // stays a plain disabled pill rather than a spinner with an overlay label.
  const busy = Boolean(primary.loading) && !primary.disabled

  return (
    <div
      className={cn("roam-location-step flex w-full flex-col gap-4")}
      data-operation={operation}
      data-slot="attendance-location-step"
    >
      {map}

      <AttendanceLocationStatus
        facts={facts}
        icon={statusIcon}
        title={title}
        tone={tone}
      />

      {recovery ? (
        <AttendanceRecoveryDetail
          steps={recovery.steps}
          title={recovery.title}
        />
      ) : null}

      <div
        className={cn("roam-location-actions flex w-full flex-col gap-3")}
        data-slot="attendance-location-actions"
      >
        <RoamButton
          disabled={primary.disabled}
          fullWidth
          icon={
            primary.disabled ? undefined : (
              <ArrowRight aria-hidden="true" size={18} strokeWidth={2} />
            )
          }
          loading={busy}
          loadingLabel={primary.label}
          onClick={primary.onClick}
          variant="primary"
        >
          {primary.label}
        </RoamButton>

        {secondary ? (
          <RoamButton fullWidth onClick={secondary.onClick} variant="secondary">
            {secondary.label}
          </RoamButton>
        ) : null}
      </div>

      <p
        data-slot="attendance-location-caption"
        style={{
          color: "#525866",
          fontFamily: "var(--font-roam-ui)",
          fontSize: 10,
          fontWeight: 500,
          lineHeight: 1.5,
          margin: 0,
        }}
      >
        {caption}
      </p>
    </div>
  )
}
