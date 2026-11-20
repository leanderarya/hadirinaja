import { Check, CircleAlert } from "lucide-react"
import type * as React from "react"

import { cn } from "@/lib/utils"

export type RoamStep = { id: string; label: string; number: string }

type StepState = "done" | "current" | "pending" | "error"

/**
 * WLYnJ step trail. The frames instance three equal columns with an 8px gap:
 * done steps swap the number for a white check, the current step is #BFD1FA
 * with a bold label, pending steps are #F4F5F8. `errorIndex` paints a failed
 * step #9B2937 (DBvSR).
 */
export function RoamStepTrail({
  steps,
  activeIndex,
  complete = false,
  errorIndex,
  doneCount,
  filledCurrent,
  className,
}: {
  steps: RoamStep[]
  activeIndex: number
  complete?: boolean
  errorIndex?: number
  /**
   * Marks the first N steps done without naming a current step. The compact
   * Location frames use this: once the position resolves, step 1 shows a check
   * while Foto and Konfirmasi stay pending.
   */
  doneCount?: number
  /**
   * Renders the current step as `#0E0E10` with a white numeral instead of the
   * `#BFD1FA` accent. `TE8Jj`/`JKJG0` use this for step 1 while the position is
   * still being resolved.
   */
  filledCurrent?: boolean
  className?: string
}): React.ReactElement {
  const labelSize = steps.length === 2 ? 13 : 12

  function stateOf(index: number): StepState {
    if (errorIndex === index) return "error"
    if (doneCount !== undefined) {
      if (index < doneCount) return "done"
      if (index === activeIndex) return "current"
      return "pending"
    }
    if (complete || index < activeIndex) return "done"
    if (index === activeIndex) return "current"
    return "pending"
  }

  return (
    <ol
      aria-label="Langkah absensi"
      className={cn("roam-step-trail m-0 list-none p-0", className)}
      data-slot="roam-step-trail"
      data-steps={steps.length}
      style={{ display: "flex", gap: 8, paddingBlock: 4, width: "100%" }}
    >
      {steps.map((step, index) => {
        const state = stateOf(index)
        const done = state === "done"
        const current = state === "current"
        const failed = state === "error"

        return (
          <li
            aria-current={current ? "step" : undefined}
            className="roam-step"
            data-slot="roam-step"
            data-state={state}
            key={step.id}
            style={{
              alignItems: "center",
              display: "flex",
              flexBasis: 0,
              flexDirection: "column",
              flexGrow: 1,
              flexShrink: 1,
              gap: 4,
              minWidth: 0,
            }}
          >
            <span
              aria-hidden="true"
              data-slot="roam-step-circle"
              style={{
                alignItems: "center",
                background: failed
                  ? "#9B2937"
                  : done || (current && filledCurrent)
                    ? "#0E0E10"
                    : current
                      ? "#BFD1FA"
                      : "#F4F5F8",
                borderRadius: 999,
                color:
                  done || failed || (current && filledCurrent)
                    ? "#FFFFFF"
                    : "#0E0E10",
                display: "inline-flex",
                flex: "none",
                fontFamily: "var(--font-roam-numeric)",
                fontSize: 12,
                fontVariantNumeric: "tabular-nums",
                fontWeight: 700,
                height: 28,
                justifyContent: "center",
                lineHeight: 1.2,
                width: 28,
              }}
            >
              {done ? (
                <Check aria-hidden="true" size={16} strokeWidth={3} />
              ) : null}
              {failed ? (
                <CircleAlert aria-hidden="true" size={16} strokeWidth={2.5} />
              ) : null}
              {done || failed ? null : step.number}
            </span>
            <span
              className="roam-step-label"
              data-slot="roam-step-label"
              style={{
                // The compact Location frames ink every step label #0E0E10 and
                // carry state in the circle; failures are the only exception.
                color: failed
                  ? "#9B2937"
                  : current || done
                    ? "#0E0E10"
                    : "#525866",
                fontFamily: "var(--font-roam-ui)",
                fontSize: labelSize,
                fontWeight: current || failed ? 700 : 500,
                lineHeight: 1.2,
                maxWidth: "100%",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {step.label}
            </span>
          </li>
        )
      })}
    </ol>
  )
}
