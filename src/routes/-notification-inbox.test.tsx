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
const { apiRequest } = vi.hoisted(() => ({ apiRequest: vi.fn() }))
vi.mock("@/lib/api", () => ({ apiRequest }))
import { NotificationInbox } from "./-notification-inbox"
const item = {
  id: 1,
  body: "Jadwal minggu QA dipublikasikan.",
  href: "/scheduling",
  created_at: "2030-01-04T02:00:00Z",
  read_at: null,
}
beforeEach(() => {
  vi.clearAllMocks()
  apiRequest.mockImplementation(async (path: string) =>
    path.endsWith("/read")
      ? { ...item, read_at: "2030-01-04T02:01:00Z" }
      : { notifications: [item], next_before: null }
  )
})
afterEach(cleanup)
it("shows only server-returned inbox and persists explicit read status", async () => {
  render(<NotificationInbox />)
  fireEvent.click(screen.getByRole("button", { name: /Notifikasi/ }))
  await screen.findByText(item.body)
  fireEvent.click(screen.getByRole("button", { name: "Tandai dibaca" }))
  await screen.findByText("Sudah dibaca")
  expect(apiRequest).toHaveBeenCalledWith("/management/notifications/1/read", {
    method: "POST",
  })
  expect(
    screen.getByRole("link", { name: "Lihat jadwal" }).getAttribute("href")
  ).toBe("/scheduling")
})
it("does not mark read when the server rejects and allows retry", async () => {
  apiRequest.mockImplementation(async (path: string) => {
    if (path.endsWith("/read")) throw new Error("Akses berubah")
    return { notifications: [item], next_before: null }
  })
  render(<NotificationInbox />)
  fireEvent.click(screen.getByRole("button", { name: /Notifikasi/ }))
  fireEvent.click(await screen.findByRole("button", { name: "Tandai dibaca" }))
  await screen.findByText("Akses berubah")
  expect(screen.queryByText("Sudah dibaca")).toBeNull()
  expect(
    screen.getByRole("button", { name: "Tandai dibaca" }).matches(":disabled")
  ).toBe(false)
})
it("ignores an obsolete refresh and appends cursor pages without duplicates", async () => {
  let resolve!: (value: unknown) => void
  const old = new Promise((done) => {
    resolve = done
  })
  let calls = 0
  apiRequest.mockImplementation(async (path: string) => {
    calls++
    if (calls === 1) return old
    return path.includes("before=1")
      ? {
          notifications: [item, { ...item, id: 2, body: "Older QA" }],
          next_before: null,
        }
      : { notifications: [item], next_before: 1 }
  })
  render(<NotificationInbox />)
  fireEvent.click(screen.getByRole("button", { name: /Notifikasi/ }))
  await screen.findByText(item.body)
  await act(async () => resolve({ notifications: [], next_before: null }))
  expect(screen.getByText(item.body)).toBeTruthy()
  fireEvent.click(screen.getByRole("button", { name: "Muat lebih lama" }))
  await screen.findByText("Older QA")
  expect(screen.getAllByText(item.body)).toHaveLength(1)
  await waitFor(() =>
    expect(screen.queryByRole("button", { name: "Muat lebih lama" })).toBeNull()
  )
})
