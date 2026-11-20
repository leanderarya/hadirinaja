import type * as React from "react"

import { RoamButton } from "@/components/roam/roam-button"
import { cn } from "@/lib/utils"

const toneSurface = {
  info: "#BFD1FA",
  progress: "#F4F5F8",
  error: "#FCEDEF",
  locked: "#F4F5F8",
} as const

/**
 * esTPz 01.5 PESAN STATUS: compact inline message. The error tone keeps its
 * retry control beneath the body, never beside it.
 */
export function RoamStatusMessage({
  tone,
  title,
  body,
  action,
  role,
  className,
}: {
  tone: "info" | "progress" | "error" | "locked"
  title: string
  body: string
  action?: { label: string; onClick: () => void }
  role?: "status" | "alert"
  className?: string
}): React.ReactElement {
  const isError = tone === "error"

  return (
    <section
      className={cn("roam-status-message flex flex-col", className)}
      data-slot="roam-status-message"
      data-tone={tone}
      role={role ?? (isError ? "alert" : "status")}
      style={{
        background: toneSurface[tone],
        borderRadius: 16,
        color: "#0E0E10",
        gap: 8,
        padding: 14,
      }}
    >
      <h3
        data-slot="roam-status-message-title"
        style={{
          fontFamily: "var(--font-roam-ui)",
          fontSize: 12,
          fontWeight: 700,
          lineHeight: 1.5,
          margin: 0,
        }}
      >
        {title}
      </h3>
      <p
        data-slot="roam-status-message-body"
        style={{
          fontFamily: "var(--font-roam-ui)",
          fontSize: 12,
          fontWeight: 500,
          lineHeight: 1.5,
          margin: 0,
        }}
      >
        {body}
      </p>
      {action ? (
        <RoamButton
          className="roam-status-message-action"
          fullWidth
          onClick={action.onClick}
          variant="secondary"
        >
          {action.label}
        </RoamButton>
      ) : null}
    </section>
  )
}
