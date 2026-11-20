// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { createRef } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { AttendanceCameraStep } from "./attendance-camera-step"

afterEach(cleanup)

const base = {
  tone: "info" as const,
  headline: "Ambil foto bukti",
  description: "Pastikan foto terang dan tidak buram.",
  photoUrl: "",
  overlayCaption: null,
  primary: null,
  secondary: null,
  recoverySteps: [] as string[],
  recoveryTitle: null,
  help: null,
  caption: "Check-in belum dikirim.",
  onVideoReady: () => undefined,
}

describe("AttendanceCameraStep", () => {
  it("renders the video with the exact aria-label and media geometry", () => {
    const videoRef = createRef<HTMLVideoElement>()
    const { container } = render(
      <AttendanceCameraStep {...base} videoRef={videoRef} />
    )
    const video = screen.getByLabelText("Pratinjau kamera karyawan")
    expect(video.tagName).toBe("VIDEO")
    expect(video.getAttribute("aria-label")).toBe("Pratinjau kamera karyawan")
    expect(video.getAttribute("playsinline")).not.toBeNull()
    expect(video.getAttribute("autoplay")).not.toBeNull()
    // React sets `muted` as a DOM property rather than an attribute
    expect((video as HTMLVideoElement).muted).toBe(true)
    expect(video.style.objectFit).toBe("cover")
    const surface = container.querySelector<HTMLElement>(
      '[data-slot="attendance-camera-surface"]'
    )
    expect(surface?.style.borderRadius).toBe("20px")
    expect(surface?.style.aspectRatio).toBe("362 / 300")
    expect(surface?.style.maxHeight).toBe("45dvh")
  })

  it("fires onVideoReady from all three readiness handlers", () => {
    const onVideoReady = vi.fn()
    const videoRef = createRef<HTMLVideoElement>()
    render(
      <AttendanceCameraStep
        {...base}
        onVideoReady={onVideoReady}
        videoRef={videoRef}
      />
    )
    const video = screen.getByLabelText("Pratinjau kamera karyawan")
    fireEvent.loadedData(video)
    fireEvent.canPlay(video)
    fireEvent.playing(video)
    expect(onVideoReady).toHaveBeenCalledTimes(3)
  })

  it("covers the stream with the F4F5F8 preparing surface only while a caption is given", () => {
    const videoRef = createRef<HTMLVideoElement>()
    const { container, rerender } = render(
      <AttendanceCameraStep {...base} videoRef={videoRef} />
    )
    expect(
      container.querySelector('[data-slot="attendance-camera-preparing"]')
    ).toBeNull()
    expect(
      container.querySelector<HTMLElement>(
        '[data-slot="attendance-camera-surface"]'
      )?.style.background
    ).toBe("rgb(14, 14, 16)")

    rerender(
      <AttendanceCameraStep
        {...base}
        overlayCaption="Menyiapkan kamera…"
        videoRef={videoRef}
      />
    )
    const surface = container.querySelector<HTMLElement>(
      '[data-slot="attendance-camera-surface"]'
    )
    // rmEe0 draws the preparing state on #F4F5F8, not the black capture surface.
    expect(surface?.style.background).toBe("rgb(244, 245, 248)")
    const preparing = container.querySelector<HTMLElement>(
      '[data-slot="attendance-camera-preparing"]'
    )
    expect(preparing?.textContent).toContain("Menyiapkan kamera…")
    expect(preparing?.textContent).toContain(
      "Tunggu sampai pratinjau kamera muncul."
    )
  })

  it("labels the warming state 15/700 over a 13/500 hint with a spinner", () => {
    const videoRef = createRef<HTMLVideoElement>()
    const { container } = render(
      <AttendanceCameraStep
        {...base}
        overlayCaption="Menyiapkan kamera…"
        videoRef={videoRef}
      />
    )
    const preparing = container.querySelector<HTMLElement>(
      '[data-slot="attendance-camera-preparing"]'
    )
    const [label, hint] = Array.from(preparing?.querySelectorAll("p") ?? [])
    expect(label.style.fontSize).toBe("15px")
    expect(label.style.fontWeight).toBe("700")
    expect(hint.style.fontSize).toBe("13px")
    expect(hint.style.fontWeight).toBe("500")
    expect(hint.style.color).toBe("rgb(82, 88, 102)")
    expect(
      preparing?.querySelector("svg.animate-spin, .animate-spin")
    ).not.toBeNull()
  })

  it("renders the preview image with the exact alt and object-contain", () => {
    const videoRef = createRef<HTMLVideoElement>()
    const { container } = render(
      <AttendanceCameraStep
        {...base}
        photoCaption="Diambil pada perangkat ini."
        photoUrl="data:image/jpeg;base64,AAAA"
        videoRef={videoRef}
      />
    )
    const img = screen.getByRole("img", {
      name: "Pratinjau foto bukti presensi",
    })
    expect(img.getAttribute("alt")).toBe("Pratinjau foto bukti presensi")
    expect((img as HTMLElement).style.objectFit).toBe("contain")
    // the stream stays mounted but invisible behind the captured frame
    expect(container.querySelector("video")?.style.opacity).toBe("0")
    expect(screen.getByText("Diambil pada perangkat ini.")).toBeDefined()
  })

  it("renders primary above secondary with the WBM9u 52/48 heights and 12px gap", () => {
    const onCapture = vi.fn()
    const onRetake = vi.fn()
    const videoRef = createRef<HTMLVideoElement>()
    const { container } = render(
      <AttendanceCameraStep
        {...base}
        primary={{ label: "Ambil foto", onClick: onCapture }}
        secondary={{ label: "Ambil ulang foto", onClick: onRetake }}
        videoRef={videoRef}
      />
    )
    const primary = screen.getByRole("button", { name: "Ambil foto" })
    const secondary = screen.getByRole("button", { name: "Ambil ulang foto" })
    expect(primary.dataset.variant).toBe("primary")
    expect(primary.style.height).toBe("52px")
    expect(secondary.dataset.variant).toBe("secondary")
    expect(secondary.style.height).toBe("48px")

    const stack = container.querySelector<HTMLElement>(
      '[data-slot="attendance-action-stack"]'
    )
    expect(stack?.style.gap).toBe("12px")
    const actions = Array.from(stack?.children ?? []) as HTMLElement[]
    expect(actions[0].textContent).toContain("Ambil foto")
    expect(actions[1].textContent).toContain("Ambil ulang foto")

    fireEvent.click(primary)
    fireEvent.click(secondary)
    expect(onCapture).toHaveBeenCalledTimes(1)
    expect(onRetake).toHaveBeenCalledTimes(1)
  })

  it("uses a plain heading for capture states and the step card only for errors", () => {
    const videoRef = createRef<HTMLVideoElement>()
    const { container, rerender } = render(
      <AttendanceCameraStep {...base} videoRef={videoRef} />
    )
    expect(container.querySelector('[data-slot="roam-status-card"]')).toBeNull()
    const heading = screen.getByRole("heading", { name: "Ambil foto bukti" })
    expect(heading).toBeDefined()
    expect(heading.style.fontSize).toBe("22px")
    expect(heading.style.fontWeight).toBe("700")

    rerender(
      <AttendanceCameraStep
        {...base}
        description="Browser belum diizinkan memakai kamera. Foto belum bisa diambil."
        headline="Izin kamera ditolak"
        recoverySteps={["Izinkan akses kamera."]}
        recoveryTitle="Ubah izin kamera"
        tone="error"
        videoRef={videoRef}
      />
    )
    const card = container.querySelector<HTMLElement>(
      '[data-slot="roam-status-card"]'
    )
    expect(card?.dataset.tone).toBe("error")
    expect(card?.dataset.variant).toBe("step")
    expect(card?.textContent).toContain("Izin kamera ditolak")
    // o3ci8s / SeDHp keep the numbered recovery outside the pastel card.
    expect(card?.textContent).not.toContain("Izinkan akses kamera.")
    expect(screen.getByText("Ubah izin kamera")).toBeDefined()
    // the error states draw no media surface at all
    expect(
      container.querySelector('[data-slot="attendance-camera-surface"]')
    ).toBeNull()
  })

  it("keeps the 56px step medallion on the error card", () => {
    const videoRef = createRef<HTMLVideoElement>()
    const { container } = render(
      <AttendanceCameraStep
        {...base}
        description="Kamera mungkin sedang dipakai aplikasi lain atau belum tersedia."
        headline="Kamera tidak bisa dibuka"
        tone="error"
        videoRef={videoRef}
      />
    )
    const medallion = container.querySelector<HTMLElement>(
      '[data-slot="roam-status-card-medallion"]'
    )
    expect(medallion?.style.width).toBe("56px")
    expect(medallion?.style.height).toBe("56px")
  })

  it("always shows the caption", () => {
    const videoRef = createRef<HTMLVideoElement>()
    render(<AttendanceCameraStep {...base} videoRef={videoRef} />)
    expect(screen.getByText("Check-in belum dikirim.")).toBeDefined()
  })
})
