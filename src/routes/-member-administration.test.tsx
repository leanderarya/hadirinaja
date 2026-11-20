// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
const { apiRequest } = vi.hoisted(() => ({ apiRequest: vi.fn() }))
vi.mock("@/lib/api", () => ({ apiRequest, ApiError: class extends Error {} }))
import { MemberAdministration } from "./-member-administration"
const member = {
  id: 2,
  name: "Target",
  email: "target@example.test",
  roles: ["owner"],
  status: "active",
  employee: null,
  outlets: [],
}
const props = {
  member,
  actorId: 1,
  employees: [{ id: 9, name: "Existing profile", access_status: "none" }],
  outlets: [{ id: 3, name: "Karangawen" }],
  onChanged: vi.fn().mockResolvedValue(undefined),
}
beforeEach(() => {
  apiRequest.mockReset()
  props.onChanged.mockClear()
})
afterEach(cleanup)
function confirmation() {
  fireEvent.change(screen.getByLabelText("Alasan perubahan atau penghapusan"), {
    target: { value: "Approved correction" },
  })
  fireEvent.change(screen.getByLabelText("Password Owner Anda"), {
    target: { value: "Owner password" },
  })
}
it("replaces Owner with Employee only after explicit confirmation and preserves selected profile", async () => {
  apiRequest.mockResolvedValue({ updated: true })
  render(<MemberAdministration {...props} />)
  expect(
    (
      screen.getByRole("button", {
        name: "Tinjau perubahan role",
      }) as HTMLButtonElement
    ).disabled
  ).toBe(true)
  fireEvent.change(screen.getByLabelText("Role baru"), {
    target: { value: "employee" },
  })
  fireEvent.change(screen.getByLabelText("Profil karyawan untuk role baru"), {
    target: { value: "9" },
  })
  confirmation()
  fireEvent.click(screen.getByRole("button", { name: "Tinjau perubahan role" }))
  const dialog = await screen.findByRole("alertdialog")
  expect(within(dialog).getByText(/Owner → Karyawan/)).toBeTruthy()
  expect(apiRequest).not.toHaveBeenCalled()
  fireEvent.click(within(dialog).getByRole("button", { name: "Konfirmasi" }))
  await waitFor(() => expect(props.onChanged).toHaveBeenCalledOnce())
  expect(apiRequest).toHaveBeenCalledWith("/management/access/members/2/role", {
    method: "PUT",
    body: {
      role: "employee",
      employee_id: 9,
      reason: "Approved correction",
      password: "Owner password",
      reactivate: false,
    },
  })
  expect(
    (screen.getByLabelText("Password Owner Anda") as HTMLInputElement).value
  ).toBe("")
})
it("requires explicit reactivation for revoked member", () => {
  render(
    <MemberAdministration
      {...props}
      member={{ ...member, status: "revoked" }}
    />
  )
  confirmation()
  expect(
    (
      screen.getByRole("button", {
        name: "Tinjau perubahan role",
      }) as HTMLButtonElement
    ).disabled
  ).toBe(true)
  fireEvent.click(
    screen.getByRole("checkbox", { name: "Aktifkan kembali akses akun ini" })
  )
  expect(
    (
      screen.getByRole("button", {
        name: "Tinjau perubahan role",
      }) as HTMLButtonElement
    ).disabled
  ).toBe(false)
})
it("blocks delete when history is present", async () => {
  apiRequest.mockResolvedValue({
    can_delete: false,
    blockers: { audit: 1 },
    employee_id: null,
    global_login_preserved: true,
  })
  render(<MemberAdministration {...props} />)
  confirmation()
  fireEvent.change(
    screen.getByLabelText("Ketik email untuk konfirmasi hapus"),
    { target: { value: member.email } }
  )
  fireEvent.click(
    screen.getByRole("button", { name: "Periksa kelayakan hapus" })
  )
  await screen.findByText(/Penghapusan ditolak/)
  expect(
    (
      screen.getByRole("button", {
        name: "Tinjau hapus permanen",
      }) as HTMLButtonElement
    ).disabled
  ).toBe(true)
  expect(
    apiRequest.mock.calls.every(([, options]) => options?.method !== "DELETE")
  ).toBe(true)
})
it("deletes selected unused membership/profile only after preview, typed email and confirmation", async () => {
  apiRequest.mockResolvedValue({
    can_delete: true,
    blockers: {},
    employee_id: 9,
    global_login_preserved: true,
  })
  render(<MemberAdministration {...props} />)
  confirmation()
  fireEvent.change(screen.getByLabelText("Profil yang ikut dihapus"), {
    target: { value: "9" },
  })
  fireEvent.click(
    screen.getByRole("button", { name: "Periksa kelayakan hapus" })
  )
  await screen.findByText(/Belum ditemukan riwayat/)
  expect(
    (
      screen.getByRole("button", {
        name: "Tinjau hapus permanen",
      }) as HTMLButtonElement
    ).disabled
  ).toBe(true)
  fireEvent.change(
    screen.getByLabelText("Ketik email untuk konfirmasi hapus"),
    { target: { value: member.email } }
  )
  fireEvent.click(screen.getByRole("button", { name: "Tinjau hapus permanen" }))
  const dialog = await screen.findByRole("alertdialog")
  expect(within(dialog).getByText(/Existing profile juga dihapus/)).toBeTruthy()
  fireEvent.click(within(dialog).getByRole("button", { name: "Konfirmasi" }))
  await waitFor(() =>
    expect(apiRequest).toHaveBeenCalledWith(
      "/management/access/members/2/permanent-deletion",
      {
        method: "DELETE",
        body: {
          reason: "Approved correction",
          password: "Owner password",
          confirmation_email: member.email,
          employee_id: 9,
        },
      }
    )
  )
})
it("cannot administer own membership", () => {
  render(<MemberAdministration {...props} actorId={2} />)
  expect(screen.getByText(/Gunakan Owner aktif lain/)).toBeTruthy()
  expect(screen.queryByRole("button")).toBeNull()
})
it("shows server failures and clears Owner password", async () => {
  apiRequest.mockRejectedValue(new Error("Role ditolak"))
  render(<MemberAdministration {...props} />)
  confirmation()
  fireEvent.click(screen.getByRole("button", { name: "Tinjau perubahan role" }))
  fireEvent.click(
    within(await screen.findByRole("alertdialog")).getByRole("button", {
      name: "Konfirmasi",
    })
  )
  await screen.findByText("Role ditolak")
  expect(props.onChanged).not.toHaveBeenCalled()
  expect(
    (screen.getByLabelText("Password Owner Anda") as HTMLInputElement).value
  ).toBe("")
})
