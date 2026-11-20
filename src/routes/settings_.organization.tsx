import { createFileRoute } from "@tanstack/react-router"
import { organizationSearch } from "@/lib/organization-explorer"
import { OrganizationExperience } from "./-organization-experience"

export const Route = createFileRoute("/settings_/organization")({
  validateSearch: organizationSearch,
  component: OrganizationExperience,
})
