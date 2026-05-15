"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { LogOut, User as UserIcon, Menu } from "lucide-react";
import { ConnectivityIndicator } from "@/components/layout/connectivity-indicator";
import { GlobalSearch } from "@/components/layout/global-search";
import { TopTabs } from "@/components/layout/top-tabs";

interface HeaderProps {
  userName: string;
  userRole: string;
  onToggleSidebar?: () => void;
}

export function Header({ userName, userRole, onToggleSidebar }: HeaderProps) {
  const router = useRouter();

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  const initials = userName
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  const roleLabels: Record<string, string> = {
    admin: "Administrador",
    abogada: "Abogada",
    asistente: "Asistente",
    contador: "Contador",
  };

  return (
    <header className="sticky top-0 z-50 border-b border-gray-200 bg-white">
      <div className="flex h-16 items-center justify-between px-4 lg:px-6">
        {/* Left: hamburger + logo + tabs (desktop inline) */}
        <div className="flex items-center gap-3 lg:gap-6">
          <button
            onClick={onToggleSidebar}
            className="rounded-md p-2 text-gray-500 hover:bg-gray-100 lg:hidden"
            aria-label="Abrir menú"
          >
            <Menu size={24} />
          </button>
          <Link href="/" aria-label="Ir al inicio" className="shrink-0">
            <h1 className="text-xl font-bold text-integra-navy">
              Integra <span className="text-integra-gold">Legal</span>
            </h1>
          </Link>
          <TopTabs userRole={userRole} variant="desktop" />
        </div>

        {/* Center: search bar */}
        <div className="hidden md:flex flex-1 max-w-md mx-4 lg:mx-8">
          <GlobalSearch />
        </div>

        {/* Right: connectivity + user menu */}
        <div className="flex items-center gap-3">
          <div className="hidden sm:flex">
            <ConnectivityIndicator />
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="flex items-center gap-2 text-integra-navy hover:bg-gray-100">
                <Avatar className="h-8 w-8 border border-integra-gold/30">
                  <AvatarFallback className="bg-integra-navy/10 text-sm text-integra-navy font-semibold">
                    {initials}
                  </AvatarFallback>
                </Avatar>
                <div className="hidden text-left sm:block">
                  <p className="text-sm font-medium leading-none text-integra-navy">{userName}</p>
                  <p className="text-xs text-gray-500">{roleLabels[userRole] || userRole}</p>
                </div>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuItem className="cursor-pointer" disabled>
                <UserIcon size={16} className="mr-2" />
                Mi perfil
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleSignOut} className="cursor-pointer text-red-600">
                <LogOut size={16} className="mr-2" />
                Cerrar sesión
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Tabs en mobile: fila separada debajo del header principal */}
      <TopTabs userRole={userRole} variant="mobile" />
    </header>
  );
}
