import { createFileRoute } from "@tanstack/react-router"

import { SchedulingPage } from "./-scheduling-page"
import { schedulingSearch } from "@/lib/scheduling-search"

export const Route = createFileRoute("/scheduling")({
  validateSearch: schedulingSearch,
  component: SchedulingPage,
})
