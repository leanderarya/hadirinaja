import { configurationSearch } from "@/lib/configuration-navigation"
import { useConfigurationDraft } from "@/lib/use-configuration-draft"
import { fromSettings } from "@/lib/settings-navigation"
import { organizationSearch } from "@/lib/organization-explorer"
import { OrganizationExperience } from "./-organization-experience"
import { createFileRoute, useLocation, useNavigate } from "@tanstack/react-router"
import {
  ArrowUpRight,
  Check,
  ChevronRight,
  Ellipsis,
  Plus,
  Search,
  SlidersHorizontal,
  UserRound,
  X,
} from "lucide-react"
import { useCallback, useEffect, useRef, useState } from "react"
import {
  ManagementSidebar,
  ManagementTopbar,
} from "@/components/management-sidebar"
import {
  ConsequenceDialog,
  ContextAlert,
  EmployeeRosterCard,
  EmployeeRosterRow,
  LabeledControl,
  StatusBadge,
} from "@/components/r2c/components"
import {
  ContextDrawer,
  PageHeading,
  ScopeBanner,
} from "@/components/r2c/screen-blocks"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { FieldGroup } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { SidebarProvider } from "@/components/ui/sidebar"

import {
  employeeAccess,
  employeeReference,
  filterRoster,
  workspaceSection,
} from "@/lib/owner-screen-presentation"
import { cn } from "@/lib/utils"
import {
  ApiError,
  type AuthSession,
  apiRequest,
  type KioskDevice,
  type OrganizationSummary,
} from "@/lib/api"

export const Route = createFileRoute("/workspace")({ validateSearch: organizationSearch, component: WorkspaceEntry })

function WorkspaceEntry() {
  const hash = useLocation({ select: (location) => location.hash.replace(/^#/, "") })
  return hash === "organization" ? <OrganizationExperience /> : <WorkspacePage />
}

function todayJakarta(offsetDays = 0) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date())
  const part = (type: string) =>
    parts.find((value) => value.type === type)?.value ?? "0"
  return new Date(
    Date.UTC(
      Number(part("year")),
      Number(part("month")) - 1,
      Number(part("day")) + offsetDays
    )
  )
    .toISOString()
    .slice(0, 10)
}

type WorkspaceData = {
  session: AuthSession
  organization: OrganizationSummary
  employees: Array<{
    id: number
    name: string
    business_unit_id: number | null
    business_unit_name: string | null
    outlet_id: number | null
    outlet_name: string | null
    access_status?: string | null
  }>
  kiosks: KioskDevice[]
}

export function WorkspacePage({ kioskSettings = false }: { kioskSettings?: boolean } = {}) {
  const settingsContext = useLocation({ select: location => kioskSettings || location.search.from === "settings" })
  const location = useLocation()
  const navigate = useNavigate()
  const kioskSearch = configurationSearch(location.search)
  const [legacyDevice, setLegacyDevice] = useState<number | null>(null)
  const selectedDeviceId = kioskSettings ? kioskSearch.deviceId ?? null : legacyDevice
  const setSelectedDeviceId = (value: number | null) => { if (kioskSettings) void navigate({ to: "/settings/kiosk-devices", search: { ...kioskSearch, deviceId: value ?? undefined } }); else setLegacyDevice(value) }
  const [codeNow, setCodeNow] = useState(() => Date.now())
  const employeeDialogTrigger = useRef<HTMLElement | null>(null)
  const [section, setSection] = useState<"team" | "organization" | "kiosk">(
    "team"
  )
  const [employeeDialog, setEmployeeDialog] = useState<
    "create" | "profile" | "edit" | "placement" | "more" | null
  >(null)
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<number | null>(
    null
  )
  const [search, setSearch] = useState("")
  const [filterUnitId, setFilterUnitId] = useState("")
  const [filterOutletId, setFilterOutletId] = useState("")
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [page, setPage] = useState(1)
  const [pairingOpen, setPairingOpen] = useState(false)
  const [renewalDeviceId, setRenewalDeviceId] = useState<number | null>(null)
  const [revokeDeviceId, setRevokeDeviceId] = useState<number | null>(null)
  useEffect(() => {
    const update = () => {
      setSection(kioskSettings ? "kiosk" : workspaceSection(window.location.hash))
      setEmployeeDialog(null)
      setPairingOpen(false)
      setOneTimeCode(null)
    }
    update()
    window.addEventListener("hashchange", update)
    return () => window.removeEventListener("hashchange", update)
  }, [kioskSettings])
  const [data, setData] = useState<WorkspaceData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")
  const [deviceName, setDeviceName] = useState("")
  const [deviceOutletId, setDeviceOutletId] = useState(String(kioskSearch.outletId ?? ""))
  const [employeeOutletIds, setEmployeeOutletIds] = useState<
    Record<number, string>
  >({})
  const [oneTimeCode, setOneTimeCode] = useState<{
    label: string
    value: string
    expiresAt: string
  } | null>(null)
  const [busy, setBusy] = useState(false)
  const pairingDraft = useConfigurationDraft(busy, () => { setPairingOpen(false); setDeviceName(""); setOneTimeCode(null) })
  const submitLock = useRef(false)
  const [uncertainKiosk, setUncertainKiosk] = useState(false)
  const [copyNotice, setCopyNotice] = useState("")
  useEffect(() => {
    if (!oneTimeCode) return
    setCodeNow(Date.now())
    const timer = window.setInterval(() => setCodeNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [oneTimeCode])
  useEffect(() => {
    if (oneTimeCode && codeNow >= Date.parse(oneTimeCode.expiresAt)) { setOneTimeCode(null); setCopyNotice("Kode kedaluwarsa; tidak dapat dipulihkan.") }
  }, [oneTimeCode, codeNow])
  const [employeeName, setEmployeeName] = useState("")
  const [employeeUnitId, setEmployeeUnitId] = useState("")
  const [employeeOutletId, setEmployeeOutletId] = useState("")
  const [employeeEffectiveFrom, setEmployeeEffectiveFrom] = useState(
    todayJakarta()
  )
  const [editingEmployeeId, setEditingEmployeeId] = useState<number | null>(
    null
  )
  const [editingEmployeeName, setEditingEmployeeName] = useState("")
  const [editingEmployeeUnitId, setEditingEmployeeUnitId] = useState("")
  const [editingEmployeeOutletId, setEditingEmployeeOutletId] = useState("")
  const [editingEmployeeEffectiveFrom, setEditingEmployeeEffectiveFrom] =
    useState(todayJakarta(1))

  const organizationTenant = useRef<number | null>(null)
  const refresh = useCallback(async (afterSave = false) => {
    setError("")

    try {
      const session = await apiRequest<AuthSession>("/auth/me")
      if (!session.active_membership) {
        window.location.assign("/select-tenant")
        return
      }

      if (kioskSettings && !session.features.kiosk_enabled) {
        setData(null)
        setOneTimeCode(null)
        setPairingOpen(false)
        setError("Pengelolaan kiosk belum diaktifkan untuk organisasi ini.")
        return
      }

      if ((kioskSettings && !session.active_membership.roles.includes("owner")) || !session.active_membership.roles.some(role => role === "owner" || role === "supervisor")) {
        setData(null)
        setOneTimeCode(null)
        setPairingOpen(false)
        setError(kioskSettings ? "Pengelolaan kiosk hanya tersedia untuk Owner." : "Pengaturan organisasi hanya tersedia untuk Owner atau Supervisor yang berwenang.")
        return
      }

      if (organizationTenant.current !== null && organizationTenant.current !== session.active_membership.tenant.id) {
        setOneTimeCode(null)
        setPairingOpen(false)
        setLegacyDevice(null)
        setData(null)
      }
      organizationTenant.current = session.active_membership.tenant.id

      const [organization, employeePayload] = await Promise.all([
        apiRequest<OrganizationSummary>("/management/organization"),
        kioskSettings ? Promise.resolve({ employees: [] }) : apiRequest<{ employees: WorkspaceData["employees"] }>(
          "/management/employees"
        ),
      ])
      if (organization.tenant.id !== session.active_membership.tenant.id) {
        setData(null)
        setOneTimeCode(null)
        setPairingOpen(false)
        setError("Konteks organisasi berubah. Muat ulang sebelum melanjutkan.")
        return
      }
      const kioskPayload = session.features.kiosk_enabled && session.active_membership.roles.includes("owner")
        ? await apiRequest<{ kiosks: KioskDevice[] }>("/management/kiosks")
        : { kiosks: [] }
      const accessPayload = !kioskSettings && session.active_membership.roles.includes("owner")
        ? await apiRequest<{
            employees: Array<{ id: number; access_status: string }>
          }>("/management/access").catch(() => null)
        : null
      const accessByEmployeeId = new Map(
        (accessPayload?.employees ?? []).map((employee) => [
          employee.id,
          employee.access_status,
        ])
      )

      setData({
        session,
        organization,
        employees: employeePayload.employees.map((employee) => ({
          ...employee,
          access_status: accessByEmployeeId.get(employee.id) ?? null,
        })),
        kiosks: kioskPayload.kiosks,
      })
      if (!session.features.kiosk_enabled) {
        setSection((current) => (current === "kiosk" ? "team" : current))
      }
    } catch (caught) {
      if (
        caught instanceof ApiError &&
        (caught.status === 401 || caught.status === 419)
      ) {
        window.location.assign("/login?expired=1")
        return
      }
      setError(afterSave ? "Perubahan tersimpan; data terbaru belum dapat dimuat. Muat ulang data tanpa mengulangi tindakan." : "Data organisasi belum dapat dimuat.")
    } finally {
      setLoading(false)
    }
  }, [kioskSettings])

  useEffect(() => {
    void refresh()
    const expireSession = () => window.location.assign("/login?expired=1")
    window.addEventListener("hadirinaja:session-expired", expireSession)

    return () =>
      window.removeEventListener("hadirinaja:session-expired", expireSession)
  }, [refresh])

  const isOwner = Boolean(data?.organization.roles.includes("owner") && data.session.active_membership?.roles.includes("owner"))

  async function submitAction(action: () => Promise<void>) {
    if (submitLock.current || (section === "kiosk" && uncertainKiosk)) return
    submitLock.current = true
    setBusy(true)
    setError("")
    setNotice("")
    setOneTimeCode(null)

    try {
      await action()
      pairingDraft.clear()
      await refresh(true)
    } catch (caught) {
      if (section === "kiosk" && (!(caught instanceof ApiError) || caught.status >= 500)) { setUncertainKiosk(true); setRevokeDeviceId(null) }
      setError(
        caught instanceof ApiError
          ? caught.message === "The given data was invalid."
            ? "Data belum valid. Periksa nama, unit, outlet, dan tanggal berlaku. Untuk mengubah penempatan, pilih tanggal yang tidak bertabrakan dengan penempatan terjadwal."
            : caught.message
          : "Perubahan tidak dapat disimpan. Periksa akses dan data yang dimasukkan."
      )
    } finally {
      submitLock.current = false
      setBusy(false)
    }
  }

  async function saveEmployee(
    event: React.FormEvent<HTMLFormElement>,
    employeeId?: number
  ) {
    event.preventDefault()
    const editing = employeeId !== undefined
    await submitAction(async () => {
      await apiRequest(
        editing
          ? `/management/employees/${employeeId}`
          : "/management/employees",
        {
          method: editing ? "PUT" : "POST",
          body: {
            name: editing ? editingEmployeeName : employeeName,
            business_unit_id: Number(
              editing ? editingEmployeeUnitId : employeeUnitId
            ),
            outlet_id: Number(
              editing ? editingEmployeeOutletId : employeeOutletId
            ),
            effective_from: editing
              ? editingEmployeeEffectiveFrom
              : employeeEffectiveFrom,
          },
        }
      )
      if (editing) setEditingEmployeeId(null)
      else setEmployeeName("")
      setEmployeeDialog(null)
      setNotice(
        editing
          ? "Data karyawan berhasil diperbarui."
          : "Data karyawan berhasil dibuat. Akun pengguna tidak dibuat otomatis."
      )
    })
  }

  function beginEmployeeEdit(employee: WorkspaceData["employees"][number]) {
    setEmployeeDialog("edit")
    setError("")
    setEditingEmployeeId(employee.id)
    setEditingEmployeeName(employee.name)
    setEditingEmployeeUnitId(
      employee.business_unit_id ? String(employee.business_unit_id) : ""
    )
    setEditingEmployeeOutletId(
      employee.outlet_id ? String(employee.outlet_id) : ""
    )
    setEditingEmployeeEffectiveFrom(todayJakarta(1))
  }

  async function issuePairingCode(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    await submitAction(async () => {
      const result = await apiRequest<{
        pairing_code: string
        expires_at: string
      }>("/management/kiosks/pairing-codes", {
        method: "POST",
        body: { outlet_id: Number(deviceOutletId), name: deviceName, ...(renewalDeviceId === null ? {} : { device_id: renewalDeviceId }) },
      })
      if (!result.pairing_code || !Number.isFinite(Date.parse(result.expires_at))) throw new Error("Incomplete pairing response")
      setOneTimeCode({
        label: "Kode pemasangan kiosk",
        value: result.pairing_code,
        expiresAt: result.expires_at,
      })
      setDeviceName("")
      if (kioskSettings) void navigate({ to: "/settings/kiosk-devices", search: { ...kioskSearch, outletId: Number(deviceOutletId) }, replace: true, ignoreBlocker: true })
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
        label: `Kode aktivasi PIN karyawan · ${data?.employees.find((employee) => employee.id === employeeId)?.name ?? employeeReference(employeeId)}`,
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
      setRevokeDeviceId(null)
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

  const navigationContext = data
    ? {
        tenantName: data.organization.tenant.name,
        roles: data.organization.roles,
        userName: data.session.user.name,
        kioskEnabled: data.session.features.kiosk_enabled,
      }
    : null
  const selectedEmployee = data?.employees.find(
    (employee) => employee.id === selectedEmployeeId
  )
  const filteredEmployees = filterRoster(
    data?.employees ?? [],
    search,
    filterUnitId,
    filterOutletId
  )
  const pageCount = Math.max(1, Math.ceil(filteredEmployees.length / 25))
  const currentPage = Math.min(page, pageCount)
  const pageEmployees = filteredEmployees.slice(
    (currentPage - 1) * 25,
    currentPage * 25
  )
  const rosterContext =
    pageEmployees.length &&
    pageEmployees.every(
      (employee) =>
        employee.outlet_id === pageEmployees[0].outlet_id &&
        employee.business_unit_id === pageEmployees[0].business_unit_id
    )
      ? [pageEmployees[0].outlet_name, pageEmployees[0].business_unit_name]
          .filter(Boolean)
          .join(" · ") || "Penempatan aktif"
      : "Penempatan aktif"
  const isEditor =
    employeeDialog === "create" ||
    employeeDialog === "edit" ||
    employeeDialog === "placement"
  const oneTimeNotice = oneTimeCode ? (
    <Card className="border-primary/30">
      <CardHeader>
        <CardTitle>{oneTimeCode.label}</CardTitle>
        <CardDescription>
          Kode hanya ditampilkan pada layar ini sampai{" "}
          {new Date(oneTimeCode.expiresAt).toLocaleString("id-ID")}.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <p data-sensitive-pairing className="break-all text-mono [font-size:24px]">
          {codeNow < new Date(oneTimeCode.expiresAt).getTime() ? oneTimeCode.value : "Kode kedaluwarsa"}
        </p>
        <p className="text-caption">{codeNow < new Date(oneTimeCode.expiresAt).getTime() ? "Kode sekali tebus; jangan dibagikan kepada pihak lain." : "Kode tidak dipulihkan. Terbitkan kode baru melalui aksi yang sesuai bila masih diperlukan."}</p>
        <Button variant="outline" disabled={codeNow >= Date.parse(oneTimeCode.expiresAt)} onClick={async () => { try { await navigator.clipboard.writeText(oneTimeCode.value); setCopyNotice("Kode disalin. Gunakan sebelum kedaluwarsa.") } catch { setCopyNotice("Clipboard tidak tersedia. Salin secara manual dari layar ini.") } }}>Salin kode</Button>

        <Button variant="outline" onClick={() => { setOneTimeCode(null); setCopyNotice("") }}>Sembunyikan kode</Button>
      </CardContent>
    </Card>
  ) : null
  const actionError = error ? (
    <ContextAlert tone="danger" title={notice ? "Data terbaru belum dimuat" : uncertainKiosk ? "Hasil belum dapat dipastikan" : "Perubahan belum tersimpan"}>
      {error}
      {uncertainKiosk ? <Button onClick={() => { pairingDraft.clear(); window.location.reload() }}>Tutup draf dan periksa perangkat</Button> : null}
    </ContextAlert>
  ) : null
  const setupNotice =
    isOwner && data && !data.organization.outlets.length ? (
      <ContextAlert
        title="Siapkan penempatan terlebih dahulu"
        action={
          <Button
            variant="outline"
            render={<a href="/workspace#organization" />}
          >
            Kelola organisasi
          </Button>
        }
      >
        Buat unit bisnis dan Outlet sebelum menambahkan karyawan atau memasang
        perangkat kiosk.
      </ContextAlert>
    ) : null
  const recordFor = (employee: WorkspaceData["employees"][number]) => {
    const access = employeeAccess(employee.access_status)
    return {
      name: employee.name,
      employeeId: employeeReference(employee.id),
      placement: employee.outlet_name
        ? `${employee.outlet_name} / ${employee.business_unit_name ?? "Unit tidak tersedia"}`
        : "Belum ada penempatan",
      placementContext: employee.outlet_id ? "Penempatan aktif" : undefined,
      accessLabel: access.label,
      accountHelper: access.helper,
      accessTone: access.tone,
      actions: (
        <>
          <Button
            variant="outline"
            aria-label={`Profil ${employee.name}`}
            disabled={busy}
            onClick={(event) => {
              employeeDialogTrigger.current = event.currentTarget
              setSelectedEmployeeId(employee.id)
              setEmployeeDialog("profile")
              setOneTimeCode(null)
              setError("")
            }}
          >
            <UserRound
              aria-hidden="true"
              data-icon="inline-start"
              className="text-brand-700"
            />
            Profil
          </Button>
          {isOwner ? (
            <>
              <Button
                variant={
                  employee.access_status === "none" ? "default" : "outline"
                }
                aria-label={`${access.action} untuk ${employee.name}`}
                render={<a href={settingsContext ? fromSettings(`/access?employeeId=${employee.id}`) : `/access?employeeId=${employee.id}`} />}
              >
                <ArrowUpRight
                  aria-hidden="true"
                  data-icon="inline-start"
                  className={
                    employee.access_status === "none"
                      ? undefined
                      : "text-brand-700"
                  }
                />
                {access.action}
              </Button>
              <Button
                variant="outline"
                size="icon"
                className="hidden xl:inline-flex"
                aria-label={`Lainnya untuk ${employee.name}`}
                onClick={(event) => {
                  employeeDialogTrigger.current = event.currentTarget
                  setSelectedEmployeeId(employee.id)
                  setEmployeeDialog("more")
                  setOneTimeCode(null)
                  setError("")
                }}
              >
                <Ellipsis aria-hidden="true" className="text-brand-700" />
              </Button>
            </>
          ) : null}
        </>
      ),
    }
  }

  return (
    <SidebarProvider className="pb-[calc(6rem+env(safe-area-inset-bottom))] md:pb-0">
      <div className="flex min-h-svh w-full bg-canvas">
        {pairingDraft.dialog}
      <ManagementSidebar activePage={kioskSettings ? "settings" : "workspace"} context={navigationContext} />
        <div className="min-w-0 flex-1" id={section === "organization" ? "organization" : undefined}>
          <ManagementTopbar
            context={navigationContext}
            settingsBack={kioskSettings}
            onLogout={logout}
            busy={busy}
          />
          <main
            className="flex min-w-0 flex-col gap-[14px] p-4 md:gap-4 md:p-6"
            data-b3-compact={kioskSettings ? "true" : undefined}
            data-r2c-screen={section === "organization" ? "organization" : "team"}
          >
            {!kioskSettings && settingsContext && navigationContext ? <Button className="w-fit" variant="ghost" render={<a href="/settings" />}>← Kembali ke Pengaturan</Button> : null}
            <PageHeading
              minimal={kioskSettings}
              className={section === "organization" ? "[&_.text-body]:block" : undefined}
              compact
              title={
                section === "organization"
                  ? "Organisasi"
                  : section === "kiosk"
                    ? "Perangkat kiosk"
                    : "Tim"
              }
              role={
                isOwner
                  ? "Owner"
                  : data?.organization.roles.includes("supervisor")
                    ? "Supervisor"
                    : kioskSettings && !data ? "Akses terbatas" : "Karyawan"
              }
              description={
                section === "team"
                  ? "Kelola profil karyawan, penempatan, dan akses akun."
                  : section === "organization"
                    ? "Unit bisnis dan Outlet dalam organisasi aktif."
                    : "Kelola organisasi dan perangkat yang dapat Anda akses."
              }
              actions={
                section === "team" && isOwner ? (
                  <Button
                    disabled={busy}
                    onClick={(event) => {
                      employeeDialogTrigger.current = event.currentTarget
                      setEditingEmployeeId(null)
                      setEmployeeDialog("create")
                      setError("")
                    }}
                  >
                    <Plus aria-hidden="true" data-icon="inline-start" />
                    Tambah karyawan
                  </Button>
                ) : undefined
              }
            />
            {error && !employeeDialog ? (
              <ContextAlert
                tone="danger"
                title="Data belum tersedia"
                action={
                  <Button variant="outline" onClick={() => void refresh()}>
                    Coba lagi
                  </Button>
                }
              >
                {error}
              </ContextAlert>
            ) : null}
            {notice ? (
              <p role="status" className="text-body text-brand-700">
                {notice}
              </p>
            ) : null}
            {copyNotice ? <p role="status">{copyNotice}</p> : null}
            {!employeeDialog && !pairingOpen ? oneTimeNotice : null}

            {data && section === "team" ? (
              <>
                <span id="people-devices" className="sr-only" />
                <div className="hidden md:block">
                  <ScopeBanner
                    purpose="provisioning"
                    title="Profil karyawan tidak otomatis membuat akun pengguna"
                  >
                    1 · Buat profil dan penempatan → 2 · Undang atau tautkan akun
                    di Akses pengguna.
                  </ScopeBanner>
                </div>
                <div className="md:hidden">
                  <ContextAlert title="Profil tidak otomatis membuat akun">
                    Buat profil dan penempatan. Undang atau tautkan akun melalui
                    Akses pengguna; tautan aktivasi satu kali dikirim manual.
                  </ContextAlert>
                </div>
                <FieldGroup className="gap-3 md:grid md:grid-cols-3">
                  <div className="relative min-w-0">
                    <LabeledControl
                      label="Cari karyawan"
                      helper={
                        <>
                          <span className="md:hidden">
                            {rosterContext} · {filteredEmployees.length}{" "}
                            karyawan
                          </span>
                          <span className="hidden md:inline">
                            Cari profil, bukan akun pengguna.
                          </span>
                        </>
                      }
                      control={
                        <Input
                          id="employee-search"
                          type="search"
                          placeholder="Nama atau ID"
                          className="pr-9 placeholder:text-foreground"
                          value={search}
                          onChange={(event) => {
                            setSearch(event.target.value)
                            setPage(1)
                          }}
                        />
                      }
                    />
                    <Search
                      aria-hidden="true"
                      className="pointer-events-none absolute end-3 top-[40px] size-[18px] text-muted-foreground"
                    />
                  </div>
                  <div
                    className={cn("hidden md:block", filtersOpen && "block")}
                  >
                    <LabeledControl
                      label="Unit bisnis"
                      helper="Penempatan mengikuti BU terpilih."
                      control={
                        <NativeSelect
                          className="w-full"
                          value={filterUnitId}
                          onChange={(event) => {
                            setFilterUnitId(event.target.value)
                            setFilterOutletId("")
                            setPage(1)
                          }}
                        >
                          <NativeSelectOption value="">
                            Semua unit bisnis
                          </NativeSelectOption>
                          {data.organization.business_units.map((unit) => (
                            <NativeSelectOption
                              key={unit.id}
                              value={String(unit.id)}
                            >
                              {unit.name}
                            </NativeSelectOption>
                          ))}
                        </NativeSelect>
                      }
                    />
                  </div>
                  <div
                    className={cn("hidden md:block", filtersOpen && "block")}
                  >
                    <LabeledControl
                      label="Outlet"
                      helper="Berdasarkan penempatan efektif."
                      control={
                        <NativeSelect
                          className="w-full"
                          value={filterOutletId}
                          onChange={(event) => {
                            setFilterOutletId(event.target.value)
                            setPage(1)
                          }}
                        >
                          <NativeSelectOption value="">
                            Semua Outlet
                          </NativeSelectOption>
                          {data.organization.outlets
                            .filter(
                              (outlet) =>
                                !filterUnitId ||
                                String(outlet.business_unit_id) === filterUnitId
                            )
                            .map((outlet) => (
                              <NativeSelectOption
                                key={outlet.id}
                                value={String(outlet.id)}
                              >
                                {outlet.name}
                              </NativeSelectOption>
                            ))}
                        </NativeSelect>
                      }
                    />
                  </div>
                </FieldGroup>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="hidden text-subtitle md:block">
                    Karyawan · {filteredEmployees.length}
                  </p>
                  <p className="hidden text-body text-[13px] text-muted-foreground md:block">
                    {filterOutletId
                      ? data.organization.outlets.find(
                          (outlet) => String(outlet.id) === filterOutletId
                        )?.name
                      : filterUnitId
                        ? data.organization.business_units.find(
                            (unit) => String(unit.id) === filterUnitId
                          )?.name
                        : rosterContext}{" "}
                    · {filteredEmployees.length} karyawan
                  </p>
                  <div className="flex flex-wrap gap-2 md:hidden">
                    <Button
                      variant="outline"
                      aria-expanded={filtersOpen}
                      onClick={() => setFiltersOpen((value) => !value)}
                    >
                      <SlidersHorizontal
                        aria-hidden="true"
                        data-icon="inline-start"
                      />
                      Filter
                    </Button>
                    {isOwner ? (
                      <Button
                        disabled={busy}
                        onClick={(event) => {
                          employeeDialogTrigger.current = event.currentTarget
                          setEditingEmployeeId(null)
                          setEmployeeDialog("create")
                          setError("")
                        }}
                      >
                        <Plus aria-hidden="true" data-icon="inline-start" />
                        Tambah karyawan
                      </Button>
                    ) : null}
                  </div>
                </div>
                {pageEmployees.length ? (
                  <>
                    <div className="hidden overflow-hidden rounded-[16px] border border-border bg-surface xl:block">
                      <div role="table" aria-label="Daftar karyawan">
                        <div role="rowgroup" className="sr-only">
                          <div role="row">
                            {[
                              "Profil karyawan",
                              "Penempatan efektif",
                              "Akun pengguna",
                              "Tindakan",
                            ].map((label) => (
                              <div role="columnheader" key={label}>
                                {label}
                              </div>
                            ))}
                          </div>
                        </div>
                        <div role="rowgroup">
                          {pageEmployees.map((employee) => (
                            <EmployeeRosterRow
                              layout="collection"
                              key={employee.id}
                              record={recordFor(employee)}
                            />
                          ))}
                        </div>
                      </div>
                    </div>
                    <div className="grid min-w-0 gap-3 md:grid-cols-2 xl:hidden">
                      {pageEmployees.map((employee) => (
                        <EmployeeRosterCard
                          key={employee.id}
                          record={recordFor(employee)}
                        />
                      ))}
                    </div>
                  </>
                ) : (
                  <Card>
                    <CardContent className="flex flex-col items-start gap-3">
                      <p className="text-subtitle">
                        {data.employees.length
                          ? "Tidak ada karyawan yang cocok"
                          : "Belum ada karyawan"}
                      </p>
                      <p className="text-body text-muted-foreground">
                        {data.employees.length
                          ? "Ubah pencarian atau filter yang dipilih."
                          : "Profil karyawan dari Outlet yang dapat Anda akses akan tampil di sini."}
                      </p>
                      {setupNotice}
                      {data.employees.length ? (
                        <Button
                          variant="outline"
                          onClick={() => {
                            setSearch("")
                            setFilterUnitId("")
                            setFilterOutletId("")
                          }}
                        >
                          Reset filter
                        </Button>
                      ) : null}
                    </CardContent>
                  </Card>
                )}
                <div className="order-2 flex flex-wrap items-center justify-between gap-3 md:order-none">
                  <p className="text-caption">
                    {filteredEmployees.length
                      ? `${(currentPage - 1) * 25 + 1}–${Math.min(currentPage * 25, filteredEmployees.length)}`
                      : "0"}{" "}
                    dari {filteredEmployees.length} karyawan · halaman{" "}
                    {currentPage}
                  </p>
                  <div className="flex gap-2">
                    {currentPage > 1 ? (
                      <Button
                        variant="outline"
                        onClick={() => setPage(currentPage - 1)}
                      >
                        Sebelumnya
                      </Button>
                    ) : null}
                    <Button
                      className={cn(pageCount === 1 && "hidden md:inline-flex")}
                      variant="outline"
                      disabled={currentPage >= pageCount}
                      onClick={() => setPage(currentPage + 1)}
                    >
                      <ChevronRight
                        aria-hidden="true"
                        data-icon="inline-start"
                      />
                      Berikutnya
                    </Button>
                  </div>
                </div>
                <p className="order-1 text-caption [--type-caption-size:13px] md:order-none md:[--type-caption-size:12px]">
                  Profil memuat perubahan dasar, penempatan bertanggal
                  {data.session.features.kiosk_enabled
                    ? ", dan kode pendaftaran PIN sesuai hak akses"
                    : ""}. Undangan dan
                  penautan akun adalah proses terpisah; tautan aktivasi satu
                  kali dikirim manual.
                </p>
              </>
            ) : null}

            {data && section === "kiosk" && data.session.features.kiosk_enabled ? (
              <>
                <span id="kiosk-devices" className="sr-only" />
                {isOwner ? (
                  <>
                    {!kioskSettings ? <ScopeBanner title="Perangkat terdaftar">
                      Kode pemasangan berlaku selama 5 menit dan hanya dapat digunakan sekali. Perangkat dibuat setelah kode digunakan. Buka /kiosk di perangkat Outlet.
                    </ScopeBanner> : null}
                    {setupNotice}
                    <Button
                      className="self-start"
                      disabled={busy || uncertainKiosk || !data.organization.outlets.length}
                      onClick={() => {
                        setRenewalDeviceId(null)
                        setPairingOpen(true)
                        setOneTimeCode(null)
                        setError("")
                      }}
                    >
                      <Plus aria-hidden="true" data-icon="inline-start" />
                      Pasang perangkat kiosk
                    </Button>
                    <div className="grid min-w-0 gap-6 lg:grid-cols-2" data-b3-kiosk>
                      <Card><CardHeader><CardTitle>Perangkat terdaftar</CardTitle><CardDescription>Aktif berarti akses belum dicabut dan belum kedaluwarsa. Status ini tidak menunjukkan apakah perangkat sedang tersambung.</CardDescription></CardHeader><CardContent className="flex flex-col gap-3">
                      {data.kiosks.map(device => <Button key={device.id} variant="outline" className="h-auto min-h-11 justify-start whitespace-normal text-start" aria-pressed={(selectedDeviceId ?? data.kiosks[0]?.id) === device.id} onClick={() => setSelectedDeviceId(device.id)}><span className="flex flex-col gap-1"><span>{device.name} · {device.revoked_at ? "Dicabut" : !device.credential_expires_at || Date.parse(device.credential_expires_at) <= Date.now() ? "Kedaluwarsa" : "Aktif"}</span><span className="text-caption">{device.outlet_name}</span></span></Button>)}
                      {!data.kiosks.length ? <p className="text-body">Belum ada perangkat terdaftar. Pasang perangkat untuk memulai.</p> : null}
                      </CardContent></Card>
                      <Card><CardHeader><CardTitle>Detail perangkat</CardTitle><CardDescription>Data akses perangkat dan PIN tidak ditampilkan.</CardDescription></CardHeader><CardContent className="flex flex-col gap-4">
                      {(() => {const device=selectedDeviceId === null ? data.kiosks[0] : data.kiosks.find(item => item.id === selectedDeviceId); return device ? <><p className="text-label">{device.name} · {device.outlet_name}</p><p className="text-body">Dipasangkan: {new Date(device.paired_at).toLocaleString("id-ID")}</p><p className="text-body">Terakhir terlihat: {device.last_seen_at ? new Date(device.last_seen_at).toLocaleString("id-ID") : "Belum tersedia"}</p><p className="text-body">Akses berlaku sampai: {device.credential_expires_at ? new Date(device.credential_expires_at).toLocaleString("id-ID") : "Belum tersedia; perlu diperbarui"}</p>{!device.revoked_at ? <Button variant="outline" disabled={busy || uncertainKiosk} onClick={() => { setRenewalDeviceId(device.id); setDeviceName(device.name); setDeviceOutletId(String(device.outlet_id)); setOneTimeCode(null); setError(""); setPairingOpen(true) }}>Buat kode pembaruan akses</Button> : null}{device.revoked_at ? <p className="text-body">Dicabut: {new Date(device.revoked_at).toLocaleString("id-ID")}. Data akses tidak dapat dipulihkan. Pasangkan ulang perangkat jika perlu.</p> : <Button variant="outline" disabled={busy || uncertainKiosk} onClick={() => setRevokeDeviceId(device.id)}>Cabut akses perangkat</Button>}</> : <p className="text-body">Pilih perangkat untuk melihat detail.</p>})()}
                      <ScopeBanner title="PIN karyawan tetap di Tim">Owner menerbitkan kode pendaftaran PIN. Karyawan mengatur PIN sendiri pada kiosk di Outlet yang dipilih. PIN tidak dapat dilihat atau dipulihkan.</ScopeBanner>
                      <Button variant="outline" render={<a href="/workspace#people-devices" />}>Buka Tim untuk kode PIN</Button>
                      <Button variant="outline" disabled={busy} onClick={() => void refresh()}>Muat ulang perangkat</Button>
                      </CardContent></Card>
                    </div>
                  </>
                ) : (
                  <ScopeBanner title="Akses terbatas">
                    Pengelolaan perangkat kiosk tersedia untuk Owner.
                  </ScopeBanner>
                )}
              </>
            ) : null}
          </main>
        </div>
      </div>

      {data && selectedEmployee ? (
        <ContextDrawer
          open={employeeDialog === "profile" || employeeDialog === "more"}
          onOpenChange={(open) => {
            if (!open) setEmployeeDialog(null)
          }}
          finalFocus={employeeDialogTrigger}
          title="Profil karyawan"
          description={`${selectedEmployee.name} · ${employeeReference(selectedEmployee.id)}`}
          busy={busy}
          footer={
            isOwner ? (
              <>
                <Button
                  variant="outline"
                  onClick={() => beginEmployeeEdit(selectedEmployee)}
                >
                  Ubah profil
                </Button>
                <Button
                  onClick={() => {
                    beginEmployeeEdit(selectedEmployee)
                    setEmployeeDialog("placement")
                  }}
                >
                  Ubah penempatan
                </Button>
              </>
            ) : undefined
          }
        >
          <dl className="grid gap-3 text-body">
            <div>
              <dt className="text-caption">Unit bisnis</dt>
              <dd>
                {selectedEmployee.business_unit_name ?? "Belum ada unit bisnis"}
              </dd>
            </div>
            <div>
              <dt className="text-caption">Outlet aktif</dt>
              <dd>{selectedEmployee.outlet_name ?? "Belum ada penempatan"}</dd>
            </div>
            <div>
              <dt className="text-caption">Akun pengguna</dt>
              <dd className="mt-1">
                <StatusBadge
                  tone={employeeAccess(selectedEmployee.access_status).tone}
                >
                  {employeeAccess(selectedEmployee.access_status).label}
                </StatusBadge>
              </dd>
            </div>
          </dl>
          <p className="text-caption">
            Profil dan penempatan terpisah dari akun pengguna. Tanggal dan
            riwayat penempatan belum tersedia di sini.
          </p>
          {isOwner ? (
            <>
              <Button
                variant="outline"
                className="self-start"
                render={
                  <a href={settingsContext ? fromSettings(`/access?employeeId=${selectedEmployee.id}`) : `/access?employeeId=${selectedEmployee.id}`} />
                }
              >
                <ArrowUpRight aria-hidden="true" data-icon="inline-start" />
                {employeeAccess(selectedEmployee.access_status).action}
              </Button>
              {data.session.features.kiosk_enabled ? (
                <details
                  open={employeeDialog === "more"}
                  className="rounded-[12px] border border-border p-4"
                >
                  <summary className="flex min-h-11 cursor-pointer items-center text-label">
                    Kode pendaftaran PIN
                  </summary>
                  <form
                    className="mt-4 flex flex-col gap-3"
                    onSubmit={(event) => issuePinCode(event, selectedEmployee.id)}
                  >
                    <LabeledControl
                      label={`Outlet untuk kode PIN ${selectedEmployee.name}`}
                      control={
                        <NativeSelect
                          className="w-full"
                          required
                          value={employeeOutletIds[selectedEmployee.id] ?? ""}
                          onChange={(event) =>
                            setEmployeeOutletIds((current) => ({
                              ...current,
                              [selectedEmployee.id]: event.target.value,
                            }))
                          }
                        >
                          <NativeSelectOption value="">
                            Pilih Outlet
                          </NativeSelectOption>
                          {data.organization.outlets.map((outlet) => (
                            <NativeSelectOption key={outlet.id} value={outlet.id}>
                              {outlet.name}
                            </NativeSelectOption>
                          ))}
                        </NativeSelect>
                      }
                    />
                    <Button
                      type="submit"
                      disabled={busy || !data.organization.outlets.length}
                      isLoading={busy}
                    >
                      Buat kode pendaftaran PIN
                    </Button>
                  </form>
                </details>
              ) : null}
            </>
          ) : null}
          {actionError}
          {oneTimeNotice}
        </ContextDrawer>
      ) : null}

      {data ? (
        <ContextDrawer
          finalFocus={employeeDialogTrigger}
          open={isEditor && isOwner}
          onOpenChange={(open) => {
            if (!open) {
              setEmployeeDialog(null)
              setEditingEmployeeId(null)
            }
          }}
          title={
            employeeDialog === "create"
              ? "Tambah karyawan"
              : employeeDialog === "placement"
                ? "Ubah penempatan"
                : "Ubah profil karyawan"
          }
          description={
            employeeDialog === "create"
              ? "Buat profil dan penempatan. Akun pengguna tidak dibuat otomatis."
                : `${editingEmployeeName} · ${employeeReference(editingEmployeeId ?? 0)} · profil karyawan, bukan perubahan akun pengguna.`
          }
          busy={busy}
          footer={
            <>
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => {
                  setEmployeeDialog(null)
                  setEditingEmployeeId(null)
                }}
              >
                <X aria-hidden="true" data-icon="inline-start" />
                Batal
              </Button>
              <Button
                type="submit"
                form="employee-editor"
                disabled={busy || !data.organization.outlets.length}
                isLoading={busy}
              >
                <Check aria-hidden="true" data-icon="inline-start" />
                {employeeDialog === "create"
                  ? "Simpan karyawan"
                  : employeeDialog === "placement"
                    ? "Simpan penempatan"
                    : "Simpan perubahan"}
              </Button>
            </>
          }
        >
          <form
            id="employee-editor"
            onSubmit={(event) => {
              if (employeeDialog !== "create" && editingEmployeeId === null) {
                event.preventDefault()
                return
              }
              void saveEmployee(
                event,
                employeeDialog === "create"
                  ? undefined
                  : (editingEmployeeId ?? undefined)
              )
            }}
          >
            <FieldGroup className="gap-3.5">
              {employeeDialog !== "placement" ? (
                <LabeledControl
                  label="Nama karyawan"
                  control={
                    <Input
                      required
                      maxLength={120}
                      value={
                        employeeDialog === "create"
                          ? employeeName
                          : editingEmployeeName
                      }
                      onChange={(event) =>
                        employeeDialog === "create"
                          ? setEmployeeName(event.target.value)
                          : setEditingEmployeeName(event.target.value)
                      }
                    />
                  }
                />
              ) : null}
              <LabeledControl
                label="Unit bisnis"
                control={
                  <NativeSelect
                    className="w-full"
                    required
                    value={
                      employeeDialog === "create"
                        ? employeeUnitId
                        : editingEmployeeUnitId
                    }
                    onChange={(event) => {
                      if (employeeDialog === "create") {
                        setEmployeeUnitId(event.target.value)
                        setEmployeeOutletId("")
                      } else {
                        setEditingEmployeeUnitId(event.target.value)
                        setEditingEmployeeOutletId("")
                      }
                    }}
                  >
                    <NativeSelectOption value="">
                      Pilih unit bisnis
                    </NativeSelectOption>
                    {data.organization.business_units.map((unit) => (
                      <NativeSelectOption key={unit.id} value={unit.id}>
                        {unit.name}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                }
              />
              <LabeledControl
                label="Outlet utama"
                helper="Outlet harus berada pada unit bisnis terpilih."
                control={
                  <NativeSelect
                    className="w-full"
                    required
                    value={
                      employeeDialog === "create"
                        ? employeeOutletId
                        : editingEmployeeOutletId
                    }
                    onChange={(event) =>
                      employeeDialog === "create"
                        ? setEmployeeOutletId(event.target.value)
                        : setEditingEmployeeOutletId(event.target.value)
                    }
                  >
                    <NativeSelectOption value="">
                      Pilih Outlet
                    </NativeSelectOption>
                    {data.organization.outlets
                      .filter(
                        (outlet) =>
                          String(outlet.business_unit_id) ===
                          (employeeDialog === "create"
                            ? employeeUnitId
                            : editingEmployeeUnitId)
                      )
                      .map((outlet) => (
                        <NativeSelectOption key={outlet.id} value={outlet.id}>
                          {outlet.name}
                        </NativeSelectOption>
                      ))}
                  </NativeSelect>
                }
              />
              <LabeledControl
                label={
                  employeeDialog === "create"
                    ? "Berlaku mulai"
                    : "Penempatan berlaku mulai"
                }
                helper="Perubahan disimpan dengan tanggal berlaku; penempatan sebelumnya tetap tersimpan."
                control={
                  <Input
                    type="date"
                    required
                    min={
                      employeeDialog === "create" ? undefined : todayJakarta(1)
                    }
                    value={
                      employeeDialog === "create"
                        ? employeeEffectiveFrom
                        : editingEmployeeEffectiveFrom
                    }
                    onChange={(event) =>
                      employeeDialog === "create"
                        ? setEmployeeEffectiveFrom(event.target.value)
                        : setEditingEmployeeEffectiveFrom(event.target.value)
                    }
                  />
                }
              />
            </FieldGroup>
          </form>
          {employeeDialog === "placement" ? (
            <Card className="gap-1 rounded-[12px] border-0 bg-canvas p-3.5">
              <CardHeader className="gap-1 p-0">
                <CardTitle className="text-label">
                  Penempatan saat ini
                </CardTitle>
                <CardDescription>
                  {data.employees.find(
                    (employee) => employee.id === editingEmployeeId
                  )?.outlet_name ?? "Belum ada penempatan"}{" "}
                  ·{" "}
                  {data.employees.find(
                    (employee) => employee.id === editingEmployeeId
                  )?.business_unit_name ?? "Unit tidak tersedia"}
                </CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                <p className="text-caption">
                  Tanggal mulai dan riwayat penempatan belum tersedia.
                </p>
              </CardContent>
            </Card>
          ) : null}
          {setupNotice}
          {actionError}
        </ContextDrawer>
      ) : null}

      {uncertainKiosk ? <ContextAlert tone="danger" title="Hasil tindakan belum dapat dipastikan">Jangan ulangi penerbitan atau pencabutan. Periksa perangkat; kode yang mungkin sudah terbit tidak dapat dipulihkan.<Button onClick={() => { pairingDraft.clear(); window.location.reload() }}>Tutup draf dan periksa perangkat</Button></ContextAlert> : null}
      {data && isOwner ? (
        <ContextDrawer
          open={pairingOpen}
          onOpenChange={open => { if (open) setPairingOpen(true); else pairingDraft.attempt(() => { setPairingOpen(false); setDeviceName(""); setOneTimeCode(null) }) }}
          title={renewalDeviceId === null ? "Pasang perangkat kiosk" : "Perbarui akses perangkat"}
          description={renewalDeviceId === null ? "Kode sekali pakai berlaku lima menit sesuai waktu kedaluwarsa server. Penerbitan tidak membuat perangkat baru dan tidak membatalkan kode sebelumnya." : "Kode pembaruan berlaku lima menit dan menggantikan kode pembaruan sebelumnya. Akses lama berhenti setelah kode digunakan pada perangkat. Perangkat yang sudah dicabut tidak dapat diperbarui."}
          busy={busy}
          footer={
            <Button
              type="submit"
              form="kiosk-pairing"
              disabled={busy || uncertainKiosk || !data.organization.outlets.length}
              isLoading={busy}
            >
              {renewalDeviceId === null ? "Buat kode pemasangan" : "Buat kode pembaruan"}
            </Button>
          }
        >
          <form id="kiosk-pairing" onInputCapture={pairingDraft.mark} onChangeCapture={pairingDraft.mark} onSubmit={issuePairingCode}>
            <FieldGroup className="gap-3.5">
              <LabeledControl
                label="Nama perangkat"
                control={
                  <Input
                    required
                    disabled={renewalDeviceId !== null}
                    maxLength={120}
                    value={deviceName}
                    onChange={(event) => setDeviceName(event.target.value)}
                  />
                }
              />
              <LabeledControl
                label="Outlet"
                control={
                  <NativeSelect
                    className="w-full"
                    required
                    disabled={renewalDeviceId !== null}
                    value={deviceOutletId}
                    onChange={(event) => setDeviceOutletId(event.target.value)}
                  >
                    <NativeSelectOption value="">
                      Pilih Outlet
                    </NativeSelectOption>
                    {data.organization.outlets.map((outlet) => (
                      <NativeSelectOption key={outlet.id} value={outlet.id}>
                        {outlet.name}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                }
              />
            </FieldGroup>
          </form>
          {actionError}
          {copyNotice ? <p role="status">{copyNotice}</p> : null}
          {oneTimeNotice}
        </ContextDrawer>
      ) : null}
      <ConsequenceDialog
        open={revokeDeviceId !== null && isOwner}
        onOpenChange={(open) => {
          if (!open) setRevokeDeviceId(null)
        }}
        title="Cabut akses perangkat?"
        consequence={
          <>
            <span>
              Perangkat tidak dapat dipakai untuk presensi setelah akses
              dicabut. Catatan presensi yang sudah tersimpan tetap
              dipertahankan.
            </span>
            {error ? (
              <span role="alert" className="mt-3 block text-danger-strong">
                {error}
              </span>
            ) : null}
          </>
        }
        actionLabel="Cabut akses"
        busy={busy || uncertainKiosk}
        onConfirm={() => {
          if (revokeDeviceId !== null) void revokeKiosk(revokeDeviceId)
        }}
      />
    </SidebarProvider>
  )
}
