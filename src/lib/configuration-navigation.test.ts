import { expect, it } from "vitest"
import { configurationSearch } from "./configuration-navigation"
it("validates scope, IDs, UTC calendar dates and bounded read range", () => {
  expect(
    configurationSearch({
      outletId: "301",
      deviceId: "901",
      scope: "tenant",
      date: "2030-01-07",
      days: "14",
      from: "settings",
    })
  ).toEqual({
    outletId: 301,
    deviceId: 901,
    scope: "tenant",
    date: "2030-01-07",
    days: 14,
    from: "settings",
  })
  for (const date of ["2030-02-30", "not-date", [], "2030-1-1"])
    expect(configurationSearch({ date }).date).toBeUndefined()
  for (const id of [-1, 0, [], {}, "x", 2 ** 53])
    expect(configurationSearch({ outletId: id }).outletId).toBeUndefined()
  for (const days of [-1, 0, 15, 1.5, "x"])
    expect(configurationSearch({ days }).days).toBe(7)
  expect(
    configurationSearch({ from: "https://external.test", scope: "unknown" })
  ).toMatchObject({ from: undefined, scope: "outlet" })
})
