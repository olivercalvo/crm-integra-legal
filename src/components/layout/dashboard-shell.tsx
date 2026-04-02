"use client";

import { useState } from "react";
import { Header } from "./header";
import { Sidebar } from "./sidebar";
import { BottomNav } from "./bottom-nav";

interface DashboardShellProps {
  children: React.ReactNode;
  userName: string;
  userRole: string;
}

export function DashboardShell({ children, userName, userRole }: DashboardShellProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="min-h-screen bg-gray-50">
      <Header
        userName={userName}
        userRole={userRole}
        onToggleSidebar={() => setSidebarOpen(!sidebarOpen)}
      />
      <Sidebar
        userRole={userRole}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />
      <main className="pb-20 lg:ml-64 lg:pb-6">
        <div className="mx-auto max-w-7xl p-4 lg:p-6">
          {children}
        </div>
      </main>
      <BottomNav userRole={userRole} />
    </div>
  );
}
