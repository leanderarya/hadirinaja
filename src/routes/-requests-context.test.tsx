// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import type { ComponentType } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  correctionHref,
  correctionSearch,
  type PersonalCorrectionOptions,
} from "@/lib/attendance-correction-navigation"

const state = vi.hoisted(() => ({
  search: {} as Record<string, unknown>,
  request: vi.fn(),
  navigate: vi.fn(async () => undefined),
  requestRecords: [] as Array<Record<string, unknown>>,
  wide: false,
  postError: null as Error | null,
  postResponse: {} as Record<string, unknown>,
  success: vi.fn(),
  error: vi.fn(),
}))
vi.mock("@/lib/notifications", () => ({ notifications: { success: state.success, error: state.error, confirm: vi.fn(async () => false) } }))
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: { component: ComponentType }) => ({
    options,
    useSearch: () => state.search,
    useNavigate: () => state.navigate,
  }),
}))
vi.mock("@/components/employee-shell", () => ({
  EmployeeShell: ({ children }: { children: React.ReactNode }) => (
    <main>{children}</main>
  ),
}))
vi.mock("@/lib/api", async (original) => ({
  ...(await original<typeof import("@/lib/api")>()),
  apiRequest: state.request,
}))
import { Route } from "./requests"
const RequestsPage = Route.options.component as ComponentType

let options: PersonalCorrectionOptions
beforeEach(() => {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: state.wide,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(() => false),
  })) as typeof window.matchMedia
  state.request.mockReset()
  state.navigate.mockClear()
  state.requestRecords = []
  state.wide = false
  state.postError = null
  state.postResponse = {}
  state.success.mockClear()
  state.error.mockClear()
  state.search = {}
  window.history.replaceState(null, "", "/requests")
  options = {
    tenant_id: 2,
    employee_id: 17,
    evaluated_at: "2026-11-06T01:00:00Z",
    sessions: [
      {
        session_id: 55,
        work_date: "2026-11-05",
        outlet: { id: 3, name: "Outlet asal" },
        correction_type: "missing_checkout",
        can_start: true,
        deadline: {
          exclusive_at: "2026-11-10T17:00:00Z",
          historical_timezone: "Asia/Jakarta",
          owner_required: false,
        },
      },
    ],
    reconstructions: [],
  }
  state.request.mockImplementation(
    async (path: string, requestOptions?: { method?: string }) => {
      if (requestOptions?.method === "POST") {
        if (state.postError) throw state.postError
        return state.postResponse
      }
      if (path === "/auth/me")
        return {
          user: { id: 7, name: "Karyawan QA", email: "fixture@example.test" },
          active_membership: {
            id: 19,
            tenant: { id: 2, name: "Organisasi QA" },
            roles: ["employee"],
          },
          memberships: [],
        }
      if (path === "/attendance/me/requests")
        return {
          requests: state.requestRecords,
          request_access: {
            status: "available",
            linked: true,
            can_submit: true,
          },
          reconstruction_outlets: [{ id: 3, name: "Outlet asal" }],
        }
      if (path.startsWith("/attendance/me/effective?"))
        return {
          correction_options: options,
          attendance: [
            {
              work_date: "2026-11-05",
              outcome: "present",
              sessions: [
                {
                  id: 55,
                  original: {
                    check_in_at: "2026-11-05T01:00:00Z",
                    check_out_at: null,
                    work_date: "2026-11-05",
                    outlet: { id: 3, name: "Outlet asal" },
                    events: [],
                  },
                  outlet: { id: 3, name: "Outlet asal" },
                  effective: {
                    work_date: "2026-11-05",
                    check_in_at: "2026-11-05T01:00:00Z",
                    check_out_at: null,
                    duration_seconds: null,
                    outlet_id: 3,
                  },
                  correction: null,
                },
              ],
              actual_duration_seconds: null,
              effective_duration_seconds: null,
              approved_leave: null,
              overtime_requests: [],
              review: { status: "none", indicators: [], cases: [] },
              unresolved_conflicts: [],
              is_finalized: false,
            },
          ],
        }
      throw new Error(`Unexpected fixture request ${path}`)
    }
  )
})
afterEach(cleanup)

function openContext() {
  state.search = correctionSearch(
    Object.fromEntries(
      new URL(correctionHref(options, options.sessions[0]), "http://localhost")
        .searchParams
    )
  )
  return render(<RequestsPage />)
}

describe("Requests correction context", () => {
  it("opens a reviewable owned draft and submits only the user-entered checkout correction", async () => {
    openContext()
    await screen.findByRole("heading", { name: "Formulir permintaan" })
    expect(screen.getByText("Work Date asal")).toBeTruthy()
    expect(
      screen.getAllByText("Outlet asal", { exact: true }).find((element) => element.tagName === "DD"),
    ).toBeTruthy()
    expect(screen.getByText("Work Date pada opsi")).toBeTruthy()
    expect(screen.getByText("Sesi presensi")).toBeTruthy()
    expect(screen.getByText("Jenis koreksi")).toBeTruthy()
    expect(screen.getByText("Batas pengajuan")).toBeTruthy()
    const deadlineSummary = screen.getByText("Batas pengajuan").parentElement?.textContent ?? ""
    expect(deadlineSummary.match(/Asia\/Jakarta/g)).toHaveLength(1)
    expect(screen.getByText("Presensi keluar terlewat", { exact: true })).toBeTruthy()
    const checkout = screen.getByLabelText<HTMLInputElement>(
      "Waktu keluar efektif"
    )
    expect(checkout.value).toBe("")
    expect(screen.queryByLabelText("Waktu masuk efektif")).toBeNull()
    expect(
      state.request.mock.calls.some(([, request]) => request?.method === "POST")
    ).toBe(false)
    fireEvent.change(checkout, { target: { value: "2026-11-05T17:00" } })
    fireEvent.change(screen.getByLabelText("Alasan"), {
      target: { value: "Presensi keluar terlewat." },
    })
    const form = document.getElementById("employee-request-form")
    if (!form) throw new Error("Correction form is missing")
    fireEvent.submit(form)
    await waitFor(() =>
      expect(
        state.request.mock.calls.some(
          ([, request]) => request?.method === "POST"
        )
      ).toBe(true)
    )
    const submitted = state.request.mock.calls.find(
      ([, request]) => request?.method === "POST"
    )
    expect(state.success).toHaveBeenCalledOnce()
    expect(submitted?.[1].body).toEqual({
      type: "attendance_correction",
      attendance_session_id: 55,
      effective_check_out_at: new Date("2026-11-05T17:00").toISOString(),
      reason: "Presensi keluar terlewat.",
    })
  })
  it.each([
    "foreign",
    "expired",
    "invalid",
  ])("rejects a %s context using freshly loaded personal metadata", async (kind) => {
    state.search = correctionSearch(
      Object.fromEntries(
        new URL(
          correctionHref(options, options.sessions[0]),
          "http://localhost"
        ).searchParams
      )
    )
    if (kind === "foreign") state.search = { ...state.search, tenantId: 99 }
    if (kind === "expired") options.sessions[0].can_start = false
    if (kind === "invalid") state.search = { correction: "invalid" }
    render(<RequestsPage />)
    expect(
      await screen.findByText(/Konteks koreksi tidak tersedia/)
    ).toBeTruthy()
    expect(screen.queryByRole("heading", { name: "Formulir permintaan" })).toBeNull()
    expect(
      state.request.mock.calls.some(([, request]) => request?.method === "POST")
    ).toBe(false)
  })
  it("prefills reconstruction Work Date and Outlet without creating an attendance session", async () => {
    const reconstruction = {
      ...options.sessions[0],
      session_id: undefined,
      correction_type: "reconstruction" as const,
    }
    options.reconstructions = [reconstruction]
    state.search = correctionSearch(
      Object.fromEntries(
        new URL(correctionHref(options, reconstruction), "http://localhost")
          .searchParams
      )
    )
    render(<RequestsPage />)
    await screen.findByRole("heading", { name: "Formulir permintaan" })
    expect(screen.getByText("Work Date", { exact: true })).toBeTruthy()
    expect(screen.getByText("2026-11-05", { exact: true })).toBeTruthy()
    expect(screen.getByText("Outlet", { exact: true })).toBeTruthy()
    expect(
      within(screen.getByText("Outlet").parentElement as HTMLElement).getByText(
        "Outlet asal",
        { exact: true },
      ),
    ).toBeTruthy()
    expect(screen.getByText("Tidak ada sesi tercatat · rekonstruksi")).toBeTruthy()
    expect(
      state.request.mock.calls.some(([, request]) => request?.method === "POST")
    ).toBe(false)
  })

  it("filters flat request rows by backend status and restores focus after detail dismissal", async () => {
    state.requestRecords = [
      {
        id: 81,
        type: "attendance_correction",
        status: "pending",
        work_date: "2026-11-05",
        starts_on: null,
        ends_on: null,
        reason: "Presensi keluar terlewat.",
        outlet: { id: 3, name: "Outlet asal" },
        details: { attendance_session_id: 55 },
        classification: "sensitive",
        correction: {
          original_values: { recorded: { check_in_at: "2026-11-05T01:00:00Z", check_out_at: null } },
          proposed_values: { check_in_at: "2026-11-05T01:00:00Z", check_out_at: "2026-11-05T10:00:00Z" },
        },
        decision_history: [],
      },
      {
        id: 82,
        type: "leave",
        status: "pending",
        work_date: null,
        starts_on: "2026-11-10",
        ends_on: "2026-11-10",
        reason: "Cuti keluarga.",
        outlet: null,
        details: { category: "annual" },
        classification: null,
        decision_history: [],
      },
      {
        id: 83,
        type: "overtime",
        status: "approved",
        work_date: "2026-11-04",
        starts_on: null,
        ends_on: null,
        reason: "Penutupan outlet.",
        outlet: null,
        details: {},
        classification: null,
        decision_history: [],
      },
      {
        id: 84,
        type: "leave",
        status: "rejected",
        work_date: null,
        starts_on: "2026-11-01",
        ends_on: "2026-11-01",
        reason: "Jadwal tidak sesuai.",
        outlet: null,
        details: { category: "permission" },
        classification: null,
        decision_history: [],
      },
    ]
    render(<RequestsPage />)
    await screen.findByRole("heading", { name: "Riwayat permintaan" })

    const list = screen.getByRole("list", { name: "Daftar permintaan" })
    expect(within(list).getAllByRole("button")).toHaveLength(4)
    const leaveRow = within(list).getByRole("button", { name: /Menunggu persetujuan\. Permintaan cuti/ })
    const leaveTitle = within(leaveRow).getByText("Permintaan cuti")
    const leaveStatus = within(leaveRow).getByText("Menunggu persetujuan")
    expect(leaveTitle.parentElement?.className).toContain("flex-wrap")
    expect(leaveTitle.className).toContain("whitespace-normal")
    expect(leaveTitle.className).toContain("break-words")
    expect(leaveTitle.className).toContain("flex-[1_1_8rem]")
    expect(leaveTitle.className).not.toContain("truncate")
    expect(leaveStatus.compareDocumentPosition(leaveTitle) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    const allFilter = screen.getByRole("button", { name: "Semua" })
    allFilter.focus()
    fireEvent.keyDown(allFilter, { key: "ArrowRight", code: "ArrowRight" })
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "Diproses" })))
    fireEvent.click(screen.getByRole("button", { name: "Diproses" }))
    expect(within(screen.getByRole("list", { name: "Daftar permintaan" })).getAllByRole("button")).toHaveLength(2)
    fireEvent.click(screen.getByRole("button", { name: "Selesai" }))
    expect(within(screen.getByRole("list", { name: "Daftar permintaan" })).getAllByRole("button")).toHaveLength(2)
    fireEvent.click(screen.getByRole("button", { name: "Semua" }))

    const row = screen.getByRole("button", { name: /Menunggu persetujuan\. Koreksi presensi/ })
    const outside = screen.getByRole("button", { name: "Ajukan permintaan" })
    fireEvent.click(row)
    const detail = await screen.findByRole("dialog")
    expect(detail.getAttribute("aria-modal")).toBe("true")
    expect(detail.contains(document.activeElement)).toBe(true)
    expect(within(detail).getByText("Outlet asal")).toBeTruthy()
    expect(within(detail).getByText("#55")).toBeTruthy()
    expect(within(detail).getByRole("table", { name: "Nilai asli dan usulan" })).toBeTruthy()
    expect(detail.querySelector("[data-request-detail-scroll='true']")).toBeTruthy()
    expect(state.request.mock.calls.some(([, request]) => request?.method === "POST")).toBe(false)

    outside.focus()
    await waitFor(() => expect(detail.contains(document.activeElement)).toBe(true))
    fireEvent.keyDown(detail, { key: "Escape" })
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
    await waitFor(() => expect(document.activeElement).toBe(row))
  })

  it("uses the right-side detail panel at wider viewports", async () => {
    state.wide = true
    state.requestRecords = [
      {
        id: 85,
        type: "leave",
        status: "pending",
        work_date: null,
        starts_on: "2026-11-10",
        ends_on: "2026-11-10",
        reason: "Izin keluarga.",
        outlet: null,
        details: { category: "permission" },
        classification: null,
        decision_history: [],
      },
    ]
    render(<RequestsPage />)
    await screen.findByRole("heading", { name: "Riwayat permintaan" })
    const row = screen.getByRole("button", { name: /Menunggu persetujuan\. Permintaan izin/ })
    fireEvent.click(row)
    const detail = await screen.findByRole("dialog")
    const panel = document.querySelector('[data-slot="sheet-content"]')
    expect(panel?.getAttribute("data-side")).toBe("right")
    expect(detail.hasAttribute("aria-modal")).toBe(false)
    expect(document.querySelector("main")?.hasAttribute("aria-hidden")).toBe(
      false
    )
    fireEvent.keyDown(detail, { key: "Escape" })
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
    await waitFor(() => expect(document.activeElement).toBe(row))
  })

  it("selects the backend-evaluated session before showing its correction type", async () => {
    render(<RequestsPage />)
    await screen.findByRole("heading", { name: "Riwayat permintaan" })
    fireEvent.click(screen.getByRole("button", { name: "Ajukan permintaan" }))
    fireEvent.click(screen.getByRole("button", { name: "Koreksi sesi presensi" }))
    expect(await screen.findByRole("heading", { name: "Pilih sesi koreksi" })).toBeTruthy()
    const option = screen.getByRole("button", {
      name: /2026-11-05, Outlet asal, sesi 55, Presensi keluar terlewat, dapat dipilih/,
    })
    expect(screen.queryByText("Jenis koreksi yang tersedia:")).toBeNull()
    fireEvent.click(option)
    expect(screen.getByText("Outlet rekaman: Outlet asal")).toBeTruthy()
    expect(screen.getByText(/Jenis koreksi yang tersedia:/)).toBeTruthy()
    expect(screen.getByText(/Batas pengajuan/)).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Lanjutkan" }))
    expect(await screen.findByRole("heading", { name: "Formulir permintaan" })).toBeTruthy()
    expect(screen.getByText("Work Date asal")).toBeTruthy()
    expect(screen.getByText("Sesi presensi")).toBeTruthy()
    expect(state.request.mock.calls.some(([, request]) => request?.method === "POST")).toBe(false)
  })

  it("shows an expired option as unavailable and blocks proceeding", async () => {
    options.evaluated_at = "2026-11-10T17:00:00Z"
    options.sessions[0].deadline.exclusive_at = "2026-11-10T17:00:00Z"
    options.sessions[0].can_start = false
    render(<RequestsPage />)
    await screen.findByRole("heading", { name: "Riwayat permintaan" })
    fireEvent.click(screen.getByRole("button", { name: "Ajukan permintaan" }))
    fireEvent.click(screen.getByRole("button", { name: "Koreksi sesi presensi" }))
    const unavailable = await screen.findByRole("button", { name: /Batas waktu terlewati/ })
    expect((unavailable as HTMLButtonElement).disabled).toBe(true)
    expect(screen.queryByRole("button", { name: "Lanjutkan" })).toBeNull()
    expect(state.request.mock.calls.some(([, request]) => request?.method === "POST")).toBe(false)
  })

  it("replays an uncertain attempt with the same idempotency key and payload", async () => {
    state.postError = new Error("response lost")
    const existingRequest = {
      id: 91,
      type: "attendance_correction",
      status: "pending",
      work_date: "2026-11-05",
      starts_on: null,
      ends_on: null,
      reason: "Presensi keluar terlewat.",
      outlet: { id: 3, name: "Outlet asal" },
      details: { attendance_session_id: 55 },
      classification: "sensitive",
      correction: null,
      decision_history: [],
    }
    state.postResponse = { request: existingRequest }
    openContext()
    await screen.findByRole("heading", { name: "Formulir permintaan" })
    fireEvent.change(screen.getByLabelText("Waktu keluar efektif"), { target: { value: "2026-11-05T17:00" } })
    fireEvent.change(screen.getByLabelText("Alasan"), { target: { value: "Presensi keluar terlewat." } })
    const form = document.getElementById("employee-request-form")
    if (!form) throw new Error("Correction form is missing")
    fireEvent.submit(form)
    const recoveryTitle = await screen.findByText("Status pengajuan belum pasti")
    const recovery = recoveryTitle.closest('[role="alert"]') as HTMLElement
    expect(within(recovery).getByText("Status pengajuan belum pasti")).toBeTruthy()
    expect(within(recovery).getByText(/tidak mengirim ulang otomatis/i)).toBeTruthy()
    expect(state.request.mock.calls.filter(([, request]) => request?.method === "POST")).toHaveLength(1)

    state.postError = null
    fireEvent.click(within(recovery).getByRole("button", { name: "Coba lagi dengan kunci yang sama" }))
    await waitFor(() => expect(state.success).toHaveBeenCalledOnce())
    const posts = state.request.mock.calls.filter(([, request]) => request?.method === "POST")
    expect(posts).toHaveLength(2)
    expect(posts[0][1].headers["Idempotency-Key"]).toBe(posts[1][1].headers["Idempotency-Key"])
    expect(posts[0][1].body).toEqual(posts[1][1].body)
  })
})
