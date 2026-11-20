import { LoaderCircle, Lock, MapPinOff, Store } from "lucide-react"
import type { ReactElement } from "react"

import { cn } from "@/lib/utils"

/**
 * `fe6li` / `K8kuyD` / `HGzqH` / `WhTcl` map preview (SLICING-INDEX §9.3).
 *
 * A designed abstraction, not a map: no tiles, no network, no gestures. The
 * 402-wide scene is centred inside the 362-wide clipping frame, so it crops
 * symmetrically at 320 and keeps the outlet marker, radius field and device
 * dot on screen. Only the resolved variant draws a device dot, so no state
 * invents a position.
 */

export type LocationMapVariant =
  | "resolved"
  | "loading"
  | "unavailable"
  | "permission_denied"

const SCENE_WIDTH = 402
const SCENE_HEIGHT = 132
const FIELD_WIDTH = 131
const FIELD_HEIGHT = 132
const DOT_SIZE = 14
const OUTLET_MARKER_SIZE = 28

type SceneShape = {
  height: number
  left: number
  top: number
  width: number
}

/** Scene-space positions, measured from the four pen.dev map components. */
const ROADS: SceneShape[] = [
  { height: 9, left: 0, top: 45, width: SCENE_WIDTH },
  { height: 7, left: 0, top: 97, width: SCENE_WIDTH },
  { height: SCENE_HEIGHT, left: 65, top: 0, width: 9 },
]

/** The loading skeleton carries an extra vertical street behind its label. */
const LOADING_ROADS: SceneShape[] = [
  ...ROADS,
  { height: SCENE_HEIGHT, left: 195, top: 0, width: 7 },
]

const BLOCKS: SceneShape[] = [
  { height: 25, left: 86, top: 12, width: 66 },
  { height: 25, left: 264, top: 12, width: 84 },
  { height: 21, left: 21, top: 111, width: 75 },
]

const STATE_COPY: Record<Exclude<LocationMapVariant, "resolved">, string> = {
  loading: "Menyiapkan peta…",
  unavailable: "Peta tidak bisa dimuat",
  permission_denied: "Izinkan lokasi untuk melihat peta",
}

/** fe6li draws the dot at scene (223, 73): just right of and below the marker. */
const DEFAULT_OFFSET = { x: 0.557, y: 0.559 }

/**
 * Offsets are fractions of the 402×132 scene. The cap keeps the dot inside the
 * crop even for an absurd distance: `CUETL` draws the out-of-range dot at scene
 * x≈345 (0.86) — past the radius field, still visible inside the 362px preview.
 */
/**
 * The dot is clamped in *viewport* fractions, not scene fractions: at 320 the
 * scene is clipped to a 280-wide crop, so a dot placed at scene 0.95 would be
 * half cut off. `DOT_MAX` keeps it inside the smallest supported crop.
 */
const DOT_MAX = 0.86
const DOT_MIN = 0.02

function clampUnit(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return 0.5
  return Math.min(DOT_MAX, Math.max(DOT_MIN, value))
}

/**
 * 0–1 spans the 402×132 scene, matching the coordinate space the route derives
 * the offset in (`location-presentation.ts`). 0.5/0.5 is the outlet marker at
 * the radius-field centre; values near 1 place the dot beyond the field, which
 * is how the outside-radius frames stay spatial. The dot is inset by half its
 * size so it never leaves the scene.
 */
function dotPosition(offset: { x: number; y: number } | null): {
  left: number
  top: number
} {
  const x = clampUnit(offset?.x)
  const y = clampUnit(offset?.y)

  return {
    left: DOT_SIZE / 2 + x * (SCENE_WIDTH - DOT_SIZE),
    top: DOT_SIZE / 2 + y * (SCENE_HEIGHT - DOT_SIZE),
  }
}

export function LocationMapPreview({
  variant,
  outletName = null,
  deviceOffset = null,
}: {
  variant: LocationMapVariant
  /** Marker label, e.g. "Outlet Sudirman". Omit when there is no resolved position. */
  outletName?: string | null
  /** 0–1 position of the device dot inside the preview scene, from the real
      offset: 0.5 is the radius-field centre, so small offsets stay inside the
      field and near-1 offsets push the dot beyond it (the CUETL frame).
      Only used when variant === "resolved". Clamped. */
  deviceOffset?: { x: number; y: number } | null
}): ReactElement {
  const resolved = variant === "resolved"
  const loading = variant === "loading"
  const roads = loading ? LOADING_ROADS : ROADS
  const dot = dotPosition(deviceOffset ?? DEFAULT_OFFSET)

  return (
    <div
      className={cn("roam-map-preview relative w-full overflow-hidden")}
      data-slot="location-map-preview"
      data-variant={variant}
      style={{
        background: "#FFFFFF",
        border: "1px solid #E5E7EB",
        borderRadius: 20,
        boxSizing: "border-box",
        height: SCENE_HEIGHT,
        maxWidth: 362,
      }}
    >
      {resolved || loading ? (
        <div
          aria-hidden="true"
          data-slot="location-map-preview-scene"
          style={{
            background: "#FFFFFF",
            height: SCENE_HEIGHT,
            left: "50%",
            position: "absolute",
            top: 0,
            transform: "translateX(-50%)",
            width: SCENE_WIDTH,
          }}
        >
          {roads.map((road) => (
            <span
              key={`road-${road.left}-${road.top}`}
              style={{
                background: loading ? "#F4F5F8" : "#E5E7EB",
                display: "block",
                height: road.height,
                left: road.left,
                position: "absolute",
                top: road.top,
                width: road.width,
              }}
            />
          ))}

          {loading
            ? null
            : BLOCKS.map((block) => (
                <span
                  key={`block-${block.left}-${block.top}`}
                  style={{
                    background: "#F4F5F8",
                    borderRadius: 6,
                    display: "block",
                    height: block.height,
                    left: block.left,
                    position: "absolute",
                    top: block.top,
                    width: block.width,
                  }}
                />
              ))}

          {resolved ? (
            <>
              <span
                data-slot="location-map-preview-field"
                style={{
                  background: "#BFD1FA",
                  borderRadius: "50%",
                  display: "block",
                  height: FIELD_HEIGHT,
                  left: (SCENE_WIDTH - FIELD_WIDTH) / 2,
                  position: "absolute",
                  top: (SCENE_HEIGHT - FIELD_HEIGHT) / 2,
                  width: FIELD_WIDTH,
                }}
              />
              <span
                data-slot="location-map-preview-outlet"
                style={{
                  alignItems: "center",
                  background: "#0E0E10",
                  borderRadius: 999,
                  boxShadow: "0 0 0 3px #FFFFFF",
                  color: "#FFFFFF",
                  display: "flex",
                  height: OUTLET_MARKER_SIZE,
                  justifyContent: "center",
                  left: SCENE_WIDTH / 2,
                  position: "absolute",
                  top: SCENE_HEIGHT / 2,
                  transform: "translate(-50%, -50%)",
                  width: OUTLET_MARKER_SIZE,
                }}
              >
                <Store aria-hidden="true" size={14} strokeWidth={1.75} />
              </span>
              <span
                data-slot="location-map-preview-device-dot"
                style={{
                  background: "#0E0E10",
                  borderRadius: 999,
                  boxShadow: "0 0 0 2px #FFFFFF",
                  display: "block",
                  height: DOT_SIZE,
                  left: dot.left,
                  position: "absolute",
                  top: dot.top,
                  transform: "translate(-50%, -50%)",
                  width: DOT_SIZE,
                }}
              />
            </>
          ) : null}
        </div>
      ) : null}

      {resolved && outletName ? (
        // The label is real text, not part of the decorative scene.
        <span
          data-slot="location-map-preview-outlet-name"
          style={{
            alignItems: "center",
            background: "#FFFFFF",
            borderRadius: 999,
            color: "#0E0E10",
            display: "inline-flex",
            fontFamily: "var(--font-roam-ui)",
            fontSize: 10,
            fontWeight: 600,
            height: 20,
            justifyContent: "center",
            left: "50%",
            lineHeight: 1.2,
            padding: "0 24px",
            position: "absolute",
            top: 95,
            transform: "translateX(-50%)",
            whiteSpace: "nowrap",
          }}
        >
          {outletName}
        </span>
      ) : null}

      {resolved ? null : (
        <div
          style={{
            alignItems: "center",
            display: "flex",
            height: "100%",
            justifyContent: "center",
            left: 0,
            position: "absolute",
            top: 0,
            width: "100%",
          }}
        >
          <div
            data-slot="location-map-preview-state"
            style={{
              alignItems: "center",
              background: loading ? "#FFFFFF" : "transparent",
              borderRadius: 12,
              display: "flex",
              flexDirection: "column",
              gap: loading ? 18 : 12,
              justifyContent: "center",
              padding: "8px 14px",
            }}
          >
            {loading ? (
              <LoaderCircle
                aria-hidden="true"
                className="animate-spin"
                color="#0E0E10"
                size={16}
                strokeWidth={1.75}
              />
            ) : null}
            {variant === "unavailable" ? (
              <MapPinOff
                aria-hidden="true"
                color="#525866"
                size={22}
                strokeWidth={1.5}
              />
            ) : null}
            {variant === "permission_denied" ? (
              <Lock
                aria-hidden="true"
                color="#525866"
                size={22}
                strokeWidth={1.5}
              />
            ) : null}
            <p
              data-slot="location-map-preview-copy"
              style={{
                color: "#525866",
                fontFamily: "var(--font-roam-ui)",
                fontSize: 10,
                fontWeight: 500,
                lineHeight: 1.2,
                margin: 0,
                textAlign: "center",
              }}
            >
              {STATE_COPY[variant]}
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
