import { useBlocker, useLocation, useNavigate } from "@tanstack/react-router"
import {
  Building2,
  ChevronRight,
  Clock3,
  MapPin,
  SlidersHorizontal,
} from "lucide-react"
import {
  type ComponentProps,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react"
import { OutletGeofenceMap } from "@/components/outlet-geofence-map"
import { ContextAlert, LabeledControl } from "@/components/r2c/components"
import { PageHeading } from "@/components/r2c/screen-blocks"
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
import { Button } from "@/components/ui/button"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty"
import { Input } from "@/components/ui/input"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { ApiError, apiRequest } from "@/lib/api"
import { configurationSearch } from "@/lib/configuration-navigation"
import {
  buildPolicySnapshot,
  changedPolicyFields,
  hasPolicyOverride,
  type PolicyConfiguration,
  type PolicyDraft,
  type PolicyGroup,
  type PolicyKey,
  type PolicyResponse,
  type PolicyScope,
  policyDefaults,
  policyDraft,
  policyFields,
  policyFingerprint,
  policyLeaf,
  utcToday,
  validatePolicyDate,
  validatePolicyDraft,
} from "@/lib/policy-editor"
import { policyValueText } from "@/lib/policy-presentation"

type Context = {
  tenant: { id: number; name: string }
  business_units: Array<{ id: number; name: string }>
  outlets: Array<{ id: number; name: string; business_unit_id: number }>
  capabilities: { manage_policies: boolean }
}
type View = "overview" | "select" | "groups" | "review" | PolicyGroup
const groups = [
  {
    key: "time",
    title: "Waktu presensi",
    summary: "Presensi masuk sebelum atau setelah mulai dan toleransi keterlambatan.",
    icon: Clock3,
  },
  {
    key: "location",
    title: "Lokasi presensi",
    summary: "Radius dan titik lokasi. Validasi lokasi tetap wajib.",
    icon: MapPin,
  },
  {
    key: "other",
    title: "Ketentuan lainnya",
    summary: "Mode presensi, batas pengajuan dan pemberitahuan jadwal.",
    icon: SlidersHorizontal,
  },
] as const
const tomorrowUTC = () =>
  new Date(Date.now() + 86400000).toISOString().slice(0, 10)
function Surface({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="policy-surface">
      <h2 className="text-subtitle text-[16px] font-normal">{title}</h2>
      {children}
    </section>
  )
}
function PolicyRow({
  title,
  children,
  onClick,
  icon,
  expanded,
  current,
}: {
  title: string
  children: ReactNode
  onClick?: () => void
  icon?: ReactNode
  expanded?: boolean
  current?: boolean
}) {
  const content = (
    <>
      {icon ? (
        <span className="shrink-0 text-primary" aria-hidden="true">
          {icon}
        </span>
      ) : null}
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="text-label text-[14px] font-normal">{title}</span>
        <span className="text-caption text-[13px] text-muted-foreground">
          {children}
        </span>
      </span>
      {onClick ? (
        <ChevronRight
          size={16}
          className="shrink-0 text-muted-foreground"
          aria-hidden="true"
        />
      ) : null}
    </>
  )
  return onClick ? (
    <button
      type="button"
      data-pen-origin="WnmUr"
      className="policy-row text-start"
      onClick={onClick}
      aria-expanded={expanded}
      aria-current={current ? "true" : undefined}
    >
      {content}
    </button>
  ) : (
    <div data-pen-origin="WnmUr" className="policy-row">
      {content}
    </div>
  )
}

function PolicyDialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  size,
  busy = false,
  finalFocus,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: string
  children: ReactNode
  footer?: ReactNode
  size: "picker" | "editor"
  busy?: boolean
  finalFocus?: ComponentProps<typeof DialogContent>["finalFocus"]
}) {
  const width = size === "editor" ? "sm:max-w-[720px]" : "sm:max-w-[560px]"

  return (
    <Dialog
      open={open}
      modal
      onOpenChange={(nextOpen) => {
        if (!busy) onOpenChange(nextOpen)
      }}
    >
      <DialogContent
        data-policy-modal={size}
        finalFocus={finalFocus}
        showCloseButton={!busy}
        className={`flex max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-[calc(100%-2rem)] min-h-0 flex-col gap-0 overflow-hidden p-0 ${width}`}
      >
        <DialogHeader className="shrink-0 border-b border-border p-4 pr-16 sm:p-5 sm:pr-16">
          <DialogTitle className="text-subtitle text-[18px] font-normal">
            {title}
          </DialogTitle>
          <DialogDescription className="text-caption text-muted-foreground">
            {description}
          </DialogDescription>
        </DialogHeader>
        <div
          data-policy-modal-body={size}
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 sm:p-5"
        >
          {children}
        </div>
        {footer ? (
          <DialogFooter className="shrink-0 border-t border-border p-4 pb-[max(16px,env(safe-area-inset-bottom))] sm:p-5">
            {footer}
          </DialogFooter>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

export function AttendancePolicy({
  context,
  settingsContext,
  compact = false,
}: {
  context: Context
  settingsContext: boolean
  compact?: boolean
}) {
  const location = useLocation()
  const navigate = useNavigate()
  const search = configurationSearch(location.search)
  const requestedOutletId = search.outletId ? String(search.outletId) : ""
  const selectedOutlet = context.outlets.find(
    (candidate) => String(candidate.id) === requestedOutletId
  )
  const outletId = String(
    selectedOutlet?.id ?? context.outlets[0]?.id ?? ""
  )
  const changeSearch = (
    next: Partial<typeof search>,
    replace = false
  ) =>
    void navigate({
      to:
        location.pathname === "/scheduling"
          ? "/scheduling"
          : "/settings/attendance-policy",
      search: { ...search, ...next },
      hash: location.pathname === "/scheduling" ? "kebijakan" : undefined,
      ignoreBlocker: true,
      replace,
    })
  const setOutletId = (value: string) => changeSearch({ outletId: Number(value) || undefined, scope: "outlet" })
  const [unitId, setUnitId] = useState("")
  const [outletSearch, setOutletSearch] = useState("")
  const scope: PolicyScope = context.capabilities.manage_policies ? search.scope : "outlet"
  const setScope = (value: PolicyScope) => changeSearch({ scope: value })
  const [expanded, setExpanded] = useState<string | null>(null)
  const [view, setView] = useState<View>("overview")
  const [data, setData] = useState<PolicyResponse | null>(null)
  const [base, setBase] = useState<PolicyConfiguration | null>(null)
  const [draft, setDraft] = useState<PolicyDraft | null>(null)
  const [review, setReview] = useState<PolicyResponse | null>(null)
  const [date, setDate] = useState(tomorrowUTC)
  const [reason, setReason] = useState("")
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const policyWriting = useRef(false)
  const [error, setError] = useState("")
  const [warning, setWarning] = useState("")
  const [notice, setNotice] = useState("")
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [unknown, setUnknown] = useState(false)
  const [contextInvalid, setContextInvalid] = useState(false)
  const [retry, setRetry] = useState(0)
  const [pending, setPending] = useState<(() => void) | null>(null)
  const titleRef = useRef<HTMLDivElement>(null)
  const errorRef = useRef<HTMLDivElement>(null)
  const outletTriggerRef = useRef<HTMLButtonElement>(null)
  const editTriggerRef = useRef<HTMLButtonElement>(null)
  const discardTrigger = useRef<HTMLElement | null>(null)
  const bypass = useRef(false)
  const requestScope = useRef(0)
  const changed = base && draft ? changedPolicyFields(base, draft) : []
  const dirty =
    changed.length > 0 || Boolean(draft && !data?.effective.tenant_default)
  const pickerOpen = compact && view === "select"
  const editorOpen =
    compact && Boolean(draft && base && view !== "overview" && view !== "select")
  const overviewVisible =
    view === "overview" || (compact && (pickerOpen || editorOpen))
  // ponytail: the parent guards hash tabs synchronously; blocking them twice can remount and discard a cancelled draft.
  const blocked = useBlocker({
    shouldBlockFn: ({ current, next }) =>
      !bypass.current &&
      (dirty || busy) &&
      (current.pathname !== next.pathname ||
        JSON.stringify(current.search) !== JSON.stringify(next.search)),
    enableBeforeUnload: () => !bypass.current && (dirty || busy),
    withResolver: true,
  })
  // Normalize only while this route is active; otherwise its cleanup transition
  // can replace an outgoing navigation to /settings.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the search snapshot only changes when one of the listed selection/context values changes.
  useEffect(() => {
    if (
      !compact ||
      location.pathname !== "/settings/attendance-policy" ||
      scope !== "outlet" ||
      !outletId ||
      requestedOutletId === outletId ||
      dirty ||
      busy
    )
      return
    changeSearch({ outletId: Number(outletId) }, true)
  }, [compact, location.pathname, scope, outletId, requestedOutletId, dirty, busy])
  const canEdit = context.capabilities.manage_policies
  const outlet = context.outlets.find((o) => String(o.id) === outletId)
  const unit = context.business_units.find(
    (u) => u.id === outlet?.business_unit_id
  )
  const identity =
    scope === "tenant"
      ? `Kebijakan organisasi · ${context.tenant.name}`
      : `${outlet?.name ?? "Pilih Outlet"} · ${unit?.name ?? "—"} · ${context.tenant.name}`
  const current =
    scope === "tenant"
      ? data?.effective.tenant_default
      : data?.effective.configuration
  const source = (key: PolicyKey) =>
    scope === "tenant"
      ? "Kebijakan organisasi"
      : hasPolicyOverride(data?.effective.outlet_overrides, key)
        ? "Pengaturan khusus Outlet"
        : "Mengikuti organisasi"
  const outletOverrideCount = data
    ? policyFields.filter((field) =>
        hasPolicyOverride(data.effective.outlet_overrides, field.key)
      ).length
    : 0
  const policySource =
    scope === "tenant" || outletOverrideCount === 0
      ? "Kebijakan organisasi"
      : outletOverrideCount === policyFields.length
        ? "Pengaturan khusus Outlet"
        : "Kebijakan organisasi + pengaturan khusus Outlet"
  const outletQuery = outletSearch.trim().toLowerCase()
  const filteredOutlets = context.outlets.filter((candidate) => {
    const businessUnitName =
      context.business_units.find(
        (businessUnit) => businessUnit.id === candidate.business_unit_id
      )?.name ?? ""
    return (
      (!unitId || String(candidate.business_unit_id) === unitId) &&
      (!outletQuery ||
        `${candidate.name} ${businessUnitName}`
          .toLowerCase()
          .includes(outletQuery))
    )
  })
  const endpoint = (targetDate?: string) => {
    const query = new URLSearchParams()
    if (scope === "outlet") query.set("outlet_id", outletId)
    if (targetDate ?? search.date) query.set("effective_date", (targetDate ?? search.date) as string)
    return `/management/scheduling/policies?${query}`
  }
  const clearDraft = () => {
    setBase(null)
    setDraft(null)
    setReview(null)
    setErrors({})
    setWarning("")
    setReason("")
    setUnknown(false)
  }
  // Scope/history navigation starts a fresh read-only view; confirmed saves keep the same URL.
  // biome-ignore lint/correctness/useExhaustiveDependencies: clearDraft only resets editor state, not URL context.
  useEffect(() => { clearDraft(); setView("overview") }, [outletId, scope, search.date])
  const attempt = (action: () => void) => {
    if (busy) return
    if (dirty) {
      discardTrigger.current = document.activeElement as HTMLElement
      setPending(() => action)
    } else action()
  }
  // biome-ignore lint/correctness/useExhaustiveDependencies: retry intentionally reloads the same read-only context.
  useEffect(() => {
    const abort = new AbortController()
    requestScope.current++
    setData(null)
    setLoading(true)
    setError("")
    if (scope === "outlet" && !outletId) {
      setLoading(false)
      return
    }
    const query = new URLSearchParams(
      scope === "outlet" ? { outlet_id: outletId } : {}
    )
    if (search.date) query.set("effective_date", search.date)
    apiRequest<PolicyResponse>(`/management/scheduling/policies?${query}`, {
      signal: abort.signal,
    })
      .then((result) => {
        if (!abort.signal.aborted) setData(result)
      })
      .catch((caught) => {
        if (!abort.signal.aborted)
          setError(
            caught instanceof Error
              ? caught.message
              : "Kebijakan belum dapat dimuat."
          )
      })
      .finally(() => {
        if (!abort.signal.aborted) setLoading(false)
      })
    return () => {
      abort.abort()
      requestScope.current++
    }
  }, [outletId, scope, retry, search.date])
  // biome-ignore lint/correctness/useExhaustiveDependencies: page transitions move focus to the page title; modal focus stays with Dialog.
  useEffect(() => {
    if (compact) return
    titleRef.current?.focus({ preventScroll: true })
    window.scrollTo(0, 0)
  }, [compact, view, scope])
  useEffect(() => {
    if (!pickerOpen && (error || Object.keys(errors).length))
      errorRef.current?.focus()
  }, [error, errors, pickerOpen])
  useEffect(() => {
    const expire = () => {
      bypass.current = true
    }
    window.addEventListener("hadirinaja:session-expired", expire, true)
    return () =>
      window.removeEventListener("hadirinaja:session-expired", expire, true)
  }, [])
  useEffect(() => {
    if (!dirty && !busy) return
    const capture = (event: MouseEvent) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      )
        return
      const anchor = (event.target as Element).closest?.(
        "a[href]"
      ) as HTMLAnchorElement | null
      if (
        !anchor ||
        anchor.target === "_blank" ||
        anchor.hasAttribute("download")
      )
        return
      if (anchor.href === window.location.href) return
      event.preventDefault()
      event.stopImmediatePropagation()
      if (busy) return
      discardTrigger.current = anchor
      setPending(() => () => {
        bypass.current = true
        window.location.assign(anchor.href)
      })
    }
    const unload = (event: BeforeUnloadEvent) => {
      if (!bypass.current) {
        event.preventDefault()
        event.returnValue = ""
      }
    }
    document.addEventListener("click", capture, true)
    window.addEventListener("beforeunload", unload)
    return () => {
      document.removeEventListener("click", capture, true)
      window.removeEventListener("beforeunload", unload)
    }
  }, [dirty, busy])
  // Parent configuration tabs use state before changing their hash; guard them before either changes.
  useEffect(() => {
    const leave = (event: Event) => {
      if (!dirty && !busy) return
      event.preventDefault()
      if (busy) return
      const action = (event as CustomEvent<() => void>).detail
      discardTrigger.current = document.activeElement as HTMLElement
      setPending(() => () => {
        clearDraft()
        action()
      })
    }
    window.addEventListener("hadirinaja:leave-policy", leave)
    return () => window.removeEventListener("hadirinaja:leave-policy", leave)
  })
  const enter = () => {
    if (!canEdit || !data || (scope === "outlet" && !current)) return
    setBase(structuredClone(current ?? policyDefaults))
    setDraft(policyDraft(current ?? policyDefaults))
    setView("groups")
    setDate(tomorrowUTC())
    setError("")
    setNotice("")
    setWarning("")
    setReason("")
    setReview(null)
  }
  const switchOutlet = (id: string) =>
    attempt(() => {
      clearDraft()
      setOutletId(id)
      setView("overview")
      setNotice("")
    })
  const openOutletPicker = () => {
    setOutletSearch("")
    setUnitId("")
    setView("select")
  }
  const closeOutletPicker = () => attempt(() => setView("overview"))
  const closeEditor = () =>
    attempt(() => {
      clearDraft()
      setView("overview")
    })
  const changeScope = (next: PolicyScope) =>
    attempt(() => {
      if (next === "tenant" && !canEdit) return
      clearDraft()
      setScope(next)
      setView("overview")
      setNotice("")
    })
  const checkDraft = () => {
    if (!draft) return false
    const next = validatePolicyDraft(draft)
    setErrors(next)
    if (Object.keys(next).length) {
      setError("Periksa nilai pada bagian yang diubah.")
      return false
    }
    setError("")
    return true
  }
  const verifyEditingContext = async () => {
    const fresh = await apiRequest<Context>("/management/scheduling/context")
    if (
      fresh.tenant.id !== context.tenant.id ||
      !fresh.capabilities.manage_policies ||
      (scope === "outlet" &&
        !fresh.outlets.some((o) => String(o.id) === outletId))
    ) {
      requestScope.current++
      clearDraft()
      setData(null)
      setView("overview")
      setContextInvalid(true)
      throw new Error(
        "Organisasi aktif atau hak akses berubah. Muat ulang halaman sebelum melanjutkan; draf tidak dipindahkan ke konteks lain."
      )
    }
  }
  const prepareReview = async () => {
    if (
      !canEdit ||
      !draft ||
      !base ||
      !checkDraft() ||
      (!dirty && data?.effective.tenant_default)
    )
      return
    setView("review")
    setError("")
    setReview(null)
    if (!validatePolicyDate(date)) {
      setError("Pilih tanggal hari ini atau ke depan menurut UTC.")
      return
    }
    const generation = requestScope.current
    setBusy(true)
    try {
      await verifyEditingContext()
      if (generation !== requestScope.current) return
      const target = await apiRequest<PolicyResponse>(endpoint(date))
      if (generation !== requestScope.current) return
      buildPolicySnapshot(target, scope, changed, draft)
      setReview(target)
      if (
        data &&
        policyFingerprint(data, scope) !== policyFingerprint(target, scope)
      )
        setWarning(
          "Kebijakan pada tanggal pilihan berbeda dari ringkasan saat ini. Periksa nilai pada tanggal berlaku sebelum menyimpan."
        )
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Pemeriksaan belum dapat dimuat."
      )
    } finally {
      setBusy(false)
    }
  }
  const save = async () => {
    if (
      !canEdit ||
      !review ||
      !draft ||
      !base ||
      busy ||
      policyWriting.current ||
      unknown ||
      !checkDraft()
    )
      return
    if (
      !validatePolicyDate(date) ||
      reason.trim().length < 3 ||
      reason.trim().length > 1000
    ) {
      setError(
        "Tanggal harus hari ini/ke depan UTC dan alasan wajib 3–1000 karakter."
      )
      return
    }
    policyWriting.current = true
    const generation = requestScope.current
    setBusy(true)
    setError("")
    let confirmed = false,
      posting = false
    try {
      await verifyEditingContext()
      if (generation !== requestScope.current) return
      const latest = await apiRequest<PolicyResponse>(endpoint(date))
      if (generation !== requestScope.current) return
      if (
        policyFingerprint(latest, scope) !== policyFingerprint(review, scope)
      ) {
        setReview(latest)
        setWarning(
          "Kebijakan berubah sejak pemeriksaan terakhir. Draf tetap tersedia; periksa kembali nilai pada tanggal berlaku sebelum menyimpan."
        )
        return
      }
      const snapshot = buildPolicySnapshot(latest, scope, changed, draft)
      posting = true
      await apiRequest(
        scope === "tenant"
          ? "/management/scheduling/policies/tenant"
          : `/management/scheduling/outlets/${outletId}/policy`,
        {
          method: "POST",
          body: {
            effective_from: date,
            reason: reason.trim(),
            [scope === "tenant" ? "configuration" : "overrides"]: snapshot,
          },
        }
      )
      confirmed = true
      clearDraft()
      setView("overview")
      setNotice(
        date > utcToday()
          ? `Perubahan untuk ${scope === "tenant" ? context.tenant.name : outlet?.name} terjadwal mulai ${date} (UTC). Ringkasan tetap menampilkan kebijakan hari ini.`
          : "Perubahan dikonfirmasi server. Kebijakan terbaru dimuat kembali."
      )
      const refreshed = await apiRequest<PolicyResponse>(endpoint())
      if (generation === requestScope.current) setData(refreshed)
    } catch (caught) {
      if (confirmed)
        setError(
          "Perubahan tersimpan, tetapi ringkasan terbaru belum dapat dimuat. Muat ulang data; jangan kirim ulang perubahan."
        )
      else if (
        posting &&
        (!(caught instanceof ApiError) || caught.status >= 500)
      ) {
        setUnknown(true)
        setError(
          "Hasil penyimpanan belum dapat dipastikan. Periksa versi terbaru sebelum membuat perubahan lain; jangan kirim ulang permintaan ini."
        )
      } else {
        const fields =
          caught instanceof ApiError
            ? Object.values(caught.errors ?? {})
                .flat()
                .join(" ")
            : ""
        setError(
          `${caught instanceof Error ? caught.message : "Perubahan belum tersimpan."} ${fields}`.trim()
        )
      }
    } finally {
      policyWriting.current = false
      setBusy(false)
    }
  }
  const title =
    view === "select"
      ? "Pilih Outlet"
      : view === "groups"
        ? scope === "tenant"
          ? "Ubah kebijakan organisasi"
          : "Ubah kebijakan Outlet"
        : view === "review"
          ? scope === "tenant"
            ? "Tinjau kebijakan organisasi"
            : "Tinjau perubahan Outlet"
          : (groups.find((g) => g.key === view)?.title ??
            (scope === "tenant"
              ? "Kebijakan organisasi"
              : "Kebijakan presensi"))
  const changeValue = (key: PolicyKey, value: string) => {
    if (!draft) return
    setDraft({ ...draft, [key]: value })
    setReview(null)
    setErrors({})
    setError("")
  }
  const reviewBase =
    scope === "tenant"
      ? review?.effective.tenant_default
      : review?.effective.configuration
  const finish = () => {
    if (checkDraft()) setView("groups")
  }
  const historyDetails =
    canEdit && data?.history ? (
      <details>
        <summary className="flex min-h-11 cursor-pointer items-center text-label text-[14px]">
          Lihat identitas dan riwayat versi
        </summary>
        <p className="text-caption">
          Tanggal berlaku berikut adalah tanggal versi. ID bukan nomor revisi.
        </p>
        {[
          ...data.history.tenant_versions.map((version) => ({
            ...version,
            kind: "Organisasi",
          })),
          ...(scope === "outlet"
            ? data.history.outlet_versions.map((version) => ({
                ...version,
                kind: "Outlet",
              }))
            : []),
        ].map((version) => (
          <p
            className="border-b border-border py-3 text-caption"
            key={`${version.kind}-${version.id}`}
          >
            {version.kind} · ID {version.id} · {version.effective_from} ·{" "}
            {version.reason ?? "Tanpa alasan tercatat"} · ID pengguna{" "}
            {version.actor_user_id ?? "—"} ·{" "}
            {policyValueText(
              "configuration" in version
                ? version.configuration
                : version.overrides
            )}
          </p>
        ))}
      </details>
    ) : null
  const editorContent =
    draft && base && view !== "overview" && view !== "select" ? (
        <div data-policy-ux="true" className="policy-focus flex flex-col gap-4">
          {compact && (error || Object.keys(errors).length) ? (
            <div ref={errorRef} tabIndex={-1} className="outline-none">
              <ContextAlert tone="danger" title="Periksa perubahan">
                {error || "Periksa field yang ditandai."}
              </ContextAlert>
            </div>
          ) : null}
          <ContextAlert
            title={view === "review" ? "Belum disimpan" : "Draf belum berlaku"}
          >
            {scope === "tenant"
              ? `Perubahan kebijakan ${context.tenant.name} dapat memengaruhi Outlet yang mengikutinya; pengaturan khusus Outlet tetap berlaku. `
              : `Perubahan untuk ${outlet?.name}; nilai yang tidak diubah tetap mengikuti organisasi. `}
            Nilai yang berlaku tetap digunakan sampai versi baru berlaku. Tanggal efektif dipilih saat meninjau perubahan dan menggunakan UTC.
          </ContextAlert>
          {warning ? (
            <ContextAlert tone="warning" title="Tinjau kembali">
              {warning}
            </ContextAlert>
          ) : null}
          {scope === "outlet" && view === "groups" ? (
            <Button
              variant="ghost"
              className="w-fit"
              disabled={busy}
              onClick={() =>
                attempt(() => {
                  clearDraft()
                  setView("select")
                })
              }
            >
              Ganti Outlet
            </Button>
          ) : null}
          {view === "groups" ? (
            <Surface title="Apa yang ingin diubah?">
              {groups.map((g) => (
                <PolicyRow
                  key={g.key}
                  title={g.title}
                  onClick={() => {
                    setView(g.key)
                    setError("")
                  }}
                  icon={<g.icon size={18} />}
                >
                  {g.summary}
                  {changed.filter((f) => f.group === g.key).length
                    ? ` · ${changed.filter((f) => f.group === g.key).length} field berubah`
                    : ""}
                </PolicyRow>
              ))}
              <Button
                variant={dirty ? "default" : "outline"}
                disabled={!dirty || busy}
                onClick={() => void prepareReview()}
              >
                Tinjau perubahan
                {dirty
                  ? ` · ${changed.length} field`
                  : " · belum ada perubahan"}
              </Button>
              <Button
                variant="outline"
                onClick={() =>
                  attempt(() => {
                    clearDraft()
                    setView("overview")
                  })
                }
              >
                Batal
              </Button>
            </Surface>
          ) : null}
          {groups.some((g) => g.key === view) ? (
            <form
              onSubmit={(e) => {
                e.preventDefault()
                finish()
              }}
            >
              <Surface title={title}>
                {view === "location" ? (
                  <ContextAlert title="Validasi lokasi tetap wajib">
                    Radius dan titik lokasi dapat disesuaikan. Ketentuan
                    validasi lokasi tidak dapat dinonaktifkan.
                  </ContextAlert>
                ) : null}
                {view === "other" ? (
                  <ContextAlert title="Alasan perubahan jadwal wajib">
                    Ketentuan ini tetap aktif; Anda dapat mengatur pemberitahuan
                    minimum.
                  </ContextAlert>
                ) : null}
                {policyFields
                  .filter((f) => f.group === view && !("coordinate" in f))
                  .map((f) => (
                    <LabeledControl
                      key={f.key}
                      label={f.label}
                      error={errors[f.key]}
                      helper={`Saat ini: ${policyValueText(policyLeaf(base, f.key))} · ${source(f.key)}${"min" in f ? ` · Batas ${f.min}–${f.max}.` : ""}`}
                      control={
                        f.key === "attendance_mode" ? (
                          <NativeSelect
                            value={draft[f.key]}
                            onChange={(e) => changeValue(f.key, e.target.value)}
                          >
                            <NativeSelectOption value="kiosk">
                              Kiosk
                            </NativeSelectOption>
                            <NativeSelectOption value="personal">
                              Perangkat pribadi
                            </NativeSelectOption>
                            <NativeSelectOption value="hybrid">
                              Kiosk dan perangkat pribadi
                            </NativeSelectOption>
                          </NativeSelect>
                        ) : (
                          <Input
                            type="number"
                            min={f.min}
                            max={f.max}
                            step={1}
                            required
                            value={draft[f.key]}
                            onChange={(e) => changeValue(f.key, e.target.value)}
                          />
                        )
                      }
                    />
                  ))}
                {view === "location" ? (
                  <OutletGeofenceMap
                    outletName={scope === "tenant" ? "Kebijakan organisasi" : (outlet?.name ?? "Outlet")}
                    latitude={draft["personal_location_validation.latitude"].trim() ? Number(draft["personal_location_validation.latitude"]) : null}
                    longitude={draft["personal_location_validation.longitude"].trim() ? Number(draft["personal_location_validation.longitude"]) : null}
                    radiusMeters={Number(draft["personal_location_validation.radius_meters"])}
                    onChange={({ latitude, longitude }) => {
                      setDraft({ ...draft, "personal_location_validation.latitude": String(latitude), "personal_location_validation.longitude": String(longitude) })
                      setReview(null)
                      setErrors({})
                      setError("")
                    }}
                  />
                ) : null}
                {view === "location" ? (
                  <details
                    open={
                      Boolean(
                        errors["personal_location_validation.latitude"] ||
                          errors["personal_location_validation.longitude"]
                      ) || undefined
                    }
                  >
                    <summary className="flex min-h-11 cursor-pointer items-center text-label">
                      Titik lokasi · tampilkan koordinat
                    </summary>
                    <div className="flex flex-col gap-4 pt-3">
                      {policyFields
                        .filter((f) => "coordinate" in f)
                        .map((f) => (
                          <LabeledControl
                            key={f.key}
                            label={f.label}
                            error={errors[f.key]}
                            helper={`Saat ini: ${policyValueText(policyLeaf(base, f.key))} · ${source(f.key)}. Isi keduanya atau kosongkan keduanya.`}
                            control={
                              <Input
                                type="number"
                                step="any"
                                min={f.min}
                                max={f.max}
                                value={draft[f.key]}
                                onChange={(e) =>
                                  changeValue(f.key, e.target.value)
                                }
                              />
                            }
                          />
                        ))}
                    </div>
                  </details>
                ) : null}
                <Button type="submit">Selesai mengubah bagian</Button>
                <Button variant="outline" onClick={finish}>
                  Kembali ke pilihan bagian
                </Button>
              </Surface>
            </form>
          ) : null}
          {view === "review" ? (
            <form
              onSubmit={(e) => {
                e.preventDefault()
                void (review ? save() : prepareReview())
              }}
            >
              <Surface title="Perubahan yang akan disimpan">
                {(changed.length ? changed : policyFields).map((f) => (
                  <PolicyRow key={f.key} title={f.label}>
                    <span className="block">
                      Sekarang: {policyValueText(policyLeaf(base, f.key))} ·{" "}
                      {source(f.key)}
                    </span>
                    {review &&
                    policyLeaf(reviewBase, f.key) !==
                      policyLeaf(base, f.key) ? (
                      <span className="block">
                        Pada tanggal berlaku:{" "}
                        {policyValueText(policyLeaf(reviewBase, f.key))}
                      </span>
                    ) : null}
                    <span className="block">
                      Usulan:{" "}
                      {policyValueText(
                        f.key === "attendance_mode"
                          ? draft[f.key]
                          : draft[f.key] === ""
                            ? null
                            : Number(draft[f.key])
                      )}{" "}
                      ·{" "}
                      {scope === "tenant"
                        ? "Kebijakan organisasi"
                        : "Pengaturan khusus Outlet"}
                    </span>
                  </PolicyRow>
                ))}
                <p className="text-caption">
                  Pengaturan khusus Outlet lain tetap dipertahankan. Nilai
                  warisan tidak diubah menjadi pengaturan khusus Outlet.
                </p>
                <LabeledControl
                  label="Berlaku mulai"
                  helper="Hari ini UTC atau ke depan. Tanggal versi duplikat ditolak server."
                  control={
                    <Input
                      type="date"
                      required
                      min={utcToday()}
                      value={date}
                      disabled={busy || unknown}
                      onChange={(e) => {
                        setDate(e.target.value)
                        setReview(null)
                        setWarning("")
                      }}
                    />
                  }
                />
                <LabeledControl
                  label="Alasan perubahan"
                  helper="Wajib 3–1000 karakter."
                  control={
                    <Input
                      required
                      minLength={3}
                      maxLength={1000}
                      value={reason}
                      disabled={busy || unknown}
                      onChange={(e) => setReason(e.target.value)}
                    />
                  }
                />
                <p className="text-caption">
                  Pemeriksaan ulang tidak mengunci versi.
                </p>
                <Button type="submit" disabled={busy || unknown}>
                  {busy
                    ? "Memeriksa…"
                    : !review
                      ? "Periksa tanggal & tinjau"
                      : scope === "tenant"
                        ? "Simpan kebijakan organisasi"
                        : `Simpan untuk ${outlet?.name}`}
                </Button>
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => setView("groups")}
                >
                  Kembali mengubah
                </Button>
                {unknown ? (
                  <Button
                    variant="outline"
                    onClick={() =>
                      attempt(() => {
                        clearDraft()
                        setView("overview")
                        setRetry((n) => n + 1)
                      })
                    }
                  >
                    Periksa versi terbaru
                  </Button>
                ) : null}
              </Surface>
            </form>
          ) : null}
        </div>
      ) : null
  if (contextInvalid)
    return (
      <div data-policy-ux="true" className="flex flex-col gap-4">
        <PageHeading
          title="Kebijakan presensi"
          description="Konteks perlu dimuat kembali."
        />
        <ContextAlert tone="danger" title="Konteks akses berubah">
          {error}
          <Button variant="outline" onClick={() => window.location.reload()}>
            Muat ulang halaman
          </Button>
        </ContextAlert>
      </div>
    )
  return (
    <div data-policy-ux="true" className="flex min-w-0 flex-col gap-6">
      <div tabIndex={-1} ref={titleRef} className="outline-none">
        <PageHeading
          title={compact ? "Kebijakan presensi" : title}
          minimal={compact}
          role={canEdit ? "Owner" : "Supervisor"}
          description={
            overviewVisible && scope === "outlet"
              ? "Pilih Outlet untuk melihat aturan presensi yang berlaku."
              : identity
          }
        />
      </div>
      {!editorOpen && (error || Object.keys(errors).length) ? (
        <div ref={errorRef} tabIndex={-1} className="outline-none">
          <ContextAlert
            tone="danger"
            title={draft ? "Periksa perubahan" : "Data belum dapat dimuat"}
          >
            {error || "Periksa field yang ditandai."}
            {!draft ? (
              <Button variant="outline" onClick={() => setRetry((n) => n + 1)}>
                Muat ulang data
              </Button>
            ) : null}
          </ContextAlert>
        </div>
      ) : null}
      {notice ? (
        <ContextAlert tone="success" title="Perubahan tersimpan">
          {notice}
        </ContextAlert>
      ) : null}
      {compact && overviewVisible ? (
        <div className="grid min-w-0 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {scope === "outlet" ? (
            <LabeledControl
              label="Outlet"
              control={
                <Button
                  variant="outline"
                  className="h-auto min-h-11 justify-between whitespace-normal text-left font-normal"
                  aria-label={`Outlet: ${outlet?.name ?? "belum dipilih"} · ${unit?.name ?? ""}`}
                  ref={outletTriggerRef}
                  onClick={openOutletPicker}
                  disabled={busy || !context.outlets.length}
                >
                  <span className="min-w-0 [overflow-wrap:anywhere]">
                    {outlet
                      ? `${outlet.name} · ${unit?.name ?? "—"}`
                      : "Pilih Outlet"}
                  </span>
                  <ChevronRight
                    className="shrink-0"
                    size={16}
                    aria-hidden="true"
                  />
                </Button>
              }
            />
          ) : null}
          {canEdit ? (
            <LabeledControl
              label="Tingkat kebijakan"
              control={
                <NativeSelect
                  value={scope}
                  disabled={busy}
                  onChange={(event) => {
                    const value = event.target.value
                    if (value === "tenant" || value === "outlet")
                      attempt(() => changeScope(value))
                  }}
                >
                  <NativeSelectOption value="outlet">
                    Outlet
                  </NativeSelectOption>
                  <NativeSelectOption value="tenant">
                    Organisasi
                  </NativeSelectOption>
                </NativeSelect>
              }
            />
          ) : null}
          <LabeledControl
            label="Tanggal evaluasi kebijakan"
            helper="UTC"
            control={
              <Input
                type="date"
                value={search.date ?? utcToday()}
                onChange={(event) => {
                  const date = event.target.value
                  if (date) attempt(() => changeSearch({ date }))
                }}
              />
            }
          />
        </div>
      ) : (
        <>
      {view === "overview" && !compact ? <LabeledControl label="Tanggal evaluasi kebijakan" helper="Nilai efektif pada tanggal UTC terpilih." control={<Input type="date" value={search.date ?? utcToday()} onChange={event => { const date = event.target.value; if (date) attempt(() => changeSearch({ date })) }} />} /> : null}
      {view === "overview" && scope === "outlet" && !compact ? (
        <Surface title="Outlet yang ingin dilihat">
          <LabeledControl
            label="Outlet"
            helper={`Organisasi: ${context.tenant.name} · pilihan mengikuti izin Anda.`}
            control={
              <Button
                variant="outline"
                className="justify-between bg-canvas font-normal"
                onClick={openOutletPicker}
                disabled={busy}
              >
                {outlet
                  ? `${outlet.name} · ${unit?.name ?? "—"}`
                  : "Pilih Outlet"}
                <ChevronRight size={16} aria-hidden="true" />
              </Button>
            }
          />
          <p className="text-body">
            Aktif: {outlet?.name ?? "Belum dipilih"} / {unit?.name ?? "—"}
          </p>
          <p className="text-caption">
            Berlaku pada {data?.effective_date ?? utcToday()} · tanggal evaluasi
            kebijakan UTC, bukan tanggal kerja Outlet.
          </p>
        </Surface>
      ) : null}
      </>)}
      {overviewVisible && !context.outlets.length && scope === "outlet" ? (
        <ContextAlert title="Belum ada Outlet yang dapat Anda akses">
          {canEdit
            ? "Pilih Organisasi pada tingkat kebijakan untuk mengelola kebijakan organisasi."
            : "Tidak ada kebijakan untuk Outlet yang dapat Anda akses."}
        </ContextAlert>
      ) : null}
      {loading && !error ? (
        <ContextAlert title="Memuat kebijakan">
          Menunggu data untuk konteks yang dipilih. Pengaturan belum dapat
          diubah.
        </ContextAlert>
      ) : null}
      {view === "select" && !compact ? (
        <div className="policy-focus">
          <Surface title="Pilih Outlet yang dapat Anda akses">
            <LabeledControl
              label="Unit bisnis"
              control={
                <NativeSelect
                  value={unitId}
                  onChange={(e) => setUnitId(e.target.value)}
                >
                  <NativeSelectOption value="">
                    Semua unit bisnis
                  </NativeSelectOption>
                  {context.business_units.map((u) => (
                    <NativeSelectOption value={u.id} key={u.id}>
                      {u.name}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              }
            />
            {context.outlets
              .filter((o) => !unitId || String(o.business_unit_id) === unitId)
              .map((o) => (
                <PolicyRow
                  key={o.id}
                  title={o.name}
                  onClick={() => switchOutlet(String(o.id))}
                >
                  {
                    context.business_units.find(
                      (u) => u.id === o.business_unit_id
                    )?.name
                  }
                </PolicyRow>
              ))}
            <Button variant="outline" onClick={() => setView("overview")}>
              Batal
            </Button>
          </Surface>
        </div>
      ) : null}
      <PolicyDialog
        open={pickerOpen}
        onOpenChange={(open) => {
          if (!open) closeOutletPicker()
        }}
        title="Pilih Outlet"
        description="Cari Outlet yang tersedia dalam izin Anda. Pilihan akan memperbarui ringkasan kebijakan pada halaman ini."
        size="picker"
        finalFocus={outletTriggerRef}
        footer={
          <Button variant="outline" onClick={closeOutletPicker}>
            Batal
          </Button>
        }
      >
        {pickerOpen ? (
          <div data-policy-ux="true" className="flex flex-col gap-3.5">
            <LabeledControl
              label="Cari Outlet"
              helper="Cari berdasarkan nama Outlet atau unit bisnis."
              control={
                <Input
                  type="search"
                  value={outletSearch}
                  onChange={(event) => setOutletSearch(event.target.value)}
                  placeholder="Nama Outlet atau unit bisnis"
                />
              }
            />
            <LabeledControl
              label="Unit bisnis"
              control={
                <NativeSelect
                  value={unitId}
                  onChange={(event) => setUnitId(event.target.value)}
                >
                  <NativeSelectOption value="">
                    Semua unit bisnis
                  </NativeSelectOption>
                  {context.business_units.map((businessUnit) => (
                    <NativeSelectOption
                      value={businessUnit.id}
                      key={businessUnit.id}
                    >
                      {businessUnit.name}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              }
            />
            <p role="status" aria-live="polite" aria-atomic="true" className="text-caption text-muted-foreground">
              {filteredOutlets.length} Outlet ditemukan
            </p>
            {filteredOutlets.length ? (
              <div className="flex flex-col gap-2">
                {filteredOutlets.map((candidate) => (
                  <PolicyRow
                    key={candidate.id}
                    title={candidate.name}
                    current={String(candidate.id) === outletId}
                    onClick={() => switchOutlet(String(candidate.id))}
                  >
                    {context.business_units.find(
                      (businessUnit) =>
                        businessUnit.id === candidate.business_unit_id
                    )?.name ?? "Unit bisnis tidak tersedia"}
                  </PolicyRow>
                ))}
              </div>
            ) : (
              <Empty className="gap-3 rounded-xl border border-dashed p-6">
                <EmptyHeader>
                  <EmptyTitle>Tidak ada Outlet yang cocok</EmptyTitle>
                  <EmptyDescription>
                    Ubah kata pencarian atau pilih unit bisnis lain.
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            )}
          </div>
        ) : null}
      </PolicyDialog>
      {!loading &&
      !error &&
      data &&
      overviewVisible &&
      (scope === "tenant" || Boolean(outletId)) ? (
        <div
          className={`policy-overview-grid${compact ? " policy-overview-compact" : ""}`}
        >
          <Surface
            title={
              scope === "tenant"
                ? "Kebijakan organisasi"
                : `Aturan yang berlaku di ${outlet?.name ?? "Outlet"}`
            }
          >
            {scope === "tenant" && !compact ? (
              <ContextAlert title="Kebijakan organisasi">
                Nilai organisasi berlaku secara default. Nilai yang diatur
                khusus pada Outlet menggantikan nilai terkait.
              </ContextAlert>
            ) : null}
            {current && compact ? (
              <p className="text-caption text-muted-foreground">
                Sumber: {policySource}
              </p>
            ) : null}
            {!current ? (
              <ContextAlert title="Belum ada kebijakan efektif">
                {scope === "tenant"
                  ? "Belum ada kebijakan organisasi yang berlaku pada tanggal ini."
                  : data.effective.tenant_default
                    ? "Belum ada kebijakan efektif untuk Outlet ini pada tanggal tersebut."
                    : "Kebijakan organisasi belum berlaku pada tanggal tersebut."}
                {canEdit && scope === "outlet"
                  ? " Pilih Organisasi pada cakupan kebijakan untuk mengelola kebijakan organisasi."
                  : ""}
              </ContextAlert>
            ) : (
              groups.map((g) => (
                <div key={g.key} className="policy-summary-group">
                  <PolicyRow
                    key={g.key}
                    title={g.title}
                    icon={<g.icon size={18} />}
                    expanded={expanded === g.key}
                    onClick={() =>
                      setExpanded(expanded === g.key ? null : g.key)
                    }
                  >
                    {g.key === "time" ? (
                      <>
                        <span className="block">
                          Presensi masuk {current.check_in_window.early_minutes} menit
                          sebelum · {current.check_in_window.late_minutes} menit
                          setelah mulai
                        </span>
                        <span className="block">
                          Toleransi {current.late_tolerance_minutes} menit
                          {!compact ? (
                            <> · {source("late_tolerance_minutes")}</>
                          ) : null}
                        </span>
                      </>
                    ) : g.key === "location" ? (
                      <>
                        <span className="block">
                          Validasi wajib · radius{" "}
                          {current.personal_location_validation.radius_meters} m
                          {!compact ? (
                            <> · {source("personal_location_validation.radius_meters")}</>
                          ) : null}
                        </span>
                        <span className="block">
                          Titik lokasi{" "}
                          {current.personal_location_validation.latitude !=
                            null &&
                          current.personal_location_validation.longitude != null
                            ? "terisi"
                            : "belum diisi"}
                        </span>
                      </>
                    ) : (
                      <>
                        <span className="block">
                          {policyValueText(current.attendance_mode)}
                        </span>
                        <span className="block">
                          Permintaan maksimal{" "}
                          {current.retroactive_request_limit_days} hari ke
                          belakang
                        </span>
                        <span className="block">
                          Pemberitahuan perubahan{" "}
                          {current.operational_review.minimum_notice_hours} jam
                        </span>
                        {!compact ? <span className="block">
                          {scope === "tenant"
                            ? "Kebijakan organisasi"
                            : policyFields
                                  .filter((f) => f.group === "other")
                                  .every(
                                    (f) =>
                                      !hasPolicyOverride(
                                        data?.effective.outlet_overrides,
                                        f.key
                                      )
                                  )
                              ? "Mengikuti organisasi"
                              : "Lihat sumber tiap field pada rincian"}
                        </span> : null}
                      </>
                    )}
                  </PolicyRow>
                  {expanded === g.key ? (
                    <dl className="flex flex-col gap-3 py-3">
                      {policyFields
                        .filter((f) => f.group === g.key)
                        .map((f) => (
                          <div key={f.key}>
                            <dt className="text-label">{f.label}</dt>
                            <dd className="text-caption">
                              {policyValueText(policyLeaf(current, f.key))} ·{" "}
                              {source(f.key)}
                            </dd>
                          </div>
                        ))}
                    </dl>
                  ) : null}
                </div>
              ))
            )}
            {canEdit ? (
              <Button
                disabled={!data || busy || (scope === "outlet" && !current)}
              ref={editTriggerRef}
                onClick={enter}
              >
                {scope === "tenant"
                  ? "Ubah kebijakan organisasi"
                  : "Ubah kebijakan Outlet"}
              </Button>
            ) : (
              <p className="text-caption">
                Hanya lihat kebijakan untuk Outlet yang dapat Anda akses.
                Perubahan hanya tersedia bagi Owner.
              </p>
            )}
            {compact ? historyDetails : null}
          </Surface>
          {!compact ? <Surface
            title={scope === "tenant" ? "Konteks organisasi" : "Sumber aturan"}
          >
            <PolicyRow
              title="Mengikuti organisasi"
              icon={<Building2 size={18} />}
            >
              Nilai ini mengikuti kebijakan organisasi.
            </PolicyRow>
            <PolicyRow title="Pengaturan khusus Outlet" icon={<MapPin size={18} />}>
              Nilai khusus ini menggantikan nilai organisasi terkait. Nilai ini
              tidak dapat dikembalikan ke kebijakan organisasi dari sini.
            </PolicyRow>
            {canEdit && scope === "outlet" ? (
              <PolicyRow
                title="Kebijakan organisasi"
                onClick={() => changeScope("tenant")}
                icon={<SlidersHorizontal size={18} />}
              >
                Terpisah dari pengaturan Outlet. Perubahan dapat memengaruhi
                Outlet yang mewarisi nilai.
              </PolicyRow>
            ) : null}
            {scope === "tenant" ? (
              <Button variant="outline" onClick={() => changeScope("outlet")}>
                Kembali ke kebijakan Outlet
              </Button>
            ) : null}
            {current ? (
              <details>
                <summary className="flex min-h-11 cursor-pointer items-center text-label text-[14px]">
                  Rincian nilai dan sumber
                </summary>
                {policyFields.map((f) => (
                  <p
                    key={f.key}
                    className="border-b border-border py-3 text-caption"
                  >
                    {f.label}: {policyValueText(policyLeaf(current, f.key))} ·{" "}
                    {source(f.key)}
                  </p>
                ))}
              </details>
            ) : null}
            {historyDetails}
            {unknown ? (
              <Button variant="outline" onClick={() => setRetry((n) => n + 1)}>
                Periksa versi terbaru
              </Button>
            ) : null}
          </Surface> : null}
        </div>
      ) : null}
      {compact ? (
        <PolicyDialog
          open={editorOpen}
          onOpenChange={(open) => {
            if (!open) closeEditor()
          }}
          title={scope === "tenant" ? "Ubah kebijakan organisasi" : "Ubah kebijakan Outlet"}
          description={
            scope === "tenant"
              ? `Kebijakan organisasi untuk ${context.tenant.name}.`
                : `Kebijakan untuk Outlet ${outlet?.name}.`
          }
          size="editor"
          busy={busy}
          finalFocus={editTriggerRef}
        >
          {editorContent}
        </PolicyDialog>
      ) : editorContent}
      <AlertDialog
        open={pending !== null || blocked.status === "blocked"}
        onOpenChange={(open) => {
          if (!open) {
            setPending(null)
            blocked.reset?.()
          }
        }}
      >
        <AlertDialogContent
          data-policy-dialog="true"
          finalFocus={discardTrigger}
          className="rounded-[16px] p-5"
        >
          <AlertDialogHeader>
            <AlertDialogTitle>Buang perubahan?</AlertDialogTitle>
            <AlertDialogDescription>
              Perubahan untuk{" "}
              {scope === "tenant" ? context.tenant.name : outlet?.name} belum
              disimpan. Tetap di sini untuk melanjutkan atau buang draf sebelum
              berpindah.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-col sm:flex-col">
            <AlertDialogCancel>Lanjutkan mengubah</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={busy}
              onClick={() => {
                const action = pending
                setPending(null)
                clearDraft()
                if (blocked.status === "blocked") blocked.proceed()
                else action?.()
              }}
            >
              Buang perubahan
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {!settingsContext && view === "overview" ? (
        <p className="text-caption">
          Konfigurasi juga dapat dibuka melalui Pengaturan. Navigasi operasional
          tetap tersedia.
        </p>
      ) : null}
    </div>
  )
}
