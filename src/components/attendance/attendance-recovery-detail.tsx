import { ChevronDown } from "lucide-react"
import type { ReactElement } from "react"
import { useId, useState } from "react"

import { cn } from "@/lib/utils"

/**
 * `d17vF` recovery detail (SLICING-INDEX §9.2.6, §9.4, §9.8).
 *
 * Collapsed by default: the frames keep recovery to one 44px summary row so the
 * retry action is visible without expanding anything. The body is hidden rather
 * than unmounted, so the numbered steps stay in the document at zero height.
 */
export function AttendanceRecoveryDetail({
  title,
  steps,
  defaultOpen = false,
}: {
  title: string
  /** Plain Indonesian, numbered by the component. */
  steps: string[]
  defaultOpen?: boolean
}): ReactElement {
  const [open, setOpen] = useState(defaultOpen)
  const bodyId = useId()

  function toggle(): void {
    setOpen((current) => !current)
  }

  return (
    <div
      className={cn("roam-recovery-detail w-full")}
      data-open={open || undefined}
      data-slot="attendance-recovery-detail"
      style={{
        background: "#FFFFFF",
        border: "1px solid #E5E7EB",
        borderRadius: 16,
        boxSizing: "border-box",
        overflow: "hidden",
      }}
    >
      <button
        aria-controls={bodyId}
        aria-expanded={open}
        className={cn("flex w-full items-center justify-between")}
        data-slot="attendance-recovery-detail-summary"
        onClick={toggle}
        onKeyDown={(event) => {
          if (event.key !== "Enter" && event.key !== " ") return
          // Suppress the platform's own activation so one keypress toggles once.
          event.preventDefault()
          toggle()
        }}
        style={{
          background: "transparent",
          border: 0,
          boxSizing: "border-box",
          color: "#0E0E10",
          cursor: "pointer",
          fontFamily: "var(--font-roam-ui)",
          fontSize: 12,
          fontWeight: 600,
          gap: 8,
          height: 44,
          lineHeight: 1.3,
          margin: 0,
          minHeight: 44,
          padding: "0 14px",
          textAlign: "left",
        }}
        type="button"
      >
        <span>{title}</span>
        <ChevronDown
          aria-hidden="true"
          className={cn(
            "transition-transform duration-200 motion-reduce:transition-none"
          )}
          color="#0E0E10"
          size={18}
          strokeWidth={2}
          style={{
            flex: "none",
            transform: open ? "rotate(180deg)" : undefined,
          }}
        />
      </button>

      <div
        data-slot="attendance-recovery-detail-body"
        hidden={!open}
        id={bodyId}
        style={{ padding: "0 14px 14px" }}
      >
        <ol
          className={cn("flex flex-col")}
          style={{ listStyle: "none", margin: 0, padding: 0 }}
        >
          {steps.map((step, index) => (
            <li
              data-slot="attendance-recovery-detail-step"
              key={step}
              style={{
                color: "#525866",
                fontFamily: "var(--font-roam-ui)",
                fontSize: 12,
                fontWeight: 500,
                // d17vF sets the three steps on a 19px pitch with no gap.
                lineHeight: 1.6,
                margin: 0,
              }}
            >
              <span aria-hidden="true">{`${index + 1}. `}</span>
              {step}
            </li>
          ))}
        </ol>
      </div>
    </div>
  )
}
