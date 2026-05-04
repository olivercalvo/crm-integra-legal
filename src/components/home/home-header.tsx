"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { LogOut, User as UserIcon } from "lucide-react";

interface HomeHeaderProps {
  userName: string;
  userRole: string;
}

const ROLE_LABELS: Record<string, string> = {
  admin: "Administrador",
  abogada: "Abogada",
  asistente: "Asistente",
  contador: "Contador",
};

/**
 * Header de la pantalla selector ("/"). Más liviano que el header de los
 * módulos: sin hamburguesa de sidebar, sin búsqueda global. Logo + avatar.
 */
export function HomeHeader({ userName, userRole }: HomeHeaderProps) {
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

  return (
    <header className="sticky top-0 z-50 flex h-16 items-center justify-between border-b border-gray-200 bg-white px-4 lg:px-6">
      <div className="flex items-center gap-3">
        <Link href="/" className="text-xl font-bold text-integra-navy">
          Integra <span className="text-integra-gold">Legal</span>
        </Link>
      </div>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            className="flex items-center gap-2 text-integra-navy hover:bg-gray-100"
          >
            <Avatar className="h-8 w-8 border border-integra-gold/30">
              <AvatarFallback className="bg-integra-navy/10 text-sm text-integra-navy font-semibold">
                {initials}
              </AvatarFallback>
            </Avatar>
            <div className="hidden text-left sm:block">
              <p className="text-sm font-medium leading-none text-integra-navy">
                {userName}
              </p>
              <p className="text-xs text-gray-500">
                {ROLE_LABELS[userRole] ?? userRole}
              </p>
            </div>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          <DropdownMenuItem className="cursor-pointer" disabled>
            <UserIcon size={16} className="mr-2" />
            Mi perfil
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={handleSignOut}
            className="cursor-pointer text-red-600"
          >
            <LogOut size={16} className="mr-2" />
            Cerrar sesión
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  );
}
