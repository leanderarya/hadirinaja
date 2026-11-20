import { LoaderCircle } from "lucide-react"
import type * as React from "react"

import { cn } from "@/lib/utils"

export type RoamButtonVariant = "primary" | "secondary" | "danger"

type Surface = { background: string; border: string; color: string }

// WBM9u 01.1 TOMBOL. Primary is the filled 52px pill with a trailing icon;
// secondary and danger are 48px outlines with a leading icon.
const surface: Record<RoamButtonVariant, Surface> = {
  primary: { background: "#0E0E10", border: "transparent", color: "#FFFFFF" },
  secondary: { background: "transparent", border: "#0E0E10", color: "#0E0E10" },
  danger: { background: "transparent", border: "#9B2937", color: "#9B2937" },
}

const disabledSurface: Record<RoamButtonVariant, Surface> = {
  primary: { background: "#E5E7EB", border: "#E5E7EB", color: "#525866" },
  secondary: { background: "transparent", border: "#E5E7EB", color: "#525866" },
  danger: { background: "transparent", border: "#E5E7EB", color: "#525866" },
}

/**
 * WBM9u 01.1 TOMBOL. Primary is a 52px pill labelled 14/700, secondary a 48px
 * 1px outline labelled 14/600, danger the same outline in #9B2937. Disabled
 * keeps its box; loading keeps its width and states the process.
 */
export function RoamButton({
  variant = "primary",
  size,
  loading = false,
  loadingLabel = "Memuat…",
  disabled = false,
  fullWidth = false,
  icon,
  iconPosition,
  children,
  onClick,
  type = "button",
  className,
}: {
  variant?: RoamButtonVariant
  size?: "lg" | "md" | "min"
  loading?: boolean
  loadingLabel?: string
  disabled?: boolean
  fullWidth?: boolean
  /** Trailing on primary/danger, leading on secondary, as in WBM9u. */
  icon?: React.ReactNode
  iconPosition?: "start" | "end"
  children: React.ReactNode
  onClick?: () => void
  type?: "button" | "submit"
  className?: string
}): React.ReactElement {
  const resolvedSize =
    size ?? (variant === "secondary" || variant === "danger" ? "md" : "lg")
  const height = resolvedSize === "lg" ? 52 : resolvedSize === "md" ? 48 : 44
  const palette = disabled ? disabledSurface[variant] : surface[variant]
  const isBusy = loading
  const inert = disabled || loading
  const position = iconPosition ?? (variant === "primary" ? "end" : "start")
  const trailing = position === "end"

  const glyph = isBusy ? (
    <LoaderCircle aria-hidden="true" className="animate-spin" size={18} />
  ) : (
    icon
  )

  return (
    <button
      aria-busy={isBusy || undefined}
      className={cn(
        "roam-button inline-flex items-center justify-center whitespace-nowrap text-center",
        fullWidth && "w-full",
        className
      )}
      data-loading={isBusy || undefined}
      data-slot="roam-button"
      data-variant={variant}
      disabled={inert}
      onClick={onClick}
      style={{
        background: palette.background,
        border: `1px solid ${palette.border}`,
        borderRadius: 999,
        boxSizing: "border-box",
        color: palette.color,
        cursor: inert ? "default" : "pointer",
        fontFamily: "var(--font-roam-ui)",
        fontSize: 14,
        fontWeight: variant === "primary" ? 700 : 600,
        gap: variant === "primary" ? 12 : 8,
        height,
        lineHeight: 1.2,
        minHeight: 44,
        opacity: 1,
        padding: "0 20px",
        width: fullWidth ? "100%" : undefined,
      }}
      type={type}
    >
      {!trailing && glyph ? (
        <span
          aria-hidden="true"
          style={{ display: "inline-flex", flex: "none" }}
        >
          {glyph}
        </span>
      ) : null}
      {/* The resting label holds the box width; the busy label overlays it and
          owns the accessible name while the button is busy. */}
      <span
        style={{
          display: "inline-flex",
          justifyContent: "center",
          position: "relative",
        }}
      >
        <span
          aria-hidden={isBusy || undefined}
          style={{ visibility: isBusy ? "hidden" : undefined }}
        >
          {children}
        </span>
        {isBusy ? (
          <span
            style={{
              left: 0,
              position: "absolute",
              right: 0,
              textAlign: "center",
              top: "50%",
              transform: "translateY(-50%)",
              whiteSpace: "nowrap",
            }}
          >
            {loadingLabel}
          </span>
        ) : null}
      </span>
      {trailing && glyph ? (
        <span
          aria-hidden="true"
          style={{ display: "inline-flex", flex: "none" }}
        >
          {glyph}
        </span>
      ) : null}
    </button>
  )
}
