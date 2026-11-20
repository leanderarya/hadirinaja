/** A fixed origin marker, never a user-supplied return URL. */
export function settingsOrigin(search: Record<string, unknown>) {
  return { from: search.from === "settings" ? "settings" as const : undefined }
}

export function fromSettings(href: string) {
  const url = new URL(href, "https://hadirinaja.invalid")
  if (url.origin !== "https://hadirinaja.invalid" || !["/workspace", "/access", "/scheduling", "/settings/organization", "/settings/shift-templates", "/settings/attendance-policy", "/settings/outlet-calendar", "/settings/kiosk-devices"].includes(url.pathname)) return href
  url.searchParams.set("from", "settings")
  return `${url.pathname}${url.search}${url.hash}`
}
