"use client";

import { useCallback, useState } from "react";
import { Header } from "./header";
import { ContextualSidebar } from "./contextual-sidebar";
import { MobileDrawer } from "./mobile-drawer";
import { BottomNav } from "./bottom-nav";
import { cn } from "@/lib/utils";

interface DashboardShellProps {
  children: React.ReactNode;
  userName: string;
  userRole: string;
}

type SidebarMode = "pinned" | "auto";

export function DashboardShell({ children, userName, userRole }: DashboardShellProps) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [sidebarMode, setSidebarMode] = useState<SidebarMode>("auto");

  const handleModeChange = useCallback((mode: SidebarMode) => {
    setSidebarMode(mode);
  }, []);

  return (
    <div className="min-h-screen bg-gray-50">
      <Header
        userName={userName}
        userRole={userRole}
        onToggleSidebar={() => setDrawerOpen((o) => !o)}
      />
      <ContextualSidebar userRole={userRole} onModeChange={handleModeChange} />
      <MobileDrawer
        userRole={userRole}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
      />
      <main
        className={cn(
          "p-4 pb-20 lg:p-6 lg:pb-6 transition-[margin] duration-200",
          // Cuando el sidebar está pineado empujamos el main 240px.
          // En modo auto, el sidebar overlay flota sobre 64px reservados.
          sidebarMode === "pinned" ? "lg:ml-60" : "lg:ml-16"
        )}
      >
        <div className="mx-auto max-w-7xl">{children}</div>
      </main>
      <BottomNav userRole={userRole} />
    </div>
  );
}
