import type { ReactElement } from "react"

/**
 * Frame heading block shared by the step screens: 22/700 title over a 14/500
 * #525866 description, 8px apart (AWKAr / cntyI / A3TMy).
 */
export function AttendanceStepHeading({
  id,
  title,
  description,
}: {
  id?: string
  title: string
  description: string
}): ReactElement {
  return (
    <div
      data-slot="attendance-step-heading"
      style={{ display: "flex", flexDirection: "column", gap: 8 }}
    >
      <h2
        id={id}
        style={{
          color: "#0E0E10",
          fontFamily: "var(--font-roam-ui)",
          fontSize: 22,
          fontWeight: 700,
          lineHeight: 1.3,
          margin: 0,
        }}
      >
        {title}
      </h2>
      <p
        style={{
          color: "#525866",
          fontFamily: "var(--font-roam-ui)",
          fontSize: 14,
          fontWeight: 500,
          lineHeight: 1.5,
          margin: 0,
        }}
      >
        {description}
      </p>
    </div>
  )
}
