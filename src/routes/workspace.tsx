import { createFileRoute } from "@tanstack/react-router"
import { useCallback, useEffect, useState } from "react"

import { ManagementSidebar } from "@/components/management-sidebar"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
} from "@/components/ui/breadcrumb"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar"
import {
  ApiError,
  type AuthSession,
  apiRequest,
  type KioskDevice,
  type OrganizationSummary,
} from "@/lib/api"

export const Route = createFileRoute("/workspace")({ component: WorkspacePage })

type WorkspaceData = {
  session: AuthSession
  organization: OrganizationSummary
  employees: Array<{ id: number; name: string }>
  kiosks: KioskDevice[]
}

function WorkspacePage() {
  const [data, setData] = useState<WorkspaceData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")
  const [unitName, setUnitName] = useState("")
  const [outletName, setOutletName] = useState("")
  const [businessUnitId, setBusinessUnitId] = useState("")
  const [deviceName, setDeviceName] = useState("")
  const [deviceOutletId, setDeviceOutletId] = useState("")
  const [employeeOutletIds, setEmployeeOutletIds] = useState<
    Record<number, string>
  >({})
  const [oneTimeCode, setOneTimeCode] = useState<{
    label: string
    value: string
    expiresAt: string
  } | null>(null)
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async () => {
    setError("")

    try {
      const session = await apiRequest<AuthSession>("/auth/me")
      if (!session.active_membership) {
        window.location.assign("/select-tenant")
        return
      }

      const [organization, employeePayload] = await Promise.all([
        apiRequest<OrganizationSummary>("/management/organization"),
        apiRequest<{ employees: Array<{ id: number; name: string }> }>(
          "/management/employees"
        ),
      ])
      const kioskPayload = session.active_membership.roles.includes("owner")
        ? await apiRequest<{ kiosks: KioskDevice[] }>("/management/kiosks")
        : { kiosks: [] }

      setData({
        session,
        organization,
        employees: employeePayload.employees,
        kiosks: kioskPayload.kiosks,
      })
    } catch (caught) {
      if (
        caught instanceof ApiError &&
        (caught.status === 401 || caught.status === 419)
      ) {
        window.location.assign("/login?expired=1")
        return
      }
      setError("Data organisasi belum dapat dimuat.")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
    const expireSession = () => window.location.assign("/login?expired=1")
    window.addEventListener("hadirinaja:session-expired", expireSession)

    return () =>
      window.removeEventListener("hadirinaja:session-expired", expireSession)
  }, [refresh])

  const isOwner = data?.organization.roles.includes("owner") ?? false

  async function submitAction(action: () => Promise<void>) {
    setBusy(true)
    setError("")
    setNotice("")
    setOneTimeCode(null)

    try {
      await action()
      await refresh()
    } catch {
      setError(
        "Perubahan tidak dapat disimpan. Periksa akses dan data yang dimasukkan."
      )
    } finally {
      setBusy(false)
    }
  }

  async function createBusinessUnit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    await submitAction(async () => {
      await apiRequest("/management/business-units", {
        method: "POST",
        body: { name: unitName },
      })
      setUnitName("")
      setNotice("Unit bisnis berhasil dibuat.")
    })
  }

  async function createOutlet(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    await submitAction(async () => {
      await apiRequest("/management/outlets", {
        method: "POST",
        body: { business_unit_id: Number(businessUnitId), name: outletName },
      })
      setOutletName("")
      setNotice("Outlet berhasil dibuat.")
    })
  }

  async function issuePairingCode(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    await submitAction(async () => {
      const result = await apiRequest<{
        pairing_code: string
        expires_at: string
      }>("/management/kiosks/pairing-codes", {
        method: "POST",
        body: { outlet_id: Number(deviceOutletId), name: deviceName },
      })
      setOneTimeCode({
        label: "Kode pemasangan kiosk",
        value: result.pairing_code,
        expiresAt: result.expires_at,
      })
      setDeviceName("")
      setNotice(
        "Masukkan kode ini pada perangkat kiosk sebelum masa berlakunya habis."
      )
    })
  }

  async function issuePinCode(
    event: React.FormEvent<HTMLFormElement>,
    employeeId: number
  ) {
    event.preventDefault()
    const outletId = employeeOutletIds[employeeId]

    await submitAction(async () => {
      const result = await apiRequest<{
        enrollment_code: string
        expires_at: string
      }>(`/management/employees/${employeeId}/pin-enrollment`, {
        method: "POST",
        body: { outlet_id: Number(outletId) },
      })
      setOneTimeCode({
        label: "Kode aktivasi PIN karyawan",
        value: result.enrollment_code,
        expiresAt: result.expires_at,
      })
      setNotice(
        "Berikan kode ini kepada karyawan untuk mengatur PIN pada kiosk yang sesuai."
      )
    })
  }

  async function revokeKiosk(deviceId: number) {
    await submitAction(async () => {
      await apiRequest(`/management/kiosks/${deviceId}/revoke`, {
        method: "POST",
      })
      setNotice("Akses perangkat berhasil dicabut.")
    })
  }

  async function logout() {
    setBusy(true)
    await apiRequest("/auth/logout", { method: "POST" }).catch(() => undefined)
    window.location.assign("/login")
  }

  if (loading && !data) {
    return (
      <main className="flex min-h-svh items-center justify-center text-body text-muted-foreground">
        Memuat ruang kerja…
      </main>
    )
  }

  return (
    <SidebarProvider>
      <div className="flex min-h-svh w-full bg-muted/20">
        <ManagementSidebar activePage="workspace" />
        <div className="min-w-0 flex-1">
          <header className="flex min-h-14 flex-wrap items-center gap-3 border-b bg-background px-4 py-2 lg:min-h-[60px] lg:px-6">
            <SidebarTrigger className="-ml-1" />
            <Breadcrumb className="min-w-0 flex-1">
              <BreadcrumbList>
                <BreadcrumbItem>
                  <BreadcrumbPage className="truncate font-semibold">
                    {data?.organization.tenant.name ?? "Organisasi"}
                  </BreadcrumbPage>
                </BreadcrumbItem>
              </BreadcrumbList>
            </Breadcrumb>
            <Button
              onClick={() => window.location.assign("/select-tenant")}
              variant="outline"
            >
              Ganti organisasi
            </Button>
            <Button disabled={busy} onClick={logout} variant="ghost">
              Keluar
            </Button>
          </header>

          <main className="space-y-6 p-4 lg:p-6">
            <section className="space-y-2">
              <p className="text-label text-muted-foreground">Ruang kerja</p>
              <h1 className="text-title">Ringkasan organisasi</h1>
              <p className="text-body text-muted-foreground">
                Data yang tampil mengikuti peran dan cakupan akses akun Anda.
              </p>
            </section>

            {error && (
              <p
                className="rounded-2xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-body text-destructive"
                role="alert"
              >
                {error}
              </p>
            )}
            {notice && (
              <p
                className="rounded-2xl border border-border bg-card px-4 py-3 text-body"
                role="status"
              >
                {notice}
              </p>
            )}
            {oneTimeCode && (
              <Card className="border-primary/30">
                <CardHeader>
                  <CardTitle className="text-label">
                    {oneTimeCode.label}
                  </CardTitle>
                  <CardDescription>
                    Kode hanya ditampilkan pada layar ini dan berlaku sampai{" "}
                    {new Date(oneTimeCode.expiresAt).toLocaleString("id-ID")}.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <p className="break-all font-mono text-title tracking-widest">
                    {oneTimeCode.value}
                  </p>
                </CardContent>
              </Card>
            )}

            {data && (
              <>
                <section
                  className="grid gap-4 sm:grid-cols-3"
                  aria-label="Ringkasan akses"
                >
                  <SummaryCard
                    label="Unit bisnis"
                    value={data.organization.business_units.length}
                  />
                  <SummaryCard
                    label="Outlet terjangkau"
                    value={data.organization.outlets.length}
                  />
                  <SummaryCard
                    label="Karyawan terjangkau"
                    value={data.organization.employee_count}
                  />
                </section>

                <section
                  className="grid gap-4 xl:grid-cols-2"
                  id="organization"
                >
                  <Card>
                    <CardHeader>
                      <CardTitle>Unit bisnis</CardTitle>
                      <CardDescription>
                        Pengelompokan operasional pada organisasi ini.
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      {data.organization.business_units.length ? (
                        <ul className="space-y-2">
                          {data.organization.business_units.map((unit) => (
                            <li
                              className="rounded-2xl bg-muted/40 px-4 py-3 text-body"
                              key={unit.id}
                            >
                              {unit.name}
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="text-body text-muted-foreground">
                          Belum ada unit yang dapat ditampilkan.
                        </p>
                      )}
                      {isOwner && (
                        <form
                          className="space-y-3 border-t pt-4"
                          onSubmit={createBusinessUnit}
                        >
                          <Field>
                            <FieldLabel htmlFor="unit-name">
                              Nama unit bisnis
                            </FieldLabel>
                            <Input
                              id="unit-name"
                              maxLength={120}
                              onChange={(event) =>
                                setUnitName(event.target.value)
                              }
                              required
                              value={unitName}
                            />
                          </Field>
                          <Button
                            disabled={busy}
                            isLoading={busy}
                            type="submit"
                          >
                            Tambah unit
                          </Button>
                        </form>
                      )}
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader>
                      <CardTitle>Outlet</CardTitle>
                      <CardDescription>
                        Lokasi sesuai organisasi dan cakupan akses Anda.
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      {data.organization.outlets.length ? (
                        <ul className="space-y-2">
                          {data.organization.outlets.map((outlet) => (
                            <li
                              className="rounded-2xl bg-muted/40 px-4 py-3 text-body"
                              key={outlet.id}
                            >
                              {outlet.name}
                              <span className="ml-2 text-caption text-muted-foreground">
                                {
                                  data.organization.business_units.find(
                                    (unit) =>
                                      unit.id === outlet.business_unit_id
                                  )?.name
                                }
                              </span>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="text-body text-muted-foreground">
                          Belum ada outlet yang dapat ditampilkan.
                        </p>
                      )}
                      {isOwner && (
                        <form
                          className="space-y-3 border-t pt-4"
                          onSubmit={createOutlet}
                        >
                          <Field>
                            <FieldLabel htmlFor="outlet-unit">
                              Unit bisnis
                            </FieldLabel>
                            <NativeSelect
                              className="w-full"
                              id="outlet-unit"
                              onChange={(event) =>
                                setBusinessUnitId(event.target.value)
                              }
                              required
                              value={businessUnitId}
                            >
                              <NativeSelectOption value="">
                                Pilih unit bisnis
                              </NativeSelectOption>
                              {data.organization.business_units.map((unit) => (
                                <NativeSelectOption
                                  key={unit.id}
                                  value={unit.id}
                                >
                                  {unit.name}
                                </NativeSelectOption>
                              ))}
                            </NativeSelect>
                          </Field>
                          <Field>
                            <FieldLabel htmlFor="outlet-name">
                              Nama outlet
                            </FieldLabel>
                            <Input
                              id="outlet-name"
                              maxLength={120}
                              onChange={(event) =>
                                setOutletName(event.target.value)
                              }
                              required
                              value={outletName}
                            />
                          </Field>
                          <Button
                            disabled={
                              busy ||
                              data.organization.business_units.length === 0
                            }
                            isLoading={busy}
                            type="submit"
                          >
                            Tambah outlet
                          </Button>
                        </form>
                      )}
                    </CardContent>
                  </Card>
                </section>

                <section
                  className="grid gap-4 xl:grid-cols-2"
                  id="people-devices"
                >
                  <Card>
                    <CardHeader>
                      <CardTitle>Karyawan</CardTitle>
                      <CardDescription>
                        Daftar terbatas pada hubungan atau outlet yang
                        diizinkan.
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      {data.employees.length ? (
                        <ul className="space-y-3">
                          {data.employees.map((employee) => (
                            <li
                              className="space-y-3 rounded-2xl bg-muted/40 p-4"
                              key={employee.id}
                            >
                              <div>
                                <p className="text-label">{employee.name}</p>
                                <p className="text-caption text-muted-foreground">
                                  ID {employee.id}
                                </p>
                              </div>
                              {isOwner && (
                                <form
                                  className="flex flex-col gap-2 sm:flex-row"
                                  onSubmit={(event) =>
                                    issuePinCode(event, employee.id)
                                  }
                                >
                                  <NativeSelect
                                    aria-label={`Outlet PIN untuk ${employee.name}`}
                                    className="w-full sm:flex-1"
                                    onChange={(event) =>
                                      setEmployeeOutletIds((current) => ({
                                        ...current,
                                        [employee.id]: event.target.value,
                                      }))
                                    }
                                    required
                                    value={employeeOutletIds[employee.id] ?? ""}
                                  >
                                    <NativeSelectOption value="">
                                      Pilih outlet aktif
                                    </NativeSelectOption>
                                    {data.organization.outlets.map((outlet) => (
                                      <NativeSelectOption
                                        key={outlet.id}
                                        value={outlet.id}
                                      >
                                        {outlet.name}
                                      </NativeSelectOption>
                                    ))}
                                  </NativeSelect>
                                  <Button
                                    disabled={
                                      busy ||
                                      data.organization.outlets.length === 0
                                    }
                                    isLoading={busy}
                                    type="submit"
                                    variant="outline"
                                  >
                                    Kode aktivasi PIN
                                  </Button>
                                </form>
                              )}
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="text-body text-muted-foreground">
                          Belum ada data karyawan dalam cakupan Anda.
                        </p>
                      )}
                    </CardContent>
                  </Card>

                  {isOwner && (
                    <Card>
                      <CardHeader>
                        <CardTitle>Kiosk</CardTitle>
                        <CardDescription>
                          Perangkat terdaftar dan pemasangan baru untuk outlet
                          yang Anda kelola.
                        </CardDescription>
                      </CardHeader>
                      <CardContent className="space-y-4">
                        <form className="space-y-3" onSubmit={issuePairingCode}>
                          <FieldGroup className="gap-3 sm:grid sm:grid-cols-2">
                            <Field>
                              <FieldLabel htmlFor="device-name">
                                Nama perangkat
                              </FieldLabel>
                              <Input
                                id="device-name"
                                maxLength={120}
                                onChange={(event) =>
                                  setDeviceName(event.target.value)
                                }
                                required
                                value={deviceName}
                              />
                            </Field>
                            <Field>
                              <FieldLabel htmlFor="device-outlet">
                                Outlet
                              </FieldLabel>
                              <NativeSelect
                                className="w-full"
                                id="device-outlet"
                                onChange={(event) =>
                                  setDeviceOutletId(event.target.value)
                                }
                                required
                                value={deviceOutletId}
                              >
                                <NativeSelectOption value="">
                                  Pilih outlet
                                </NativeSelectOption>
                                {data.organization.outlets.map((outlet) => (
                                  <NativeSelectOption
                                    key={outlet.id}
                                    value={outlet.id}
                                  >
                                    {outlet.name}
                                  </NativeSelectOption>
                                ))}
                              </NativeSelect>
                            </Field>
                          </FieldGroup>
                          <Button
                            disabled={
                              busy || data.organization.outlets.length === 0
                            }
                            isLoading={busy}
                            type="submit"
                          >
                            Buat kode pemasangan
                          </Button>
                        </form>
                        <ul className="space-y-2 border-t pt-4">
                          {data.kiosks.map((device) => (
                            <li
                              className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-muted/40 p-4"
                              key={device.id}
                            >
                              <div>
                                <p className="text-label">{device.name}</p>
                                <p className="text-caption text-muted-foreground">
                                  {device.outlet_name} ·{" "}
                                  {device.revoked_at
                                    ? "Akses dicabut"
                                    : "Aktif"}
                                </p>
                              </div>
                              {!device.revoked_at && (
                                <Button
                                  disabled={busy}
                                  onClick={() => revokeKiosk(device.id)}
                                  variant="outline"
                                >
                                  Cabut akses
                                </Button>
                              )}
                            </li>
                          ))}
                          {data.kiosks.length === 0 && (
                            <li className="text-body text-muted-foreground">
                              Belum ada kiosk terdaftar.
                            </li>
                          )}
                        </ul>
                      </CardContent>
                    </Card>
                  )}
                </section>
              </>
            )}
          </main>
        </div>
      </div>
    </SidebarProvider>
  )
}

function SummaryCard({ label, value }: { label: string; value: number }) {
  return (
    <Card>
      <CardContent className="space-y-2">
        <p className="text-caption text-muted-foreground">{label}</p>
        <p className="text-title">{value}</p>
      </CardContent>
    </Card>
  )
}
