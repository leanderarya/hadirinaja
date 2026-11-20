import {
  ArrowUpRight,
  ChevronRight,
  RefreshCw,
  ShieldCheck,
  UserRound,
  UserX,
} from "lucide-react"
import { useState, type ReactNode } from "react"
import { r2cComponents } from "@/components/r2c/catalog"
import {
  ApprovalQueueItem,
  AttendanceProjection,
  AttendanceRecovery,
  ConsequenceDialog,
  ContextAlert,
  ContextFilterBar,
  DatedPlacementDrawer,
  EmployeeDock,
  EmployeeHeader,
  EmployeeRosterCard,
  EmployeeRosterRow,
  EvidenceAccess,
  LabeledControl,
  MembershipContext,
  OperationalMetric,
  RecordCard,
  SettingsSection,
  StatusBadge,
} from "@/components/r2c/components"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Textarea } from "@/components/ui/textarea"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  demoOrganization,
  demoOutletLabel,
} from "@/components/ui-kit/organization-fixtures"
import { UiKitSection } from "@/components/ui-kit/ui-kit-section"

export function R2cSection() {
  const [notice, setNotice] = useState("")
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [confirmationOpen, setConfirmationOpen] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)
  const [selected, setSelected] = useState(true)
  const fixtureAction = () =>
    setNotice("Demo sintetis: tidak ada permintaan API dikirim.")
  const record = {
    name: "Nabila Putri Ramadhani",
    employeeId: "EMP-014",
    placement: "Contoh penempatan sintetis",
    effectiveFrom: "1 Okt 2026",
    accessLabel: "Belum ada akun",
    accessTone: "warning" as const,
    accountHelper: "Profil tersimpan",
    placementContext: "Penempatan aktif",
    actions: (
      <>
        <Button variant="outline" onClick={() => setDrawerOpen(true)}>
          <UserRound aria-hidden="true" data-icon="inline-start" />
          Profil
        </Button>
        <Button onClick={() => setConfirmationOpen(true)}>
          <ArrowUpRight aria-hidden="true" data-icon="inline-start" />
          Undang
        </Button>
      </>
    ),
  }
  const outletControl = (
    <NativeSelect className="w-full" defaultValue="301">
      {demoOrganization.outlets.map((outlet) => (
        <NativeSelectOption key={outlet.id} value={String(outlet.id)}>
          {demoOutletLabel(outlet)}
        </NativeSelectOption>
      ))}
    </NativeSelect>
  )
  const demos: Record<string, ReactNode> = {
    "r2c-button": (
      <div className="flex flex-wrap gap-3">
        <Button
          variant="outline"
          data-pen-origin="JS9jS"
          onClick={fixtureAction}
        >
          <RefreshCw aria-hidden="true" data-icon="inline-start" />
          Simpan perubahan
        </Button>
        <Button variant="outline" onClick={fixtureAction}>
          Perbarui
        </Button>
        <Button variant="destructive" onClick={fixtureAction}>
          Cabut akses
        </Button>
        <Button variant="secondary" onClick={fixtureAction}>
          Profil
        </Button>
        <Button disabled>Menyimpan…</Button>
      </div>
    ),
    "r2c-field": (
      <div className="grid gap-4 md:grid-cols-3">
        <LabeledControl
          label="Outlet"
          control={outletControl}
          helper="Pilihan mengikuti cakupan tenant aktif."
        />
        <LabeledControl
          label="Nama profil"
          control={<Input defaultValue="Naya Pratiwi" />}
          helper={<span>Nama profil tidak mengubah akun.</span>}
        />
        <LabeledControl
          label="Tanggal berlaku"
          control={<Input type="date" />}
          error="Pilih tanggal berlaku yang valid."
        />
      </div>
    ),
    "r2c-badge": (
      <div className="flex flex-wrap gap-3">
        <StatusBadge>Terhubung</StatusBadge>
        <StatusBadge tone="warning">Menunggu</StatusBadge>
        <StatusBadge tone="danger">Ditolak</StatusBadge>
        <StatusBadge tone="neutral">Nonaktif</StatusBadge>
        <StatusBadge tone="info">Koreksi efektif</StatusBadge>
      </div>
    ),
    "r2c-tab": (
      <Tabs defaultValue="weekly">
        <TabsList>
          <TabsTrigger data-pen-origin="dbQJp" value="weekly">
            Mingguan
          </TabsTrigger>
          <TabsTrigger value="assignment">Penugasan shift</TabsTrigger>
        </TabsList>
        <TabsContent value="weekly">Jadwal mingguan.</TabsContent>
        <TabsContent value="assignment">
          Penugasan sesuai scope Outlet.
        </TabsContent>
      </Tabs>
    ),
    "r2c-alert": (
      <div className="grid items-start gap-3 md:grid-cols-2">
        <ContextAlert title="Data belum tersedia">
          Ubah filter atau coba kembali tanpa kehilangan konteks.
        </ContextAlert>
        <ContextAlert tone="success" title="Perubahan tersimpan" icon={<ShieldCheck aria-hidden="true" size={18} className="shrink-0"/>}>
          Riwayat tetap dapat ditelusuri.
        </ContextAlert>
        <ContextAlert
          tone="danger"
          title="Belum dapat dimuat"
          action={
            <Button variant="outline" onClick={fixtureAction}>
              Coba lagi
            </Button>
          }
        >
          Periksa koneksi dan muat ulang data.
        </ContextAlert>
        <ContextAlert tone="warning" title="Perlu izin peninjau">
          Kasus ini berada di luar hak keputusan akun.
        </ContextAlert>
      </div>
    ),
    "r2c-metric": (
      <div className="max-w-[350px]">
        <OperationalMetric
          label="Tingkat kehadiran"
          value="85%"
          context="34 dari 40 hari kerja tercatat"
        />
      </div>
    ),
    "r2c-record": (
      <div className="max-w-[350px]">
        <RecordCard
          title="Naya Pratiwi"
          metadata="Outlet contoh · 26 Okt 2026"
          result={"Asli: 08:10–17:00\nEfektif: 08:00–17:00"}
          status={<StatusBadge tone="info">Koreksi efektif</StatusBadge>}
          actions={
            <Button variant="outline" onClick={fixtureAction}>
              <ChevronRight aria-hidden="true" data-icon="inline-start" />
              Rincian
            </Button>
          }
        />
      </div>
    ),
    "r2c-filter": (
      <div className="flex flex-col gap-4">
        <ContextFilterBar>
          <LabeledControl
            label="Tanggal kerja Outlet"
            control={<Input defaultValue="26–30 Okt 2026" />}
            helper="Rentang maksimal 31 hari."
          />
          <LabeledControl
            label="Unit bisnis"
            control={
              <NativeSelect className="w-full">
                <NativeSelectOption>Semua unit bisnis</NativeSelectOption>
              </NativeSelect>
            }
            helper="Mengikuti tenant aktif."
          />
          <LabeledControl
            label="Outlet"
            control={outletControl}
            helper="Supervisor hanya cakupan terotorisasi."
          />
        </ContextFilterBar>
        <ContextFilterBar context="audit-utc">
          <LabeledControl
            label="Waktu audit (UTC)"
            control={<Input defaultValue="26–30 Okt 2026" />}
            helper="Jam audit tidak memakai zona Outlet."
          />
        </ContextFilterBar>
      </div>
    ),
    "r2c-employee-header": (
      <div className="max-w-[390px]">
        <EmployeeHeader
          tenantName="Uji HadirinAja"
          employeeName="Naya Pratiwi"
          roles="Employee"
          onProfile={() => setProfileOpen(!profileOpen)}
        />
        <div
          id="r2c-employee-account-panel"
          hidden={!profileOpen}
          className="p-4 text-body"
        >
          Naya Pratiwi · Employee
        </div>
      </div>
    ),
    "r2c-employee-dock": (
      <div className="max-w-[390px]">
        <EmployeeDock appearance="r2c" active="profile" />
      </div>
    ),
    "r2c-membership": (
      <div className="max-w-[390px]">
        <MembershipContext
          tenantName="Uji HadirinAja"
          roles={["Owner", "Employee"]}
        />
      </div>
    ),
    "r2c-roster-row": (
      <>
        <div role="table" aria-label="Roster collection">
          <div role="rowgroup">
            <EmployeeRosterRow record={record} layout="collection" />
          </div>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              {[
                "Profil Employee",
                "Penempatan efektif",
                "Akun login",
                "Tindakan",
              ].map((label) => (
                <TableHead key={label}>{label}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            <EmployeeRosterRow record={record} />
          </TableBody>
        </Table>
      </>
    ),
    "r2c-roster-card": (
      <div className="max-w-[350px]">
        <EmployeeRosterCard record={record} />
      </div>
    ),
    "r2c-queue": (
      <div className="max-w-[440px]">
        <ApprovalQueueItem
          subject="Naya Pratiwi"
          requestType="Koreksi kehadiran"
          context="Outlet contoh · 26 Okt 2026 · REQ-010"
          status={selected ? "Disetujui" : "Menunggu tinjauan"}
          tone={selected ? "success" : "warning"}
          selected={selected}
          onSelect={() => setSelected(!selected)}
        />
      </div>
    ),
    "r2c-evidence": (
      <div className="max-w-[440px]">
        <EvidenceAccess
          actions={
            <Button variant="outline" onClick={fixtureAction}>
              Buka bukti sintetis
            </Button>
          }
        />
      </div>
    ),
    "r2c-recovery": (
      <div className="max-w-[390px]">
        <AttendanceRecovery onCheck={fixtureAction} />
      </div>
    ),
    "r2c-settings": (
      <div className="max-w-lg overflow-hidden rounded-[16px] border border-border">
        <SettingsSection
          icon={<ShieldCheck size={20} />}
          title="Kebijakan presensi"
          summary="Tenant dan override Outlet"
          href="/scheduling#kebijakan"
        />
        <SettingsSection
          title="Kalender Outlet"
          summary="Hari operasi dan pengecualian"
          href="/scheduling#kalender"
          readOnly
        />
      </div>
    ),
    "r2c-drawer": (
      <Button variant="outline" onClick={() => setDrawerOpen(true)}>
        Ubah penempatan
      </Button>
    ),
    "r2c-confirmation": (
      <Button variant="destructive" onClick={() => setConfirmationOpen(true)}>
        Cabut akses organisasi
      </Button>
    ),
    "r2c-table-head": (
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead data-pen-origin="Oqwrx">Karyawan</TableHead>
          </TableRow>
        </TableHeader>
      </Table>
    ),
    "r2c-table-cell": (
      <Table>
        <TableBody>
          <TableRow>
            <TableCell data-pen-origin="L4oSG9">
              Naya Pratiwi
              <br />
              EMP-008
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    ),
    "r2c-projection": (
      <AttendanceProjection
        original="08:10–17:00"
        effective="08:10–17:00"
        proposed="08:00–17:00"
      />
    ),
  }
  return (
    <div className="flex min-w-0 flex-col gap-6" data-r2c-library>
      <p className="text-body text-muted-foreground">
        22 origin native Pen. Komposisi Ringkasan dan Tim telah diadopsi pada
        Slice 02A. Data katalog tetap sintetis.
      </p>
      {notice ? (
        <p role="status" className="text-body text-brand-700">
          {notice}
        </p>
      ) : null}
      {r2cComponents.map((item) => (
        <UiKitSection
          key={item.id}
          id={item.id}
          title={`${item.label} · ${item.penId}`}
          importPath={item.importPath}
        >
          {demos[item.id]}
        </UiKitSection>
      ))}
      <DatedPlacementDrawer
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        employeeContext={
          <>
            Nabila Putri · EMP-014
            <br />
            Profil Employee, bukan perubahan akun login.
          </>
        }
        onSubmit={(event) => {
          event.preventDefault()
          fixtureAction()
          setDrawerOpen(false)
        }}
        history={
          <>
            <p className="text-label">Penempatan saat ini</p>
            <p className="text-caption">
              Outlet contoh · mulai 1 Okt 2026
              <br />
              Buka riwayat untuk assignment sebelumnya.
            </p>
          </>
        }
      >
        <LabeledControl
          label="Outlet"
          control={
            <NativeSelect className="w-full">
              {demoOrganization.outlets.map((outlet) => (
                <NativeSelectOption key={outlet.id} value={String(outlet.id)}>
                  {demoOutletLabel(outlet)}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          }
          helper="Outlet harus berada pada BU terpilih."
        />
        <LabeledControl
          label="Tanggal berlaku"
          control={<Input type="date" defaultValue="2026-11-01" required />}
          helper="Riwayat assignment sebelumnya tetap tersimpan."
        />
        <LabeledControl
          label="Alasan perubahan · wajib"
          control={
            <Textarea
              defaultValue="Penyesuaian kebutuhan operasional"
              required
            />
          }
          helper="Alasan dicatat bersama perubahan penempatan."
        />
      </DatedPlacementDrawer>
      <ConsequenceDialog
        open={confirmationOpen}
        onOpenChange={setConfirmationOpen}
        title="Cabut akses organisasi?"
        consequence="Pengguna kehilangan akses ke tenant ini. Profil karyawan, penempatan dan catatan riwayat tidak dihapus."
        actionLabel="Cabut akses"
        actionIcon={<UserX aria-hidden="true" data-icon="inline-start" />}
        onConfirm={() => {
          fixtureAction()
          setConfirmationOpen(false)
        }}
      />
    </div>
  )
}
