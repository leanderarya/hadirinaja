import type * as React from "react"

import { cn } from "@/lib/utils"

export type RoamStatusTone =
  | "info"
  | "waiting"
  | "request"
  | "error"
  | "neutral"

/**
 * `step` is the QihdH card on the step screens (b9Lv5, o3ci8s): 56px medallion,
 * 25px headline, 13px description, 20px padding.
 *
 * `result` is the centred variant the result screens draw (wdXB0, ZhBqn,
 * DBvSR): 64px medallion, 22px headline, 14px description, 28/20 padding.
 */
export type RoamStatusCardVariant = "step" | "result"

const toneSurface: Record<RoamStatusTone, string> = {
  info: "#BFD1FA",
  waiting: "#EFC263",
  request: "#E79FF5",
  error: "#FCEDEF",
  neutral: "#F4F5F8",
}

/**
 * QihdH / YJGEC status card: pastel surface, 56px medallion, headline and
 * description only. Actions and recovery lists belong outside the card.
 *
 * `align` follows the frames: step screens align the block to the start
 * (b9Lv5 / o3ci8s), result screens centre it (DBvSR / wdXB0 / ZhBqn).
 */
export function RoamStatusCard({
  tone,
  headline,
  description,
  icon,
  compact = false,
  align = "start",
  variant = "step",
  role,
  children,
  className,
}: {
  tone: RoamStatusTone
  headline: string
  description: string
  icon?: React.ReactNode
  compact?: boolean
  align?: "start" | "center"
  variant?: RoamStatusCardVariant
  role?: "status" | "alert"
  children?: React.ReactNode
  className?: string
}): React.ReactElement {
  const isError = tone === "error"
  const result = variant === "result"
  const centered = align === "center" || result
  const medallion = result ? 64 : 56

  return (
    <section
      className={cn(
        "roam-status-card flex flex-col",
        centered ? "items-center text-center" : "items-start text-left",
        className
      )}
      data-align={align}
      data-slot="roam-status-card"
      data-tone={tone}
      role={role ?? (isError ? "alert" : "status")}
      data-variant={variant}
      style={{
        background: toneSurface[tone],
        borderRadius: 20,
        color: isError ? "#9B2937" : "#0E0E10",
        gap: 16,
        padding: result ? "28px 20px" : 20,
      }}
    >
      {icon ? (
        <span
          aria-hidden="true"
          data-slot="roam-status-card-medallion"
          style={{
            alignItems: "center",
            background: "#FBFBFD",
            borderRadius: 999,
            display: "inline-flex",
            flex: "none",
            height: medallion,
            justifyContent: "center",
            width: medallion,
          }}
        >
          {icon}
        </span>
      ) : null}
      <h2
        data-slot="roam-status-card-headline"
        style={{
          fontFamily: "var(--font-roam-ui)",
          fontSize: compact || result ? 22 : 25,
          fontWeight: 700,
          lineHeight: 1.2,
          margin: 0,
        }}
      >
        {headline}
      </h2>
      <p
        data-slot="roam-status-card-description"
        style={{
          fontFamily: "var(--font-roam-ui)",
          fontSize: result ? 14 : 13,
          fontWeight: result ? 400 : 500,
          // The frames use a 20px line pitch for the 13px step description.
          lineHeight: result ? 1.5 : 1.54,
          margin: 0,
        }}
      >
        {description}
      </p>
      {children}
    </section>
  )
}
