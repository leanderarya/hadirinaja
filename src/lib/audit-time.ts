export function formatAuditTime(value: string): string {
  if (!value || typeof value !== "string") return "Waktu tidak valid"
  const normalized = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(
    value
  )
    ? `${value.replace(" ", "T")}Z`
    : value
  const date = new Date(normalized)
  if (Number.isNaN(date.getTime())) return "Waktu tidak valid"

  return `${new Intl.DateTimeFormat("id-ID", {
    timeZone: "UTC",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date)} UTC`
}
