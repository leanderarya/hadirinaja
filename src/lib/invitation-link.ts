/** Tokens stay in the fragment so navigation/referrer requests do not carry them. */
export function invitationLink(origin: string, token: string): string | null {
  if (!/^[A-Za-z0-9]{64}$/.test(token)) return null
  try {
    const url = new URL(origin)
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
    if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) return null
    return `${url.origin}/activate#${token}`
  } catch {
    return null
  }
}
