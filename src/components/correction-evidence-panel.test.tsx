// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { CorrectionEvidencePanel } from "@/components/correction-evidence-panel"
import { ApiError, apiRequest, downloadApiFile } from "@/lib/api"
import {
  CorrectionRetentionSettings,
  HistoricalComparison,
  CorrectionReversalForm,
} from "@/routes/approvals"

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  apiRequest: vi.fn(),
  downloadApiFile: vi.fn(),
}))

const request = vi.mocked(apiRequest)
const download = vi.mocked(downloadApiFile)
const empty = { files: [], supplement: null }

beforeEach(() => {
  request.mockReset()
  download.mockReset()
})

describe("correction evidence", () => {
  it("responds to a supplementary requirement and retries the same optional upload", async () => {
    const required = { reason: "Lampirkan catatan jadwal.", satisfied: false }
    request
      .mockResolvedValueOnce({ files: [], supplement: required })
      .mockRejectedValueOnce(
        new ApiError("Penyimpanan sementara tidak tersedia.", 503)
      )
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({
        files: [],
        supplement: { ...required, satisfied: true },
      })
    const onSupplementChange = vi.fn()
    render(
      <CorrectionEvidencePanel
        requestId={12}
        onSupplementChange={onSupplementChange}
      />
    )

    const input = await screen.findByLabelText("Lampiran tambahan")
    expect(screen.getByText("Lampirkan catatan jadwal.")).toBeTruthy()
    expect(onSupplementChange).toHaveBeenCalledWith(true)
    expect(screen.queryByText("Minta bukti tambahan")).toBeNull()
    const file = new File(["evidence"], "catatan.png", { type: "image/png" })
    fireEvent.change(input, { target: { files: [file] } })
    fireEvent.click(screen.getByRole("button", { name: "Unggah lampiran" }))
    await screen.findByText("Penyimpanan sementara tidak tersedia.")
    fireEvent.click(screen.getByRole("button", { name: "Unggah lampiran" }))
    await screen.findByText("Bukti tambahan tersedia.")

    const writes = request.mock.calls.filter(
      ([, options]) => options?.method === "POST"
    )
    expect(writes).toHaveLength(2)
    expect(writes[0][0]).toBe("/correction-evidence/12")
    const first = writes[0][1]?.body as FormData
    const second = writes[1][1]?.body as FormData
    expect(first.get("file")).toBe(file)
    expect(first.get("key")).toBe(second.get("key"))
    expect(onSupplementChange).toHaveBeenLastCalledWith(false)
  })

  it("submits an authorized proof request and shows hold and expiry without exposing file paths", async () => {
    request
      .mockResolvedValueOnce(empty)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({
        supplement: { reason: "Periksa bukti tambahan.", satisfied: false },
        files: [
          {
            id: 3,
            mime_type: "application/pdf",
            size_bytes: 1000,
            available: true,
            hold_state: "held",
            expires_at: "2027-01-01",
            decision_id: null,
          },
          {
            id: 4,
            mime_type: "image/png",
            size_bytes: 1000,
            available: false,
            hold_state: null,
            expires_at: "2026-01-01",
            decision_id: null,
          },
        ],
      })
    download.mockResolvedValue(undefined)
    render(<CorrectionEvidencePanel requestId={17} canRequireSupplement />)
    fireEvent.click(await screen.findByText("Minta bukti tambahan"))
    fireEvent.change(
      screen.getByLabelText("Alasan dan bukti yang diperlukan"),
      { target: { value: "Periksa bukti tambahan." } }
    )
    fireEvent.click(
      screen.getByRole("button", { name: "Kirim permintaan bukti" })
    )
    expect(await screen.findByText("Ditahan (Legal Hold)")).toBeTruthy()
    expect(screen.getByText("Berkas tidak tersedia")).toBeTruthy()
    expect(
      screen.queryByRole("button", { name: "Unduh lampiran #4" })
    ).toBeNull()
    expect(request).toHaveBeenCalledWith(
      "/management/approvals/17/evidence/requirement",
      {
        method: "POST",
        body: { reason: "Periksa bukti tambahan." },
      }
    )
    fireEvent.click(screen.getByRole("button", { name: "Unduh lampiran #3" }))
    expect(download).toHaveBeenCalledWith(
      "/correction-evidence/17/3",
      "bukti-koreksi-3.pdf",
      "application/octet-stream"
    )
  })
})

it("reverses the exact decision, shows a dependency error, and keeps a retry key", async () => {
  const message =
    "Balikkan koreksi lanjutan yang masih berlaku terlebih dahulu."
  request
    .mockRejectedValueOnce(
      new ApiError("Koreksi tidak dapat dibalik.", 422, undefined, {
        decision_id: [message],
      })
    )
    .mockResolvedValueOnce({})
  const onReversed = vi.fn().mockResolvedValue(undefined)
  render(
    <CorrectionReversalForm
      requestId={27}
      decisionId={41}
      onReversed={onReversed}
    />
  )
  fireEvent.click(screen.getByText("Balikkan koreksi"))
  const confirm = screen.getByRole("button", {
    name: "Konfirmasi pembalikan",
  }) as HTMLButtonElement
  expect(confirm.disabled).toBe(true)
  fireEvent.change(screen.getByLabelText("Alasan pembalikan"), {
    target: { value: " Perbaiki keputusan. " },
  })
  fireEvent.click(confirm)
  await screen.findByText(message)
  expect(onReversed).not.toHaveBeenCalled()
  fireEvent.click(confirm)
  await waitFor(() => expect(onReversed).toHaveBeenCalledTimes(1))
  const [path, options] = request.mock.calls[1]
  expect(path).toBe("/management/approvals/27/reversal")
  expect(options?.body).toEqual({
    decision_id: 41,
    reason: "Perbaiki keputusan.",
  })
  expect(options?.headers).toEqual(request.mock.calls[0][1]?.headers)
})

it("reads retention before editing, cancels drafts, and saves explicit changes", async () => {
  request
    .mockResolvedValueOnce({ days: 365 })
    .mockResolvedValueOnce({ days: 120 })
  render(<CorrectionRetentionSettings />)
  await screen.findByText("Masa simpan bukti 365 hari.")
  expect(screen.queryByLabelText("Masa simpan bukti (hari)")).toBeNull()
  fireEvent.click(screen.getByRole("button", { name: "Ubah retensi" }))
  fireEvent.change(screen.getByLabelText("Masa simpan bukti (hari)"), {
    target: { value: "90" },
  })
  fireEvent.click(screen.getByRole("button", { name: "Batal" }))
  expect(request).toHaveBeenCalledTimes(1)
  fireEvent.click(screen.getByRole("button", { name: "Ubah retensi" }))
  expect(
    (screen.getByLabelText("Masa simpan bukti (hari)") as HTMLInputElement)
      .value
  ).toBe("365")
  fireEvent.change(screen.getByLabelText("Masa simpan bukti (hari)"), {
    target: { value: "120" },
  })
  fireEvent.click(screen.getByRole("button", { name: "Simpan retensi" }))
  await screen.findByText("Masa simpan bukti 120 hari.")
  expect(request).toHaveBeenLastCalledWith(
    "/management/correction-evidence/retention",
    { method: "PUT", body: { days: 120 } }
  )
})

it("compares one authorized day and clears a previously loaded snapshot on denied retry", async () => {
  request
    .mockResolvedValueOnce({
      historical_comparison: {
        revision: 1,
        snapshot: {
          outcome: "present",
          effective_duration_seconds: 28800,
          actual_duration_seconds: 28000,
        },
      },
    })
    .mockRejectedValueOnce(new ApiError("Akses riwayat dicabut.", 403))
  const day = {
    employee: { id: 12, name: "Synthetic" },
    work_date: "2026-11-05",
    finalization: {
      id: 9,
      revision: 2,
      outcome: "present",
      reason: "Reviewed",
    },
    effective_duration_seconds: 25200,
    actual_duration_seconds: 28000,
  } as Parameters<typeof HistoricalComparison>[0]["day"]
  render(<HistoricalComparison day={day} />)
  fireEvent.click(screen.getByText("Bandingkan riwayat penetapan hasil"))
  fireEvent.change(screen.getByLabelText("Revisi penetapan hasil"), {
    target: { value: "1" },
  })
  fireEvent.click(screen.getByRole("button", { name: "Bandingkan revisi" }))
  await screen.findByText(/Revisi 1/)
  const query = new URLSearchParams(request.mock.calls[0][0].split("?")[1])
  expect(Object.fromEntries(query)).toEqual({
    employee_id: "12",
    from: "2026-11-05",
    to: "2026-11-05",
    compare_revision: "1",
  })
  fireEvent.click(screen.getByRole("button", { name: "Bandingkan revisi" }))
  await screen.findByText("Akses riwayat dicabut.")
  expect(screen.queryByText(/Revisi 1/)).toBeNull()
})
