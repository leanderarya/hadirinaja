import { useBlocker } from "@tanstack/react-router"
import { useRef, useState } from "react"
import { ConsequenceDialog } from "@/components/r2c/components"
export function useConfigurationDraft(busy: boolean, onDiscard?: () => void) {
  const dirty = useRef(false)
  const busyRef = useRef(busy)
  busyRef.current = busy
  const [pending, setPending] = useState<(() => void) | null>(null)
  const blocker = useBlocker({
    shouldBlockFn: () => dirty.current || busyRef.current,
    enableBeforeUnload: () => dirty.current || busyRef.current,
    withResolver: true,
  })
  const attempt = (action: () => void) => {
    if (busyRef.current) return
    if (dirty.current) setPending(() => action)
    else action()
  }
  return {
    mark: () => {
      dirty.current = true
    },
    clear: () => {
      dirty.current = false
    },
    attempt,
    dialog: (
      <ConsequenceDialog
        open={Boolean(pending) || blocker.status === "blocked"}
        onOpenChange={(open) => {
          if (!open) {
            setPending(null)
            blocker.reset?.()
          }
        }}
        title="Buang perubahan konfigurasi?"
        consequence="Ada perubahan yang belum disimpan. Tetap di editor atau buang draf untuk melanjutkan."
        actionLabel="Buang dan lanjutkan"
        busy={busy}
        onConfirm={() => {
          dirty.current = false
          onDiscard?.()
          const action = pending
          setPending(null)
          if (action) action()
          else blocker.proceed?.()
        }}
      />
    ),
  }
}
