import { createFileRoute, notFound } from "@tanstack/react-router"
import { EmployeeSchedulePrototype } from "./-employee-schedule-prototype"

export const Route = createFileRoute("/dev-employee-schedule-prototype")({
  beforeLoad: () => {
    if (import.meta.env.PROD) throw notFound()
  },
  head: () => ({
    meta: [{ title: "Prototype Jadwal Karyawan | HadirinAja" }],
  }),
  component: EmployeeSchedulePrototype,
})
