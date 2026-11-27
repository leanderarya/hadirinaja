import { cn } from "@/lib/utils"
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
import { ConsequenceDialog } from "@/components/r2c/components"
import { ShiftTemplateExplorer } from "@/components/r2c/shift-template-explorer"
import { PageHeading, ScopeBanner } from "@/components/r2c/screen-blocks"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { SidebarProvider } from "@/components/ui/sidebar"
import { ApiError, apiRequest, type AuthSession } from "@/lib/api"
import { getAuthRecoveryPath } from "@/lib/auth-navigation"
import {
  canReadTemplates,
  defaultShiftSelection,
  shiftSearch,
  ShiftSaveError,
  type ShiftCommand,
  type ShiftContext,
  type ShiftSelection,
  type ShiftTemplate,
  type ShiftVersion,
} from "@/lib/shift-templates"

export function ShiftTemplatesExperience({
  onContextChange,
}: {
  onContextChange?: (context: ShiftContext | null) => void
} = {}) {
  const location = useLocation()
  const navigate = useNavigate()
  const legacy = location.pathname === "/scheduling"
  const path = legacy ? "/scheduling" : "/settings/shift-templates"
  const currentPath = location.pathname
  const search = shiftSearch(location.search)
  const [data, setData] = useState<{
    session: AuthSession
    context: ShiftContext
  } | null>(null)
  const [loading, setLoading] = useState(true)
  const [denied, setDenied] = useState(false)
  const [error, setError] = useState("")
  const [savedRefreshFailed, setSavedRefreshFailed] = useState(false)
  const [notice, setNotice] = useState("")
  const [dirty, setDirty] = useState(false)
  const [writing, setWriting] = useState(false)
  const [editorVersion, setEditorVersion] = useState(0)
  const dirtyRef = useRef(false),
    writingRef = useRef(false),
    request = useRef(0),
    tenant = useRef<number | null>(null)
  // ponytail: Back and refresh can happen before effects; read input-updated refs synchronously.
  const setUnsaved = useCallback((value: boolean) => {
    dirtyRef.current = value
    setDirty(value)
  }, [])
  const hasUnsaved = useCallback(
    () => dirtyRef.current || writingRef.current,
    []
  )
  const blocker = useBlocker({
    shouldBlockFn: hasUnsaved,
    enableBeforeUnload: hasUnsaved,
    withResolver: true,
  })
  const load = useCallback(
    async (saved = false) => {
      const version = ++request.current
      setLoading(true)
      setError("")
      setSavedRefreshFailed(false)
      try {
        const session = await apiRequest<AuthSession>("/auth/me")
        if (version !== request.current) return
        const membership = session.active_membership
        if (!membership) {
          window.location.assign("/select-tenant")
          return
        }
        if (!canReadTemplates(membership.roles, legacy)) {
          setData(null)
          onContextChange?.(null)
          setNotice("")
          setDenied(true)
          setError(
            "Template shift di Pengaturan hanya tersedia bagi Owner. Supervisor dapat melihatnya melalui Jadwal; karyawan menggunakan jadwal pribadi."
          )
          return
        }
        if (
          tenant.current !== null &&
          tenant.current !== membership.tenant.id
        ) {
          setData(null)
          onContextChange?.(null)
          setNotice("")
        }
        tenant.current = membership.tenant.id
        const context = await apiRequest<ShiftContext>(
          "/management/scheduling/context"
        )
        if (version !== request.current) return
        if (
          context.tenant.id !== membership.tenant.id ||
          !canReadTemplates(context.roles, legacy)
        ) {
          setData(null)
          onContextChange?.(null)
          setNotice("")
          throw new Error("Context mismatch")
        }
        setDenied(false)
        setData({ session, context })
        onContextChange?.(context)
      } catch (caught) {
        if (version !== request.current) return
        const recovery = getAuthRecoveryPath(caught)
        if (recovery) {
          window.location.assign(recovery)
          return
        }
        if (caught instanceof ApiError && caught.status === 403) {
          setData(null)
          onContextChange?.(null)
          setNotice("")
          setDenied(true)
        }
        setSavedRefreshFailed(saved)
        setError(
          saved
            ? "Perubahan sudah dikonfirmasi server, tetapi daftar terbaru belum dapat dimuat. Periksa kembali daftar; perubahan tidak akan dikirim ulang."
            : caught instanceof ApiError
              ? caught.message
              : "Template belum dapat dimuat. Periksa konteks organisasi lalu coba lagi."
        )
      } finally {
        if (version === request.current) setLoading(false)
      }
    },
    [legacy, onContextChange]
  )
  useEffect(() => {
    void load()
    return () => {
      ++request.current
    }
  }, [load])

  const templates = data?.context.shift_templates
  useEffect(() => {
    if (!templates || currentPath !== path) return
    const fallback = defaultShiftSelection(templates, {
      templateId: search.templateId,
      versionId: search.versionId,
    })
    if (fallback) {
      void navigate({
        to: path,
        search: {
          from: search.from,
          q: search.q,
          templateId: fallback.templateId,
          versionId: undefined,
        },
        hash: legacy ? "shift" : undefined,
        replace: true,
      })
      return
    }
    if (!templates.length && (search.templateId || search.versionId)) {
      void navigate({
        to: path,
        search: {
          from: search.from,
          q: search.q,
          templateId: undefined,
          versionId: undefined,
        },
        hash: legacy ? "shift" : undefined,
        replace: true,
      })
    }
  }, [
    legacy,
    currentPath,
    navigate,
    path,
    templates,
    search.from,
    search.q,
    search.templateId,
    search.versionId,
  ])

  function select(next: ShiftSelection, saved = false) {
    if (saved) blocker.reset?.()
    void navigate({
      to: path,
      search: {
        ...search,
        templateId: next.templateId,
        versionId: next.versionId,
      },
      hash: legacy ? "shift" : undefined,
      ignoreBlocker: saved,
    })
  }
  async function save(command: ShiftCommand): Promise<ShiftSelection> {
    if (
      !data?.session.active_membership?.roles.includes("owner") ||
      !data.context.capabilities.manage_templates ||
      !data.context.roles.includes("owner")
    )
      throw new ShiftSaveError("Owner dengan izin kelola template diperlukan.")
    writingRef.current = true
    setWriting(true)
    setNotice("")
    let posting = false
    try {
      const fresh = await apiRequest<ShiftContext>(
        "/management/scheduling/context"
      )
      if (fresh.tenant.id !== data.context.tenant.id) onContextChange?.(null)
      else onContextChange?.(fresh)
      if (
        fresh.tenant.id !== data.context.tenant.id ||
        !fresh.capabilities.manage_templates ||
        !fresh.roles.includes("owner")
      ) {
        setData(null)
        onContextChange?.(null)
        setNotice("")
        setDenied(true)
        setError(
          "Organisasi atau izin berubah. Periksa kembali sebelum melanjutkan."
        )
        throw new ShiftSaveError(
          "Organisasi atau izin berubah. Draf tidak dipindahkan ke konteks lain; periksa kembali izin sebelum melanjutkan."
        )
      }
      if (
        command.kind === "revision" &&
        !fresh.shift_templates.some((item) => item.id === command.templateId)
      )
        throw new ShiftSaveError(
          "Template tidak lagi tersedia. Periksa daftar sebelum membuat revisi."
        )
      const { name, ...revision } = command.draft
      posting = true
      const response = await apiRequest<{
        shift_template?: ShiftTemplate
        version?: ShiftVersion
      }>(
        command.kind === "create"
          ? "/management/scheduling/shifts"
          : `/management/scheduling/shifts/${command.templateId}/versions`,
        {
          method: "POST",
          body: command.kind === "create" ? { name, ...revision } : revision,
        }
      )
      let selection: ShiftSelection
      let templates: ShiftTemplate[]
      if (
        command.kind === "create" &&
        response.shift_template?.id &&
        response.shift_template.versions.length
      ) {
        const created = response.shift_template
        templates = [
          ...fresh.shift_templates.filter((item) => item.id !== created.id),
          created,
        ]
        selection = {
          templateId: created.id,
          versionId: created.versions[0].id,
        }
      } else if (command.kind === "revision" && response.version?.id) {
        const version = response.version
        templates = fresh.shift_templates.map((item) =>
          item.id === command.templateId
            ? {
                ...item,
                versions: [
                  ...item.versions.filter((old) => old.id !== version.id),
                  version,
                ],
              }
            : item
        )
        selection = { templateId: command.templateId, versionId: version.id }
      } else
        throw new ShiftSaveError(
          "Respons penyimpanan tidak lengkap. Periksa daftar dan revisi sebelum membuat perubahan lain; jangan kirim ulang otomatis.",
          true
        )
      setData((current) =>
        current
          ? { ...current, context: { ...fresh, shift_templates: templates } }
          : current
      )
      onContextChange?.({ ...fresh, shift_templates: templates })
      setNotice(
        command.kind === "create"
          ? "Template berhasil dibuat. Penugasan tetap dikelola melalui Jadwal."
          : "Revisi baru tersimpan. Versi pada penugasan yang sudah ada tetap dipertahankan."
      )
      await load(true)
      return selection
    } catch (caught) {
      if (caught instanceof ShiftSaveError) throw caught
      const recovery = getAuthRecoveryPath(caught)
      if (recovery) {
        setData(null)
        onContextChange?.(null)
        setNotice("")
        setUnsaved(false)
        window.location.assign(recovery)
      }
      const uncertain =
        posting && (!(caught instanceof ApiError) || caught.status >= 500)
      throw new ShiftSaveError(
        uncertain
          ? "Hasil penyimpanan belum dapat dipastikan. Periksa daftar/revisi terbaru; jangan mengirim ulang permintaan yang sama secara otomatis."
          : caught instanceof ApiError
            ? caught.message
            : "Pemeriksaan sebelum penyimpanan gagal. Belum ada perubahan yang dikonfirmasi.",
        uncertain,
        caught instanceof ApiError ? caught.errors : undefined
      )
    } finally {
      writingRef.current = false
      setWriting(false)
    }
  }
  const canManage = Boolean(
    data?.session.active_membership?.roles.includes("owner") &&
      data.context.roles.includes("owner") &&
      data.context.capabilities.manage_templates
  )
  const context = data
    ? {
        tenantName: data.context.tenant.name,
        roles: data.context.roles,
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
        data-shift-page
      >
        <ManagementTopbar context={context} settingsBack={!legacy} />
        <main className={cn("mx-auto flex w-full max-w-[1440px] flex-col p-4 md:p-6", legacy ? "gap-5 lg:p-8" : "gap-4 lg:p-6")}>
          {legacy ? <div className="flex">
            <Button
              variant="ghost"
              render={
                <Link
                  to={
                    !legacy || search.from === "settings"
                      ? "/settings"
                      : "/scheduling"
                  }
                  search={
                    legacy && search.from !== "settings"
                      ? shiftSearch({})
                      : undefined
                  }
                />
              }
            >
              {!legacy || search.from === "settings"
                ? "← Kembali ke Pengaturan"
                : "← Kembali ke Jadwal"}
            </Button>
          </div> : null}
          <PageHeading
            title="Template shift"
            minimal={!legacy}
            role={
              context
                ? context.roles.includes("owner")
                  ? "Owner"
                  : "Supervisor"
                : "Pengaturan"
            }
            description="Definisi jam kerja dan revisi template organisasi. Penugasan dikelola di Jadwal."
            className="[&_.text-body]:block"
          />
          {error ? (
            <Alert variant="destructive">
              <AlertTitle>
                {denied ? "Akses tidak tersedia" : "Data belum diperbarui"}
              </AlertTitle>
              <AlertDescription role="alert">{error}</AlertDescription>
              {data && !denied ? (
                <Button
                  variant="outline"
                  className="mt-3"
                  disabled={loading || dirty || writing}
                  onClick={() => void load(savedRefreshFailed)}
                >
                  {savedRefreshFailed ? "Periksa daftar terbaru" : "Coba lagi"}
                </Button>
              ) : null}
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
              Memuat template shift…
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
          {denied ? (
            <Button
              variant="outline"
              className="self-start"
              render={<Link to="/scheduling" search={shiftSearch({})} />}
            >
              Buka Jadwal sesuai akses
            </Button>
          ) : null}
          {data && !denied ? (
            <>
              {legacy ? <ScopeBanner
                title={
                  canManage
                    ? "Template organisasi · kelola definisi"
                    : "Hanya lihat · template organisasi"
                }
              >
                Versi shift pada jadwal yang sudah tersimpan tetap
                dipertahankan.
              </ScopeBanner> : null}
              <ShiftTemplateExplorer
                key={`${data.context.tenant.id}:${editorVersion}`}
                compact={!legacy}
                templates={data.context.shift_templates}
                canManage={canManage}
                selection={search}
                query={search.q ?? ""}
                onSelect={select}
                onQuery={(q) =>
                  void navigate({
                    to: path,
                    search: { ...search, q: q || undefined },
                    hash: legacy ? "shift" : undefined,
                    replace: true,
                  })
                }
                onSave={save}
                onInspect={() => void load()}
                onDirtyChange={setUnsaved}
              />
            </>
          ) : null}
        </main>
      </div>
      <ConsequenceDialog
        open={blocker.status === "blocked"}
        onOpenChange={(open) => {
          if (!open) blocker.reset?.()
        }}
        title="Tinggalkan draf template?"
        consequence="Perubahan belum disimpan. Tetap di editor atau buang draf untuk melanjutkan."
        actionLabel="Buang dan lanjutkan"
        busy={writing}
        onConfirm={() => {
          setUnsaved(false)
          setEditorVersion((value) => value + 1)
          blocker.proceed?.()
        }}
      />
    </SidebarProvider>
  )
}
