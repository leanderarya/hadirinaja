import { createFileRoute } from "@tanstack/react-router"
import { configurationSearch } from "@/lib/configuration-navigation"
import { SchedulingPage } from "./-scheduling-page"
export const Route = createFileRoute("/settings_/outlet-calendar")({
  validateSearch: configurationSearch,
  component: () => <SchedulingPage configuration="kalender" />,
})
