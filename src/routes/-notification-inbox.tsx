import { useCallback, useEffect, useRef, useState } from "react"
import { apiRequest } from "@/lib/api"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

type Notification = {
  id: number
  body: string
  href: string
  created_at: string
  read_at: string | null
}
type Inbox = { notifications: Notification[]; next_before: number | null }
const base = "/management/notifications"
export function NotificationInbox() {
  const [open, setOpen] = useState(false)
  const [data, setData] = useState<Inbox>({
    notifications: [],
    next_before: null,
  })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const generation = useRef(0)
  const [reading, setReading] = useState<number | null>(null)
  const readLock = useRef(false)
  const load = useCallback(async (before?: number) => {
    const current = ++generation.current
    setLoading(true)
    setError("")
    try {
      const result = await apiRequest<Inbox>(
        base + (before ? `?before=${before}` : "")
      )
      if (current === generation.current)
        setData((previous) => ({
          notifications: before
            ? [
                ...previous.notifications,
                ...result.notifications.filter(
                  (row) =>
                    !previous.notifications.some((old) => old.id === row.id)
                ),
              ]
            : result.notifications,
          next_before: result.next_before,
        }))
    } catch (caught) {
      if (current === generation.current)
        setError(
          caught instanceof Error
            ? caught.message
            : "Notifikasi belum dapat dimuat."
        )
    } finally {
      if (current === generation.current) setLoading(false)
    }
  }, [])
  useEffect(() => {
    void load()
    return () => {
      ++generation.current
    }
  }, [load])
  async function read(id: number) {
    if (readLock.current) return
    readLock.current = true
    setReading(id)
    setError("")
    try {
      const row = await apiRequest<Notification>(`${base}/${id}/read`, {
        method: "POST",
      })
      setData((previous) => ({
        ...previous,
        notifications: previous.notifications.map((old) =>
          old.id === id ? row : old
        ),
      }))
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Status baca belum tersimpan."
      )
    } finally {
      readLock.current = false
      setReading(null)
    }
  }
  const unread = data.notifications.filter((row) => !row.read_at).length
  return (
    <>
      <Button
        variant="outline"
        onClick={() => {
          setOpen(true)
          void load()
        }}
      >
        Notifikasi{unread ? <Badge variant="secondary">{unread}</Badge> : null}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Notifikasi</DialogTitle>
            <DialogDescription>
              Pembaruan untuk akun dan organisasi aktif Anda. Jumlah belum
              dibaca mengikuti daftar yang dimuat.
            </DialogDescription>
          </DialogHeader>
          <Button
            variant="outline"
            disabled={loading}
            onClick={() => void load()}
          >
            Muat ulang notifikasi
          </Button>
          {loading ? <p role="status">Memuat notifikasi…</p> : null}
          {error ? (
            <Alert variant="destructive">
              <AlertTitle>Notifikasi belum diperbarui</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          {!loading && !error && !data.notifications.length ? (
            <p className="text-caption">Belum ada notifikasi.</p>
          ) : null}
          <ul className="flex flex-col gap-3">
            {data.notifications.map((row) => (
              <li
                key={row.id}
                className="flex min-w-0 flex-col gap-3 rounded-lg border p-4"
              >
                <p className="break-words text-body">{row.body}</p>
                <time
                  className="text-caption text-muted-foreground"
                  dateTime={row.created_at}
                >
                  {new Date(row.created_at).toLocaleString("id-ID", {
                    timeZone: "Asia/Jakarta",
                  })}{" "}
                  WIB
                </time>
                <div className="flex flex-wrap items-center gap-2">
                  <Button variant="outline" render={<a href={row.href} />}>
                    Lihat jadwal
                  </Button>
                  {row.read_at ? (
                    <Badge variant="outline">Sudah dibaca</Badge>
                  ) : (
                    <Button
                      variant="ghost"
                      disabled={reading !== null}
                      onClick={() => void read(row.id)}
                    >
                      {reading === row.id ? "Menyimpan…" : "Tandai dibaca"}
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
          {data.next_before ? (
            <Button
              variant="outline"
              disabled={loading}
              onClick={() => void load(data.next_before ?? undefined)}
            >
              Muat lebih lama
            </Button>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  )
}
