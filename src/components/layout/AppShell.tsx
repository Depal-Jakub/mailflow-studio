import { useState } from "react";
import { Outlet } from "react-router";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";
import { ToastViewport } from "../ui/ToastViewport";

export function AppShell() {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="app-shell" data-sidebar-collapsed={collapsed}>
      <Sidebar
        collapsed={collapsed}
        mobileOpen={mobileOpen}
        onCollapse={() => setCollapsed((value) => !value)}
        onNavigate={() => setMobileOpen(false)}
      />
      <div className="app-main">
        <Topbar onMenuClick={() => setMobileOpen(true)} />
        <main className="app-content">
          <Outlet />
        </main>
      </div>
      <ToastViewport />
    </div>
  );
}
