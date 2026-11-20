import { MapPinOff, WifiOff } from "lucide-react"
import type { ReactElement, ReactNode } from "react"

import {
  AttendanceConfirmationSummary,
  type AttendanceSummaryRow,
} from "@/components/attendance/attendance-confirmation-summary"
import { AttendanceRecoveryList } from "@/components/attendance/attendance-recovery-list"
import { AttendanceStepHeading } from "@/components/attendance/attendance-step-heading"
import { RoamButton } from "@/components/roam/roam-button"
import {
  RoamStatusCard,
  type RoamStatusTone,
} from "@/components/roam/roam-status-card"

/**
 * Result step (frames A3TMy, KQlyB, wdXB0, ZhBqn, DBvSR / esTPz 01.5).
 *
 * Submitting and checking keep the plain heading plus the summary card the user
 * is about to send (A3TMy, KQlyB draw uqxF6 as a card there). Success and
 * failures use the centred result card, then the recorded facts as the flat
 * full-bleed list (wdXB0, ZhBqn, DBvSR).
 */

const TEXT_SECONDARY = "#525866"
const ISSUE_INK = "#9B2937"

const SUCCESS_TONE: RoamStatusTone = "info"
const LOST_TONE: RoamStatusTone = "error"

export function AttendanceResultStep({
  variant,
  headline,
  description,
  detailsTitle,
  details,
  recoverySteps = [],
  recoveryTitle,
  primary,
  secondary,
  caption,
  help,
  role,
}: {
  variant: "progress" | "success" | "lost" | "checking" | "out_of_range"
  headline: string
  description: string
  detailsTitle?: string | null
  details?: AttendanceSummaryRow[]
  recoverySteps?: string[]
  recoveryTitle?: string | null
  primary?: {
    label: string
    onClick: () => void
    disabled?: boolean
    loading?: boolean
    loadingLabel?: string
    icon?: ReactNode
  }
  secondary?: {
    label: string
    onClick?: () => void
    href?: string
    icon?: ReactNode
  }
  caption: string
  help?: string | null
  role?: "status" | "alert"
}): ReactElement {
  const inFlight = variant === "progress" || variant === "checking"
  const isSuccess = variant === "success"

  return (
    <div
      data-slot="attendance-result-step"
      data-variant={variant}
      style={{ display: "flex", flexDirection: "column", gap: 16 }}
    >
      {inFlight ? (
        <AttendanceStepHeading description={description} title={headline} />
      ) : (
        <RoamStatusCard
          align="center"
          description={description}
          headline={headline}
          variant="result"
          icon={
            isSuccess ? (
              <CheckDoubleIcon />
            ) : variant === "lost" ? (
              <WifiOff
                aria-hidden="true"
                color={ISSUE_INK}
                size={28}
                strokeWidth={2}
              />
            ) : (
              // DBvSR: a struck-through pin, not a warning circle.
              <MapPinOff
                aria-hidden="true"
                color={ISSUE_INK}
                size={28}
                strokeWidth={2}
              />
            )
          }
          role={role}
          tone={isSuccess ? SUCCESS_TONE : LOST_TONE}
        />
      )}

      {details && details.length > 0 ? (
        <section style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {detailsTitle ? (
            <h3
              data-slot="attendance-result-details-title"
              style={{
                color: "#0E0E10",
                fontFamily: "var(--font-roam-ui)",
                fontSize: 14,
                fontWeight: 700,
                lineHeight: 1.4,
                margin: 0,
              }}
            >
              {detailsTitle}
            </h3>
          ) : null}
          {/* A3TMy / KQlyB compose uqxF6 as a card while in flight; wdXB0 /
              ZhBqn compose it flat. Icons only exist on the card variant. */}
          <AttendanceConfirmationSummary
            rows={details}
            variant={inFlight ? "card" : "flat"}
          />
        </section>
      ) : null}

      <AttendanceRecoveryList
        steps={recoverySteps}
        title={recoveryTitle ?? null}
      />

      <div
        data-slot="attendance-action-stack"
        style={{ display: "flex", flexDirection: "column", gap: 12 }}
      >
        {primary ? (
          <RoamButton
            disabled={primary.disabled}
            fullWidth
            icon={primary.icon}
            loading={primary.loading}
            loadingLabel={primary.loadingLabel}
            onClick={primary.onClick}
            variant="primary"
          >
            {primary.label}
          </RoamButton>
        ) : null}

        {secondary?.href ? (
          <a
            data-slot="attendance-result-secondary-link"
            href={secondary.href}
            onClick={secondary.onClick}
            style={{
              alignItems: "center",
              border: "1px solid #0E0E10",
              borderRadius: 999,
              boxSizing: "border-box",
              color: "#0E0E10",
              display: "flex",
              fontFamily: "var(--font-roam-ui)",
              fontSize: 14,
              fontWeight: 600,
              gap: 8,
              height: 48,
              justifyContent: "center",
              textDecoration: "none",
            }}
          >
            {secondary.icon ? (
              <span
                aria-hidden="true"
                style={{ display: "inline-flex", flex: "none" }}
              >
                {secondary.icon}
              </span>
            ) : null}
            {secondary.label}
          </a>
        ) : secondary ? (
          <RoamButton
            fullWidth
            icon={secondary.icon}
            onClick={secondary.onClick}
            variant="secondary"
          >
            {secondary.label}
          </RoamButton>
        ) : null}
      </div>

      {help ? (
        <p
          data-slot="attendance-result-help"
          style={{
            color: TEXT_SECONDARY,
            fontFamily: "var(--font-roam-ui)",
            fontSize: 12,
            fontWeight: 500,
            lineHeight: 1.5,
            margin: 0,
            textAlign: "center",
          }}
        >
          {help}
        </p>
      ) : null}

      <p
        data-slot="attendance-result-caption"
        style={{
          color: TEXT_SECONDARY,
          fontFamily: "var(--font-roam-ui)",
          fontSize: 12,
          fontWeight: 500,
          lineHeight: 1.5,
          margin: 0,
          textAlign: "center",
        }}
      >
        {caption}
      </p>
    </div>
  )
}

/** wdXB0's medallion glyph is a wide double check (ink ~27×17 at 28px). */
function CheckDoubleIcon(): ReactElement {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height="28"
      viewBox="0 0 24 24"
      width="28"
    >
      <path
        d="M2 13.5l4 4L14.5 7M8.5 17.5l4 4L22 9"
        stroke="#0E0E10"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
      />
    </svg>
  )
}
