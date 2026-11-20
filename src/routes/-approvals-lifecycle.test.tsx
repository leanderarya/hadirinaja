// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import type { ComponentType, ReactNode } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { apiRequest } from "@/lib/api"
import { Route } from "./approvals"

vi.mock("@tanstack/react-router", () => ({ createFileRoute: () => (options: object) => ({ options }) }))
vi.mock("@/components/management-sidebar", () => ({ ManagementSidebar: () => null, ManagementTopbar: () => null }))
vi.mock("@/components/ui/sidebar", () => ({ SidebarProvider: ({ children }: { children: ReactNode }) => <>{children}</> }))
vi.mock("@/lib/api", async (original) => ({ ...(await original<typeof import("@/lib/api")>()), apiRequest: vi.fn() }))

const Page = Route.options.component as ComponentType
const request = vi.mocked(apiRequest)
const workDate = "2026-11-05"
const item = (id: number) => ({
  id, type: "attendance_correction", status: "approved", employee: { id, name: `Employee ${id}` },
  outlet: { id: 1, name: "Primary" }, requester_user_id: 1, work_date: workDate,
  starts_on: null, ends_on: null, reason: "Completed work", details: {}, classification: "sensitive",
  can_decide: false, eligibility_reason: null,
  decision_history: [{ id, action: "approved", actor_user_id: 1, acted_at: "2026-11-06T00:00:00Z", reason: "Reviewed", original_values: null, proposed_values: null, effective_values: null }],
})
const day = {
  tenant_id: 1, employee: { id: 1, name: "Employee 1" }, work_date: workDate, outlet: null,
  schedule: { status: "unscheduled", scheduled_start: null, scheduled_end: null }, sessions: [],
  actual_duration_seconds: 0, effective_duration_seconds: 28800, approved_leave: null, overtime_requests: [],
  review: { status: "clear", indicators: [], cases: [] }, outcome: "present", conflicts: [], unresolved_conflicts: [],
  is_finalized: false, finalization: null,
}
const evidence = (id: number) => ({ files: [{ id, mime_type: "image/png", size_bytes: 1024, available: true, hold_state: null, expires_at: "2027-11-06T00:00:00Z", decision_id: id }], supplement: null })
let finalized = false
let pendingEvidence: Map<string, (value: unknown) => void>

beforeEach(() => {
  request.mockReset()
  finalized = false
  pendingEvidence = new Map()
  request.mockImplementation(async (path, options) => {
    if (path === "/auth/me") return { active_membership: { roles: ["owner"] } } as never
    if (path === "/management/organization") return { tenant: { id: 1, name: "Synthetic" }, roles: ["owner"], outlets: [] } as never
    if (path === "/management/employees") return { employees: [] } as never
    if (path === "/management/attendance/reviews/discover") return {} as never
    if (path.startsWith("/management/approvals?")) return { pending_count: 0, requests: [item(1), item(2)] } as never
    if (path.startsWith("/management/attendance/effective?")) return { attendance: [{ ...day, is_finalized: finalized, finalization: finalized ? { id: 1, revision: 1, outcome: "present", reason: "Reviewed" } : null }] } as never
    if (path === "/management/attendance/finalizations") { finalized = true; return {} as never }
    if (path.includes("retention")) return { days: 365 } as never
    if (path.startsWith("/correction-evidence/")) return await new Promise<unknown>(resolve => pendingEvidence.set(path, resolve)) as never
    throw new Error(`Unexpected API call: ${options?.method ?? "GET"} ${path}`)
  })
})
afterEach(cleanup)

function expectOnePanel() {
  expect(screen.getAllByRole("heading", { name: "Bukti koreksi" })).toHaveLength(1)
}

describe("Owner correction evidence lifecycle", () => {
  it("keeps one mounted panel when request and decision IDs overlap across updates and finalization", async () => {
    render(<Page />)
    fireEvent.click(await screen.findByRole("button", { name: /Employee 1.*Koreksi presensi/ }))
    await waitFor(() => expect(pendingEvidence.has("/correction-evidence/1")).toBe(true))
    expectOnePanel()
    expect(screen.getByText("Memuat bukti…")).toBeTruthy()
    await act(async () => pendingEvidence.get("/correction-evidence/1")?.(evidence(101)))
    await screen.findByRole("button", { name: "Unduh lampiran #101" })
    const fileInput = screen.getByLabelText("Lampiran opsional")
    for (let n = 0; n < 4; n++) {
      fireEvent.click(screen.getByRole("button", { name: "Retensi bukti koreksi" }))
      expectOnePanel()
      expect(screen.getByLabelText("Lampiran opsional")).toBe(fileInput)
    }
    fireEvent.click(screen.getByText("Rincian dan penetapan hasil", { selector: "summary" }))
    fireEvent.change(screen.getByLabelText("Alasan penetapan hasil"), { target: { value: "Reviewed" } })
    fireEvent.submit(screen.getByLabelText("Alasan penetapan hasil").closest("form")!)
    await waitFor(() => expect(finalized).toBe(true))
    await screen.findByText("Bandingkan riwayat penetapan hasil")
    expectOnePanel()
    expect(screen.getByLabelText("Lampiran opsional")).toBe(fileInput)
    expect(request.mock.calls.filter(([path]) => path === "/correction-evidence/1")).toHaveLength(1)
  })

  it("unmounts the old request, ignores its late evidence, and reloads only the applicable binding", async () => {
    const view = render(<Page />)
    fireEvent.click(await screen.findByRole("button", { name: /Employee 1.*Koreksi presensi/ }))
    await waitFor(() => expect(pendingEvidence.has("/correction-evidence/1")).toBe(true))
    fireEvent.click(screen.getByRole("button", { name: /Employee 2Koreksi presensi/ }))
    await waitFor(() => expect(pendingEvidence.has("/correction-evidence/2")).toBe(true))
    await act(async () => pendingEvidence.get("/correction-evidence/1")?.(evidence(101)))
    expectOnePanel()
    expect(screen.queryByRole("button", { name: "Unduh lampiran #101" })).toBeNull()
    await act(async () => pendingEvidence.get("/correction-evidence/2")?.(evidence(202)))
    await screen.findByRole("button", { name: "Unduh lampiran #202" })
    expectOnePanel()
    view.unmount()
    render(<Page />)
    fireEvent.click(await screen.findByRole("button", { name: /Employee 1.*Koreksi presensi/ }))
    await waitFor(() => expect(request.mock.calls.filter(([path]) => path === "/correction-evidence/1")).toHaveLength(2))
    expectOnePanel()
    expect(screen.queryByRole("button", { name: "Unduh lampiran #202" })).toBeNull()
  })
})
