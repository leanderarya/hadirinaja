import { createFileRoute } from "@tanstack/react-router"
import { EmployeeProfilePage } from "./-profile-page"

export const Route = createFileRoute("/profile")({
  head: () => ({ meta: [{ title: "Profil Karyawan | HadirinAja" }] }),
  component: EmployeeProfilePage,
})
