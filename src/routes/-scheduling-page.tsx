import { useLocation, useNavigate } from "@tanstack/react-router"
import { id } from "date-fns/locale"
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Settings2,
} from "lucide-react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { EmployeeShell } from "@/components/employee-shell"
import {
  ManagementSidebar,
  ManagementTopbar,
} from "@/components/management-sidebar"
import { ContextAlert, LabeledControl } from "@/components/r2c/components"
import {
  OperationalSummary,
  ScheduleMatrix,
  WorkWeekControl,
} from "@/components/r2c/operational-blocks"
import { ContextDrawer, PageHeading } from "@/components/r2c/screen-blocks"
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
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty"
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { SidebarProvider } from "@/components/ui/sidebar"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ApiError, type AuthSession, apiRequest } from "@/lib/api"
import { getAuthRecoveryPath } from "@/lib/auth-navigation"
import { configurationSearch } from "@/lib/configuration-navigation"
import { getSchedulingSection } from "@/lib/management-navigation"
import type { PolicyConfiguration } from "@/lib/policy-editor"
import { schedulingSearch } from "@/lib/scheduling-search"
import type { ShiftContext as SchedulingContext } from "@/lib/shift-templates"
import { useConfigurationDraft } from "@/lib/use-configuration-draft"
import { cn } from "@/lib/utils"
import { AttendancePolicy } from "./-attendance-policy"
import { NotificationInbox } from "./-notification-inbox"
import { ShiftChanges } from "./-shift-changes"
import { ShiftTemplatesExperience } from "./-shift-templates"
import { WeeklyPlanner } from "./-weekly-planner"

type OutletOption = { id: number; name: string; business_unit_id: number }
type EmployeeOption = { id: number; name: string }
type PersonalClock = {
  server_time: string
  timezone: string
  work_date: string
}
type EffectiveDay = {
  employee_id: number
  tenant_id: number
  work_date: string
  status: "scheduled" | "rest" | "unscheduled"
  outlet: { id: number; name: string } | null
  timezone: string
  shift: {
    template_id: number
    version_id: number
    revision: number
    name: string | null
    start_time: string
    end_time: string
    crosses_midnight: boolean
  } | null
  scheduled_start: string | null
  scheduled_end: string | null
  policy: {
    tenant_version_id: number | null
    outlet_version_id: number | null
    effective: PolicyConfiguration | null
  }
  provenance: {
    source: string
    entry_id?: number | null
    schedule_rule_id: number | null
    exception_id: number | null
  }
  holiday_references: Array<{ id: number; name: string; region: string | null }>
  outlet_operating: boolean | null
  conflicts: string[]
}
type WeekResponse = {
  week_start: string
  week_end: string
  timezone: string
  outlet: OutletOption
  days: string[]
  employees: Array<{ id: number; name: string; days: EffectiveDay[] }>
}
type CalendarResponse = {
  outlet: { id: number; name: string }
  days: Array<{
    date: string
    timezone: string
    status: "open" | "closed"
    holiday_references: Array<{
      id: number
      name: string
      region: string | null
    }>
    exception: {
      id: number
      revision: number
      status: "open" | "closed"
    } | null
  }>
  versions: Array<{
    id: number
    effective_from: string
    timezone: string
    operating_weekdays: number[]
    reason: string | null
  }> | null
}
type CalendarModal = "version" | "holiday" | "exception"

const weekdays = [
  { id: 1, label: "Senin" },
  { id: 2, label: "Selasa" },
  { id: 3, label: "Rabu" },
  { id: 4, label: "Kamis" },
  { id: 5, label: "Jumat" },
  { id: 6, label: "Sabtu" },
  { id: 7, label: "Minggu" },
]

export function SchedulingPage({
  configuration,
}: {
  configuration?: "kebijakan" | "kalender"
} = {}) {
  const location = useLocation()
  const navigate = useNavigate()
  const configSearch = configurationSearch(location.search)
  const currentHash = useLocation({
    select: (location) => location.hash.replace(/^#/, ""),
  })
  const settingsContext = useLocation({
    select: (location) =>
      Boolean(configuration) || location.search.from === "settings",
  })
  const configConfirmTrigger = useRef<HTMLElement | null>(null)
  const [configConfirmation, setConfigConfirmation] = useState<{
    title: string
    description: string
    actionLabel: string
    action: () => Promise<void>
  } | null>(null)
  const [context, setContext] = useState<SchedulingContext | null>(null)
  const [kioskEnabled, setKioskEnabled] = useState(false)
  const [organizationName, setOrganizationName] = useState("")
  const [operationalWeek, setOperationalWeek] = useState(
    () => schedulingSearch(location.search).week ?? mondayOfToday()
  )
  const [personalWeekStart, setPersonalWeekStart] = useState<string | null>(
    null
  )
  const personalWeekManuallySelected = useRef(false)
  const [personalClock, setPersonalClock] = useState<PersonalClock | null>(null)
  const [personalClockLoading, setPersonalClockLoading] = useState(false)
  const [personalClockError, setPersonalClockError] = useState("")
  const [personalTodayDay, setPersonalTodayDay] = useState<EffectiveDay | null>(
    null
  )
  const [personalTodayError, setPersonalTodayError] = useState("")
  const operationalSearch = schedulingSearch(location.search)
  const urlContext = !configuration && context?.capabilities.manage_schedules
  const isPersonalSchedule = Boolean(
    context &&
      context.employee_id !== null &&
      !context.capabilities.manage_schedules
  )
  const personalToday = personalClock
    ? workDateInTimezone(personalClock.server_time, personalClock.timezone)
    : null
  const weekStart =
    configuration === "kalender"
      ? (configSearch.date ?? mondayOfToday())
      : urlContext
        ? (operationalSearch.week ?? mondayOfToday())
        : isPersonalSchedule
          ? (personalWeekStart ?? "")
          : operationalWeek
  const navigateContext = (outlet: string, week: string) =>
    void navigate({
      to: "/scheduling",
      search: {
        ...operationalSearch,
        outletId: Number(outlet) || undefined,
        week,
      },
      hash: location.hash,
      resetScroll: false,
    })
  const setWeekStart = (date: string) => {
    if (configuration === "kalender")
      void navigate({
        to: "/settings/outlet-calendar",
        search: { ...configSearch, date },
      })
    else if (urlContext) navigateContext(outletId, date)
    else if (isPersonalSchedule) {
      personalWeekManuallySelected.current =
        !personalToday || mondayOf(personalToday) !== date
      setPersonalWeekStart(date)
    } else setOperationalWeek(date)
  }
  const [businessUnitId, setBusinessUnitId] = useState("")
  const [operationalOutlet, setOperationalOutlet] = useState("")
  const outletId =
    configuration === "kalender"
      ? String(configSearch.outletId ?? context?.outlets[0]?.id ?? "")
      : urlContext
        ? String(
            context.outlets.find(
              (outlet) => outlet.id === operationalSearch.outletId
            )?.id ??
              context.outlets[0]?.id ??
              ""
          )
        : operationalOutlet
  const setOutletId = (value: string | ((current: string) => string)) => {
    const next = typeof value === "function" ? value(outletId) : value
    if (configuration === "kalender")
      void navigate({
        to: "/settings/outlet-calendar",
        search: { ...configSearch, outletId: Number(next) || undefined },
      })
    else if (urlContext) navigateContext(next, weekStart)
    else setOperationalOutlet(next)
  }
  useEffect(() => {
    if (urlContext)
      setBusinessUnitId((current) =>
        context.outlets.some(
          (outlet) =>
            String(outlet.id) === outletId &&
            String(outlet.business_unit_id) === current
        )
          ? current
          : ""
      )
  }, [urlContext, outletId, context])
  const [week, setWeek] = useState<WeekResponse | null>(null)
  const [personalDays, setPersonalDays] = useState<EffectiveDay[]>([])
  const [calendar, setCalendar] = useState<CalendarResponse | null>(null)
  const [calendarLoadedFor, setCalendarLoadedFor] = useState<string | null>(
    null
  )
  const calendarDays = configuration === "kalender" ? configSearch.days : 7
  const calendarKey = `${context?.tenant.id}:${context?.user.id}:${outletId}:${weekStart}:${calendarDays}`
  const [loading, setLoading] = useState(true)
  const calendarReady =
    !loading &&
    calendarLoadedFor === calendarKey &&
    calendar?.outlet.id === Number(outletId)
  const [busy, setBusy] = useState(false)
  const actionLock = useRef(false)
  const [uncertainCalendar, setUncertainCalendar] = useState(false)
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")
  const [activeTab, setActiveTab] = useState(configuration ?? "jadwal")
  const activeTabRef = useRef("jadwal")
  useEffect(() => {
    activeTabRef.current = activeTab
  }, [activeTab])
  const [operation, setOperation] = useState("planner")
  const [plannerBusy, setPlannerBusy] = useState(false)
  const [configurationOpen, setConfigurationOpen] = useState(false)
  const [scheduleEditor, setScheduleEditor] = useState<
    "rule" | "exception" | null
  >(null)
  const [selectedDay, setSelectedDay] = useState<{
    employee: EmployeeOption
    day: EffectiveDay
  } | null>(null)
  const scheduleTrigger = useRef<HTMLElement | null>(null)
  useEffect(() => {
    const update = (hash = window.location.hash) => {
      const section = configuration ?? getSchedulingSection(hash)
      const apply = () => {
        activeTabRef.current = section
        setActiveTab(section)
        window.history.replaceState(
          window.history.state,
          "",
          `${window.location.pathname}${window.location.search}${section === "jadwal" ? "" : `#${section}`}`
        )
      }
      if (activeTabRef.current === "kebijakan" && section !== "kebijakan") {
        const leave = new CustomEvent("hadirinaja:leave-policy", {
          cancelable: true,
          detail: apply,
        })
        if (!window.dispatchEvent(leave)) {
          window.history.replaceState(
            window.history.state,
            "",
            `${window.location.pathname}${window.location.search}#kebijakan`
          )
          return
        }
      }
      activeTabRef.current = section
      setActiveTab(section)
    }
    update(currentHash)
    const onHashChange = () => update()
    window.addEventListener("hashchange", onHashChange)
    return () => window.removeEventListener("hashchange", onHashChange)
  }, [currentHash, configuration])

  const [ruleEmployeeId, setRuleEmployeeId] = useState("")
  const [ruleWeekday, setRuleWeekday] = useState("1")
  const [ruleShiftId, setRuleShiftId] = useState("")
  const [ruleEffectiveFrom, setRuleEffectiveFrom] = useState(tomorrow())
  const [ruleEffectiveUntil, setRuleEffectiveUntil] = useState("")
  const [ruleReason, setRuleReason] = useState("")

  const [exceptionEmployeeId, setExceptionEmployeeId] = useState("")
  const [exceptionDate, setExceptionDate] = useState(tomorrow())
  const [exceptionStatus, setExceptionStatus] = useState<"work" | "rest">(
    "work"
  )
  const [exceptionShiftId, setExceptionShiftId] = useState("")
  const [exceptionReason, setExceptionReason] = useState("")

  const [calendarEffectiveFrom, setCalendarEffectiveFrom] = useState(tomorrow())
  const [calendarTimezone, setCalendarTimezone] = useState("Asia/Jakarta")
  const [calendarWeekdays, setCalendarWeekdays] = useState<number[]>([
    1, 2, 3, 4, 5, 6, 7,
  ])
  const [calendarReason, setCalendarReason] = useState("")
  const [calendarExceptionDate, setCalendarExceptionDate] = useState(tomorrow())
  const [calendarExceptionStatus, setCalendarExceptionStatus] = useState<
    "open" | "closed"
  >("closed")
  const [calendarExceptionHoliday, setCalendarExceptionHoliday] = useState("")
  const [calendarExceptionReason, setCalendarExceptionReason] = useState("")
  const [holidayDate, setHolidayDate] = useState(tomorrow())
  const [holidayName, setHolidayName] = useState("")
  const [holidayRegion, setHolidayRegion] = useState("")
  const [calendarModal, setCalendarModal] = useState<CalendarModal | null>(null)
  const [calendarModalContext, setCalendarModalContext] = useState<
    string | null
  >(null)
  const calendarEditorReady =
    calendarReady && calendarModalContext === calendarKey
  const readyCalendarContext = useRef({ key: calendarKey, ready: false })
  readyCalendarContext.current = { key: calendarKey, ready: calendarReady }
  const calendarModalTrigger = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    if (calendarModalContext === null || calendarModalContext === calendarKey)
      return
    setCalendarModal(null)
    setCalendarModalContext(null)
    setConfigConfirmation(null)
  }, [calendarKey, calendarModalContext])

  function canSubmitCalendar() {
    return (
      readyCalendarContext.current.ready &&
      readyCalendarContext.current.key === calendarKey &&
      calendarModalContext === calendarKey
    )
  }
  const calendarDraft = useConfigurationDraft(busy, () => {
    setCalendarReason("")
    setCalendarExceptionReason("")
    setCalendarExceptionDate(tomorrow())
    setCalendarExceptionStatus("closed")
    setCalendarExceptionHoliday("")
    setHolidayDate(tomorrow())
    setHolidayName("")
    setHolidayRegion("")
    setCalendarEffectiveFrom(tomorrow())
    const currentVersion = calendar?.versions?.at(-1)
    setCalendarTimezone(currentVersion?.timezone ?? "Asia/Jakarta")
    setCalendarWeekdays(
      currentVersion?.operating_weekdays ?? [1, 2, 3, 4, 5, 6, 7]
    )
    setCalendarModal(null)
    setScheduleEditor(null)
  })

  const managerOutlets = useMemo(() => {
    if (!context) return []
    return !configuration && businessUnitId
      ? context.outlets.filter(
          (outlet) => String(outlet.business_unit_id) === businessUnitId
        )
      : context.outlets
  }, [businessUnitId, context, configuration])

  const pageDataRequest = useRef(0)
  const receiveShiftContext = useCallback((next: SchedulingContext | null) => {
    ++pageDataRequest.current
    setWeek(null)
    setCalendar(null)
    setPersonalDays([])
    setScheduleEditor(null)
    setSelectedDay(null)
    setContext(next)
    setOperationalOutlet((current) =>
      next?.outlets.some((outlet) => String(outlet.id) === current)
        ? current
        : ""
    )
    setBusinessUnitId((current) =>
      next?.business_units.some((unit) => String(unit.id) === current)
        ? current
        : ""
    )
  }, [])
  const calendarOnly =
    configuration === "kalender" ||
    currentHash === "kalender" ||
    activeTab === "kalender"
  const loadPageData = useCallback(
    async (
      current: SchedulingContext,
      currentOutletId: string,
      currentWeek: string,
      afterSave = false
    ) => {
      if (
        !current.capabilities.manage_schedules &&
        current.employee_id !== null &&
        (!currentWeek || !personalToday)
      )
        return
      const requestKey = `${current.tenant.id}:${current.user.id}:${currentOutletId}:${currentWeek}:${configuration === "kalender" ? configSearch.days : 7}`
      if (readyCalendarContext.current.key !== requestKey) return
      const generation = ++pageDataRequest.current
      const isCurrent = () =>
        generation === pageDataRequest.current &&
        readyCalendarContext.current.key === requestKey
      setLoading(true)
      setError("")
      setCalendar(null)
      setCalendarLoadedFor(null)

      try {
        if (current.capabilities.manage_schedules) {
          if (!currentOutletId) {
            setWeek(null)
            setCalendar(null)
            return
          }

          const calendarQuery = new URLSearchParams({
            outlet_id: currentOutletId,
            start_date: currentWeek,
            days: String(configuration === "kalender" ? configSearch.days : 7),
          })
          const [weekData, calendarData] = await Promise.all([
            calendarOnly
              ? Promise.resolve(null)
              : apiRequest<WeekResponse>(
                  `/management/scheduling/week?week_start=${currentWeek}&outlet_id=${currentOutletId}`
                ),
            apiRequest<CalendarResponse>(
              `/management/scheduling/calendar?${calendarQuery.toString()}`
            ),
          ])
          if (!isCurrent()) return
          if (calendarData.outlet.id !== Number(currentOutletId))
            throw new Error("Calendar Outlet mismatch")
          setWeek(weekData)
          setCalendar(calendarData)
          setCalendarLoadedFor(requestKey)
        } else if (current.employee_id !== null) {
          const todayWorkDate = personalToday
          if (!todayWorkDate) throw new Error("Server date unavailable")
          const loadPersonalWeek = (weekStartDate: string) =>
            apiRequest<{
              week_start: string
              days: EffectiveDay[]
            }>(`/management/scheduling/me/week?week_start=${weekStartDate}`)
          const result = await loadPersonalWeek(currentWeek)
          if (!isCurrent()) return
          if (result.week_start !== currentWeek || !Array.isArray(result.days))
            throw new Error("Personal schedule week response mismatch")
          setPersonalDays(result.days)

          const currentTodayWeek = mondayOf(todayWorkDate)
          if (currentWeek === currentTodayWeek) {
            const todayMatch = uniqueDayForWorkDate(result.days, todayWorkDate)
            setPersonalTodayDay(todayMatch.day)
            setPersonalTodayError(
              todayMatch.duplicate
                ? "Data jadwal hari ini berulang dan belum dapat dipastikan."
                : ""
            )
          } else {
            try {
              const todayResult = await loadPersonalWeek(currentTodayWeek)
              if (!isCurrent()) return
              if (
                todayResult.week_start !== currentTodayWeek ||
                !Array.isArray(todayResult.days)
              )
                throw new Error("Today schedule response mismatch")
              const todayMatch = uniqueDayForWorkDate(
                todayResult.days,
                todayWorkDate
              )
              setPersonalTodayDay(todayMatch.day)
              setPersonalTodayError(
                todayMatch.duplicate
                  ? "Data jadwal hari ini berulang dan belum dapat dipastikan."
                  : ""
              )
            } catch {
              if (!isCurrent()) return
              setPersonalTodayDay(null)
              setPersonalTodayError("Jadwal hari ini belum dapat dimuat.")
            }
          }
        } else {
          setError("Akun ini belum terhubung ke jadwal pribadi.")
        }
      } catch (caught) {
        if (!isCurrent()) return
        setPersonalDays([])
        const recovery = getAuthRecoveryPath(caught)
        if (recovery) {
          window.location.assign(recovery)
          return
        }
        setError(
          afterSave
            ? "Perubahan tersimpan, tetapi data terbaru belum dapat dimuat. Muat ulang data tanpa mengirim ulang perubahan."
            : caught instanceof ApiError
              ? caught.message
              : "Jadwal dan kebijakan belum dapat dimuat. Coba muat ulang halaman."
        )
      } finally {
        if (isCurrent()) setLoading(false)
      }
    },
    [configuration, configSearch.days, calendarOnly, personalToday]
  )

  useEffect(() => {
    let cancelled = false
    async function bootstrap() {
      const generation = pageDataRequest.current
      try {
        const session = await apiRequest<AuthSession>("/auth/me")
        if (!session.active_membership) {
          window.location.assign("/select-tenant")
          return
        }
        setKioskEnabled(session.features.kiosk_enabled)
        setOrganizationName(session.active_membership.tenant?.name ?? "")
        if (
          configuration &&
          !session.active_membership.roles.some(
            (role) => role === "owner" || role === "supervisor"
          )
        ) {
          setError(
            "Akses konfigurasi hanya tersedia untuk Owner atau Supervisor yang berwenang."
          )
          return
        }
        const nextContext = await apiRequest<SchedulingContext>(
          "/management/scheduling/context"
        )
        if (cancelled || generation !== pageDataRequest.current) return
        setContext(nextContext)
        const firstOutlet = nextContext.outlets[0]
        setBusinessUnitId(
          firstOutlet
            ? String(firstOutlet.business_unit_id)
            : nextContext.business_units[0]
              ? String(nextContext.business_units[0].id)
              : ""
        )
        setOperationalOutlet(firstOutlet ? String(firstOutlet.id) : "")
        setRuleEmployeeId(
          nextContext.employees[0] ? String(nextContext.employees[0].id) : ""
        )
        setExceptionEmployeeId(
          nextContext.employees[0] ? String(nextContext.employees[0].id) : ""
        )
      } catch (caught) {
        if (
          caught instanceof ApiError &&
          (caught.status === 401 || caught.status === 419)
        ) {
          window.location.assign("/login?expired=1")
          return
        }
        if (!cancelled)
          setError("Sesi atau organisasi aktif belum dapat dimuat.")
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void bootstrap()
    const expireSession = () => window.location.assign("/login?expired=1")
    window.addEventListener("hadirinaja:session-expired", expireSession)

    return () => {
      cancelled = true
      window.removeEventListener("hadirinaja:session-expired", expireSession)
    }
  }, [configuration])

  useEffect(() => {
    if (
      !context ||
      context.employee_id === null ||
      context.capabilities.manage_schedules
    )
      return

    let cancelled = false
    let requestActive = false
    let refreshTimer = 0

    const refreshServerClock = async () => {
      if (requestActive || cancelled) return
      requestActive = true
      setPersonalClockLoading(true)
      try {
        const result = await apiRequest<{
          server_time?: unknown
          schedule?: { timezone?: unknown } | null
        }>("/attendance/me")
        if (cancelled) return
        const serverTime =
          typeof result.server_time === "string" &&
          Number.isFinite(Date.parse(result.server_time))
            ? result.server_time
            : null
        const timezone =
          typeof result.schedule?.timezone === "string" &&
          isValidTimezone(result.schedule.timezone)
            ? result.schedule.timezone
            : null
        if (!serverTime || !timezone) {
          setPersonalClockError(
            "Tanggal hari ini belum dapat diverifikasi dari server."
          )
          setPersonalClock(null)
          return
        }
        const workDate = workDateInTimezone(serverTime, timezone)
        if (!workDate) {
          setPersonalClockError(
            "Tanggal hari ini belum dapat diverifikasi dari server."
          )
          setPersonalClock(null)
          return
        }
        setPersonalClock({
          server_time: serverTime,
          timezone,
          work_date: workDate,
        })
        setPersonalWeekStart((current) =>
          !personalWeekManuallySelected.current
            ? mondayOf(workDate)
            : (current ?? mondayOf(workDate))
        )
        setPersonalClockError("")
      } catch (caught) {
        if (cancelled) return
        const recovery = getAuthRecoveryPath(caught)
        if (recovery) {
          window.location.assign(recovery)
          return
        }
        setPersonalClockError(
          "Tanggal hari ini belum dapat diverifikasi dari server."
        )
        setPersonalClock(null)
      } finally {
        if (!cancelled) {
          requestActive = false
          setPersonalClockLoading(false)
          refreshTimer = window.setTimeout(
            () => void refreshServerClock(),
            5 * 60 * 1000
          )
        }
      }
    }

    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") {
        window.clearTimeout(refreshTimer)
        void refreshServerClock()
      }
    }

    void refreshServerClock()
    document.addEventListener("visibilitychange", refreshWhenVisible)
    window.addEventListener("focus", refreshWhenVisible)
    return () => {
      cancelled = true
      window.clearTimeout(refreshTimer)
      document.removeEventListener("visibilitychange", refreshWhenVisible)
      window.removeEventListener("focus", refreshWhenVisible)
    }
  }, [context])

  useEffect(() => {
    if (
      !context ||
      currentHash === "shift" ||
      (isPersonalSchedule && (!personalToday || !weekStart)) ||
      (context.capabilities.manage_schedules &&
        (activeTab === "kebijakan" || window.location.hash === "#kebijakan"))
    )
      return
    void loadPageData(context, outletId, weekStart)
    return () => {
      ++pageDataRequest.current
    }
  }, [
    context,
    loadPageData,
    outletId,
    weekStart,
    activeTab,
    currentHash,
    isPersonalSchedule,
    personalToday,
  ])

  async function reloadContext() {
    const updated = await apiRequest<SchedulingContext>(
      "/management/scheduling/context"
    )
    setContext(updated)
  }

  function openCalendarModal(
    modal: CalendarModal,
    trigger: HTMLButtonElement,
    date?: string
  ) {
    if (!calendarReady) return
    setConfigConfirmation(null)
    setCalendarModalContext(calendarKey)
    if (modal === "version") {
      const version = calendar?.versions?.at(-1)
      setCalendarTimezone(version?.timezone ?? "Asia/Jakarta")
      setCalendarWeekdays(version?.operating_weekdays ?? [1, 2, 3, 4, 5, 6, 7])
    }
    calendarModalTrigger.current = trigger
    if (date) setCalendarExceptionDate(date)
    setCalendarModal(modal)
  }

  function requestCalendarModalClose(open: boolean) {
    if (open) return
    calendarDraft.attempt(() => setCalendarModal(null))
  }

  async function runAction(
    action: () => Promise<unknown>,
    success: string,
    refreshContext = false
  ): Promise<boolean> {
    if (actionLock.current || uncertainCalendar) return false
    actionLock.current = true
    setBusy(true)
    setError("")
    setNotice("")
    let saved = false
    try {
      await action()
      saved = true
      calendarDraft.clear()
      setNotice(success)
      try {
        if (refreshContext) await reloadContext()
        else if (context) await loadPageData(context, outletId, weekStart, true)
      } catch {
        setError("Perubahan tersimpan, tetapi data terbaru belum dapat dimuat.")
      }
    } catch (caught) {
      if (
        activeTab === "kalender" &&
        (!(caught instanceof ApiError) || caught.status >= 500)
      )
        setUncertainCalendar(true)
      setError(
        caught instanceof ApiError
          ? caught.message
          : "Perubahan tidak dapat disimpan. Periksa akses dan data yang dimasukkan."
      )
    } finally {
      actionLock.current = false
      setBusy(false)
    }
    return saved
  }

  function logout() {
    setBusy(true)
    void apiRequest("/auth/logout", { method: "POST" })
      .catch(() => undefined)
      .finally(() => window.location.assign("/login"))
  }

  // ponytail: Keep operational state mounted across #shift; its configuration UI shares no mutation handlers.
  if (currentHash === "shift")
    return <ShiftTemplatesExperience onContextChange={receiveShiftContext} />

  if (loading && !context) {
    return (
      <main className="flex min-h-svh items-center justify-center text-body text-muted-foreground">
        Memuat jadwal…
      </main>
    )
  }

  if (!context) {
    return (
      <EmployeeShell active="schedule">
        <Alert className="max-w-lg" variant="destructive">
          <AlertTitle>Jadwal belum dapat dibuka</AlertTitle>
          <AlertDescription>
            {error || "Periksa sesi dan organisasi aktif Anda."}
          </AlertDescription>
        </Alert>
      </EmployeeShell>
    )
  }

  const isOwner = context.capabilities.manage_policies
  const canManage = context.capabilities.manage_schedules
  const flatHolidayOptions = [
    ...new Map(
      (calendar?.days.flatMap((day) => day.holiday_references) ?? []).map(
        (holiday) => [holiday.id, holiday]
      )
    ).values(),
  ]
  const calendarTimezones = [
    ...new Set(calendar?.days.map((day) => day.timezone) ?? []),
  ]
  const calendarRecoveryAlert = (
    <Alert variant="destructive">
      <AlertTitle>Hasil perubahan belum dapat dipastikan</AlertTitle>
      <AlertDescription>
        {error ||
          "Jangan kirim ulang. Periksa kalender dan versi terbaru sebelum membuat perubahan berikutnya."}
        <Button
          type="button"
          onClick={() => {
            calendarDraft.clear()
            window.location.reload()
          }}
        >
          Tutup draf dan periksa data
        </Button>
      </AlertDescription>
    </Alert>
  )

  async function createWeeklyRule(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!outletId) return
    const saved = await runAction(
      () =>
        apiRequest("/management/scheduling/weekly-rules", {
          method: "POST",
          body: {
            employee_id: Number(ruleEmployeeId),
            outlet_id: Number(outletId),
            weekday: Number(ruleWeekday),
            shift_template_version_id: ruleShiftId ? Number(ruleShiftId) : null,
            effective_from: ruleEffectiveFrom,
            effective_until: ruleEffectiveUntil || null,
            reason: ruleReason,
          },
        }),
      "Jadwal mingguan berhasil disimpan."
    )
    if (saved) setRuleReason("")
  }

  async function createException(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!outletId) return
    const saved = await runAction(
      () =>
        apiRequest("/management/scheduling/exceptions", {
          method: "POST",
          body: {
            employee_id: Number(exceptionEmployeeId),
            outlet_id: Number(outletId),
            work_date: exceptionDate,
            status: exceptionStatus,
            shift_template_version_id:
              exceptionStatus === "work" ? Number(exceptionShiftId) : null,
            reason: exceptionReason,
          },
        }),
      "Perubahan satu hari berhasil disimpan."
    )
    if (saved) setExceptionReason("")
  }

  async function createCalendarVersion(
    event: React.FormEvent<HTMLFormElement>
  ) {
    event.preventDefault()
    if (!canSubmitCalendar()) return
    const saved = await runAction(
      () =>
        apiRequest("/management/scheduling/calendar/versions", {
          method: "POST",
          body: {
            outlet_id: Number(outletId),
            effective_from: calendarEffectiveFrom,
            timezone: calendarTimezone,
            operating_weekdays: calendarWeekdays,
            reason: calendarReason,
          },
        }),
      "Perubahan kalender dijadwalkan."
    )
    if (saved) {
      setCalendarReason("")
      setCalendarModal(null)
    }
  }

  async function createCalendarException(
    event: React.FormEvent<HTMLFormElement>
  ) {
    event.preventDefault()
    if (!canSubmitCalendar()) return
    const saved = await runAction(
      () =>
        apiRequest("/management/scheduling/calendar/exceptions", {
          method: "POST",
          body: {
            outlet_id: Number(outletId),
            calendar_date: calendarExceptionDate,
            status: calendarExceptionStatus,
            holiday_reference_id: calendarExceptionHoliday
              ? Number(calendarExceptionHoliday)
              : null,
            reason: calendarExceptionReason,
          },
        }),
      "Perubahan kalender satu hari berhasil disimpan."
    )
    if (saved) {
      setCalendarExceptionReason("")
      setCalendarModal(null)
    }
  }

  async function createHoliday(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!canSubmitCalendar()) return
    const saved = await runAction(
      () =>
        apiRequest("/management/scheduling/holidays", {
          method: "POST",
          body: {
            holiday_date: holidayDate,
            name: holidayName,
            region: holidayRegion || null,
          },
        }),
      "Referensi hari libur tercatat. Outlet tetap mengikuti kalender operasionalnya."
    )
    if (saved) {
      setHolidayName("")
      setHolidayRegion("")
      setCalendarModal(null)
    }
  }

  function changeWeek(value: string) {
    if (value)
      setWeekStart(configuration === "kalender" ? value : mondayOf(value))
  }

  const weekRows = week?.employees ?? []
  const displayDays = week?.days ?? []
  const shiftVersions = context.shift_templates.flatMap((template) =>
    template.versions.map((version) => ({
      ...version,
      template_id: template.id,
      template_name: template.name,
    }))
  )

  if (!canManage) {
    return (
      <EmployeeShell
        active="schedule"
        accountName={context.user.name}
        outletContext={{
          outlets: context.outlets.map(({ id, name }) => ({ id, name })),
          selectedOutletId: null,
          selectedOutletName: "Semua Outlet",
        }}
      >
        <header className="employee-schedule-heading flex flex-col gap-1">
          <h1 className="text-title">Jadwal</h1>
          <p className="text-caption text-muted-foreground">
            {context.user.name} · {context.tenant.name}
          </p>
        </header>
        <NotificationInbox
          key={`inbox:${context.tenant.id}:${context.user.id}`}
        />
        {error ? (
          <Alert variant="destructive">
            <AlertTitle>Jadwal belum dapat dimuat</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
            <Button
              variant="outline"
              onClick={() => void loadPageData(context, outletId, weekStart)}
            >
              Coba lagi
            </Button>
          </Alert>
        ) : (
          <PersonalSchedule
            days={personalDays}
            organizationName={organizationName}
            loading={loading}
            clockLoading={personalClockLoading}
            clockError={personalClockError}
            todayError={personalTodayError}
            today={personalToday}
            todayTimezone={personalClock?.timezone ?? null}
            todayDay={
              personalTodayDay?.work_date === personalToday
                ? personalTodayDay
                : null
            }
            onWeekChange={changeWeek}
            weekStart={weekStart}
          />
        )}
        {context.employee_id !== null ? (
          <ShiftChanges
            key={`${context.tenant.id}:${context.user.id}:${context.employee_id}`}
            employeeId={context.employee_id}
            days={personalDays}
            onChanged={() => {
              void loadPageData(context, outletId, weekStart)
            }}
          />
        ) : null}
      </EmployeeShell>
    )
  }

  const exceptionDays = weekRows.flatMap((employee) =>
    employee.days
      .filter((day) => day.provenance.exception_id)
      .map((day) => ({ employee, day }))
  )
  const assignmentSummary = (
    <OperationalSummary
      title="Penugasan shift"
      action="Kelola penugasan"
      onAction={() => {
        scheduleTrigger.current =
          document.activeElement instanceof HTMLElement
            ? document.activeElement
            : null
        setScheduleEditor("rule")
      }}
    >
      <p>{weekRows.length} karyawan pada minggu terpilih.</p>
      <p>
        Pola berulang memiliki tanggal berlaku dan alasan. Versi shift dan
        sumber per hari dapat diperiksa melalui matriks.
      </p>
    </OperationalSummary>
  )
  const exceptionSummary = (
    <OperationalSummary
      title="Pengecualian tanggal"
      action="Lihat pengecualian"
      onAction={() => {
        scheduleTrigger.current =
          document.activeElement instanceof HTMLElement
            ? document.activeElement
            : null
        setScheduleEditor("exception")
      }}
    >
      <p>
        {exceptionDays.length
          ? exceptionDays
              .map(
                ({ employee, day }) =>
                  `${employee.name} · ${formatWorkDate(day.work_date)}`
              )
              .join("; ")
          : "Belum ada pengecualian pada minggu ini."}
      </p>
      <p>Berlaku satu hari; sumber asli tetap dapat ditelusuri.</p>
    </OperationalSummary>
  )
  const operationalSummaries = (
    <div className="grid gap-4 md:grid-cols-2">
      {assignmentSummary}
      {exceptionSummary}
    </div>
  )

  const navigationContext = {
    tenantName: context.tenant.name,
    roles: context.roles,
    userName: context.user.name,
    kioskEnabled,
  }

  return (
    <SidebarProvider className="pb-[calc(6rem+env(safe-area-inset-bottom))] md:pb-0">
      {calendarDraft.dialog}
      <div className="flex min-h-svh w-full bg-canvas">
        <ManagementSidebar
          activePage={configuration ? "settings" : "scheduling"}
          context={navigationContext}
        />
        <div className="min-w-0 flex-1">
          <ManagementTopbar
            context={navigationContext}
            settingsBack={Boolean(configuration)}
            onLogout={logout}
            busy={busy}
          />

          <AlertDialog
            open={configConfirmation !== null && calendarEditorReady}
            onOpenChange={(open) => {
              if (!open) setConfigConfirmation(null)
            }}
          >
            <AlertDialogContent finalFocus={configConfirmTrigger}>
              <AlertDialogHeader>
                <AlertDialogTitle>{configConfirmation?.title}</AlertDialogTitle>
                <AlertDialogDescription>
                  {configConfirmation?.description}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Batal</AlertDialogCancel>
                <AlertDialogAction
                  disabled={!calendarEditorReady || busy || uncertainCalendar}
                  onClick={() => {
                    const pending = configConfirmation
                    setConfigConfirmation(null)
                    if (pending && canSubmitCalendar()) void pending.action()
                  }}
                >
                  {configConfirmation?.actionLabel}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
          <main
            data-b3-compact={configuration ? "true" : undefined}
            data-policy-page={activeTab === "kebijakan" ? "true" : undefined}
            data-b3-config={activeTab !== "jadwal" ? "true" : undefined}
            className="flex min-w-0 flex-col gap-[14px] wrap-anywhere p-4 md:gap-4 md:p-6"
            data-r2c-screen="scheduling"
          >
            {!configuration && settingsContext && navigationContext ? (
              <Button
                className={
                  activeTab === "kebijakan" ? "w-full bg-surface" : "w-fit"
                }
                variant="ghost"
                render={<a href="/settings" />}
              >
                ← Kembali ke Pengaturan
              </Button>
            ) : null}
            {!configuration && settingsContext && activeTab !== "jadwal" ? (
              <Breadcrumb className="hidden md:block">
                <BreadcrumbList>
                  <BreadcrumbItem>
                    <BreadcrumbLink href="/settings">Pengaturan</BreadcrumbLink>
                  </BreadcrumbItem>
                  <BreadcrumbSeparator />
                  <BreadcrumbItem>
                    <BreadcrumbPage>
                      {activeTab === "shift"
                        ? "Template shift"
                        : activeTab === "kebijakan"
                          ? "Kebijakan presensi"
                          : "Kalender Outlet"}
                    </BreadcrumbPage>
                  </BreadcrumbItem>
                </BreadcrumbList>
              </Breadcrumb>
            ) : null}
            {activeTab !== "kebijakan" ? (
              <>
                {!configuration ? (
                  <NotificationInbox
                    key={`inbox:${context.tenant.id}:${context.user.id}`}
                  />
                ) : null}
                <PageHeading
                  minimal={Boolean(configuration)}
                  title={
                    activeTab === "jadwal"
                      ? "Jadwal"
                      : activeTab === "shift"
                        ? "Template shift"
                        : activeTab === "kebijakan"
                          ? "Kebijakan presensi"
                          : "Kalender Outlet"
                  }
                  role={
                    context.roles.includes("owner") ? "Owner" : "Supervisor"
                  }
                  description={
                    activeTab === "shift"
                      ? "Template shift organisasi dan revisi bertanggal berlaku."
                      : activeTab === "kebijakan"
                        ? "Nilai yang berlaku, sumbernya, dan perubahan mendatang."
                        : activeTab === "kalender"
                          ? "Hari buka/tutup dan zona waktu Outlet."
                          : "Jadwal mingguan, penugasan shift, dan pengecualian tanggal."
                  }
                />
                {!configuration ? (
                  <ContextAlert
                    title={`${context.roles.includes("owner") ? "Owner" : "Supervisor"} · ${context.outlets.map((outlet) => outlet.name).join(" & ") || "Belum ada Outlet"}`}
                  >
                    {context.roles.includes("owner")
                      ? activeTab === "jadwal"
                        ? "Kelola jadwal organisasi aktif. Template shift, kebijakan presensi, dan kalender tersedia di Pengaturan."
                        : "Perubahan disimpan sebagai versi baru. Penugasan mingguan dan jadwal lama tetap mengikuti versi yang dipilih."
                      : "Jadwal hanya menampilkan Outlet yang dapat Anda akses. Izin untuk mengubah konfigurasi tersedia di Pengaturan."}
                  </ContextAlert>
                ) : null}

                {error && !scheduleEditor ? (
                  <Alert variant="destructive">
                    <AlertTitle>Permintaan belum berhasil</AlertTitle>
                    <AlertDescription>{error}</AlertDescription>
                  </Alert>
                ) : null}
                {notice && !scheduleEditor ? (
                  <Alert>
                    <AlertTitle>Perubahan tersimpan</AlertTitle>
                    <AlertDescription>{notice}</AlertDescription>
                  </Alert>
                ) : null}

                <div
                  className={
                    configuration === "kalender"
                      ? "rounded-[16px] border border-border bg-surface p-3"
                      : undefined
                  }
                >
                  <FieldGroup
                    className={cn(
                      "grid min-w-0 gap-3",
                      configuration === "kalender"
                        ? "grid-cols-1 sm:grid-cols-3"
                        : "md:grid-cols-2"
                    )}
                  >
                    {configuration === "kalender" ? (
                      <Field>
                        <FieldLabel htmlFor="calendar-start">
                          Tanggal awal (lokal)
                        </FieldLabel>
                        <Input
                          id="calendar-start"
                          type="date"
                          value={weekStart}
                          onChange={(event) => {
                            const value = event.target.value
                            if (value)
                              calendarDraft.attempt(() => changeWeek(value))
                          }}
                        />
                      </Field>
                    ) : activeTab === "jadwal" || activeTab === "kalender" ? (
                      <WorkWeekControl
                        weekStart={weekStart}
                        onChange={(value) =>
                          calendarDraft.attempt(() => changeWeek(value))
                        }
                        disabled={busy || loading || plannerBusy}
                      />
                    ) : null}
                    {configuration === "kalender" ? (
                      <Field>
                        <FieldLabel htmlFor="calendar-outlet">
                          Outlet
                        </FieldLabel>
                        <NativeSelect
                          id="calendar-outlet"
                          value={outletId}
                          onChange={(event) => {
                            const value = event.target.value
                            calendarDraft.attempt(() => setOutletId(value))
                          }}
                        >
                          <NativeSelectOption value="">
                            Pilih Outlet
                          </NativeSelectOption>
                          {managerOutlets.map((outlet) => (
                            <NativeSelectOption
                              key={outlet.id}
                              value={outlet.id}
                            >
                              {outlet.name}
                            </NativeSelectOption>
                          ))}
                        </NativeSelect>
                      </Field>
                    ) : (
                      <LabeledControl
                        label="Outlet"
                        helper="Pilih dari Outlet yang dapat Anda akses."
                        control={
                          <NativeSelect
                            id="outlet-filter"
                            disabled={plannerBusy}
                            value={outletId}
                            onChange={(event) => {
                              const value = event.target.value
                              calendarDraft.attempt(() => setOutletId(value))
                            }}
                          >
                            <NativeSelectOption value="">
                              Pilih Outlet
                            </NativeSelectOption>
                            {managerOutlets.map((outlet) => (
                              <NativeSelectOption
                                key={outlet.id}
                                value={outlet.id}
                              >
                                {outlet.name}
                              </NativeSelectOption>
                            ))}
                          </NativeSelect>
                        }
                      />
                    )}
                    {configuration === "kalender" ? (
                      <Field>
                        <FieldLabel htmlFor="calendar-days">
                          Rentang (1–14 hari)
                        </FieldLabel>
                        <Input
                          id="calendar-days"
                          type="number"
                          min={1}
                          max={14}
                          value={configSearch.days}
                          onChange={(event) => {
                            const days = Number(event.target.value)
                            if (days >= 1 && days <= 14)
                              calendarDraft.attempt(
                                () =>
                                  void navigate({
                                    to: "/settings/outlet-calendar",
                                    search: { ...configSearch, days },
                                  })
                              )
                          }}
                        />
                      </Field>
                    ) : null}
                  </FieldGroup>
                </div>
                {!configuration ? (
                  <details className="min-w-0">
                    <summary className="flex min-h-11 w-fit cursor-pointer items-center gap-2 text-label text-brand-700">
                      Filter unit bisnis
                    </summary>
                    <div className="max-w-sm pt-2">
                      <LabeledControl
                        label="Unit bisnis"
                        helper="Pilihan Outlet mengikuti unit bisnis."
                        control={
                          <NativeSelect
                            id="business-unit-filter"
                            disabled={plannerBusy}
                            value={businessUnitId}
                            onChange={(event) => {
                              const value = event.target.value
                              calendarDraft.attempt(() => {
                                const outlet = context.outlets.find(
                                  (item) =>
                                    !value ||
                                    String(item.business_unit_id) === value
                                )
                                setBusinessUnitId(value)
                                setOutletId(outlet ? String(outlet.id) : "")
                              })
                            }}
                          >
                            <NativeSelectOption value="">
                              Semua unit bisnis
                            </NativeSelectOption>
                            {context.business_units.map((unit) => (
                              <NativeSelectOption key={unit.id} value={unit.id}>
                                {unit.name}
                              </NativeSelectOption>
                            ))}
                          </NativeSelect>
                        }
                      />
                    </div>
                  </details>
                ) : null}
              </>
            ) : null}
            {canManage ? (
              <Tabs
                onValueChange={(value) =>
                  calendarDraft.attempt(() => {
                    const section = String(value)
                    const changeSection = () => {
                      setActiveTab(section)
                      window.history.replaceState(
                        window.history.state,
                        "",
                        `${window.location.pathname}${window.location.search}${section === "jadwal" ? "" : `#${section}`}`
                      )
                    }
                    if (activeTab === "kebijakan") {
                      const leave = new CustomEvent("hadirinaja:leave-policy", {
                        cancelable: true,
                        detail: changeSection,
                      })
                      if (!window.dispatchEvent(leave)) return
                    }
                    setActiveTab(section)
                    window.history.replaceState(
                      window.history.state,
                      "",
                      `${window.location.pathname}${window.location.search}${section === "jadwal" ? "" : `#${section}`}`
                    )
                    window.dispatchEvent(new HashChangeEvent("hashchange"))
                  })
                }
                value={activeTab}
              >
                <TabsContent
                  className="flex min-w-0 flex-col gap-4"
                  value="jadwal"
                >
                  <Tabs
                    value={operation}
                    onValueChange={(value) => setOperation(String(value))}
                  >
                    <TabsList
                      aria-label="Operasional jadwal"
                      className="max-w-full flex-wrap group-data-horizontal/tabs:h-auto"
                    >
                      <TabsTrigger disabled={plannerBusy} value="planner">
                        Planner mingguan
                      </TabsTrigger>
                      <TabsTrigger disabled={plannerBusy} value="mingguan">
                        Jadwal berlaku
                      </TabsTrigger>
                      <TabsTrigger disabled={plannerBusy} value="penugasan">
                        Penugasan shift
                      </TabsTrigger>
                      <TabsTrigger disabled={plannerBusy} value="pengecualian">
                        Pengecualian
                      </TabsTrigger>
                    </TabsList>
                    <TabsContent value="planner" className="min-w-0 pt-4">
                      {operation === "planner" && outletId ? (
                        <WeeklyPlanner
                          key={`${context.tenant.id}:${context.user.id}:${outletId}:${weekStart}`}
                          outletId={Number(outletId)}
                          outletName={
                            context.outlets.find(
                              (outlet) => outlet.id === Number(outletId)
                            )?.name ?? "Outlet"
                          }
                          weekStart={weekStart}
                          templates={context.shift_templates}
                          onBusyChange={setPlannerBusy}
                          onPublished={() => {
                            void loadPageData(context, outletId, weekStart)
                          }}
                        />
                      ) : (
                        <p className="text-body">
                          Pilih Outlet untuk merencanakan minggu ini.
                        </p>
                      )}
                    </TabsContent>
                    <TabsContent
                      value="mingguan"
                      className="flex min-w-0 flex-col gap-4 pt-4"
                    >
                      {loading ? (
                        <p
                          role="status"
                          className="text-body text-muted-foreground"
                        >
                          Memuat jadwal…
                        </p>
                      ) : error ? (
                        <Button
                          variant="outline"
                          className="self-start"
                          onClick={() =>
                            void loadPageData(context, outletId, weekStart)
                          }
                        >
                          Coba lagi
                        </Button>
                      ) : !weekRows.length ? (
                        <Empty>
                          <EmptyHeader>
                            <EmptyTitle>
                              Belum ada jadwal untuk Outlet ini
                            </EmptyTitle>
                            <EmptyDescription>
                              Karyawan dengan penugasan atau jadwal pada minggu
                              ini akan tampil di sini.
                            </EmptyDescription>
                          </EmptyHeader>
                        </Empty>
                      ) : (
                        <ScheduleMatrix
                          days={displayDays}
                          employees={weekRows}
                          onSelect={(employee, day) => {
                            scheduleTrigger.current =
                              document.activeElement instanceof HTMLElement
                                ? document.activeElement
                                : null
                            setSelectedDay({ employee, day })
                          }}
                        />
                      )}
                      <p className="text-caption">
                        Jam lokal Outlet · * pengecualian satu tanggal · catatan
                        dan riwayat tidak ditimpa
                      </p>
                      {operationalSummaries}
                    </TabsContent>
                    <TabsContent value="penugasan" className="pt-4">
                      {assignmentSummary}
                    </TabsContent>
                    <TabsContent value="pengecualian" className="pt-4">
                      {exceptionSummary}
                    </TabsContent>
                  </Tabs>
                </TabsContent>

                <TabsContent value="kebijakan" className="pt-0">
                  {activeTab === "kebijakan" ? (
                    <AttendancePolicy
                      key={`${context.tenant.id}-${isOwner}`}
                      context={context}
                      settingsContext={settingsContext}
                      compact={Boolean(configuration)}
                    />
                  ) : null}
                </TabsContent>
                <TabsContent
                  className="b3-calendar-pane flex flex-col gap-3 pt-3"
                  value="kalender"
                >
                  {uncertainCalendar && !calendarModal
                    ? calendarRecoveryAlert
                    : null}
                  <fieldset
                    disabled={busy || uncertainCalendar || !calendarReady}
                    className="contents"
                  >
                    <Card>
                      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <div className="flex min-w-0 flex-col gap-1">
                          <CardTitle>Kalender operasional</CardTitle>
                          <CardDescription className="flex flex-wrap items-center gap-x-2 gap-y-1">
                            {calendar?.outlet.name ? (
                              <span>{calendar.outlet.name}</span>
                            ) : null}
                            {calendarTimezones.length === 1 ? (
                              <Badge variant="outline">
                                {calendarTimezones[0]}
                              </Badge>
                            ) : calendarTimezones.length > 1 ? (
                              <span>Zona waktu dapat berbeda per tanggal</span>
                            ) : null}
                          </CardDescription>
                          <p className="text-caption text-muted-foreground">
                            Referensi libur tidak mengubah status buka/tutup.
                          </p>
                        </div>
                        {context.capabilities.manage_calendars ? (
                          <div className="flex flex-wrap items-center gap-2">
                            <Button
                              type="button"
                              variant="outline"
                              disabled={!calendarReady}
                              onClick={(event) =>
                                openCalendarModal(
                                  "version",
                                  event.currentTarget
                                )
                              }
                            >
                              Jadwalkan perubahan
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              disabled={!calendarReady}
                              onClick={(event) =>
                                openCalendarModal(
                                  "holiday",
                                  event.currentTarget
                                )
                              }
                            >
                              Catat libur
                            </Button>
                          </div>
                        ) : null}
                      </CardHeader>
                      <CardContent className="pt-0">
                        {loading && !calendar ? (
                          <p
                            role="status"
                            className="py-4 text-caption text-muted-foreground"
                          >
                            Memuat kalender…
                          </p>
                        ) : !outletId ? (
                          <p
                            role="status"
                            className="py-4 text-caption text-muted-foreground"
                          >
                            {managerOutlets.length
                              ? "Pilih Outlet untuk melihat kalender."
                              : "Belum ada Outlet yang dapat Anda akses."}
                          </p>
                        ) : error && !calendar ? null : calendar?.days
                            .length ? (
                          <div className="grid min-w-0 grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                            {calendar.days.map((day) => (
                              <article
                                className="flex min-w-0 flex-col gap-2.5 rounded-[14px] border border-border bg-surface p-3"
                                key={day.date}
                              >
                                <div className="flex items-start justify-between gap-2">
                                  <time
                                    dateTime={day.date}
                                    className="text-label [font-size:15px] font-semibold"
                                  >
                                    {formatWorkDate(day.date)}
                                  </time>
                                  <Badge
                                    variant={
                                      day.status === "open"
                                        ? "secondary"
                                        : "outline"
                                    }
                                  >
                                    {day.status === "open" ? "Buka" : "Tutup"}
                                  </Badge>
                                </div>
                                {calendarTimezones.length > 1 ? (
                                  <p className="text-caption text-muted-foreground">
                                    {day.timezone}
                                  </p>
                                ) : null}
                                {day.exception ? (
                                  <Badge className="w-fit" variant="outline">
                                    Pengecualian · revisi{" "}
                                    {day.exception.revision}
                                  </Badge>
                                ) : null}
                                {day.holiday_references.length ? (
                                  <div className="flex min-w-0 flex-col gap-1">
                                    {day.holiday_references.map((holiday) => (
                                      <p
                                        className="wrap-anywhere text-caption text-muted-foreground"
                                        key={holiday.id}
                                      >
                                        Libur: {holiday.name}
                                        {holiday.region
                                          ? ` · ${holiday.region}`
                                          : ""}
                                      </p>
                                    ))}
                                  </div>
                                ) : null}
                                {context.capabilities.manage_calendars ? (
                                  <Button
                                    className="mt-auto min-h-10 self-start"
                                    type="button"
                                    size="sm"
                                    variant="ghost"
                                    aria-label={`Atur status ${formatWorkDate(day.date)}`}
                                    title={`Atur status ${formatWorkDate(day.date)}`}
                                    disabled={!calendarReady}
                                    onClick={(event) =>
                                      openCalendarModal(
                                        "exception",
                                        event.currentTarget,
                                        day.date
                                      )
                                    }
                                  >
                                    Atur status
                                  </Button>
                                ) : null}
                              </article>
                            ))}
                          </div>
                        ) : (
                          <p
                            role="status"
                            className="py-4 text-caption text-muted-foreground"
                          >
                            Belum ada hari pada rentang ini.
                          </p>
                        )}
                      </CardContent>
                    </Card>

                    {context.capabilities.manage_calendars &&
                    calendar?.versions?.length ? (
                      <details className="rounded-[16px] border border-border bg-surface px-4 py-2">
                        <summary className="flex min-h-11 cursor-pointer items-center text-label">
                          Riwayat perubahan ({calendar.versions.length})
                        </summary>
                        <ol className="grid gap-2 pb-3">
                          {calendar.versions.map((version) => (
                            <li
                              className="rounded-xl border border-border p-3"
                              key={version.id}
                            >
                              <p className="text-label">
                                Perubahan #{version.id} · berlaku mulai{" "}
                                {version.effective_from} UTC
                              </p>
                              <p className="text-caption text-muted-foreground">
                                {version.timezone} ·{" "}
                                {version.operating_weekdays
                                  .map(
                                    (id) =>
                                      weekdays.find((day) => day.id === id)
                                        ?.label ?? String(id)
                                  )
                                  .join(", ")}
                              </p>
                              {version.reason ? (
                                <p className="mt-1 text-caption">
                                  Alasan: {version.reason}
                                </p>
                              ) : null}
                            </li>
                          ))}
                        </ol>
                      </details>
                    ) : null}

                    {!context.capabilities.manage_calendars ? (
                      <Alert>
                        <AlertTitle>Kalender Outlet</AlertTitle>
                        <AlertDescription>
                          Supervisor hanya dapat melihat Outlet yang diizinkan.
                        </AlertDescription>
                      </Alert>
                    ) : null}

                    <Dialog
                      modal
                      open={calendarModal === "version" && calendarEditorReady}
                      onOpenChange={requestCalendarModalClose}
                    >
                      <DialogContent
                        finalFocus={calendarModalTrigger}
                        className="flex max-h-[calc(100dvh-2rem)] w-[calc(100%-1rem)] max-w-[720px] flex-col gap-0 overflow-hidden p-0 sm:w-[calc(100%-2rem)]"
                      >
                        <DialogHeader className="shrink-0 border-b border-border px-4 py-3 pr-14 sm:px-5">
                          <DialogTitle>
                            Jadwalkan perubahan kalender
                          </DialogTitle>
                          <DialogDescription>
                            Perubahan berlaku mulai tanggal UTC yang dipilih.
                            Status untuk satu tanggal diatur terpisah.
                          </DialogDescription>
                        </DialogHeader>
                        {uncertainCalendar ? calendarRecoveryAlert : null}
                        <form
                          className="flex min-h-0 flex-1 flex-col"
                          onSubmit={(event) => {
                            event.preventDefault()
                            if (!canSubmitCalendar()) return
                            configConfirmTrigger.current =
                              event.currentTarget.querySelector(
                                'button[type="submit"]'
                              )
                            setConfigConfirmation({
                              title: "Jadwalkan perubahan kalender?",
                              description:
                                "Perubahan berlaku mulai tanggal UTC yang dipilih. Riwayat kalender sebelumnya tetap tersimpan.",
                              actionLabel: "Jadwalkan perubahan",
                              action: () => createCalendarVersion(event),
                            })
                          }}
                          onChangeCapture={() => calendarDraft.mark()}
                        >
                          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain p-4 sm:p-5">
                            <fieldset
                              disabled={
                                busy ||
                                uncertainCalendar ||
                                !calendarEditorReady
                              }
                              className="m-0 grid min-w-0 gap-4 border-0 p-0 sm:grid-cols-2"
                            >
                              <Field>
                                <FieldLabel htmlFor="calendar-timezone">
                                  Zona waktu Outlet
                                </FieldLabel>
                                <Input
                                  id="calendar-timezone"
                                  onChange={(event) =>
                                    setCalendarTimezone(event.target.value)
                                  }
                                  required
                                  value={calendarTimezone}
                                />
                              </Field>
                              <Field>
                                <FieldLabel htmlFor="calendar-effective">
                                  Mulai berlaku (UTC)
                                </FieldLabel>
                                <Input
                                  id="calendar-effective"
                                  min={new Date().toISOString().slice(0, 10)}
                                  onChange={(event) =>
                                    setCalendarEffectiveFrom(event.target.value)
                                  }
                                  required
                                  type="date"
                                  value={calendarEffectiveFrom}
                                />
                              </Field>
                              <FieldSet className="gap-3 sm:col-span-2">
                                <FieldLegend variant="label">
                                  Hari operasional normal
                                </FieldLegend>
                                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                                  {weekdays.map((day) => (
                                    <Field
                                      orientation="horizontal"
                                      className="items-center"
                                      key={day.id}
                                    >
                                      <Checkbox
                                        checked={calendarWeekdays.includes(
                                          day.id
                                        )}
                                        id={`calendar-day-${day.id}`}
                                        onCheckedChange={(checked) =>
                                          setCalendarWeekdays((current) =>
                                            checked
                                              ? [...current, day.id].sort()
                                              : current.filter(
                                                  (value) => value !== day.id
                                                )
                                          )
                                        }
                                      />
                                      <FieldLabel
                                        htmlFor={`calendar-day-${day.id}`}
                                      >
                                        {day.label}
                                      </FieldLabel>
                                    </Field>
                                  ))}
                                </div>
                              </FieldSet>
                              <Field className="sm:col-span-2">
                                <FieldLabel htmlFor="calendar-reason">
                                  Alasan perubahan
                                </FieldLabel>
                                <Input
                                  id="calendar-reason"
                                  maxLength={1000}
                                  minLength={3}
                                  onChange={(event) =>
                                    setCalendarReason(event.target.value)
                                  }
                                  required
                                  value={calendarReason}
                                />
                              </Field>
                            </fieldset>
                          </div>
                          <div className="flex shrink-0 flex-col-reverse gap-2 border-t border-border bg-popover p-4 pb-[max(16px,env(safe-area-inset-bottom))] sm:flex-row sm:justify-end sm:px-5">
                            <Button
                              type="button"
                              variant="outline"
                              disabled={busy}
                              onClick={() => requestCalendarModalClose(false)}
                            >
                              Batal
                            </Button>
                            <Button
                              disabled={
                                busy ||
                                uncertainCalendar ||
                                !calendarEditorReady ||
                                calendarWeekdays.length === 0
                              }
                              type="submit"
                            >
                              Jadwalkan perubahan
                            </Button>
                          </div>
                        </form>
                      </DialogContent>
                    </Dialog>

                    <Dialog
                      modal
                      open={calendarModal === "holiday" && calendarEditorReady}
                      onOpenChange={requestCalendarModalClose}
                    >
                      <DialogContent
                        finalFocus={calendarModalTrigger}
                        className="flex max-h-[calc(100dvh-2rem)] w-[calc(100%-1rem)] max-w-[720px] flex-col gap-0 overflow-hidden p-0 sm:w-[calc(100%-2rem)]"
                      >
                        <DialogHeader className="shrink-0 border-b border-border px-4 py-3 pr-14 sm:px-5">
                          <DialogTitle>Catat hari libur</DialogTitle>
                          <DialogDescription>
                            Referensi ini hanya catatan; Outlet tidak otomatis
                            tutup.
                          </DialogDescription>
                        </DialogHeader>
                        {uncertainCalendar ? calendarRecoveryAlert : null}
                        <form
                          className="flex min-h-0 flex-1 flex-col"
                          onSubmit={(event) => {
                            event.preventDefault()
                            if (!canSubmitCalendar()) return
                            configConfirmTrigger.current =
                              event.currentTarget.querySelector(
                                'button[type="submit"]'
                              )
                            setConfigConfirmation({
                              title: "Catat hari libur?",
                              description:
                                "Referensi hari libur hanya sebagai catatan. Outlet tidak otomatis tutup.",
                              actionLabel: "Catat hari libur",
                              action: () => createHoliday(event),
                            })
                          }}
                          onChangeCapture={() => calendarDraft.mark()}
                        >
                          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain p-4 sm:p-5">
                            <fieldset
                              disabled={
                                busy ||
                                uncertainCalendar ||
                                !calendarEditorReady
                              }
                              className="m-0 grid min-w-0 gap-4 border-0 p-0 sm:grid-cols-3"
                            >
                              <Field>
                                <FieldLabel htmlFor="holiday-date">
                                  Tanggal
                                </FieldLabel>
                                <Input
                                  id="holiday-date"
                                  onChange={(event) =>
                                    setHolidayDate(event.target.value)
                                  }
                                  required
                                  type="date"
                                  value={holidayDate}
                                />
                              </Field>
                              <Field>
                                <FieldLabel htmlFor="holiday-name">
                                  Nama hari
                                </FieldLabel>
                                <Input
                                  id="holiday-name"
                                  maxLength={160}
                                  minLength={2}
                                  onChange={(event) =>
                                    setHolidayName(event.target.value)
                                  }
                                  required
                                  value={holidayName}
                                />
                              </Field>
                              <Field>
                                <FieldLabel htmlFor="holiday-region">
                                  Wilayah (opsional)
                                </FieldLabel>
                                <Input
                                  id="holiday-region"
                                  maxLength={120}
                                  onChange={(event) =>
                                    setHolidayRegion(event.target.value)
                                  }
                                  value={holidayRegion}
                                />
                              </Field>
                            </fieldset>
                          </div>
                          <div className="flex shrink-0 flex-col-reverse gap-2 border-t border-border bg-popover p-4 pb-[max(16px,env(safe-area-inset-bottom))] sm:flex-row sm:justify-end sm:px-5">
                            <Button
                              type="button"
                              variant="outline"
                              disabled={busy}
                              onClick={() => requestCalendarModalClose(false)}
                            >
                              Batal
                            </Button>
                            <Button
                              disabled={
                                busy ||
                                uncertainCalendar ||
                                !calendarEditorReady
                              }
                              type="submit"
                              variant="outline"
                            >
                              Catat hari libur
                            </Button>
                          </div>
                        </form>
                      </DialogContent>
                    </Dialog>

                    <Dialog
                      modal
                      open={
                        calendarModal === "exception" && calendarEditorReady
                      }
                      onOpenChange={requestCalendarModalClose}
                    >
                      <DialogContent
                        finalFocus={calendarModalTrigger}
                        className="flex max-h-[calc(100dvh-2rem)] w-[calc(100%-1rem)] max-w-[720px] flex-col gap-0 overflow-hidden p-0 sm:w-[calc(100%-2rem)]"
                      >
                        <DialogHeader className="shrink-0 border-b border-border px-4 py-3 pr-14 sm:px-5">
                          <DialogTitle>Atur status tanggal</DialogTitle>
                          <DialogDescription>
                            Tanggal mengikuti waktu lokal Outlet. Referensi
                            libur tidak mengubah status.
                          </DialogDescription>
                        </DialogHeader>
                        {uncertainCalendar ? calendarRecoveryAlert : null}
                        <form
                          className="flex min-h-0 flex-1 flex-col"
                          onSubmit={(event) => {
                            event.preventDefault()
                            if (!canSubmitCalendar()) return
                            configConfirmTrigger.current =
                              event.currentTarget.querySelector(
                                'button[type="submit"]'
                              )
                            setConfigConfirmation({
                              title:
                                "Terapkan status Outlet untuk tanggal ini?",
                              description:
                                "Status hanya berlaku pada tanggal yang dipilih. Referensi hari libur tidak otomatis menutup Outlet.",
                              actionLabel: "Terapkan status",
                              action: () => createCalendarException(event),
                            })
                          }}
                          onChangeCapture={() => calendarDraft.mark()}
                        >
                          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain p-4 sm:p-5">
                            <fieldset
                              disabled={
                                busy ||
                                uncertainCalendar ||
                                !calendarEditorReady
                              }
                              className="m-0 grid min-w-0 gap-4 border-0 p-0 sm:grid-cols-2"
                            >
                              <Field>
                                <FieldLabel htmlFor="calendar-exception-date">
                                  Tanggal
                                </FieldLabel>
                                <Input
                                  id="calendar-exception-date"
                                  min={new Date().toISOString().slice(0, 10)}
                                  onChange={(event) =>
                                    setCalendarExceptionDate(event.target.value)
                                  }
                                  required
                                  type="date"
                                  value={calendarExceptionDate}
                                />
                              </Field>
                              <Field>
                                <FieldLabel htmlFor="calendar-exception-status">
                                  Status Outlet
                                </FieldLabel>
                                <NativeSelect
                                  id="calendar-exception-status"
                                  onChange={(event) =>
                                    setCalendarExceptionStatus(
                                      event.target.value as "open" | "closed"
                                    )
                                  }
                                  value={calendarExceptionStatus}
                                >
                                  <NativeSelectOption value="closed">
                                    Tutup
                                  </NativeSelectOption>
                                  <NativeSelectOption value="open">
                                    Buka
                                  </NativeSelectOption>
                                </NativeSelect>
                              </Field>
                              <Field className="sm:col-span-2">
                                <FieldLabel htmlFor="calendar-holiday">
                                  Referensi hari libur (opsional)
                                </FieldLabel>
                                <NativeSelect
                                  id="calendar-holiday"
                                  onChange={(event) =>
                                    setCalendarExceptionHoliday(
                                      event.target.value
                                    )
                                  }
                                  value={calendarExceptionHoliday}
                                >
                                  <NativeSelectOption value="">
                                    Tanpa referensi
                                  </NativeSelectOption>
                                  {flatHolidayOptions.map((holiday) => (
                                    <NativeSelectOption
                                      key={`${holiday.id}-${holiday.name}`}
                                      value={holiday.id}
                                    >
                                      {holiday.name}
                                    </NativeSelectOption>
                                  ))}
                                </NativeSelect>
                              </Field>
                              <Field className="sm:col-span-2">
                                <FieldLabel htmlFor="calendar-exception-reason">
                                  Alasan operasional
                                </FieldLabel>
                                <Input
                                  id="calendar-exception-reason"
                                  maxLength={1000}
                                  minLength={3}
                                  onChange={(event) =>
                                    setCalendarExceptionReason(
                                      event.target.value
                                    )
                                  }
                                  required
                                  value={calendarExceptionReason}
                                />
                              </Field>
                            </fieldset>
                          </div>
                          <div className="flex shrink-0 flex-col-reverse gap-2 border-t border-border bg-popover p-4 pb-[max(16px,env(safe-area-inset-bottom))] sm:flex-row sm:justify-end sm:px-5">
                            <Button
                              type="button"
                              variant="outline"
                              disabled={busy}
                              onClick={() => requestCalendarModalClose(false)}
                            >
                              Batal
                            </Button>
                            <Button
                              disabled={
                                busy ||
                                uncertainCalendar ||
                                !calendarEditorReady
                              }
                              type="submit"
                            >
                              Simpan status Outlet
                            </Button>
                          </div>
                        </form>
                      </DialogContent>
                    </Dialog>
                  </fieldset>
                </TabsContent>
                {!configuration && activeTab !== "kebijakan" ? (
                  <section className="flex min-w-0 flex-wrap items-center gap-3 rounded-[16px] bg-brand-50 p-4">
                    <p className="min-w-0 flex-1 text-body [font-size:13px] text-muted-foreground">
                      Konfigurasi ada di Pengaturan
                      <br />
                      {isOwner
                        ? "Template shift, kebijakan presensi dan kalender Outlet."
                        : "Supervisor dapat melihat konfigurasi sesuai izin, tetapi tidak dapat mengubah template shift, kebijakan presensi, atau kalender Outlet."}
                    </p>
                    <Button
                      variant="outline"
                      className="text-[13px]"
                      aria-expanded={
                        configurationOpen || activeTab !== "jadwal"
                      }
                      aria-controls="scheduling-configuration-navigation"
                      onClick={() => setConfigurationOpen((open) => !open)}
                    >
                      <Settings2 aria-hidden="true" data-icon="inline-start" />
                      Lihat konfigurasi
                    </Button>
                    {configurationOpen || activeTab !== "jadwal" ? (
                      <TabsList
                        id="scheduling-configuration-navigation"
                        aria-label="Konfigurasi dan jadwal"
                        className="max-w-full flex-wrap justify-start group-data-horizontal/tabs:h-auto"
                      >
                        <TabsTrigger value="jadwal">
                          Kembali ke Jadwal
                        </TabsTrigger>
                        <TabsTrigger value="shift">Template shift</TabsTrigger>
                        <TabsTrigger value="kebijakan">Kebijakan</TabsTrigger>
                        <TabsTrigger value="kalender">
                          Kalender Outlet
                        </TabsTrigger>
                      </TabsList>
                    ) : null}
                  </section>
                ) : null}
              </Tabs>
            ) : (
              <PersonalSchedule
                days={personalDays}
                organizationName={organizationName}
                loading={loading}
                clockLoading={personalClockLoading}
                clockError={personalClockError}
                todayError={personalTodayError}
                today={personalToday}
                todayTimezone={personalClock?.timezone ?? null}
                todayDay={
                  personalTodayDay?.work_date === personalToday
                    ? personalTodayDay
                    : null
                }
                onWeekChange={changeWeek}
                weekStart={weekStart}
              />
            )}
            <ContextDrawer
              open={!!scheduleEditor}
              onOpenChange={(open) => {
                if (!open) setScheduleEditor(null)
              }}
              finalFocus={scheduleTrigger}
              busy={busy}
              title={
                scheduleEditor === "rule"
                  ? "Atur pola mingguan"
                  : "Pengecualian satu tanggal"
              }
              description="Perubahan mengikuti Outlet terpilih, tanggal berlaku, dan alasan. Periode sebelumnya tetap tersimpan."
            >
              {error ? (
                <ContextAlert tone="danger" title="Perubahan belum tersimpan">
                  {error}
                </ContextAlert>
              ) : null}
              {notice ? (
                <p role="status" className="text-body text-brand-700">
                  {notice}
                </p>
              ) : null}
              {scheduleEditor === "rule" ? (
                <form
                  className="flex flex-col gap-4"
                  onSubmit={createWeeklyRule}
                >
                  <FieldGroup className="grid gap-4 sm:grid-cols-2">
                    <Field>
                      <FieldLabel htmlFor="rule-employee">Karyawan</FieldLabel>
                      <NativeSelect
                        id="rule-employee"
                        onChange={(event) =>
                          setRuleEmployeeId(event.target.value)
                        }
                        required
                        value={ruleEmployeeId}
                      >
                        <NativeSelectOption value="">
                          Pilih karyawan
                        </NativeSelectOption>
                        {context.employees.map((employee) => (
                          <NativeSelectOption
                            key={employee.id}
                            value={employee.id}
                          >
                            {employee.name}
                          </NativeSelectOption>
                        ))}
                      </NativeSelect>
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="rule-weekday">
                        Hari berulang
                      </FieldLabel>
                      <NativeSelect
                        id="rule-weekday"
                        onChange={(event) => setRuleWeekday(event.target.value)}
                        value={ruleWeekday}
                      >
                        {weekdays.map((day) => (
                          <NativeSelectOption key={day.id} value={day.id}>
                            {day.label}
                          </NativeSelectOption>
                        ))}
                      </NativeSelect>
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="rule-shift">Shift</FieldLabel>
                      <NativeSelect
                        id="rule-shift"
                        onChange={(event) => setRuleShiftId(event.target.value)}
                        value={ruleShiftId}
                      >
                        <NativeSelectOption value="">
                          Hari istirahat
                        </NativeSelectOption>
                        {shiftVersions.map((shift) => (
                          <NativeSelectOption key={shift.id} value={shift.id}>
                            {shift.template_name} · v{shift.revision} ·{" "}
                            {shift.start_time}–{shift.end_time}
                          </NativeSelectOption>
                        ))}
                      </NativeSelect>
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="rule-start">
                        Berlaku mulai
                      </FieldLabel>
                      <Input
                        id="rule-start"
                        onChange={(event) =>
                          setRuleEffectiveFrom(event.target.value)
                        }
                        required
                        type="date"
                        value={ruleEffectiveFrom}
                      />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="rule-until">
                        Berlaku sampai (opsional)
                      </FieldLabel>
                      <Input
                        id="rule-until"
                        onChange={(event) =>
                          setRuleEffectiveUntil(event.target.value)
                        }
                        type="date"
                        value={ruleEffectiveUntil}
                      />
                    </Field>
                  </FieldGroup>
                  <Field>
                    <FieldLabel htmlFor="rule-reason">
                      Alasan perubahan
                    </FieldLabel>
                    <Input
                      id="rule-reason"
                      maxLength={1000}
                      minLength={3}
                      onChange={(event) => setRuleReason(event.target.value)}
                      required
                      value={ruleReason}
                    />
                  </Field>
                  <Button
                    disabled={busy || !ruleEmployeeId || !outletId}
                    type="submit"
                  >
                    Simpan pola mingguan
                  </Button>
                </form>
              ) : (
                <form
                  className="flex flex-col gap-4"
                  onSubmit={createException}
                >
                  <FieldGroup className="grid gap-4 sm:grid-cols-2">
                    <Field>
                      <FieldLabel htmlFor="exception-employee">
                        Karyawan
                      </FieldLabel>
                      <NativeSelect
                        id="exception-employee"
                        onChange={(event) =>
                          setExceptionEmployeeId(event.target.value)
                        }
                        required
                        value={exceptionEmployeeId}
                      >
                        <NativeSelectOption value="">
                          Pilih karyawan
                        </NativeSelectOption>
                        {context.employees.map((employee) => (
                          <NativeSelectOption
                            key={employee.id}
                            value={employee.id}
                          >
                            {employee.name}
                          </NativeSelectOption>
                        ))}
                      </NativeSelect>
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="exception-date">
                        Tanggal kerja
                      </FieldLabel>
                      <Input
                        id="exception-date"
                        min={today()}
                        onChange={(event) =>
                          setExceptionDate(event.target.value)
                        }
                        required
                        type="date"
                        value={exceptionDate}
                      />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="exception-status">Status</FieldLabel>
                      <NativeSelect
                        id="exception-status"
                        onChange={(event) =>
                          setExceptionStatus(
                            event.target.value as "work" | "rest"
                          )
                        }
                        value={exceptionStatus}
                      >
                        <NativeSelectOption value="work">
                          Bekerja
                        </NativeSelectOption>
                        <NativeSelectOption value="rest">
                          Libur
                        </NativeSelectOption>
                      </NativeSelect>
                    </Field>
                    {exceptionStatus === "work" ? (
                      <Field>
                        <FieldLabel htmlFor="exception-shift">
                          Shift untuk tanggal ini
                        </FieldLabel>
                        <NativeSelect
                          id="exception-shift"
                          onChange={(event) =>
                            setExceptionShiftId(event.target.value)
                          }
                          required
                          value={exceptionShiftId}
                        >
                          <NativeSelectOption value="">
                            Pilih shift
                          </NativeSelectOption>
                          {shiftVersions.map((shift) => (
                            <NativeSelectOption key={shift.id} value={shift.id}>
                              {shift.template_name} · v{shift.revision} ·{" "}
                              {shift.start_time}–{shift.end_time}
                            </NativeSelectOption>
                          ))}
                        </NativeSelect>
                      </Field>
                    ) : null}
                  </FieldGroup>
                  <Field>
                    <FieldLabel htmlFor="exception-reason">
                      Alasan perubahan
                    </FieldLabel>
                    <Input
                      id="exception-reason"
                      maxLength={1000}
                      minLength={3}
                      onChange={(event) =>
                        setExceptionReason(event.target.value)
                      }
                      required
                      value={exceptionReason}
                    />
                  </Field>
                  <Button
                    disabled={busy || !exceptionEmployeeId || !outletId}
                    type="submit"
                  >
                    Simpan pengecualian
                  </Button>
                </form>
              )}
            </ContextDrawer>
            <ContextDrawer
              open={!!selectedDay}
              onOpenChange={(open) => {
                if (!open) setSelectedDay(null)
              }}
              finalFocus={scheduleTrigger}
              title="Rincian jadwal"
              description={
                selectedDay
                  ? `${selectedDay.employee.name} · ${formatWorkDate(selectedDay.day.work_date)}`
                  : "Sumber jadwal efektif"
              }
            >
              {selectedDay ? (
                <>
                  <ScheduleDayCard day={selectedDay.day} />
                  <dl className="grid gap-3 text-body">
                    <div>
                      <dt className="text-caption">Outlet dan zona waktu</dt>
                      <dd>
                        {selectedDay.day.outlet?.name ?? "Tanpa Outlet"} ·{" "}
                        {selectedDay.day.timezone}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-caption">Sumber efektif</dt>
                      <dd>
                        {selectedDay.day.provenance.source} · Aturan #
                        {selectedDay.day.provenance.schedule_rule_id ?? "—"} ·
                        Pengecualian #
                        {selectedDay.day.provenance.exception_id ?? "—"}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-caption">Versi shift</dt>
                      <dd>
                        #{selectedDay.day.shift?.version_id ?? "—"} · revisi{" "}
                        {selectedDay.day.shift?.revision ?? "—"}
                        {selectedDay.day.shift?.crosses_midnight
                          ? " · lintas tengah malam"
                          : ""}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-caption">
                        Versi kebijakan organisasi dan Outlet
                      </dt>
                      <dd>
                        #{selectedDay.day.policy.tenant_version_id ?? "—"} / #
                        {selectedDay.day.policy.outlet_version_id ?? "—"}
                      </dd>
                    </div>
                  </dl>
                </>
              ) : null}
              <p className="text-caption">
                Rincian menampilkan sumber jadwal, revisi shift, zona waktu,
                kebijakan, dan konflik yang tersedia. Riwayat lengkap aturan
                belum ditampilkan di sini.
              </p>
            </ContextDrawer>
          </main>
        </div>
      </div>
    </SidebarProvider>
  )
}

function ScheduleDayCard({ day }: { day: EffectiveDay }) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-xl border p-3">
      <div className="flex flex-col gap-1">
        <p className="text-label">{formatWorkDate(day.work_date)}</p>
        {day.status === "scheduled" && day.shift ? (
          <p className="text-caption text-muted-foreground">
            {day.shift.name} ·{" "}
            {formatInstant(day.scheduled_start, day.timezone)}–
            {formatInstant(day.scheduled_end, day.timezone)}
          </p>
        ) : null}
        {day.conflicts.map((conflict) => (
          <p className="text-caption text-destructive" key={conflict}>
            {conflictLabel(conflict)}
          </p>
        ))}
      </div>
      <Badge
        variant={
          day.conflicts.length
            ? "destructive"
            : day.status === "scheduled"
              ? "secondary"
              : "outline"
        }
      >
        {day.conflicts.length
          ? "Konflik"
          : day.status === "scheduled"
            ? "Shift"
            : day.status === "rest"
              ? "Libur"
              : "Belum diatur"}
      </Badge>
    </div>
  )
}

function PersonalSchedule({
  days,
  organizationName,
  loading,
  clockLoading,
  clockError,
  todayError,
  today,
  todayTimezone,
  todayDay,
  onWeekChange,
  weekStart,
}: {
  days: EffectiveDay[]
  organizationName: string
  loading: boolean
  clockLoading: boolean
  clockError: string
  todayError: string
  today: string | null
  todayTimezone: string | null
  todayDay: EffectiveDay | null
  onWeekChange?: (value: string) => void
  weekStart: string
}) {
  const [pickerOpen, setPickerOpen] = useState(false)
  const [selectedDay, setSelectedDay] = useState<{
    workDate: string
    day: EffectiveDay | null
    ambiguous: boolean
  } | null>(null)
  const [widePanel, setWidePanel] = useState(false)
  const detailOpener = useRef<HTMLButtonElement | null>(null)
  const restoreFocus = useRef(false)
  const groupedDays = new Map<string, EffectiveDay[]>()
  for (const day of days) {
    const group = groupedDays.get(day.work_date) ?? []
    group.push(day)
    groupedDays.set(day.work_date, group)
  }
  const weekEnd = weekStart ? addDays(weekStart, 6) : ""
  const weekDates = weekStart
    ? Array.from({ length: 7 }, (_, index) => addDays(weekStart, index))
    : []
  const previousWeek = weekStart ? addDays(weekStart, -7) : ""
  const nextWeek = weekStart ? addDays(weekStart, 7) : ""

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return
    const query = window.matchMedia("(min-width: 768px)")
    const update = () => setWidePanel(query.matches)
    update()
    query.addEventListener("change", update)
    return () => query.removeEventListener("change", update)
  }, [])

  useEffect(() => {
    if (selectedDay || !restoreFocus.current) return
    restoreFocus.current = false
    const restore = () => detailOpener.current?.focus()
    if (typeof window.requestAnimationFrame === "function")
      window.requestAnimationFrame(restore)
    else window.setTimeout(restore, 0)
  }, [selectedDay])

  function openDay(
    workDate: string,
    day: EffectiveDay | null,
    ambiguous: boolean,
    trigger: HTMLButtonElement
  ) {
    detailOpener.current = trigger
    setSelectedDay({ workDate, day, ambiguous })
  }

  function closeDay() {
    restoreFocus.current = true
    setSelectedDay(null)
  }

  function selectCalendarDate(date: Date | undefined) {
    if (!date || !onWeekChange) return
    const selectedDate = calendarDateString(date)
    onWeekChange(mondayOf(selectedDate))
    setPickerOpen(false)
  }

  const todaySummary = describePersonalDay(
    todayDay,
    Boolean(todayDay && hasContradictoryDayShape(todayDay))
  )
  const organizationDoesNotUseSchedules =
    weekDates.length === 7 &&
    weekDates.every((date) => {
      const matches = groupedDays.get(date) ?? []
      return (
        matches.length === 1 &&
        matches[0].status === "unscheduled" &&
        matches[0].provenance.source === "none" &&
        matches[0].conflicts.length === 0
      )
    })
  const selectedGroup = selectedDay
    ? (groupedDays.get(selectedDay.workDate) ?? [])
    : []
  const selected = selectedDay
    ? {
        ...selectedDay,
        day:
          selectedDay.ambiguous || selectedGroup.length > 1
            ? null
            : (selectedGroup[0] ?? selectedDay.day),
        ambiguous: selectedDay.ambiguous || selectedGroup.length > 1,
      }
    : null

  const dayDetails = selected ? (
    <PersonalScheduleDayDetails
      ambiguous={selected.ambiguous}
      day={selected.day}
      workDate={selected.workDate}
    />
  ) : null

  return (
    <div className="flex flex-col gap-4">
      <section
        aria-labelledby="personal-today-title"
        className="rounded-lg border border-border bg-primary/5 p-4"
        data-personal-today="true"
      >
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <h2 className="text-label text-primary" id="personal-today-title">
            Hari ini
          </h2>
          {todayTimezone ? (
            <span className="text-caption text-muted-foreground">
              {todayTimezone}
            </span>
          ) : null}
        </div>
        <p className="mt-1 text-caption text-muted-foreground">
          {today
            ? formatWorkDateLong(today)
            : "Tanggal hari ini belum tersedia"}
        </p>
        <p className="mt-3 text-title">
          {today
            ? todayError
              ? "Jadwal hari ini belum dapat dimuat"
              : personalDaySummary(todayDay, todaySummary, clockLoading)
            : clockLoading
              ? "Memuat tanggal server…"
              : "Tanggal hari ini belum dapat dipastikan"}
        </p>
        {todayDay?.status === "scheduled" &&
        todaySummary.kind === "scheduled" ? (
          <div className="mt-1">
            <p className="text-body tabular-nums">
              {formatPersonalScheduleTime(todayDay)}
            </p>
            {todayDay.outlet?.name ? (
              <p className="mt-1 text-caption text-muted-foreground">
                {todayDay.outlet.name}
              </p>
            ) : null}
          </div>
        ) : null}
        {todayError || clockError ? (
          <p className="mt-2 text-caption text-destructive" role="status">
            {todayError || clockError}
          </p>
        ) : null}
      </section>

      <section
        aria-labelledby="personal-week-title"
        className="flex flex-col gap-3"
      >
        <div className="flex items-center justify-between gap-3 px-1">
          <h2 className="text-subtitle" id="personal-week-title">
            Jadwal mingguan
          </h2>
          <span className="text-caption text-muted-foreground">
            Senin–Minggu
          </span>
        </div>
        <div
          className="relative mx-auto flex min-h-11 w-full max-w-sm items-center justify-center"
          data-personal-week-navigation="true"
        >
          <Button
            aria-label="Minggu sebelumnya"
            className="absolute left-0 top-1/2 size-11 -translate-y-1/2 rounded-md"
            disabled={!onWeekChange || loading || !weekStart}
            onClick={() => onWeekChange?.(previousWeek)}
            size="icon"
            variant="ghost"
          >
            <ChevronLeft aria-hidden="true" />
          </Button>
          <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
            <PopoverTrigger
              render={
                <Button
                  aria-label={
                    weekStart
                      ? `Pilih tanggal untuk minggu ${formatWorkDateLong(weekStart)} sampai ${formatWorkDateLong(weekEnd)}`
                      : "Tanggal minggu belum tersedia"
                  }
                  className="min-h-11 min-w-0 max-w-[calc(100%-6rem)] justify-center gap-2 rounded-md px-2 text-label"
                  disabled={!onWeekChange || loading || !weekStart}
                  variant="ghost"
                />
              }
            >
              <span className="truncate">
                {weekStart
                  ? formatWeekRange(weekStart, weekEnd)
                  : "Memuat minggu"}
              </span>
              <CalendarDays aria-hidden="true" className="size-4 shrink-0" />
            </PopoverTrigger>
            <PopoverContent
              align="center"
              className="max-h-[var(--available-height)] w-auto max-w-[calc(100vw-1rem)] gap-2 overflow-y-auto rounded-lg p-2"
              sideOffset={6}
            >
              <PopoverHeader className="px-2 pt-1">
                <PopoverTitle>Pilih tanggal</PopoverTitle>
                <PopoverDescription>
                  Minggu dimulai pada hari Senin.
                </PopoverDescription>
              </PopoverHeader>
              {weekStart ? (
                <Calendar
                  autoFocus
                  className="[--cell-radius:6px] [--cell-size:2.5rem]"
                  defaultMonth={dateFromWorkDate(weekStart)}
                  labels={{
                    labelDayButton: (date, modifiers) =>
                      `${modifiers.today ? "Hari ini, " : ""}${new Intl.DateTimeFormat(
                        "id-ID",
                        {
                          weekday: "long",
                          day: "numeric",
                          month: "long",
                          year: "numeric",
                        }
                      ).format(date)}${modifiers.selected ? ", dipilih" : ""}`,
                    labelNav: () => "Navigasi kalender",
                    labelNext: () => "Bulan berikutnya",
                    labelPrevious: () => "Bulan sebelumnya",
                  }}
                  locale={id}
                  mode="single"
                  onSelect={selectCalendarDate}
                  required
                  selected={dateFromWorkDate(weekStart)}
                  weekStartsOn={1}
                />
              ) : null}
            </PopoverContent>
          </Popover>
          <Button
            aria-label="Minggu berikutnya"
            className="absolute right-0 top-1/2 size-11 -translate-y-1/2 rounded-md"
            disabled={!onWeekChange || loading || !weekStart}
            onClick={() => onWeekChange?.(nextWeek)}
            size="icon"
            variant="ghost"
          >
            <ChevronRight aria-hidden="true" />
          </Button>
        </div>
        {organizationDoesNotUseSchedules ? (
          <div className="flex flex-col items-start gap-2">
            <p className="text-body text-muted-foreground" role="status">
              {organizationName || "Organisasi"} belum memakai jadwal di
              aplikasi. Absen tetap bisa dilakukan kapan saja.
            </p>
            <Button
              nativeButton={false}
              render={<a href="/attendance" />}
              variant="outline"
            >
              Ke halaman Absen
            </Button>
          </div>
        ) : null}
        {loading ? (
          <p className="text-body text-muted-foreground" role="status">
            Memuat jadwal minggu ini…
          </p>
        ) : !weekStart ? (
          <p className="text-body text-muted-foreground" role="status">
            {clockError || "Tanggal server diperlukan untuk memuat jadwal."}
          </p>
        ) : (
          <div
            className="divide-y divide-border border-y border-border"
            data-personal-week-list="true"
          >
            {weekDates.map((date) => {
              const matchingDays = groupedDays.get(date) ?? []
              const ambiguous = matchingDays.length > 1
              const day = matchingDays.length === 1 ? matchingDays[0] : null
              const description = describePersonalDay(
                day,
                ambiguous || Boolean(day && hasContradictoryDayShape(day))
              )
              return (
                <button
                  aria-haspopup="dialog"
                  className="flex min-h-[4.5rem] w-full items-center justify-between gap-3 py-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
                  key={date}
                  onClick={(event) =>
                    openDay(date, day, ambiguous, event.currentTarget)
                  }
                  type="button"
                >
                  <span className="min-w-0">
                    <span className="block text-label">
                      {today === date ? "Hari ini · " : ""}
                      {formatWorkDate(date)}
                    </span>
                    <span className="mt-1 block truncate text-caption text-muted-foreground">
                      {personalDaySummary(day, description, false)}
                      {day?.status === "scheduled" && day.outlet?.name
                        ? ` · ${day.outlet.name}`
                        : ""}
                    </span>
                  </span>
                  <span
                    className={cn(
                      "shrink-0 text-caption",
                      description.kind === "uncertain"
                        ? "text-destructive"
                        : "text-muted-foreground"
                    )}
                  >
                    {description.label}
                  </span>
                  <span className="sr-only">Lihat detail</span>
                </button>
              )
            })}
          </div>
        )}
      </section>
      <Button className="w-full" render={<a href="/attendance" />}>
        Catat kehadiran
      </Button>

      {selected ? (
        widePanel ? (
          <Sheet
            modal={false}
            open
            onOpenChange={(open) => !open && closeDay()}
          >
            <SheetContent
              className="w-full overflow-hidden pb-[env(safe-area-inset-bottom)] sm:max-w-md"
              side="right"
            >
              <SheetHeader className="gap-1 border-b border-border px-5 pb-3 pt-5 pr-14">
                <SheetTitle>{`Jadwal · ${formatWorkDateLong(selected.workDate)}`}</SheetTitle>
              </SheetHeader>
              {dayDetails}
            </SheetContent>
          </Sheet>
        ) : (
          <Drawer open onOpenChange={(open) => !open && closeDay()}>
            <DrawerContent className="max-h-[86dvh] overflow-hidden rounded-t-lg pb-0 before:rounded-lg">
              <DrawerHeader className="px-5 pb-2 pt-1 text-left">
                <DrawerTitle>{`Jadwal · ${formatWorkDateLong(selected.workDate)}`}</DrawerTitle>
              </DrawerHeader>
              {dayDetails}
            </DrawerContent>
          </Drawer>
        )
      ) : null}
    </div>
  )
}

function PersonalScheduleDayDetails({
  ambiguous,
  day,
  workDate,
}: {
  ambiguous: boolean
  day: EffectiveDay | null
  workDate: string
}) {
  const description = describePersonalDay(
    day,
    ambiguous || Boolean(day && hasContradictoryDayShape(day))
  )
  const provenance = day?.provenance.source
    ? (scheduleProvenanceLabel[day.provenance.source] ??
      "Sumber jadwal tercatat")
    : "Sumber jadwal belum tersedia"

  return (
    <div
      className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-3"
      data-personal-day-detail-scroll="true"
    >
      <p className="text-label">{description.label}</p>
      {ambiguous ? (
        <p className="mt-2 text-body text-muted-foreground">
          Ada lebih dari satu catatan untuk tanggal ini. Jadwal belum dapat
          dipastikan.
        </p>
      ) : day ? (
        <div className="mt-3 divide-y divide-border">
          {day.status === "scheduled" && description.kind === "scheduled" ? (
            <div className="py-3">
              <p className="text-title tabular-nums">
                {formatPersonalScheduleTime(day)}
              </p>
              {day.shift?.name ? (
                <p className="mt-1 text-body">{day.shift.name}</p>
              ) : null}
            </div>
          ) : null}
          <DetailValue label="Work Date" value={formatWorkDateLong(workDate)} />
          <DetailValue
            label="Outlet"
            value={day.outlet?.name ?? "Belum ditentukan"}
          />
          <DetailValue
            label="Zona waktu"
            value={day.timezone || "Belum tersedia"}
          />
          <DetailValue label="Sumber" value={provenance} />
          {day.outlet_operating !== null ? (
            <DetailValue
              label="Status Outlet"
              value={day.outlet_operating ? "Beroperasi" : "Tutup"}
            />
          ) : null}
          {day.holiday_references.length ? (
            <div className="py-3">
              <p className="text-caption text-muted-foreground">
                Referensi hari libur
              </p>
              <ul className="mt-1 list-inside list-disc text-body">
                {day.holiday_references.map((holiday) => (
                  <li key={holiday.id}>
                    {holiday.name}
                    {holiday.region ? ` · ${holiday.region}` : ""}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {day.conflicts.length ? (
            <div className="py-3">
              <p className="text-caption text-destructive">
                Jadwal perlu diperiksa
              </p>
              <ul className="mt-1 list-inside list-disc text-body">
                {day.conflicts.map((conflict) => (
                  <li key={conflict}>{conflictLabel(conflict)}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : (
        <p className="mt-2 text-body text-muted-foreground">
          {ambiguous
            ? "Data jadwal berulang ditemukan dan belum dapat dipastikan."
            : "Data jadwal untuk tanggal ini belum tersedia. Ini tidak berarti hari libur."}
        </p>
      )}
    </div>
  )
}

function DetailValue({ label, value }: { label: string; value: string }) {
  return (
    <div className="py-3">
      <p className="text-caption text-muted-foreground">{label}</p>
      <p className="mt-1 break-words text-body">{value}</p>
    </div>
  )
}

const scheduleProvenanceLabel: Record<string, string> = {
  none: "Belum ada sumber jadwal",
  weekly_rule: "Aturan mingguan",
  date_exception: "Perubahan tanggal",
  published_roster: "Jadwal terbit",
  planner_unpublished: "Jadwal belum diterbitkan",
  outlet_filter: "Penjadwalan difilter berdasarkan Outlet",
}

function personalDayDescription(
  day: EffectiveDay | null,
  uncertain = false
): {
  kind: "scheduled" | "rest" | "unscheduled" | "unknown" | "uncertain"
  label: string
} {
  if (!day)
    return {
      kind: uncertain ? "uncertain" : "unknown",
      label: uncertain ? "Perlu dipastikan" : "Belum tersedia",
    }
  if (uncertain || day.conflicts.length > 0)
    return { kind: "uncertain", label: "Perlu dipastikan" }
  if (day.status === "scheduled") {
    if (
      !day.scheduled_start ||
      !day.scheduled_end ||
      !day.shift ||
      !isValidTimezone(day.timezone)
    )
      return { kind: "uncertain", label: "Perlu dipastikan" }
    return { kind: "scheduled", label: "Terjadwal" }
  }
  if (day.status === "rest") return { kind: "rest", label: "Libur" }
  if (day.status === "unscheduled")
    return { kind: "unscheduled", label: "Belum dijadwalkan" }
  return { kind: "uncertain", label: "Perlu dipastikan" }
}

function describePersonalDay(day: EffectiveDay | null, uncertain = false) {
  return personalDayDescription(day, uncertain)
}

function uniqueDayForWorkDate(days: EffectiveDay[], workDate: string) {
  const matches = days.filter((day) => day.work_date === workDate)
  return {
    day: matches.length === 1 ? matches[0] : null,
    duplicate: matches.length > 1,
  }
}

function personalDaySummary(
  day: EffectiveDay | null,
  description: ReturnType<typeof describePersonalDay>,
  loading: boolean
) {
  if (loading && !day) return "Memuat jadwal…"
  if (description.kind === "scheduled" && day)
    return `${day.shift?.name || "Shift"} · ${formatPersonalScheduleTime(day)}`
  if (description.kind === "rest") return "Hari libur terkonfirmasi"
  if (description.kind === "unscheduled") return "Belum dijadwalkan"
  if (description.kind === "uncertain") return "Jadwal belum dapat dipastikan"
  return "Jadwal belum tersedia"
}

function hasContradictoryDayShape(day: EffectiveDay) {
  if (day.conflicts?.length) return true
  const hasTime = Boolean(day.scheduled_start || day.scheduled_end)
  const hasShift = Boolean(day.shift)
  if (day.status === "scheduled")
    return !day.scheduled_start || !day.scheduled_end || !day.shift
  if (day.status === "rest" || day.status === "unscheduled")
    return hasTime || hasShift
  return true
}

function formatPersonalScheduleTime(day: EffectiveDay) {
  if (
    !day.scheduled_start ||
    !day.scheduled_end ||
    !isValidTimezone(day.timezone)
  )
    return "Jam belum tersedia"
  const start = formatInstant(day.scheduled_start, day.timezone)
  const end = formatInstant(day.scheduled_end, day.timezone)
  const endDate = workDateInTimezone(day.scheduled_end, day.timezone)
  const nextDate = endDate && endDate !== day.work_date
  return `${start}–${end}${nextDate ? ` · ${formatWorkDateLong(endDate)}` : ""}`
}

function formatWorkDateLong(value: string) {
  return new Intl.DateTimeFormat("id-ID", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(`${value}T00:00:00`))
}

function dateFromWorkDate(value: string) {
  const [year, month, day] = value.split("-").map(Number)
  return new Date(year, month - 1, day, 12)
}

function calendarDateString(value: Date) {
  const year = value.getFullYear()
  const month = String(value.getMonth() + 1).padStart(2, "0")
  const day = String(value.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

function workDateInTimezone(value: string, timezone: string): string | null {
  if (!Number.isFinite(Date.parse(value)) || !isValidTimezone(timezone))
    return null
  const parts = new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    timeZone: timezone,
    year: "numeric",
  }).formatToParts(new Date(value))
  const get = (type: string) => parts.find((part) => part.type === type)?.value
  const year = get("year")
  const month = get("month")
  const day = get("day")
  return year && month && day ? `${year}-${month}-${day}` : null
}

function isValidTimezone(value: string) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format(new Date(0))
    return true
  } catch {
    return false
  }
}

function formatWeekRange(start: string, end: string): string {
  const startDate = new Date(`${start}T00:00:00`)
  const endDate = new Date(`${end}T00:00:00`)
  const sameMonth =
    startDate.getMonth() === endDate.getMonth() &&
    startDate.getFullYear() === endDate.getFullYear()
  const month = new Intl.DateTimeFormat("id-ID", { month: "short" })
  return sameMonth
    ? `${startDate.getDate()}–${endDate.getDate()} ${month.format(endDate)}`
    : `${startDate.getDate()} ${month.format(startDate)} – ${endDate.getDate()} ${month.format(endDate)}`
}

function formatWorkDate(value: string): string {
  const date = new Date(`${value}T00:00:00`)
  return new Intl.DateTimeFormat("id-ID", {
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(date)
}

function formatInstant(value: string | null, timezone: string): string {
  if (!value) return "—"
  return new Intl.DateTimeFormat("id-ID", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: timezone,
  }).format(new Date(value))
}

function conflictLabel(value: string): string {
  const labels: Record<string, string> = {
    contradictory_schedule_rules: "Aturan jadwal bertentangan",
    shift_template_not_effective: "Versi shift belum berlaku",
    invalid_shift_interval: "Rentang shift tidak valid",
    employee_not_assigned_to_outlet: "Penugasan outlet tidak mencakup shift",
    outlet_closed: "Shift bertabrakan dengan outlet tutup",
    attendance_policy_missing: "Kebijakan efektif belum tersedia",
    invalid_local_time: "Jam lokal ambigu pada perubahan zona waktu",
  }
  return labels[value] ?? "Konflik jadwal"
}

function today(): string {
  return localDateString(new Date())
}

function tomorrow(): string {
  const date = new Date()
  date.setDate(date.getDate() + 1)
  return localDateString(date)
}

function mondayOfToday(): string {
  return mondayOf(localDateString(new Date()))
}

function mondayOf(value: string): string {
  const date = new Date(`${value}T00:00:00`)
  date.setDate(date.getDate() - ((date.getDay() + 6) % 7))
  return localDateString(date)
}

function addDays(value: string, amount: number): string {
  const date = new Date(`${value}T00:00:00`)
  date.setDate(date.getDate() + amount)
  return localDateString(date)
}

function localDateString(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}
