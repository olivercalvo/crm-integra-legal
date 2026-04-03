"use client";

import { useState, useEffect } from "react";
import { Header } from "./header";
import { Sidebar } from "./sidebar";
import { BottomNav } from "./bottom-nav";
import { cn } from "@/lib/utils";

interface DashboardShellProps {
  children: React.ReactNode;
  userName: string;
  userRole: string;
}

export function DashboardShell({ children, userName, userRole }: DashboardShellProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  useEffect(() => {
    try {
      const saved = localStorage.getItem("sidebar-collapsed");
      if (saved === "true") setSidebarCollapsed(true);
    } catch {}
  }, []);

  function toggleCollapse() {
    setSidebarCollapsed((prev) => {
      const next = !prev;
      try { localStorage.setItem("sidebar-collapsed", String(next)); } catch {}
      return next;
    });
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Header
        userName={userName}
        userRole={userRole}
        onToggleSidebar={() => setSidebarOpen((o) => !o)}
      />
      <Sidebar
        userRole={userRole}
        open={sidebarOpen}
        collapsed={sidebarCollapsed}
        onClose={() => setSidebarOpen(false)}
        onToggleCollapse={toggleCollapse}
      />
      <main
        className={cn(
          "p-4 pb-20 lg:p-6 lg:pb-6 transition-all duration-200",
          sidebarCollapsed ? "lg:ml-16" : "lg:ml-64"
        )}
      >
        <div className="mx-auto max-w-7xl">{children}</div>
      </main>
      <BottomNav userRole={userRole} />
    </div>
  );
}
