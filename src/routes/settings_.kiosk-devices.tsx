import { createFileRoute } from "@tanstack/react-router"
import { configurationSearch } from "@/lib/configuration-navigation"
import { WorkspacePage } from "./workspace"
export const Route = createFileRoute("/settings_/kiosk-devices")({
  validateSearch: configurationSearch,
  component: () => <WorkspacePage kioskSettings />,
})
