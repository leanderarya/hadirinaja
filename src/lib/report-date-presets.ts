export const REPORT_DATE_PRESETS = [
  { value: "today", label: "Hari ini" },
  { value: "last7", label: "7 hari terakhir" },
  { value: "current_month", label: "Bulan ini" },
] as const

export type ReportDatePreset = (typeof REPORT_DATE_PRESETS)[number]["value"]
export type ReportDateCalendar = "local" | "utc"

export function reportDateValue(
  date: Date,
  calendar: ReportDateCalendar = "local"
) {
  const year = calendar === "utc" ? date.getUTCFullYear() : date.getFullYear()
  const month = calendar === "utc" ? date.getUTCMonth() : date.getMonth()
  const day = calendar === "utc" ? date.getUTCDate() : date.getDate()

  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`
}

export function reportDateDaysAgo(
  days: number,
  now = new Date(),
  calendar: ReportDateCalendar = "local"
) {
  const date = new Date(now)
  if (calendar === "utc") date.setUTCDate(date.getUTCDate() - days)
  else date.setDate(date.getDate() - days)

  return reportDateValue(date, calendar)
}

export function reportDateRange(
  preset: ReportDatePreset,
  now = new Date(),
  calendar: ReportDateCalendar = "local"
) {
  const utc = calendar === "utc"
  const year = utc ? now.getUTCFullYear() : now.getFullYear()
  const month = utc ? now.getUTCMonth() : now.getMonth()
  const day = utc ? now.getUTCDate() : now.getDate()
  const start = utc
    ? new Date(Date.UTC(year, month, day))
    : new Date(year, month, day)

  if (preset === "last7") {
    if (utc) start.setUTCDate(start.getUTCDate() - 6)
    else start.setDate(start.getDate() - 6)
  } else if (preset === "current_month") {
    if (utc) start.setUTCDate(1)
    else start.setDate(1)
  }

  return {
    from: reportDateValue(start, calendar),
    to: reportDateValue(now, calendar),
  }
}
