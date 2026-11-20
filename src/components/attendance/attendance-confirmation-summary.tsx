import type { ReactElement, ReactNode } from "react"

import { cn } from "@/lib/utils"

/**
 * uqxF6 — the confirmation summary.
 *
 * Two compositions exist in the frames and they are genuinely different:
 *
 * - `card` (AWKAr, plus A3TMy / KQlyB while in flight): white card, r20,
 *   1px #E5E7EB, 16px padding, 37px rows at 4px pitch, an 18px icon per row,
 *   label in an 80px column, right-aligned 14/600 values.
 * - `flat` (wdXB0 / ZhBqn / DBvSR, the result screens): no card, no border, no
 *   radius and no padding — the rows sit directly on the canvas and the
 *   hairlines span the full 362px content width, with no row icons and an 8px
 *   row gap (45px pitch).
 */

export type AttendanceSummaryRow = {
  label: string
  value: string
  emphasis?: boolean
  icon?: ReactNode
}

export type AttendanceSummaryVariant = "card" | "flat"

const SURFACE = "#FFFFFF"
const BORDER = "#E5E7EB"
const TEXT_PRIMARY = "#0E0E10"
const TEXT_SECONDARY = "#525866"
const EMPHASIS_SURFACE = "#E79FF5"

const LABEL_COLUMN = 80
const ROW_GAP = 10
const ICON_SIZE = 18
const EMPHASIS_INSET = 10

export function AttendanceConfirmationSummary({
  rows,
  photoUrl,
  photoCaption,
  variant = "card",
  className,
}: {
  rows: AttendanceSummaryRow[]
  photoUrl?: string
  photoCaption?: string
  /** `card` on the confirmation step, `flat` on the result screens. */
  variant?: AttendanceSummaryVariant
  className?: string
}): ReactElement {
  const flat = variant === "flat"

  return (
    <section
      className={cn("overflow-hidden", className)}
      data-slot="attendance-confirmation-summary"
      data-variant={variant}
      style={
        flat
          ? { display: "flex", flexDirection: "column", gap: 8 }
          : {
              backgroundColor: SURFACE,
              border: `1px solid ${BORDER}`,
              borderRadius: 20,
              display: "flex",
              flexDirection: "column",
              gap: 4,
              padding: 16,
            }
      }
    >
      <dl
        style={{
          display: "flex",
          flexDirection: "column",
          gap: flat ? 8 : 4,
          margin: 0,
        }}
      >
        {rows.map((row, index) => {
          const isLast = index === rows.length - 1
          return (
            <div
              data-emphasis={row.emphasis ? "true" : undefined}
              data-slot="attendance-summary-row"
              key={row.label}
              style={{
                alignItems: "center",
                backgroundColor: row.emphasis ? EMPHASIS_SURFACE : undefined,
                borderBottom:
                  isLast || row.emphasis ? undefined : `1px solid ${BORDER}`,
                borderRadius: row.emphasis ? 8 : undefined,
                display: "flex",
                gap: ROW_GAP,
                height: 37,
                paddingLeft: row.emphasis ? EMPHASIS_INSET : 0,
                paddingRight: row.emphasis ? EMPHASIS_INSET : 0,
              }}
            >
              {/* Row icons belong to the confirmation card only; the result
                  list in the frames has none. */}
              {!flat && row.icon ? (
                <span
                  aria-hidden="true"
                  data-slot="attendance-summary-icon"
                  style={{
                    alignItems: "center",
                    color: row.emphasis ? TEXT_PRIMARY : TEXT_SECONDARY,
                    display: "inline-flex",
                    flex: "none",
                    height: ICON_SIZE,
                    justifyContent: "center",
                    width: ICON_SIZE,
                  }}
                >
                  {row.icon}
                </span>
              ) : null}
              <dt
                style={{
                  color: row.emphasis ? TEXT_PRIMARY : TEXT_SECONDARY,
                  flex: "none",
                  fontSize: 13,
                  fontWeight: 500,
                  lineHeight: 1.2,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  width: LABEL_COLUMN,
                }}
              >
                {row.label}
              </dt>
              <dd
                style={{
                  color: TEXT_PRIMARY,
                  flex: "1 1 0",
                  fontSize: 14,
                  fontWeight: 600,
                  lineHeight: 1.2,
                  margin: 0,
                  minWidth: 0,
                  overflow: "hidden",
                  textAlign: "right",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {row.value}
              </dd>
            </div>
          )
        })}
      </dl>

      {photoUrl ? (
        <div
          data-slot="attendance-summary-photo"
          style={{
            alignItems: "center",
            display: "flex",
            gap: 12,
            paddingTop: 12,
          }}
        >
          <img
            alt="Foto bukti presensi"
            src={photoUrl}
            style={{
              borderRadius: 14,
              flexShrink: 0,
              height: 112,
              objectFit: "cover",
              width: 96,
            }}
          />
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 4,
              minWidth: 0,
            }}
          >
            <p
              style={{
                color: TEXT_PRIMARY,
                fontSize: 14,
                fontWeight: 600,
                lineHeight: 1.5,
                margin: 0,
              }}
            >
              Foto bukti
            </p>
            {photoCaption ? (
              <p
                style={{
                  color: TEXT_SECONDARY,
                  fontSize: 12,
                  fontWeight: 500,
                  lineHeight: 1.5,
                  margin: 0,
                }}
              >
                {photoCaption}
              </p>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  )
}
