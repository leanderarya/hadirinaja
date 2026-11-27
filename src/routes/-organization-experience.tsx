import {
  Link,
  useBlocker,
  useLocation,
  useNavigate,
} from "@tanstack/react-router"
import { useCallback, useEffect, useRef, useState } from "react"
import {
  ManagementSidebar,
  ManagementTopbar,
} from "@/components/management-sidebar"
import { OrganizationExplorer } from "@/components/r2c/organization-explorer"
import { ConsequenceDialog } from "@/components/r2c/components"
import { PageHeading, ScopeBanner } from "@/components/r2c/screen-blocks"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { SidebarProvider } from "@/components/ui/sidebar"
import {
  ApiError,
  apiRequest,
  type AuthSession,
  type OrganizationSummary,
} from "@/lib/api"
import {
  organizationSearch,
  type OrganizationCommand,
  type OrganizationSelection,
} from "@/lib/organization-explorer"

export function OrganizationExperience() {
  const location = useLocation()
  const navigate = useNavigate()
  const search = organizationSearch(location.search)
  const [data, setData] = useState<{
    session: AuthSession
    organization: OrganizationSummary
  } | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")
  const [dirty, setDirty] = useState(false)
  const [writing, setWriting] = useState(false)
  const [editorVersion, setEditorVersion] = useState(0)
  // ponytail: Back/refresh can run before effects; input events update these guards immediately.
  const dirtyRef = useRef(false)
  const writingRef = useRef(false)
  const setUnsavedChanges = useCallback((value: boolean) => {
    dirtyRef.current = value
    setDirty(value)
  }, [])
  const hasUnsavedChanges = useCallback(
    () => dirtyRef.current || writingRef.current,
    []
  )
  const [denied, setDenied] = useState(false)
  const request = useRef(0)
  const activeTenant = useRef<number | null>(null)
  const blocker = useBlocker({
    shouldBlockFn: hasUnsavedChanges,
    enableBeforeUnload: hasUnsavedChanges,
    withResolver: true,
  })
  const path =
    location.pathname === "/workspace" ? "/workspace" : "/settings/organization"

  const load = useCallback(async (afterSave = false) => {
    const version = ++request.current
    setLoading(true)
    setError("")
    try {
      const session = await apiRequest<AuthSession>("/auth/me")
      if (version !== request.current) return
      const membership = session.active_membership
      if (!membership) {
        window.location.assign("/select-tenant")
        return
      }
      if (
        !membership?.roles.some(
          (role) => role === "owner" || role === "supervisor"
        )
      ) {
        setData(null)
        setNotice("")
        setDenied(true)
        setError(
          "Organisasi hanya tersedia untuk Owner dan Supervisor yang berwenang."
        )
        return
      }
      if (
        activeTenant.current !== null &&
        activeTenant.current !== membership.tenant.id
      ) {
        setData(null)
        setNotice("")
      }
      activeTenant.current = membership.tenant.id
      const organization = await apiRequest<OrganizationSummary>(
        "/management/organization"
      )
      if (version !== request.current) return
      if (organization.tenant.id !== membership.tenant.id) {
        setData(null)
        setNotice("")
        throw new Error("Konteks organisasi aktif berubah.")
      }
      setDenied(false)
      setData({ session, organization })
    } catch (caught) {
      if (version !== request.current) return
      if (caught instanceof ApiError && [401, 419].includes(caught.status)) {
        window.location.assign("/login?expired=1")
        return
      }
      if (caught instanceof ApiError && caught.status === 403) {
        setData(null)
        setNotice("")
        setDenied(true)
      }
      setError(
        afterSave
          ? "Perubahan sudah tersimpan. Data terbaru belum dapat dimuat; muat ulang tanpa menyimpan ulang."
          : caught instanceof ApiError
            ? caught.message
            : "Data organisasi belum dapat dimuat. Coba muat ulang."
      )
    } finally {
      if (version === request.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
    return () => {
      ++request.current
    }
  }, [load])

  function select(next: OrganizationSelection, afterSave = false) {
    if (afterSave) blocker.reset?.()
    void navigate({
      to: path,
      search: {
        ...search,
        ...next,
        unitId: next.unitId,
        outletId: next.outletId,
      },
      hash: path === "/workspace" ? "organization" : undefined,
      ignoreBlocker: afterSave,
    })
  }

  async function save(
    command: OrganizationCommand
  ): Promise<OrganizationSelection> {
    if (
      !data?.session.active_membership?.roles.includes("owner") ||
      !data.organization.roles.includes("owner")
    )
      throw new Error("Owner required")
    const unitCommand =
      command.kind === "create-unit" || command.kind === "rename-unit"
    const create =
      command.kind === "create-unit" || command.kind === "create-outlet"
    const endpoint = `/management/${unitCommand ? "business-units" : "outlets"}${!create && "id" in command ? `/${command.id}` : ""}`
    setNotice("")
    writingRef.current = true
    setWriting(true)
    try {
      const result = await apiRequest<{
        business_unit?: OrganizationSummary["business_units"][number]
        outlet?: OrganizationSummary["outlets"][number]
      }>(endpoint, {
        method: create ? "POST" : "PUT",
        body:
          command.kind === "create-outlet"
            ? {
                name: command.name,
                business_unit_id: command.unitId,
                address: command.address,
              }
            : command.kind === "rename-outlet"
              ? { name: command.name, address: command.address }
            : { name: command.name },
      })
      const unit = result.business_unit
      const outlet = result.outlet
      if ((unitCommand && !unit) || (!unitCommand && !outlet)) {
        await load(true)
        throw new ApiError(
          "Perubahan mungkin sudah tersimpan, tetapi respons tidak lengkap. Muat ulang dan periksa data sebelum menyimpan ulang.",
          502
        )
      }
      setData((current) =>
        current
          ? {
              ...current,
              organization: {
                ...current.organization,
                business_units: unit
                  ? [
                      ...current.organization.business_units.filter(
                        (item) => item.id !== unit.id
                      ),
                      unit,
                    ]
                  : current.organization.business_units,
                outlets: outlet
                  ? [
                      ...current.organization.outlets.filter(
                        (item) => item.id !== outlet.id
                      ),
                      outlet,
                    ]
                  : current.organization.outlets,
              },
            }
          : current
      )
      setNotice(
        `${command.name} berhasil ${create ? "ditambahkan" : "diperbarui"}.`
      )
      await load(true)
      return outlet
        ? { unitId: outlet.business_unit_id, outletId: outlet.id }
        : { unitId: unit?.id }
    } finally {
      writingRef.current = false
      setWriting(false)
    }
  }

  const owner = Boolean(
    data?.session.active_membership?.roles.includes("owner") &&
      data.organization.roles.includes("owner")
  )
  const context = data
    ? {
        tenantName: data.organization.tenant.name,
        roles: data.session.active_membership?.roles ?? [],
        userName: data.session.user.name,
        kioskEnabled: data.session.features.kiosk_enabled,
      }
    : null

  return (
    <SidebarProvider className="pb-[calc(6rem+env(safe-area-inset-bottom))] md:pb-0">
      {context ? (
        <ManagementSidebar activePage="settings" context={context} />
      ) : null}
      <div
        className="min-h-svh min-w-0 flex-1 bg-canvas [overflow-wrap:anywhere]"
        data-organization-page
      >
        <ManagementTopbar context={context} />
        <main className="mx-auto flex w-full max-w-[1440px] flex-col gap-5 p-4 md:p-6 lg:p-8">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Button
              variant="ghost"
              render={
                <Link
                  to={
                    search.from === "settings" ||
                    path === "/settings/organization"
                      ? "/settings"
                      : "/workspace"
                  }
                />
              }
            >
              {search.from === "settings" || path === "/settings/organization"
                ? "← Kembali ke Pengaturan"
                : "← Kembali ke Tim"}
            </Button>
            {!denied ? (
              <Button
                variant="outline"
                disabled={loading || dirty}
                onClick={() => void load()}
              >
                Muat ulang
              </Button>
            ) : null}
          </div>
          <PageHeading
            title="Organisasi"
            role={data ? (owner ? "Owner" : "Supervisor") : "Pengaturan"}
            description="Jelajahi unit bisnis dan Outlet, lalu kelola informasi pada tempatnya."
            className="[&_.text-body]:block"
          />
          {error ? (
            <Alert variant="destructive">
              <AlertTitle>
                {denied ? "Akses tidak tersedia" : "Data belum diperbarui"}
              </AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          {notice ? (
            <Alert>
              <AlertTitle>Perubahan tersimpan</AlertTitle>
              <AlertDescription role="status">{notice}</AlertDescription>
            </Alert>
          ) : null}
          {loading && !data ? (
            <p role="status" className="text-body text-muted-foreground">
              Memuat organisasi…
            </p>
          ) : null}
          {!loading && !data && !denied ? (
            <Button
              variant="outline"
              className="self-start"
              onClick={() => void load()}
            >
              Coba lagi
            </Button>
          ) : null}
          {data && !denied ? (
            <>
              {!owner ? (
                <ScopeBanner title="Hanya lihat · Outlet yang dapat diakses">
                  Hanya struktur yang diizinkan untuk Anda yang ditampilkan.
                  Hubungi Owner untuk perubahan.
                </ScopeBanner>
              ) : null}
              <OrganizationExplorer
                key={`${data.organization.tenant.id}:${editorVersion}`}
                organization={data.organization}
                canManage={owner}
                selection={search}
                query={search.q ?? ""}
                onQuery={(q) =>
                  void navigate({
                    to: path,
                    search: { ...search, q: q || undefined },
                    hash: path === "/workspace" ? "organization" : undefined,
                    replace: true,
                  })
                }
                onSelect={select}
                onSave={save}
                onDirtyChange={setUnsavedChanges}
              />
              <p className="text-caption text-muted-foreground">
                Profil dan penempatan karyawan dikelola di{" "}
                <Link
                  className="text-primary underline underline-offset-4"
                  to="/workspace"
                  search={organizationSearch({})}
                  hash="people-devices"
                >
                  Tim
                </Link>
                .
              </p>
            </>
          ) : null}
        </main>
      </div>
      <ConsequenceDialog
        open={blocker.status === "blocked"}
        onOpenChange={(open) => {
          if (!open) blocker.reset?.()
        }}
        title="Tinggalkan perubahan?"
        consequence="Editor masih berisi perubahan yang belum disimpan. Tetap di sini untuk melanjutkan atau buang perubahan dan lanjutkan navigasi."
        actionLabel="Buang dan lanjutkan"
        busy={writing}
        onConfirm={() => {
          setUnsavedChanges(false)
          setEditorVersion((version) => version + 1)
          blocker.proceed?.()
        }}
      />
    </SidebarProvider>
  )
}
