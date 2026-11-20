import { OwnerPasswordReset } from "./-owner-password-reset"
import { useId, useState } from "react"
import { Alert, AlertDescription } from "@/components/ui/alert"
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldDescription,
  FieldSet,
  FieldLegend,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { Separator } from "@/components/ui/separator"
import { ApiError, apiRequest } from "@/lib/api"

type Member = {
  id: number
  name: string
  email: string
  roles: string[]
  status: string
  employee: { id: number; name: string } | null
  outlets: { id: number; name: string }[]
}
type Preview = {
  can_delete: boolean
  blockers: Record<string, number>
  employee_id: number | null
  global_login_preserved: boolean
}
const roleLabels = {
  owner: "Owner",
  supervisor: "Supervisor",
  employee: "Karyawan",
}
type Role = keyof typeof roleLabels

function blockerLabel(reference: string): string {
  if (reference.startsWith("management_change_events")) return "Audit perubahan"
  if (reference.startsWith("tenant_access_invitation"))
    return "Riwayat undangan"
  if (reference.startsWith("employee_outlet_assignments"))
    return "Riwayat penempatan"
  if (reference.startsWith("attendance")) return "Riwayat presensi"
  if (/schedule|shift|planner/.test(reference))
    return "Jadwal atau pergantian shift"
  if (reference === "self") return "Keanggotaan Anda sendiri"
  if (reference === "last_owner") return "Owner aktif terakhir"
  return "Referensi tersimpan lainnya"
}

export function MemberAdministration({
  member,
  actorId,
  employees,
  outlets,
  onChanged,
}: {
  member: Member
  actorId: number | undefined
  employees: { id: number; name: string; access_status: string }[]
  outlets: { id: number; name: string }[]
  onChanged: () => Promise<void>
}) {
  const uid = useId()
  const [role, setRole] = useState<Role>(
    (member.roles[0] as Role) || "employee"
  )
  const [employeeId, setEmployeeId] = useState(
    String(member.employee?.id ?? "")
  )
  const [deleteEmployeeId, setDeleteEmployeeId] = useState(
    String(member.employee?.id ?? "")
  )
  const [scope, setScope] = useState(member.outlets.map((o) => o.id))
  const [reactivate, setReactivate] = useState(false)
  const [reason, setReason] = useState("")
  const [password, setPassword] = useState("")
  const [email, setEmail] = useState("")
  const [preview, setPreview] = useState<Preview | null>(null)
  const [pending, setPending] = useState(false)
  const [action, setAction] = useState<"role" | "delete" | null>(null)
  const [message, setMessage] = useState("")
  const [error, setError] = useState("")
  const self = actorId === member.id
  const eligible = employees.filter(
    (e) => e.id === member.employee?.id || e.access_status !== "active"
  )
  const base = `/management/access/members/${member.id}`
  const confirmed = reason.trim().length >= 3 && password.length > 0
  const validRole =
    confirmed &&
    (member.status === "active" || reactivate) &&
    (role !== "employee" || Boolean(employeeId)) &&
    (role !== "supervisor" || scope.length > 0)

  function failure(e: unknown) {
    setError(
      e instanceof ApiError && e.errors
        ? Object.values(e.errors).flat().join(" ")
        : e instanceof Error
          ? e.message
          : "Permintaan gagal. Periksa kembali status akses."
    )
  }
  async function inspect() {
    setPending(true)
    setError("")
    setPreview(null)
    try {
      setPreview(
        await apiRequest<Preview>(
          `${base}/permanent-deletion${deleteEmployeeId ? `?employee_id=${deleteEmployeeId}` : ""}`
        )
      )
    } catch (e) {
      failure(e)
    } finally {
      setPending(false)
    }
  }
  async function execute() {
    if (pending || !action) return
    setPending(true)
    setError("")
    setMessage("")
    const operation = action
    try {
      await apiRequest(
        `${base}/${operation === "role" ? "role" : "permanent-deletion"}`,
        {
          method: operation === "role" ? "PUT" : "DELETE",
          body:
            operation === "role"
              ? {
                  role,
                  reason: reason.trim(),
                  password,
                  reactivate,
                  ...(role === "employee"
                    ? { employee_id: Number(employeeId) }
                    : {}),
                  ...(role === "supervisor" ? { outlet_ids: scope } : {}),
                }
              : {
                  reason: reason.trim(),
                  password,
                  confirmation_email: email.trim(),
                  ...(deleteEmployeeId
                    ? { employee_id: Number(deleteEmployeeId) }
                    : {}),
                },
        }
      )
      setMessage(
        operation === "role"
          ? "Role berhasil diganti. Akun memakai password yang sama."
          : "Keanggotaan dan profil yang dipilih telah dihapus. Akun login global tetap disimpan."
      )
      setPreview(null)
      setReason("")
      setEmail("")
      await onChanged()
    } catch (e) {
      failure(e)
    } finally {
      setPassword("")
      setPending(false)
      setAction(null)
    }
  }
  if (self)
    return (
      <Alert>
        <AlertDescription>
          Gunakan Owner aktif lain untuk mengubah role atau menghapus
          keanggotaan Anda sendiri.
        </AlertDescription>
      </Alert>
    )

  return (
    <section
      className="flex flex-col gap-4"
      aria-label="Administrasi keanggotaan"
    >
      <OwnerPasswordReset key={member.id} membership={member.id} email={member.email} />
      <Separator />
      <h3 className="text-subtitle">Ubah role langsung</h3>
      <p className="text-caption text-muted-foreground">
        Role lama diganti seluruhnya. Penempatan dan riwayat karyawan tetap
        disimpan. Undangan yang belum digunakan untuk akun atau profil terpilih
        akan dicabut.
      </p>
      {error && (
        <Alert variant="destructive">
          <AlertDescription role="alert">{error}</AlertDescription>
        </Alert>
      )}
      {message && (
        <Alert>
          <AlertDescription role="status">{message}</AlertDescription>
        </Alert>
      )}
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor={`${uid}-role`}>Role baru</FieldLabel>
          <NativeSelect
            id={`${uid}-role`}
            value={role}
            disabled={pending}
            onChange={(e) => setRole(e.target.value as Role)}
          >
            {Object.entries(roleLabels).map(([value, label]) => (
              <NativeSelectOption key={value} value={value}>
                {label}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </Field>
        {role === "employee" && (
          <Field>
            <FieldLabel htmlFor={`${uid}-employee`}>
              Profil karyawan untuk role baru
            </FieldLabel>
            <NativeSelect
              id={`${uid}-employee`}
              value={employeeId}
              disabled={pending}
              onChange={(e) => setEmployeeId(e.target.value)}
            >
              <NativeSelectOption value="">
                Pilih profil existing
              </NativeSelectOption>
              {eligible.map((e) => (
                <NativeSelectOption key={e.id} value={e.id}>
                  {e.name}
                </NativeSelectOption>
              ))}
            </NativeSelect>
            <FieldDescription>
              Outlet mengikuti penempatan profil; perubahan role tidak
              memindahkan Outlet.
            </FieldDescription>
          </Field>
        )}
        {role === "supervisor" && (
          <FieldSet>
            <FieldLegend>Outlet Supervisor</FieldLegend>
            {outlets.map((o) => (
              <Field orientation="horizontal" key={o.id}>
                <Checkbox
                  id={`${uid}-outlet-${o.id}`}
                  checked={scope.includes(o.id)}
                  disabled={pending}
                  onCheckedChange={(checked) =>
                    setScope((ids) =>
                      checked ? [...ids, o.id] : ids.filter((id) => id !== o.id)
                    )
                  }
                />
                <FieldLabel htmlFor={`${uid}-outlet-${o.id}`}>
                  {o.name}
                </FieldLabel>
              </Field>
            ))}
          </FieldSet>
        )}
        {member.status !== "active" && (
          <Field orientation="horizontal">
            <Checkbox
              id={`${uid}-reactivate`}
              checked={reactivate}
              disabled={pending}
              onCheckedChange={(checked) => setReactivate(checked === true)}
            />
            <FieldLabel htmlFor={`${uid}-reactivate`}>
              Aktifkan kembali akses akun ini
            </FieldLabel>
          </Field>
        )}
        <Field>
          <FieldLabel htmlFor={`${uid}-reason`}>
            Alasan perubahan atau penghapusan
          </FieldLabel>
          <Input
            id={`${uid}-reason`}
            value={reason}
            maxLength={1000}
            disabled={pending}
            onChange={(e) => setReason(e.target.value)}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor={`${uid}-password`}>
            Password Owner Anda
          </FieldLabel>
          <Input
            id={`${uid}-password`}
            type="password"
            autoComplete="current-password"
            value={password}
            disabled={pending}
            onChange={(e) => setPassword(e.target.value)}
          />
          <FieldDescription>
            Password akun penerima tetap sama.
          </FieldDescription>
        </Field>
        <Button
          type="button"
          disabled={pending || !validRole}
          onClick={() => setAction("role")}
        >
          Tinjau perubahan role
        </Button>
      </FieldGroup>
      <Separator />
      <h3 className="text-subtitle">Hapus permanen dari organisasi</h3>
      <p className="text-caption text-muted-foreground">
        Hanya untuk data tanpa riwayat, termasuk riwayat audit dan undangan.
        Akun login global serta akses organisasi lain tetap disimpan. Data yang
        memiliki riwayat harus dinonaktifkan atau dicabut aksesnya.
      </p>
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor={`${uid}-delete-employee`}>
            Profil yang ikut dihapus
          </FieldLabel>
          <NativeSelect
            id={`${uid}-delete-employee`}
            value={deleteEmployeeId}
            disabled={pending || Boolean(member.employee)}
            onChange={(e) => {
              setDeleteEmployeeId(e.target.value)
              setPreview(null)
            }}
          >
            <NativeSelectOption value="">Keanggotaan saja</NativeSelectOption>
            {eligible.map((e) => (
              <NativeSelectOption key={e.id} value={e.id}>
                {e.name}
              </NativeSelectOption>
            ))}
          </NativeSelect>
          <FieldDescription>
            Pastikan profil ini milik akun {member.email}.
          </FieldDescription>
        </Field>
        <Button
          type="button"
          variant="outline"
          disabled={pending}
          onClick={() => void inspect()}
        >
          Periksa kelayakan hapus
        </Button>
        {preview && (
          <Alert variant={preview.can_delete ? "default" : "destructive"}>
            <AlertDescription>
              {preview.can_delete
                ? "Belum ditemukan riwayat yang menghalangi. Pemeriksaan diulang saat penghapusan."
                : "Penghapusan ditolak: akun atau profil masih memiliki riwayat/referensi tersimpan. Gunakan nonaktifkan atau cabut akses."}
              {!preview.can_delete && (
                <p>
                  Penghalang:{" "}
                  {[
                    ...new Set(Object.keys(preview.blockers).map(blockerLabel)),
                  ].join(", ")}
                  .
                </p>
              )}
            </AlertDescription>
          </Alert>
        )}
        <Field>
          <FieldLabel htmlFor={`${uid}-email`}>
            Ketik email untuk konfirmasi hapus
          </FieldLabel>
          <Input
            id={`${uid}-email`}
            type="email"
            autoComplete="off"
            value={email}
            disabled={pending}
            onChange={(e) => setEmail(e.target.value)}
          />
        </Field>
        <Button
          type="button"
          variant="destructive"
          disabled={
            pending ||
            !preview?.can_delete ||
            !confirmed ||
            email.trim().toLowerCase() !== member.email.toLowerCase()
          }
          onClick={() => setAction("delete")}
        >
          Tinjau hapus permanen
        </Button>
      </FieldGroup>
      <AlertDialog
        open={action !== null}
        onOpenChange={(open) => {
          if (!open && !pending) setAction(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {action === "role"
                ? "Ganti role akun?"
                : "Hapus permanen dari organisasi?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {action === "role"
                ? `${member.email}: ${member.roles.map((r) => roleLabels[r as Role] || r).join(", ") || "Tanpa role"} → ${roleLabels[role]}. Role sebelumnya akan dilepas.`
                : `${member.email}. ${deleteEmployeeId ? `Profil ${employees.find((e) => e.id === Number(deleteEmployeeId))?.name ?? deleteEmployeeId} juga dihapus.` : "Keanggotaan saja yang dihapus."} Tindakan ini tidak dapat dibatalkan.`}{" "}
              Akun login global tetap disimpan.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Batal</AlertDialogCancel>
            <Button
              type="button"
              variant={action === "delete" ? "destructive" : "default"}
              disabled={pending}
              onClick={() => void execute()}
            >
              {pending ? "Memproses…" : "Konfirmasi"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}
