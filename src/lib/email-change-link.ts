export function emailChangeLink(origin: string, token: string): string | null {
  if (!/^[a-f0-9]{64}$/.test(token)) return null

  try {
    const url = new URL(origin)
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
    if (url.protocol !== "https:" && !(url.protocol === "http:" && local))
      return null
    return `${url.origin}/ubah-email#token=${token}`
  } catch {
    return null
  }
}

export function emailChangeWhatsAppUrl(link: string): string {
  const message = `Halo, silakan ubah email akun HadirinAja melalui tautan ini. Tautan berlaku 24 jam dan hanya dapat digunakan sekali: ${link}`
  return `https://wa.me/?text=${encodeURIComponent(message)}`
}
