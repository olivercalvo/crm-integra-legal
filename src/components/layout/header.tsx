"use client";

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
  };

  return (
    <header className="sticky top-0 z-50 flex h-16 items-center justify-between border-b bg-integra-navy px-4 lg:px-6">
      {/* Left: hamburger + logo */}
      <div className="flex items-center gap-3">
        <button
          onClick={onToggleSidebar}
          className="rounded-md p-2 text-integra-white/80 hover:bg-white/10 lg:hidden"
          aria-label="Abrir menú"
        >
          <Menu size={24} />
        </button>
        <h1 className="font-serif text-xl font-bold text-integra-white">
          Integra <span className="text-integra-gold">Legal</span>
        </h1>
      </div>

      {/* Right: user menu */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" className="flex items-center gap-2 text-integra-white hover:bg-white/10">
            <Avatar className="h-8 w-8 border border-integra-gold/30">
              <AvatarFallback className="bg-integra-gold/20 text-sm text-integra-gold">
                {initials}
              </AvatarFallback>
            </Avatar>
            <div className="hidden text-left sm:block">
              <p className="text-sm font-medium leading-none">{userName}</p>
              <p className="text-xs text-integra-white/60">{roleLabels[userRole] || userRole}</p>
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
    </header>
  );
}
