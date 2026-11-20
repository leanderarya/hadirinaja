import type { ReactElement, ReactNode } from "react"

import { cn } from "@/lib/utils"

/**
 * `FLXF8` compact status (SLICING-INDEX §9.2.4, §9.4): one 14/700 outcome line
 * with an 18px icon, one 12/500 facts line, 12/14 padding on a radius-16
 * surface. It replaces the pastel QihdH card inside the location step; that card
 * keeps serving camera and result.
 */

export type AttendanceLocationStatusTone = "neutral" | "error"

const SURFACE: Record<AttendanceLocationStatusTone, string> = {
  neutral: "#BFD1FA",
  error: "#FCEDEF",
}

export function AttendanceLocationStatus({
  tone,
  title,
  facts,
  icon,
  role,
}: {
  tone: AttendanceLocationStatusTone
  /** 14/700 */
  title: string
  /** 12/500 */
  facts: string
  /** 18px */
  icon?: ReactNode
  role?: "status" | "alert"
}): ReactElement {
  const isError = tone === "error"

  return (
    <div
      className={cn("roam-location-status flex w-full flex-col")}
      data-slot="attendance-location-status"
      data-tone={tone}
      role={role ?? (isError ? "alert" : "status")}
      style={{
        background: SURFACE[tone],
        borderRadius: 16,
        boxSizing: "border-box",
        color: "#0E0E10",
        gap: 4,
        // FLXF8: 12 + 19 (title) + 4 + 18 (facts) + 12 ≈ the 67px card.
        padding: "12px 14px",
      }}
    >
      <div className={cn("flex items-center gap-2")}>
        {icon ? (
          <span
            aria-hidden="true"
            data-slot="attendance-location-status-icon"
            style={{
              alignItems: "center",
              color: isError ? "#9B2937" : "#0E0E10",
              display: "inline-flex",
              flex: "none",
              height: 18,
              justifyContent: "center",
              width: 18,
            }}
          >
            {icon}
          </span>
        ) : null}
        <p
          data-slot="attendance-location-status-title"
          style={{
            color: "#0E0E10",
            fontFamily: "var(--font-roam-ui)",
            fontSize: 14,
            fontWeight: 700,
            lineHeight: 1.45,
            margin: 0,
          }}
        >
          {title}
        </p>
      </div>
      <p
        data-slot="attendance-location-status-facts"
        style={{
          color: "#525866",
          fontFamily: "var(--font-roam-ui)",
          fontSize: 12,
          fontWeight: 500,
          lineHeight: 1.5,
          margin: 0,
        }}
      >
        {facts}
      </p>
    </div>
  )
}
