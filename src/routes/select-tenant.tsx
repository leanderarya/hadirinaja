import { createFileRoute } from "@tanstack/react-router"
import { useEffect, useState } from "react"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { type AuthSession, apiRequest, type TenantMembership } from "@/lib/api"
import { getAuthenticatedEntryPath } from "@/lib/auth-navigation"

export const Route = createFileRoute("/select-tenant")({
  component: SelectTenantPage,
})

function SelectTenantPage() {
  const [memberships, setMemberships] = useState<TenantMembership[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [error, setError] = useState("")

  useEffect(() => {
    let active = true

    apiRequest<AuthSession>("/auth/me")
      .then((session) => {
        if (!active) return
        setMemberships(session.memberships)
      })
      .catch(() => {
        if (active) window.location.assign("/login?expired=1")
      })
      .finally(() => {
        if (active) setLoading(false)
      })

    return () => {
      active = false
    }
  }, [])

  async function chooseMembership(membershipId: number) {
    setSelectedId(membershipId)
    setError("")

    try {
      const result = await apiRequest<{
        active_membership: TenantMembership
      }>("/auth/tenant", {
        method: "POST",
        body: { membership_id: membershipId },
      })
      window.location.assign(
        getAuthenticatedEntryPath(result.active_membership)
      )
    } catch {
      setError(
        "Organisasi tidak dapat dipilih. Muat ulang halaman dan coba lagi."
      )
      setSelectedId(null)
    }
  }

  return (
    <main className="flex min-h-svh items-center justify-center bg-muted/20 px-4 py-10">
      <Card className="w-full max-w-2xl">
        <CardHeader>
          <p className="text-label text-muted-foreground">HadirinAja</p>
          <CardTitle className="text-title">Pilih organisasi</CardTitle>
          <CardDescription>
            Akses hanya tersedia untuk organisasi yang terhubung dengan akun
            Anda.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {loading ? (
            <p className="text-body text-muted-foreground" role="status">
              Memuat organisasi…
            </p>
          ) : memberships.length === 0 ? (
            <div className="space-y-4">
              <p className="text-body text-muted-foreground">
                Akun ini belum memiliki akses ke organisasi yang tersedia.
                Hubungi Owner organisasi Anda.
              </p>
              <Button
                onClick={() => window.location.assign("/login")}
                variant="outline"
              >
                Kembali ke halaman masuk
              </Button>
            </div>
          ) : (
            <ul className="grid gap-3 sm:grid-cols-2">
              {memberships.map((membership) => (
                <li key={membership.id}>
                  <Button
                    className="h-auto min-h-24 w-full justify-between whitespace-normal rounded-3xl p-5 text-left"
                    disabled={selectedId !== null}
                    isLoading={selectedId === membership.id}
                    onClick={() => chooseMembership(membership.id)}
                    variant="outline"
                  >
                    <span className="flex flex-col items-start gap-2">
                      <span className="text-label">
                        {membership.tenant.name}
                      </span>
                      <span className="text-caption text-muted-foreground">
                        {membership.roles.map(roleLabel).join(" · ")}
                      </span>
                    </span>
                    <span aria-hidden="true" className="text-muted-foreground">
                      →
                    </span>
                  </Button>
                </li>
              ))}
            </ul>
          )}
          {error && (
            <p className="text-body text-destructive" role="alert">
              {error}
            </p>
          )}
        </CardContent>
      </Card>
    </main>
  )
}

function roleLabel(role: TenantMembership["roles"][number]): string {
  return {
    owner: "Owner",
    supervisor: "Supervisor",
    employee: "Karyawan",
  }[role]
}
