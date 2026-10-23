import { LogoIcon } from "@/components/logo"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"

export function ManagementSidebar({
  activePage,
}: {
  activePage: "workspace" | "scheduling" | "approvals" | "reports" | "audit"
}) {
  return (
    <Sidebar>
      <SidebarHeader className="p-4">
        <div className="flex items-center gap-3">
          <LogoIcon className="size-8" />
          <div>
            <p className="text-label">HadirinAja</p>
            <p className="text-caption text-muted-foreground">Ruang kerja</p>
          </div>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Organisasi</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  isActive={activePage === "workspace"}
                  render={<a href="/workspace" />}
                >
                  <span>Ringkasan</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        <SidebarGroup>
          <SidebarGroupLabel>Operasional</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  isActive={activePage === "scheduling"}
                  render={<a href="/scheduling" />}
                >
                  <span>Jadwal & kebijakan</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton
                  isActive={activePage === "approvals"}
                  render={<a href="/approvals" />}
                >
                  <span>Approval Center</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton
                  isActive={activePage === "reports"}
                  render={<a href="/reports" />}
                >
                  <span>Laporan kehadiran</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton
                  isActive={activePage === "audit"}
                  render={<a href="/reports/audit" />}
                >
                  <span>Audit aktivitas</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="p-4">
        <p className="text-caption text-muted-foreground">
          Akses selalu diperiksa oleh server.
        </p>
      </SidebarFooter>
    </Sidebar>
  )
}
