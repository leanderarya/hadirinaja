import { settingsOrigin } from "./settings-navigation"
export function configurationSearch(search: Record<string, unknown>) {
  const id = (value: unknown) =>
    (typeof value === "string" && /^\d+$/.test(value)) ||
    typeof value === "number"
      ? Number.isSafeInteger(Number(value)) && Number(value) > 0
        ? Number(value)
        : undefined
      : undefined
  const date = (value: unknown) =>
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value
      ? value
      : undefined
  return {
    ...settingsOrigin(search),
    outletId: id(search.outletId),
    deviceId: id(search.deviceId),
    scope:
      search.scope === "tenant" ? ("tenant" as const) : ("outlet" as const),
    date: date(search.date),
    days:
      Number.isInteger(Number(search.days)) &&
      Number(search.days) >= 1 &&
      Number(search.days) <= 14
        ? Number(search.days)
        : 7,
  }
}
