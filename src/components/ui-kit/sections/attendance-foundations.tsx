"use client"

import { Check, LocateFixed, MapPin, Send, Store } from "lucide-react"
import { AttendanceConfirmationSummary } from "@/components/attendance/attendance-confirmation-summary"
import { AttendanceLocationStep } from "@/components/attendance/attendance-location-step"
import { AttendanceRecoveryList } from "@/components/attendance/attendance-recovery-list"
import { AttendanceResultStep } from "@/components/attendance/attendance-result-step"
import { AttendanceStepHeading } from "@/components/attendance/attendance-step-heading"
import { LocationMapPreview } from "@/components/attendance/location-map-preview"
import { RoamButton } from "@/components/roam/roam-button"
import { RoamStatusCard } from "@/components/roam/roam-status-card"
import { RoamStatusMessage } from "@/components/roam/roam-status-message"
import { RoamStepTrail } from "@/components/roam/roam-step-trail"
import { UiKitSection } from "@/components/ui-kit/ui-kit-section"

const steps = [
  { id: "location", label: "Lokasi", number: "1" },
  { id: "photo", label: "Foto", number: "2" },
  { id: "confirm", label: "Konfirmasi", number: "3" },
]

const summaryRows = [
  { key: "operation", label: "Jenis aksi", value: "Check-in" },
  { key: "distance", label: "Jarak", value: "12 m" },
  { key: "outlet", label: "Outlet", value: "Outlet Sudirman", emphasis: true },
]

export function AttendanceFoundationsSection() {
  return (
    <div className="flex flex-col gap-6">
      <UiKitSection
        description="WBM9u 01.1 TOMBOL — primary 52px pill, secondary and danger 48px outlines"
        id="roam-button"
        importPath="@/components/roam/roam-button"
        title="Roam Button"
      >
        <div className="flex flex-col gap-3">
          <RoamButton fullWidth icon={<Send aria-hidden="true" size={18} />}>
            Konfirmasi Check-in
          </RoamButton>
          <RoamButton
            fullWidth
            icon={<LocateFixed aria-hidden="true" size={18} />}
          >
            Coba lagi dengan lokasi baru
          </RoamButton>
          <RoamButton fullWidth variant="secondary">
            Ambil ulang foto
          </RoamButton>
          <RoamButton disabled fullWidth>
            Lanjut ke konfirmasi
          </RoamButton>
          <RoamButton fullWidth loading loadingLabel="Mengirim Check-in…">
            Konfirmasi Check-in
          </RoamButton>
        </div>
      </UiKitSection>

      <UiKitSection
        description="WLYnJ / M9RmiS — equal columns, 28px circles, done swaps the number for a check"
        id="roam-step-trail"
        importPath="@/components/roam/roam-step-trail"
        title="Roam Step Trail"
      >
        <div className="flex flex-col gap-6">
          <RoamStepTrail activeIndex={0} steps={steps} />
          <RoamStepTrail activeIndex={1} steps={steps} />
          <RoamStepTrail activeIndex={2} steps={steps} />
          <RoamStepTrail activeIndex={2} complete steps={steps} />
          <RoamStepTrail activeIndex={2} errorIndex={0} steps={steps} />
        </div>
      </UiKitSection>

      <UiKitSection
        description="QihdH / YJGEC — pastel surface, 56px medallion, headline and description only"
        id="roam-status-card"
        importPath="@/components/roam/roam-status-card"
        title="Roam Status Card"
      >
        <div className="grid gap-4 md:grid-cols-2">
          <RoamStatusCard
            description="Lanjutkan dengan foto bukti absensi."
            headline="Lokasi berhasil diperoleh"
            icon={<Check aria-hidden="true" size={28} />}
            tone="info"
          />
          <RoamStatusCard
            align="center"
            description="Lokasimu di luar batas jarak outlet. Check-in belum dicatat."
            headline="Di luar area absensi"
            icon={<MapPin aria-hidden="true" size={28} />}
            tone="error"
          />
          <RoamStatusCard
            description="Browser belum diizinkan mengakses lokasi perangkat."
            headline="Izin lokasi ditolak"
            icon={<MapPin aria-hidden="true" size={28} />}
            tone="error"
          />
          <RoamStatusCard
            description="Absensi di outlet ini tidak memerlukan pemeriksaan lokasi."
            headline="Lokasi tidak diwajibkan"
            tone="neutral"
          />
        </div>
      </UiKitSection>

      <UiKitSection
        description="esTPz 01.5 PESAN STATUS — the compact inline message tone"
        id="roam-status-message"
        importPath="@/components/roam/roam-status-message"
        title="Roam Status Message"
      >
        <div className="flex flex-col gap-3">
          <RoamStatusMessage
            body="Status dan riwayat diperbarui setelah server mengonfirmasi."
            title="Mengirim absensi"
            tone="progress"
          />
          <RoamStatusMessage
            body="Absensi sudah tercatat pada Work Date ini."
            title="Informasi"
            tone="info"
          />
          <RoamStatusMessage
            body="Permintaan sebelumnya belum dapat dipastikan."
            title="Perlu diperiksa"
            tone="error"
          />
          <RoamStatusMessage
            body="Work Date ini sudah dikunci."
            title="Terkunci"
            tone="locked"
          />
        </div>
      </UiKitSection>

      <UiKitSection
        description="uqxF6 — 16px-padded card, 37px rows with 4px gaps, orchid outlet row"
        id="attendance-confirmation-summary"
        importPath="@/components/attendance/attendance-confirmation-summary"
        title="Attendance Confirmation Summary"
      >
        <AttendanceConfirmationSummary
          photoCaption="Diambil pada perangkat ini."
          photoUrl="data:image/svg+xml;utf8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='96' height='112'%3E%3Crect width='96' height='112' fill='%230E0E10'/%3E%3C/svg%3E"
          rows={[
            {
              ...summaryRows[0],
              icon: <LocateFixed aria-hidden="true" size={18} />,
            },
            {
              ...summaryRows[1],
              icon: <MapPin aria-hidden="true" size={18} />,
            },
            { ...summaryRows[2], icon: <Store aria-hidden="true" size={18} /> },
          ]}
        />
        <AttendanceConfirmationSummary rows={summaryRows} />
      </UiKitSection>

      <UiKitSection
        description="b9Lv5 / DBvSR — the recovery block that must sit outside the status card"
        id="attendance-recovery-list"
        importPath="@/components/attendance/attendance-recovery-list"
        title="Attendance Recovery List"
      >
        <AttendanceRecoveryList
          steps={[
            "Buka pengaturan izin situs di browser.",
            "Ubah Lokasi menjadi Izinkan.",
            "Kembali ke sini, lalu ketuk Coba lagi.",
          ]}
          title="Ubah izin, lalu coba lagi"
        />
        <AttendanceRecoveryList
          note="Pastikan layanan lokasi aktif. Pencarian bisa lebih lama di dalam ruangan."
          title="Biarkan halaman tetap terbuka"
        />
      </UiKitSection>

      <UiKitSection
        description="AWKAr / cnyI — the 22/700 title with a 14/500 description"
        id="attendance-step-heading"
        importPath="@/components/attendance/attendance-step-heading"
        title="Attendance Step Heading"
      >
        <AttendanceStepHeading
          description="Pastikan foto terang dan tidak buram."
          title="Ambil foto bukti"
        />
      </UiKitSection>

      <UiKitSection
        description="Full step composition using only the canonical primitives"
        id="attendance-location-step"
        importPath="@/components/attendance/attendance-location-step"
        title="Attendance Location Step"
      >
        <AttendanceLocationStepDemo />
      </UiKitSection>

      <UiKitSection
        description="Frame composition with the media surface and the retake action"
        id="attendance-result-step"
        importPath="@/components/attendance/attendance-result-step"
        title="Attendance Result Step"
      >
        <AttendanceResultStepDemo />
      </UiKitSection>
    </div>
  )
}

function AttendanceLocationStepDemo() {
  return (
    <div className="flex flex-col gap-8">
      <AttendanceLocationStep
        caption="Check-in belum dikirim."
        facts="Outlet Sudirman · ± 18 m · akurasi ± 8 m"
        map={
          <LocationMapPreview
            deviceOffset={{ x: 0.63, y: 0.56 }}
            outletName="Outlet Sudirman"
            variant="resolved"
          />
        }
        operation="check_in"
        primary={{ label: "Lanjut ke foto", onClick: () => undefined }}
        statusIcon={<Check aria-hidden="true" size={18} />}
        title="Lokasi ditemukan"
        tone="neutral"
      />
      <AttendanceLocationStep
        caption="Check-in belum dikirim."
        facts="Tanpa izin, absensi belum bisa dilanjutkan."
        map={<LocationMapPreview variant="permission_denied" />}
        operation="check_in"
        primary={{ label: "Coba lagi", onClick: () => undefined }}
        recovery={{
          steps: [
            "Buka setelan browser, pilih izin lokasi.",
            "Pilih Izinkan untuk situs HadirinAja.",
            "Muat ulang halaman, lalu ketuk Coba lagi.",
          ],
          title: "Cara memperbaiki",
        }}
        secondary={{ label: "Kembali ke Hari Ini", onClick: () => undefined }}
        statusIcon={<MapPin aria-hidden="true" size={18} />}
        title="Izin lokasi ditolak"
        tone="error"
      />
    </div>
  )
}

function AttendanceResultStepDemo() {
  return (
    <AttendanceResultStep
      caption="Tercatat oleh server, bukan perkiraan aplikasi."
      description="Absensi sudah tercatat. Status Hari Ini dan riwayatmu sudah diperbarui."
      details={summaryRows}
      detailsTitle="Data yang tercatat"
      headline="Check-in berhasil"
      primary={{
        icon: <Send aria-hidden="true" size={18} />,
        label: "Kembali ke Hari Ini",
        onClick: () => undefined,
      }}
      secondary={{ href: "#history", label: "Lihat riwayat absensi" }}
      variant="success"
    />
  )
}
