import { createFileRoute, notFound } from "@tanstack/react-router"
import { EmployeeProfilePrototype } from "./-employee-profile-prototype"

export const Route = createFileRoute("/dev-employee-profile-prototype")({
  beforeLoad: () => {
    if (import.meta.env.PROD) throw notFound()
  },
  head: () => ({
    meta: [{ title: "Prototype Profil Karyawan | HadirinAja" }],
  }),
  component: EmployeeProfilePrototype,
})
