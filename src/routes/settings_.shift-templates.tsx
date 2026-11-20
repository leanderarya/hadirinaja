import { createFileRoute } from "@tanstack/react-router"
import { shiftSearch } from "@/lib/shift-templates"
import { ShiftTemplatesExperience } from "./-shift-templates"
export const Route = createFileRoute("/settings_/shift-templates")({
  validateSearch: shiftSearch,
  component: ShiftTemplatesExperience,
})
