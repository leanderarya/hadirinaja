import { createFileRoute, notFound } from "@tanstack/react-router"
import { EmployeeRequestsPrototype } from "./-employee-requests-prototype"

export const Route = createFileRoute("/dev-employee-requests-prototype")({
  beforeLoad: () => {
    if (import.meta.env.PROD) throw notFound()
  },
  head: () => ({
    meta: [{ title: "Prototype Permintaan Karyawan | HadirinAja" }],
  }),
  component: EmployeeRequestsPrototype,
})
