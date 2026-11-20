import { configurationSearch } from "./configuration-navigation"
import { shiftSearch } from "./shift-templates"

export function schedulingSearch(search: Record<string, unknown>) {
  const date = configurationSearch({ date: search.week }).date
  return {
    ...shiftSearch(search),
    ...(Object.keys(search).some((key) =>
      ["scope", "date", "outletId", "days"].includes(key)
    )
      ? configurationSearch(search)
      : {}),
    ...(date && new Date(`${date}T00:00:00Z`).getUTCDay() === 1
      ? { week: date }
      : {}),
  }
}
