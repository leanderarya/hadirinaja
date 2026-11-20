// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import type { PublishedShiftDay } from "./-shift-changes"
const { apiRequest } = vi.hoisted(() => ({ apiRequest: vi.fn() }))
vi.mock("@/lib/api", () => ({ apiRequest }))
vi.mock("@tanstack/react-router", () => ({
  useBlocker: () => ({ status: "idle" }),
}))
import { ShiftChanges } from "./-shift-changes"
const base = "/management/scheduling/me/changes"
const shift = {
  name: "Pagi QA",
  start_time: "08:00:00",
  end_time: "16:00:00",
  crosses_midnight: false,
}
const day: PublishedShiftDay = {
  work_date: "2099-01-05",
  scheduled_start: "2099-01-05T08:00:00+07:00",
  status: "scheduled",
  outlet: { name: "Outlet QA" },
  shift,
  provenance: { source: "published_roster", entry_id: 10 },
}
const row = {
  id: 1,
  kind: "replacement",
  status: "pending",
  requester_id: 1,
  recipient_id: 2,
  requester_name: "QA A",
  recipient_name: "QA B",
  source_date: day.work_date,
  source_shift: shift,
  target_date: null,
  target_shift: null,
  outlet_name: "Outlet QA",
  reason: "Family QA",
}
const onChanged = vi.fn()
let rows: unknown[]
beforeEach(() => {
  vi.clearAllMocks()
  rows = []
  apiRequest.mockImplementation(
    async (path: string, options?: { method?: string }) => {
      if (path.includes("/options"))
        return {
          recipients: [
            {
              id: 2,
              name: "QA B",
              shifts: [{ entry_id: 20, date: day.work_date, shift }],
            },
          ],
        }
      if (path.endsWith("/respond")) {
        rows = [{ ...row, status: "accepted" }]
        return rows[0]
      }
      if (options?.method === "POST") {
        rows = [row]
        return row
      }
      return { requests: rows }
    }
  )
})
afterEach(cleanup)
async function open() {
  const button = await screen.findByRole("button", {
    name: "Ajukan perubahan shift",
  })
  await waitFor(() => expect(button.matches(":disabled")).toBe(false))
  fireEvent.click(button)
  await screen.findByRole("option", { name: "QA B" })
}
it("does not offer requests for legacy or already-started shifts", async () => {
  render(
    <ShiftChanges
      employeeId={1}
      days={[
        { ...day, provenance: { source: "legacy" } },
        { ...day, scheduled_start: "2000-01-01T08:00:00Z" },
      ]}
      onChanged={onChanged}
    />
  )
  await screen.findByText("Belum ada permintaan.")
  expect(
    screen
      .getByRole("button", { name: "Ajukan perubahan shift" })
      .matches(":disabled")
  ).toBe(true)
})
it("requires recipient/reason, sends replacement payload with an idempotency key, and waits for acceptance", async () => {
  render(<ShiftChanges employeeId={1} days={[day]} onChanged={onChanged} />)
  await open()
  expect(
    screen
      .getByRole("button", { name: "Kirim permintaan" })
      .matches(":disabled")
  ).toBe(true)
  fireEvent.change(screen.getByLabelText("Jenis perubahan"), {
    target: { value: "replacement" },
  })
  fireEvent.change(screen.getByLabelText("Penerima"), {
    target: { value: "2" },
  })
  fireEvent.change(screen.getByLabelText("Alasan"), {
    target: { value: "Family QA" },
  })
  fireEvent.click(screen.getByRole("button", { name: "Kirim permintaan" }))
  await screen.findByText(/Permintaan dikirim/)
  expect(apiRequest).toHaveBeenCalledWith(
    base,
    expect.objectContaining({
      method: "POST",
      body: {
        kind: "replacement",
        source_entry_id: 10,
        recipient_id: 2,
        reason: "Family QA",
      },
      headers: { "Idempotency-Key": expect.any(String) },
    })
  )
  expect(onChanged).not.toHaveBeenCalled()
  expect(
    screen.getByRole("button", { name: "Batalkan permintaan" })
  ).toBeTruthy()
})
it("requires the recipient's published shift when swapping", async () => {
  render(<ShiftChanges employeeId={1} days={[day]} onChanged={onChanged} />)
  await open()
  fireEvent.change(screen.getByLabelText("Penerima"), {
    target: { value: "2" },
  })
  fireEvent.change(screen.getByLabelText("Alasan"), {
    target: { value: "Swap QA" },
  })
  expect(
    screen
      .getByRole("button", { name: "Kirim permintaan" })
      .matches(":disabled")
  ).toBe(true)
  fireEvent.change(screen.getByLabelText("Shift penerima"), {
    target: { value: "20" },
  })
  fireEvent.click(screen.getByRole("button", { name: "Kirim permintaan" }))
  await waitFor(() =>
    expect(apiRequest).toHaveBeenCalledWith(
      base,
      expect.objectContaining({
        body: expect.objectContaining({ kind: "swap", target_entry_id: 20 }),
      })
    )
  )
})
it("shows recipient accept/reject controls and refreshes schedule after acceptance", async () => {
  rows = [row]
  render(<ShiftChanges employeeId={2} days={[]} onChanged={onChanged} />)
  fireEvent.click(
    await screen.findByRole("button", { name: "Terima perubahan" })
  )
  await waitFor(() => expect(onChanged).toHaveBeenCalledOnce())
  expect(apiRequest).toHaveBeenCalledWith(`${base}/1/respond`, {
    method: "POST",
    body: { action: "accept" },
  })
  expect(screen.queryByRole("button", { name: "Terima perubahan" })).toBeNull()
})
it("shows a failed acceptance and leaves schedule unchanged", async () => {
  rows = [row]
  apiRequest.mockImplementation(async (path: string) => {
    if (path.endsWith("/respond")) throw new Error("Revisi roster berubah")
    return { requests: rows }
  })
  render(<ShiftChanges employeeId={2} days={[]} onChanged={onChanged} />)
  fireEvent.click(
    await screen.findByRole("button", { name: "Terima perubahan" })
  )
  await screen.findByText("Revisi roster berubah")
  expect(onChanged).not.toHaveBeenCalled()
})
it("ignores delayed recipient options after switching source", async () => {
  let resolve!: (value: unknown) => void
  const pending = new Promise((done) => {
    resolve = done
  })
  apiRequest.mockImplementation(async (path: string) =>
    path.endsWith("entry_id=10")
      ? pending
      : path.includes("/options")
        ? { recipients: [{ id: 3, name: "QA C", shifts: [] }] }
        : { requests: [] }
  )
  render(
    <ShiftChanges
      employeeId={1}
      days={[
        day,
        { ...day, provenance: { source: "published_roster", entry_id: 11 } },
      ]}
      onChanged={onChanged}
    />
  )
  const button = await screen.findByRole("button", {
    name: "Ajukan perubahan shift",
  })
  await waitFor(() => expect(button.matches(":disabled")).toBe(false))
  fireEvent.click(button)
  fireEvent.change(screen.getByLabelText("Shift saya"), {
    target: { value: "11" },
  })
  await screen.findByRole("option", { name: "QA C" })
  await act(async () =>
    resolve({ recipients: [{ id: 2, name: "QA B", shifts: [] }] })
  )
  expect(screen.queryByRole("option", { name: "QA B" })).toBeNull()
})

it("uses server time to expire an open pending request and removes acceptance controls", async () => {
  const serverNow = Date.parse("2030-01-04T02:00:00Z")
  rows = [{ ...row, expires_at: new Date(serverNow + 250).toISOString() }]
  apiRequest.mockImplementation(async () => ({
    requests: rows,
    server_now: new Date(serverNow).toISOString(),
  }))
  render(<ShiftChanges employeeId={2} days={[]} onChanged={onChanged} />)
  await screen.findByRole("button", { name: "Terima perubahan" })
  await screen.findByText("Kedaluwarsa")
  expect(screen.queryByRole("button", { name: "Terima perubahan" })).toBeNull()
  expect(screen.queryByRole("button", { name: "Tolak" })).toBeNull()
})
