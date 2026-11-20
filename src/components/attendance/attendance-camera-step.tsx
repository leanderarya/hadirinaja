import { LoaderCircle } from "lucide-react"
import type { ReactElement, ReactNode, RefObject } from "react"

import { AttendanceRecoveryList } from "@/components/attendance/attendance-recovery-list"
import { AttendanceStepHeading } from "@/components/attendance/attendance-step-heading"
import { RoamButton } from "@/components/roam/roam-button"
import {
  RoamStatusCard,
  type RoamStatusTone,
} from "@/components/roam/roam-status-card"

/**
 * Camera step composition (frames ImWvk, cntyI, TA4fH, rmEe0, o3ci8s, SeDHp).
 *
 * Only permission/failure states use the pastel status card. Ready, warming and
 * preview states are a plain heading over the media surface, which is what the
 * frames actually draw.
 */

const SURFACE_NEUTRAL = "#F4F5F8"
const TEXT_SECONDARY = "#525866"

export function AttendanceCameraStep({
  tone,
  headline,
  description,
  videoRef,
  photoUrl,
  overlayCaption,
  primary,
  secondary,
  recoverySteps,
  recoveryTitle,
  noteTitle = null,
  note = null,
  help,
  caption,
  photoCaption,
  onVideoReady,
}: {
  tone: RoamStatusTone
  headline: string
  description: string
  videoRef: RefObject<HTMLVideoElement | null>
  photoUrl: string
  overlayCaption: string | null
  primary: {
    label: string
    onClick: () => void
    disabled?: boolean
    loading?: boolean
    icon?: ReactNode
  } | null
  secondary: { label: string; onClick: () => void; icon?: ReactNode } | null
  recoverySteps: string[]
  recoveryTitle: string | null
  noteTitle?: string | null
  note?: string | null
  help: string | null
  caption: string
  photoCaption?: string | null
  onVideoReady: () => void
}): ReactElement {
  const isError = tone === "error"
  const preparing = overlayCaption !== null

  return (
    <div
      data-slot="attendance-camera-step"
      style={{ display: "flex", flexDirection: "column", gap: 16 }}
    >
      {isError ? (
        <RoamStatusCard
          align="start"
          description={description}
          headline={headline}
          icon={<CameraIssueIcon />}
          tone={tone}
        />
      ) : (
        <AttendanceStepHeading description={description} title={headline} />
      )}

      {isError ? null : (
        <>
          <div
            data-mode={photoUrl ? "preview" : "capture"}
            data-slot="attendance-camera-surface"
            style={{
              aspectRatio: "362 / 300",
              background: preparing ? SURFACE_NEUTRAL : "#0E0E10",
              borderRadius: 20,
              maxHeight: "45dvh",
              overflow: "hidden",
              position: "relative",
              width: "100%",
            }}
          >
            {/* The stream mounts immediately: the route requests the camera as
                soon as the dialog opens, so the element must exist before the
                first frame. The preparing surface covers it until it is ready. */}
            <video
              aria-hidden={photoUrl ? true : undefined}
              aria-label="Pratinjau kamera karyawan"
              autoPlay
              muted
              onCanPlay={onVideoReady}
              onLoadedData={onVideoReady}
              onPlaying={onVideoReady}
              playsInline
              ref={videoRef}
              style={{
                height: "100%",
                objectFit: "cover",
                opacity: preparing || photoUrl ? 0 : 1,
                width: "100%",
              }}
            />
            {photoUrl ? (
              <img
                alt="Pratinjau foto bukti presensi"
                src={photoUrl}
                style={{
                  height: "100%",
                  inset: 0,
                  objectFit: "contain",
                  position: "absolute",
                  width: "100%",
                }}
              />
            ) : null}
            {preparing && !photoUrl ? (
              <div
                data-slot="attendance-camera-preparing"
                style={{
                  alignItems: "center",
                  display: "flex",
                  flexDirection: "column",
                  gap: 20,
                  inset: 0,
                  justifyContent: "center",
                  padding: 20,
                  position: "absolute",
                }}
              >
                <LoaderCircle
                  aria-hidden="true"
                  className="animate-spin"
                  size={32}
                />
                <p
                  style={{
                    color: "#0E0E10",
                    fontFamily: "var(--font-roam-ui)",
                    fontSize: 15,
                    fontWeight: 700,
                    lineHeight: 1.3,
                    margin: 0,
                    textAlign: "center",
                  }}
                >
                  {overlayCaption}
                </p>
                <p
                  style={{
                    color: TEXT_SECONDARY,
                    fontFamily: "var(--font-roam-ui)",
                    fontSize: 13,
                    fontWeight: 500,
                    lineHeight: 1.5,
                    margin: 0,
                    textAlign: "center",
                  }}
                >
                  Tunggu sampai pratinjau kamera muncul.
                </p>
              </div>
            ) : null}
          </div>

          {photoUrl && photoCaption ? (
            <p
              data-slot="attendance-camera-photo-caption"
              style={{
                color: TEXT_SECONDARY,
                fontFamily: "var(--font-roam-ui)",
                fontSize: 12,
                fontWeight: 500,
                lineHeight: 1.5,
                margin: 0,
                textAlign: "center",
              }}
            >
              {photoCaption}
            </p>
          ) : null}
        </>
      )}

      <AttendanceRecoveryList
        note={note}
        steps={recoverySteps}
        title={recoveryTitle ?? noteTitle}
      />

      <div
        data-slot="attendance-action-stack"
        style={{ display: "flex", flexDirection: "column", gap: 12 }}
      >
        {primary ? (
          <RoamButton
            disabled={primary.disabled}
            fullWidth
            icon={primary.icon}
            loading={primary.loading}
            onClick={primary.onClick}
            variant="primary"
          >
            {primary.label}
          </RoamButton>
        ) : null}

        {secondary ? (
          <RoamButton
            fullWidth
            icon={secondary.icon}
            onClick={secondary.onClick}
            variant="secondary"
          >
            {secondary.label}
          </RoamButton>
        ) : null}
      </div>

      {help ? (
        <p
          data-slot="attendance-camera-help"
          style={{
            color: TEXT_SECONDARY,
            fontFamily: "var(--font-roam-ui)",
            fontSize: 12,
            fontWeight: 500,
            lineHeight: 1.5,
            margin: 0,
            textAlign: "center",
          }}
        >
          {help}
        </p>
      ) : null}

      <p
        data-slot="attendance-camera-caption"
        style={{
          color: TEXT_SECONDARY,
          fontFamily: "var(--font-roam-ui)",
          fontSize: 12,
          fontWeight: 500,
          lineHeight: 1.5,
          margin: 0,
          textAlign: "center",
        }}
      >
        {caption}
      </p>
    </div>
  )
}

function CameraIssueIcon(): ReactElement {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height="28"
      viewBox="0 0 24 24"
      width="28"
    >
      <path
        d="M2 2l20 20M9.5 4.5h5L16 7h3a2 2 0 0 1 2 2v8m-2.5 2H5a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h2"
        stroke="#9B2937"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
      <circle cx="12" cy="13" r="3.2" stroke="#9B2937" strokeWidth="1.8" />
    </svg>
  )
}
