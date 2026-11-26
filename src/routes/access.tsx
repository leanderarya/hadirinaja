import { MemberAdministration } from "./-member-administration"
import {
  EmailChangeLinkManager,
  type EmailChangeLinkMetadata,
} from "./-email-change-link"
import { Breadcrumb, BreadcrumbList, BreadcrumbItem, BreadcrumbLink, BreadcrumbSeparator, BreadcrumbPage } from "@/components/ui/breadcrumb"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger } from "@/components/ui/dialog"
import { PageHeading, ScopeBanner } from "@/components/r2c/screen-blocks"
import { settingsOrigin } from "@/lib/settings-navigation"
import { createFileRoute } from "@tanstack/react-router"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import { ManagementSidebar, ManagementTopbar } from "@/components/management-sidebar"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { Spinner } from "@/components/ui/spinner"
import { SidebarProvider } from "@/components/ui/sidebar"
import { ApiError, type AuthSession, apiRequest } from "@/lib/api"
import { invitationLink } from "@/lib/invitation-link"

type AccessRole = "employee" | "supervisor"
type AccessStatus =
  | "active"
  | "deactivated"
  | "revoked"
  | "pending"
  | "expired"
  | "accepted"
  | "none"

type AccessMember = {
  id: number
  name: string
  email: string
  roles: Array<"owner" | "supervisor" | "employee">
  status: "active" | "deactivated" | "revoked"
  employee: { id: number; name: string } | null
  outlets: Array<{ id: number; name: string }>
  email_change_link: EmailChangeLinkMetadata
}

type AccessInvitation = {
  id: number
  email: string
  role: AccessRole
  status: AccessStatus
  employee: { id: number; name: string } | null
  outlets: Array<{ id: number; name: string }>
  invited_by: string | null
  expires_at: string
}

type AccessEmployee = {
  id: number
  name: string
  access_status: AccessStatus
}

type AccessOutlet = {
  id: number
  name: string
  business_unit_name: string | null
}

type AccessData = {
  session: AuthSession
  members: AccessMember[]
  invitations: AccessInvitation[]
  employees: AccessEmployee[]
  outlets: AccessOutlet[]
}

type ConfirmationAction =
  | {
      type: "deactivate" | "reactivate" | "revoke" | "unlink"
      member: AccessMember
    }
  | { type: "cancel" | "reissue"; invitation: AccessInvitation; email?: string }

export const Route = createFileRoute("/access")({
  validateSearch: (search: Record<string, unknown>) => {
    const employeeId = Number(search.employeeId)
    return {
      ...settingsOrigin(search),
      employeeId:
        Number.isSafeInteger(employeeId) && employeeId > 0
          ? employeeId
          : undefined,
    }
  },
  component: AccessManagementPage,
})

function AccessManagementPage() {
  const settingsContext = Route.useSearch().from === "settings"
  const { employeeId: initialEmployeeId } = Route.useSearch()
  const [inviteOpen, setInviteOpen] = useState(Boolean(initialEmployeeId))
  const [data, setData] = useState<AccessData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")
  const [operation, setOperation] = useState("")
  const [role, setRole] = useState<AccessRole>("employee")
  const [email, setEmail] = useState("")
  const [invitationEmails, setInvitationEmails] = useState<Record<number, string>>({})
  const [invitationDialogId, setInvitationDialogId] = useState<number | null>(null)
  const [employeeId, setEmployeeId] = useState(
    initialEmployeeId ? String(initialEmployeeId) : ""
  )
  const [outletIds, setOutletIds] = useState<number[]>([])
  const [selectedEmployees, setSelectedEmployees] = useState<
    Record<number, string>
  >({})
  const [memberOutletIds, setMemberOutletIds] = useState<
    Record<number, number[]>
  >({})
  const [activationToken, setActivationToken] = useState<string | null>(null)
  const [confirmation, setConfirmation] = useState<ConfirmationAction | null>(
    null
  )
  const activationLink =
    activationToken && typeof window !== "undefined"
      ? invitationLink(window.location.origin, activationToken)
      : null

  const accessTenant = useRef<number | null>(null)
  const refresh = useCallback(async (afterSave = false) => {
    setError("")

    try {
      const session = await apiRequest<AuthSession>("/auth/me")
      if (!session.active_membership) {
        setData(null)
        setActivationToken(null)
        window.location.assign("/select-tenant")
        return
      }
      if (
        !session.active_membership.roles.includes("owner") &&
        !session.active_membership.roles.includes("supervisor")
      ) {
        setData(null)
        setActivationToken(null)
        setError("Pengelolaan tautan email hanya tersedia untuk Owner atau Supervisor.")
        return
      }
      if (accessTenant.current !== null && accessTenant.current !== session.active_membership.tenant.id) {
        setData(null)
        setActivationToken(null)
        setInviteOpen(false)
        setEmployeeId("")
        setOutletIds([])
        setSelectedEmployees({})
        setInvitationEmails({})
        setInvitationDialogId(null)
        setConfirmation(null)
      }
      accessTenant.current = session.active_membership.tenant.id
      const access = await apiRequest<Omit<AccessData, "session">>("/management/access")
      setData({ ...access, session })
      setMemberOutletIds(
        Object.fromEntries(
          access.members
            .filter((member) => member.roles.includes("supervisor"))
            .map((member) => [
              member.id,
              member.outlets.map((outlet) => outlet.id),
            ])
        )
      )
    } catch (caught) {
      if (
        caught instanceof ApiError &&
        (caught.status === 401 || caught.status === 419)
      ) {
        window.location.assign("/login?expired=1")
        return
      }
      setError(afterSave ? "Perubahan tersimpan; data terbaru belum dapat dimuat. Muat ulang data tanpa mengulangi tindakan." : caught instanceof ApiError ? caught.message : "Data akses belum dapat dimuat.")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const selectedEmployee = useMemo(
    () =>
      data?.employees.find((employee) => String(employee.id) === employeeId),
    [data?.employees, employeeId]
  )

  async function createInvitation(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError("")
    setNotice("")
    if (!data) return

    if (role === "employee") {
      if (!employeeId || !selectedEmployee) {
        setError("Pilih data karyawan yang tersedia untuk organisasi ini.")
        return
      }
      if (
        selectedEmployee &&
        !canInviteEmployee(selectedEmployee.access_status)
      ) {
        setError(
          "Karyawan ini sudah memiliki akses atau undangan yang masih berlaku."
        )
        return
      }
    }
    if (role === "supervisor" && outletIds.length === 0) {
      setError("Pilih setidaknya satu Outlet untuk Supervisor.")
      document.getElementById(`invite-outlet-${data.outlets[0]?.id}`)?.focus()
      return
    }

    setOperation("create-invitation")
    try {
      const result = await apiRequest<{ activation_token: string }>(
        "/management/access/invitations",
        {
          method: "POST",
          body:
            role === "employee"
              ? { email, role, employee_id: Number(employeeId) }
              : { email, role, outlet_ids: outletIds },
        }
      )
      setInviteOpen(false)
      setActivationToken(result.activation_token)
      setNotice("Undangan dibuat. Tautan aktivasi hanya ditampilkan satu kali.")
      await refresh(true)
    } catch (caught) {
      setError(errorMessage(caught, "Undangan tidak dapat dibuat."))
    } finally {
      setOperation("")
    }
  }

  async function copyActivationLink() {
    if (!activationLink) return
    try {
      await navigator.clipboard.writeText(activationLink)
      setNotice("Tautan aktivasi disalin. Bagikan melalui kanal tepercaya.")
    } catch {
      setNotice("Salin tautan yang terlihat di bawah secara manual.")
    }
  }

  function askToConfirm(action: ConfirmationAction) {
    setError("")
    setConfirmation(action)
  }

  async function runConfirmedAction() {
    const action = confirmation
    if (!action) return
    setConfirmation(null)
    setOperation(
      `${action.type}-${"member" in action ? action.member.id : action.invitation.id}`
    )
    setError("")
    setNotice("")
    try {
      if ("member" in action) {
        if (action.type === "deactivate" || action.type === "reactivate") {
          await apiRequest(`/management/access/members/${action.member.id}`, {
            method: "PATCH",
            body: { is_active: action.type === "reactivate" },
          })
        } else if (action.type === "revoke") {
          await apiRequest(`/management/access/members/${action.member.id}`, {
            method: "DELETE",
          })
        } else {
          await apiRequest(
            `/management/access/members/${action.member.id}/employee-link`,
            { method: "DELETE" }
          )
        }
      } else if (action.type === "cancel") {
        await apiRequest(
          `/management/access/invitations/${action.invitation.id}/cancel`,
          { method: "POST" }
        )
      } else {
        const result = await apiRequest<{ activation_token: string }>(
          `/management/access/invitations/${action.invitation.id}/reissue`,
          {
            method: "POST",
            ...(action.email ? { body: { email: action.email } } : {}),
          }
        )
        setActivationToken(result.activation_token)
      }
      if (!("member" in action)) setInvitationDialogId(null)
      setNotice(actionNotice(action))
      await refresh(true)
    } catch (caught) {
      setError(errorMessage(caught, "Perubahan akses tidak dapat disimpan."))
    } finally {
      setOperation("")
    }
  }

  async function saveSupervisorScope(member: AccessMember) {
    const selected = memberOutletIds[member.id] ?? []
    if (selected.length === 0) {
      setError("Supervisor harus memiliki setidaknya satu Outlet yang dipilih.")
      document.getElementById(`member-${member.id}-outlet-${data?.outlets[0]?.id}`)?.focus()
      return
    }
    setOperation(`scope-${member.id}`)
    setError("")
    setNotice("")
    try {
      await apiRequest(`/management/access/members/${member.id}/outlet-scope`, {
        method: "PUT",
        body: { outlet_ids: selected },
      })
      setNotice(`Akses Outlet untuk ${member.name} diperbarui.`)
      await refresh(true)
    } catch (caught) {
      setError(errorMessage(caught, "Akses Outlet tidak dapat diperbarui."))
    } finally {
      setOperation("")
    }
  }

  async function linkMemberEmployee(member: AccessMember) {
    const selected = selectedEmployees[member.id]
    if (!selected) {
      setError(`Pilih identitas karyawan untuk ${member.name}.`)
      return
    }
    setOperation(`employee-link-${member.id}`)
    setError("")
    setNotice("")
    try {
      await apiRequest(
        `/management/access/members/${member.id}/employee-link`,
        {
          method: "POST",
          body: { employee_id: Number(selected) },
        }
      )
      setNotice(`Identitas karyawan ${member.name} berhasil ditautkan.`)
      await refresh(true)
    } catch (caught) {
      setError(
        errorMessage(caught, "Identitas karyawan tidak dapat ditautkan.")
      )
    } finally {
      setOperation("")
    }
  }

  function toggleNewOutlet(id: number, checked: boolean) {
    setOutletIds((current) =>
      checked
        ? [...new Set([...current, id])]
        : current.filter((item) => item !== id)
    )
  }

  function toggleMemberOutlet(memberId: number, id: number, checked: boolean) {
    setMemberOutletIds((current) => {
      const values = current[memberId] ?? []
      return {
        ...current,
        [memberId]: checked
          ? [...new Set([...values, id])]
          : values.filter((item) => item !== id),
      }
    })
  }

  if (loading) {
    return (
      <main className="flex min-h-svh items-center justify-center gap-3 text-body text-muted-foreground">
        <Spinner />
        Memuat pengelolaan akses…
      </main>
    )
  }

  if (!data) return <main className="flex min-h-svh flex-col gap-4 bg-canvas p-4"><h1 className="text-title">Akses tidak tersedia</h1><Alert variant="destructive"><AlertTitle>Pengelolaan akses belum dapat dibuka</AlertTitle><AlertDescription>{error || "Owner atau Supervisor organisasi diperlukan."}</AlertDescription></Alert><Button variant="outline" render={<a href={settingsContext ? "/settings" : "/workspace"} />}>{settingsContext ? "Kembali ke Pengaturan" : "Kembali ke ruang kerja"}</Button></main>

  const isOwner = data.session.active_membership?.roles.includes("owner") === true
  const actorMembershipId = data.session.active_membership?.id
  const visibleMembers = isOwner
    ? data.members
    : data.members.filter(
        (member) =>
          member.roles.includes("employee") &&
          !member.roles.includes("owner") &&
          !member.roles.includes("supervisor")
      )
  const navigationContext = data ? { tenantName: data.session.active_membership?.tenant.name ?? "Organisasi", roles: data.session.active_membership?.roles ?? [], userName: data.session.user.name } : null

  return (
    <SidebarProvider className="pb-[calc(6rem+env(safe-area-inset-bottom))] md:pb-0">
      <ManagementSidebar activePage="access" context={navigationContext} />
      <main className="owner-access-page min-h-svh min-w-0 flex-1 bg-canvas">
        <ManagementTopbar context={navigationContext} />
      <div className="b2-access flex w-full flex-col gap-6 p-4 md:p-6">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex flex-col gap-2">
            <Button
              className="w-fit"
              render={<a href={settingsContext ? "/settings" : "/workspace"} />}
              variant="ghost"
            >
              {settingsContext ? "← Kembali ke Pengaturan" : "← Kembali ke ruang kerja"}
            </Button>
            {settingsContext ? <Breadcrumb className="hidden md:block"><BreadcrumbList><BreadcrumbItem><BreadcrumbLink href="/settings">Pengaturan</BreadcrumbLink></BreadcrumbItem><BreadcrumbSeparator /><BreadcrumbItem><BreadcrumbPage>Akses pengguna</BreadcrumbPage></BreadcrumbItem></BreadcrumbList></Breadcrumb> : null}
            <PageHeading title="Akses pengguna" description={isOwner ? "Akun pengguna, undangan, dan akses ke Outlet di organisasi." : "Tautan ubah email untuk karyawan pada Outlet yang dapat Anda akses."} />
          </div>
          <Button
            disabled={Boolean(operation)}
            onClick={() => void refresh()}
            variant="outline"
          >
            {operation ? <Spinner data-icon="inline-start" /> : null}
            Perbarui data
          </Button>
        </header>

        <ScopeBanner title={isOwner ? "Owner · organisasi aktif" : "Supervisor · Outlet dalam cakupan"}>{isOwner ? "Profil karyawan terpisah dari akun pengguna. Tautan aktivasi dibagikan secara manual." : "Daftar hanya memuat karyawan pada Outlet yang dapat Anda akses. Tautan ubah email berlaku 24 jam dan hanya dapat digunakan sekali."}</ScopeBanner>

        {error ? (
          <Alert variant="destructive">
            <AlertTitle>Pengelolaan akses belum selesai</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        {notice ? (
          <Alert>
            <AlertTitle>Status akses</AlertTitle>
            <AlertDescription>{notice}</AlertDescription>
          </Alert>
        ) : null}

        {isOwner && activationToken ? (
          <Card className="border-primary/40">
            <CardHeader>
              <CardTitle>Tautan aktivasi satu kali</CardTitle>
              <CardDescription>
                Salin dan kirim sendiri melalui kanal tepercaya. Setelah
                disembunyikan atau halaman ditutup, tautan ini tidak dapat
                ditampilkan kembali.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <code className="break-all rounded-xl bg-muted px-3 py-2 text-caption">
                {activationLink ?? "Buka aplikasi melalui HTTPS untuk menyalin tautan aktivasi."}
              </code>
              <div className="flex flex-wrap gap-2">
                <Button disabled={!activationLink} onClick={() => void copyActivationLink()} type="button">
                  Salin tautan
                </Button>
                <Button
                  onClick={() => setActivationToken(null)}
                  type="button"
                  variant="outline"
                >
                  Sembunyikan tautan
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : null}

        <section className="b2-access-grid grid items-start gap-6 lg:grid-cols-2">


          <Card>
            <CardHeader>
              <CardTitle>{isOwner ? "Anggota organisasi" : "Karyawan dalam cakupan Outlet"}</CardTitle>
              <CardDescription>
                {isOwner
                  ? "Perubahan status dan akses berlaku saat anggota melakukan tindakan berikutnya."
                  : "Tautan hanya dapat diterbitkan untuk akun karyawan yang aktif dalam cakupan Anda."}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {visibleMembers.length ? (
                <ul className="flex flex-col gap-3">
                  {visibleMembers.map((member) => (
                    <li
                      className="rounded-2xl border bg-background p-4"
                      key={member.id}
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="flex min-w-0 flex-col gap-1">
                          <p className="text-label">{member.name}</p>
                          <p className="break-all text-caption text-muted-foreground">
                            {member.email}
                          </p>
                          <p className="text-caption text-muted-foreground">
                            {member.roles.map(roleLabel).join(" · ") ||
                              "Tidak ada peran aktif"}
                          </p>
                        </div>
                        <StatusBadge status={member.status} />
                      </div>

                      <Dialog>
                        <DialogTrigger render={<Button className="mt-3 h-auto min-h-11 max-w-full whitespace-normal text-start" variant="outline" />}>{isOwner ? `Lihat akses ${member.name}` : `Ubah email ${member.name}`}</DialogTrigger>
                        <DialogContent className="w-[calc(100%-2rem)] max-w-[480px] max-h-[calc(100dvh-2rem)] overflow-y-auto p-4 md:p-8 sm:max-w-[480px]">
                          <DialogHeader><DialogTitle>{member.name}</DialogTitle><DialogDescription>{member.email} · {member.roles.map(roleLabel).join(" · ")} · {statusLabel(member.status)}</DialogDescription></DialogHeader>
                          {isOwner ? (
                            <MemberAdministration member={member} actorId={actorMembershipId} emailChangeLink={member.email_change_link ?? null} employees={data.employees} outlets={data.outlets} onChanged={() => refresh(true)} />
                          ) : member.status === "active" ? (
                            <EmailChangeLinkManager
                              membership={member.id}
                              memberName={member.name}
                              emailChangeLink={member.email_change_link ?? null}
                              actorMembershipId={actorMembershipId}
                              isOwner={false}
                              onChanged={() => refresh(true)}
                            />
                          ) : (
                            <Alert>
                              <AlertDescription>
                                Hanya akun aktif yang dapat menerima tautan ubah email.
                              </AlertDescription>
                            </Alert>
                          )}
                          {error ? <Alert variant="destructive"><AlertTitle>Periksa status perubahan</AlertTitle><AlertDescription>{error}</AlertDescription></Alert> : null}
                          {notice ? <Alert><AlertDescription>{notice}</AlertDescription></Alert> : null}
                      {isOwner && member.employee ? (
                        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-muted/40 px-3 py-2">
                          <p className="text-caption">
                            Identitas karyawan: {member.employee.name}
                          </p>
                          {member.status === "active" ? (
                            <Button
                              disabled={Boolean(operation)}
                              onClick={() =>
                                askToConfirm({ type: "unlink", member })
                              }
                              size="sm"
                              type="button"
                              variant="outline"
                            >
                              Lepas tautan
                            </Button>
                          ) : null}
                        </div>
                      ) : isOwner && member.status === "active" &&
                        member.roles.length > 0 ? (
                        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                          <NativeSelect
                            aria-label={`Identitas karyawan untuk ${member.name}`}
                            className="w-full sm:flex-1"
                            onChange={(event) =>
                              setSelectedEmployees((current) => ({
                                ...current,
                                [member.id]: event.target.value,
                              }))
                            }
                            value={selectedEmployees[member.id] ?? ""}
                          >
                            <NativeSelectOption value="">
                              Pilih identitas karyawan
                            </NativeSelectOption>
                            {data.employees.map((employee) => (
                              <NativeSelectOption
                                disabled={
                                  !canInviteEmployee(employee.access_status)
                                }
                                key={employee.id}
                                value={employee.id}
                              >
                                {employee.name} ·{" "}
                                {statusLabel(employee.access_status)}
                              </NativeSelectOption>
                            ))}
                          </NativeSelect>
                          <Button
                            disabled={
                              Boolean(operation) ||
                              !selectedEmployees[member.id]
                            }
                            onClick={() => void linkMemberEmployee(member)}
                            size="sm"
                            type="button"
                            variant="outline"
                          >
                            Tautkan sebagai karyawan
                          </Button>
                        </div>
                      ) : null}

                      {isOwner && member.roles.includes("supervisor") &&
                      member.status !== "revoked" ? (
                        <form
                          className="mt-3 flex flex-col gap-3 rounded-xl border p-3"
                          onSubmit={(event) => {
                            event.preventDefault()
                            void saveSupervisorScope(member)
                          }}
                        >
                          <FieldSet>
                            <FieldLegend variant="label">
                              Outlet Supervisor
                            </FieldLegend>
                            {data.outlets.map((outlet) => (
                              <Field key={outlet.id} orientation="horizontal">
                                <Checkbox
                                  checked={(
                                    memberOutletIds[member.id] ?? []
                                  ).includes(outlet.id)}
                                  id={`member-${member.id}-outlet-${outlet.id}`}
                                  onCheckedChange={(checked) =>
                                    toggleMemberOutlet(
                                      member.id,
                                      outlet.id,
                                      Boolean(checked)
                                    )
                                  }
                                />
                                <FieldLabel
                                  htmlFor={`member-${member.id}-outlet-${outlet.id}`}
                                >
                                  {outlet.name}
                                  {outlet.business_unit_name
                                    ? ` · ${outlet.business_unit_name}`
                                    : ""}
                                </FieldLabel>
                              </Field>
                            ))}
                          </FieldSet>
                          <Button
                            disabled={Boolean(operation)}
                            size="sm"
                            type="submit"
                            variant="outline"
                          >
                            {operation === `scope-${member.id}` ? (
                              <Spinner data-icon="inline-start" />
                            ) : null}
                            Simpan akses Outlet
                          </Button>
                        </form>
                      ) : null}

                      {isOwner && member.status !== "revoked" &&
                      member.id !== data.session.active_membership?.id ? (
                        <div className="mt-3 flex flex-wrap gap-2">
                          {member.status === "active" ? (
                            <Button
                              disabled={Boolean(operation)}
                              onClick={() =>
                                askToConfirm({ type: "deactivate", member })
                              }
                              size="sm"
                              type="button"
                              variant="outline"
                            >
                              Nonaktifkan
                            </Button>
                          ) : (
                            <Button
                              disabled={Boolean(operation)}
                              onClick={() =>
                                askToConfirm({ type: "reactivate", member })
                              }
                              size="sm"
                              type="button"
                              variant="outline"
                            >
                              Aktifkan kembali
                            </Button>
                          )}
                          <Button
                            disabled={Boolean(operation)}
                            onClick={() =>
                              askToConfirm({ type: "revoke", member })
                            }
                            size="sm"
                            type="button"
                            variant="destructive-outline"
                          >
                            Cabut akses organisasi
                          </Button>
                        </div>
                      ) : null}
                        </DialogContent>
                      </Dialog>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-body text-muted-foreground">
                  Belum ada anggota organisasi.
                </p>
              )}
        {isOwner ? <Dialog open={inviteOpen} onOpenChange={open => { if (!operation) setInviteOpen(open) }}>
          <DialogTrigger render={<Button className="w-fit" variant="outline" />}>Undang pengguna</DialogTrigger>
          <DialogContent className="w-[calc(100%-2rem)] max-w-[480px] max-h-[calc(100dvh-2rem)] overflow-y-auto p-4 md:p-8 sm:max-w-[480px]">
          <div id="invite" className="flex flex-col gap-4">
            <DialogHeader>
              <DialogTitle>Buat undangan akses</DialogTitle>
              <DialogDescription>
                Tautan dibuat sekali dan tidak dikirim melalui email oleh
                aplikasi.
              </DialogDescription>
            </DialogHeader>
            <CardContent>
              <form className="flex flex-col gap-5" onSubmit={createInvitation}>
                <FieldGroup className="gap-4">
                  <Field>
                    <FieldLabel htmlFor="invite-role">Peran akses</FieldLabel>
                    <NativeSelect
                      id="invite-role"
                      onChange={(event) =>
                        setRole(event.target.value as AccessRole)
                      }
                      value={role}
                    >
                      <NativeSelectOption value="employee">
                        Karyawan
                      </NativeSelectOption>
                      <NativeSelectOption value="supervisor">
                        Supervisor
                      </NativeSelectOption>
                    </NativeSelect>
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="invite-email">
                      Email akun penerima
                    </FieldLabel>
                    <Input
                      autoComplete="email"
                      id="invite-email"
                      maxLength={255}
                      onChange={(event) => setEmail(event.target.value)}
                      placeholder="nama@contoh.id"
                      required
                      type="email"
                      value={email}
                    />
                    <FieldDescription>
                      Email hanya digunakan untuk mengikat undangan ke identitas
                      login yang tepat.
                    </FieldDescription>
                  </Field>
                  {role === "employee" ? (
                    <Field>
                      <FieldLabel htmlFor="invite-employee">
                        Identitas karyawan
                      </FieldLabel>
                      <NativeSelect
                        id="invite-employee"
                        onChange={(event) => setEmployeeId(event.target.value)}
                        required
                        value={employeeId}
                      >
                        <NativeSelectOption value="">
                          Pilih karyawan
                        </NativeSelectOption>
                        {data?.employees.map((employee) => (
                          <NativeSelectOption
                            disabled={
                              !canInviteEmployee(employee.access_status)
                            }
                            key={employee.id}
                            value={employee.id}
                          >
                            {employee.name} ·{" "}
                            {statusLabel(employee.access_status)}
                          </NativeSelectOption>
                        ))}
                      </NativeSelect>
                      {initialEmployeeId && employeeId === String(initialEmployeeId) && (!selectedEmployee || !canInviteEmployee(selectedEmployee.access_status)) ? (
                        <FieldDescription role="alert">
                          Profil dari tautan tidak tersedia atau sudah memiliki akses. Pilih profil yang memenuhi syarat.
                        </FieldDescription>
                      ) : null}
                      {selectedEmployee ? (
                        <FieldDescription>
                          Status akses saat ini:{" "}
                          {statusLabel(selectedEmployee.access_status)}.
                        </FieldDescription>
                      ) : null}
                    </Field>
                  ) : (
                    <FieldSet>
                      <FieldLegend variant="label">
                        Outlet yang dapat diakses Supervisor
                      </FieldLegend>
                      <FieldDescription>
                        Pilih Outlet secara eksplisit. Outlet baru tidak akan
                        ditambahkan otomatis.
                      </FieldDescription>
                      {data?.outlets.map((outlet) => (
                        <Field key={outlet.id} orientation="horizontal">
                          <Checkbox
                            checked={outletIds.includes(outlet.id)}
                            id={`invite-outlet-${outlet.id}`}
                            onCheckedChange={(checked) =>
                              toggleNewOutlet(outlet.id, Boolean(checked))
                            }
                          />
                          <FieldLabel htmlFor={`invite-outlet-${outlet.id}`}>
                            {outlet.name}
                            {outlet.business_unit_name
                              ? ` · ${outlet.business_unit_name}`
                              : ""}
                          </FieldLabel>
                        </Field>
                      ))}
                    </FieldSet>
                  )}
                </FieldGroup>
                <Button disabled={Boolean(operation)} type="submit">
                  {operation === "create-invitation" ? (
                    <Spinner data-icon="inline-start" />
                  ) : null}
                  Buat undangan
                </Button>
              </form>
            </CardContent>
          </div>
            {error ? <Alert variant="destructive"><AlertTitle>Undangan belum tersimpan</AlertTitle><AlertDescription>{error}</AlertDescription></Alert> : null}
            <Button variant="outline" disabled={Boolean(operation)} onClick={() => setInviteOpen(false)}>Batal</Button>
          </DialogContent>
        </Dialog>
        : null}
            </CardContent>
          </Card>
          {isOwner ? <details className="lg:col-span-2 order-last rounded-[16px] border border-border bg-surface p-4">
            <summary className="cursor-pointer text-label">Lihat status akses karyawan</summary>
          <Card>
            <CardHeader>
              <CardTitle>Status akses karyawan</CardTitle>
              <CardDescription>
                Pilih tindakan untuk mengisi formulir undangan.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {data?.employees.length ? (
                <ul className="flex flex-col gap-2">
                  {data.employees.map((employee) => (
                    <li
                      className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-muted/30 px-3 py-2"
                      key={employee.id}
                    >
                      <div>
                        <p className="text-label">{employee.name}</p>
                        <p className="text-caption text-muted-foreground">
                          ID {employee.id}
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <StatusBadge status={employee.access_status} />
                        {canInviteEmployee(employee.access_status) ? (
                          <Button
                            onClick={() => {
                              setRole("employee")
                              setEmployeeId(String(employee.id))
                              setInviteOpen(true)
                              document
                                .getElementById("invite-email")
                                ?.focus({ preventScroll: true })
                            }}
                            size="sm"
                            type="button"
                            variant="outline"
                          >
                            Undang karyawan
                          </Button>
                        ) : null}
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-body text-muted-foreground">
                  Belum ada data karyawan.
                </p>
              )}
            </CardContent>
          </Card>

          </details>
          : null}
          {isOwner ? <Card>
            <CardHeader>
              <CardTitle>Undangan</CardTitle>
              <CardDescription>
                Tautan aktivasi tidak ditampilkan di daftar. Tautan baru hanya
                muncul sekali setelah undangan dibuat atau diterbitkan ulang.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {data?.invitations.length ? (
                <ul className="flex flex-col gap-3">
                  {data.invitations.map((invitation) => (
                    <li
                      className="rounded-2xl border bg-background p-4"
                      key={invitation.id}
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <p className="text-label">{invitation.email}</p>
                          <p className="text-caption text-muted-foreground">
                            {roleLabel(invitation.role)}
                            {invitation.employee
                              ? ` · ${invitation.employee.name}`
                              : ""}
                          </p>
                          {invitation.outlets.length ? (
                            <p className="mt-1 text-caption text-muted-foreground">
                              Outlet:{" "}
                              {invitation.outlets
                                .map((outlet) => outlet.name)
                                .join(", ")}
                            </p>
                          ) : null}
                        </div>
                        <StatusBadge status={invitation.status} />
                      </div>
                      <Dialog
                        open={invitationDialogId === invitation.id}
                        onOpenChange={(open) => {
                          if (!operation) setInvitationDialogId(open ? invitation.id : null)
                        }}
                      >
                        <DialogTrigger render={<Button className="mt-3 h-auto min-h-11 max-w-full whitespace-normal text-start" variant="outline" />}>Lihat undangan {invitation.email}</DialogTrigger>
                        <DialogContent className="w-[calc(100%-2rem)] max-w-[480px] max-h-[calc(100dvh-2rem)] overflow-y-auto p-4 md:p-8 sm:max-w-[480px]">
                          <DialogHeader><DialogTitle>Detail undangan</DialogTitle><DialogDescription>{invitation.email} · {statusLabel(invitation.status)}</DialogDescription></DialogHeader>
                      <p className="mt-2 text-caption text-muted-foreground">
                        Diundang oleh {invitation.invited_by ?? "Owner"} ·
                        berlaku sampai {formatDate(invitation.expires_at)}
                      </p>
                      {invitation.role === "employee" && (invitation.status === "pending" || invitation.status === "expired") ? (
                        <form
                          className="flex flex-col gap-3"
                          onSubmit={(event) => {
                            event.preventDefault()
                            askToConfirm({
                              type: "reissue",
                              invitation,
                              email: invitationEmails[invitation.id] ?? invitation.email,
                            })
                          }}
                        >
                          <FieldGroup>
                            <Field>
                              <FieldLabel htmlFor={`invitation-email-${invitation.id}`}>Email login karyawan</FieldLabel>
                              <Input
                                id={`invitation-email-${invitation.id}`}
                                type="email"
                                required
                                maxLength={255}
                                disabled={Boolean(operation)}
                                value={invitationEmails[invitation.id] ?? invitation.email}
                                onChange={(event) => setInvitationEmails((current) => ({
                                  ...current,
                                  [invitation.id]: event.target.value,
                                }))}
                              />
                              <FieldDescription>Email dapat dikoreksi sebelum aktivasi. Tautan lama akan berhenti berlaku; profil dan riwayat karyawan tetap disimpan.</FieldDescription>
                            </Field>
                          </FieldGroup>
                          <Button type="submit" variant="outline" disabled={Boolean(operation)}>Simpan email & buat tautan baru</Button>
                        </form>
                      ) : null}
                      {invitation.status === "pending" ? (
                        <Button
                          className="mt-3"
                          disabled={Boolean(operation)}
                          onClick={() =>
                            askToConfirm({ type: "cancel", invitation })
                          }
                          size="sm"
                          type="button"
                          variant="outline"
                        >
                          Batalkan undangan
                        </Button>
                      ) : null}
                      {(invitation.status === "pending" || invitation.status === "expired") && invitation.role !== "employee" ? (
                        <Button
                          className="mt-3"
                          disabled={Boolean(operation)}
                          onClick={() =>
                            askToConfirm({ type: "reissue", invitation })
                          }
                          size="sm"
                          type="button"
                          variant="outline"
                        >
                          Buat tautan baru
                        </Button>
                      ) : null}
                        </DialogContent>
                      </Dialog>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-body text-muted-foreground">
                  Belum ada undangan.
                </p>
              )}
            </CardContent>
          </Card>
          : null}
        </section>
      </div>

      <AlertDialog
        open={confirmation !== null}
        onOpenChange={(open) => !open && setConfirmation(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirmationTitle(confirmation)}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirmationDescription(confirmation)}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={Boolean(operation)}>
              Batal
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={Boolean(operation)}
              onClick={() => void runConfirmedAction()}
              type="button"
            >
              {operation ? <Spinner data-icon="inline-start" /> : null}
              Lanjutkan
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      </main>
    </SidebarProvider>
  )
}

function canInviteEmployee(status: AccessStatus): boolean {
  return status === "none" || status === "expired" || status === "revoked"
}

function roleLabel(
  role: AccessRole | "owner" | "employee" | "supervisor"
): string {
  return { owner: "Owner", supervisor: "Supervisor", employee: "Karyawan" }[
    role
  ]
}

function statusLabel(status: AccessStatus): string {
  return {
    active: "Aktif",
    deactivated: "Nonaktif",
    revoked: "Dicabut",
    pending: "Menunggu aktivasi",
    expired: "Kedaluwarsa",
    accepted: "Diterima",
    none: "Belum ada akses",
  }[status]
}

function StatusBadge({ status }: { status: AccessStatus }) {
  const variant =
    status === "active" || status === "pending" || status === "accepted"
      ? "default"
      : status === "revoked"
        ? "destructive"
        : "secondary"
  return <Badge variant={variant}>{statusLabel(status)}</Badge>
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback
}

function actionNotice(action: ConfirmationAction): string {
  if ("member" in action) {
    if (action.type === "deactivate")
      return `Akses ${action.member.name} dinonaktifkan.`
    if (action.type === "reactivate")
      return `Akses ${action.member.name} diaktifkan kembali.`
    if (action.type === "revoke")
      return `Akses organisasi ${action.member.name} dicabut.`
    return `Tautan identitas karyawan ${action.member.name} dilepas.`
  }
  return action.type === "cancel"
    ? "Undangan dibatalkan. Tautan sebelumnya tidak dapat digunakan."
    : "Tautan baru dibuat. Tautan sebelumnya sudah tidak berlaku."
}

function confirmationTitle(action: ConfirmationAction | null): string {
  if (!action) return "Konfirmasi perubahan akses"
  if ("member" in action) {
    if (action.type === "deactivate")
      return `Nonaktifkan akses ${action.member.name}?`
    if (action.type === "reactivate")
      return `Aktifkan kembali akses ${action.member.name}?`
    if (action.type === "revoke")
      return `Cabut akses organisasi ${action.member.name}?`
    return `Lepas tautan karyawan ${action.member.name}?`
  }
  return action.type === "cancel"
    ? "Batalkan undangan ini?"
    : "Terbitkan ulang undangan?"
}

function confirmationDescription(action: ConfirmationAction | null): string {
  if (!action) return "Perubahan ini akan dicatat dalam audit organisasi."
  if ("member" in action && action.type === "deactivate") {
    return "Akses organisasi berhenti saat anggota melakukan tindakan berikutnya. Akun, profil karyawan, Outlet yang ditetapkan, dan riwayat tetap tersimpan."
  }
  if ("member" in action && action.type === "reactivate") {
    return "Akses yang dinonaktifkan dapat digunakan kembali sesuai peran dan Outlet yang ditetapkan."
  }
  if ("member" in action && action.type === "revoke") {
    return "Akses ke organisasi ini, termasuk peran dan Outlet yang ditetapkan, akan dicabut. Akun dan riwayat kehadiran tidak dihapus."
  }
  if ("member" in action) {
    return "Akun tidak lagi dapat melakukan presensi personal melalui identitas karyawan tersebut."
  }
  if (action.type === "reissue" && action.email && action.email.trim().toLowerCase() !== action.invitation.email) {
    return `Email login akan diganti menjadi ${action.email.trim().toLowerCase()}. Undangan lama dicabut dan disimpan dalam riwayat. Bagikan hanya tautan baru kepada karyawan yang benar.`
  }
  return action.type === "cancel"
    ? "Undangan ini langsung dibatalkan dan tautannya tidak dapat digunakan untuk aktivasi."
    : "Tautan lama langsung tidak berlaku. Tautan baru hanya ditampilkan sekali setelah tindakan selesai."
}

function formatDate(value: string): string {
  return new Date(value).toLocaleString("id-ID", {
    dateStyle: "medium",
    timeStyle: "short",
  })
}
