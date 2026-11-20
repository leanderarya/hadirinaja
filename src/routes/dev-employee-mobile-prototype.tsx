import { createFileRoute, notFound } from "@tanstack/react-router"
import { EmployeeMobilePrototype } from "./-employee-mobile-prototype"

export const Route = createFileRoute("/dev-employee-mobile-prototype")({
  beforeLoad: () => {
    if (import.meta.env.PROD) throw notFound()
  },
  head: () => ({
    meta: [{ title: "Prototype Presensi Karyawan | HadirinAja" }],
  }),
  component: EmployeeMobilePrototype,
})
