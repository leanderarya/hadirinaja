import type { ReactElement } from "react"

/**
 * Frames b9Lv5 / DBvSR / o3ci8s: recovery copy sits OUTSIDE the status surface,
 * under a 16/700 title. Numbered steps are 13px; an advice block (xsCgO /
 * EqGzP) is a single 13/500 paragraph with no numbering.
 */
export function AttendanceRecoveryList({
  title,
  steps = [],
  note = null,
}: {
  title: string | null
  steps?: string[]
  note?: string | null
}): ReactElement | null {
  if (!title && steps.length === 0) return null
  if (steps.length === 0 && !note) return null

  return (
    <section
      data-slot="attendance-recovery"
      style={{ display: "flex", flexDirection: "column", gap: 16 }}
    >
      {title ? (
        <h3
          data-slot="attendance-recovery-title"
          style={{
            color: "#0E0E10",
            fontFamily: "var(--font-roam-ui)",
            fontSize: 16,
            fontWeight: 700,
            lineHeight: 1.3,
            margin: 0,
          }}
        >
          {title}
        </h3>
      ) : null}
      {note ? (
        <p
          data-slot="attendance-recovery-note"
          style={{
            color: "#525866",
            fontFamily: "var(--font-roam-ui)",
            fontSize: 13,
            fontWeight: 500,
            lineHeight: 1.5,
            margin: 0,
          }}
        >
          {note}
        </p>
      ) : (
        <ol
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 16,
            listStyle: "none",
            margin: 0,
            padding: 0,
          }}
        >
          {steps.map((step, index) => (
            <li
              data-slot="attendance-recovery-step"
              key={step}
              style={{ display: "flex", gap: 10, minHeight: 20 }}
            >
              <span
                aria-hidden="true"
                style={{
                  color: "#0E0E10",
                  flex: "none",
                  fontFamily: "var(--font-roam-ui)",
                  fontSize: 13,
                  fontWeight: 700,
                  lineHeight: 1.5,
                }}
              >
                {index + 1}.
              </span>
              <span
                style={{
                  color: "#0E0E10",
                  fontFamily: "var(--font-roam-ui)",
                  fontSize: 13,
                  fontWeight: 500,
                  lineHeight: 1.5,
                }}
              >
                {step}
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}
