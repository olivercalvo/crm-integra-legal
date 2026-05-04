import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { HomeHeader } from "@/components/home/home-header";
import { Card, CardContent } from "@/components/ui/card";
import { Scale, Wallet, ArrowRight } from "lucide-react";
import { getGreetingPanama } from "@/lib/utils/greeting";

interface ModuleCard {
  href: string;
  title: string;
  description: string;
  Icon: typeof Scale;
  show: (role: string) => boolean;
}

// Tarjetas del selector. La visibilidad depende del rol — pero la pantalla
// del selector siempre se renderiza (sin auto-redirect), incluso cuando solo
// hay una tarjeta visible. Esto deja espacio a futura expansión y mantiene
// consistencia entre roles.
const MODULES: ModuleCard[] = [
  {
    href: "/legal",
    title: "Gestión Legal",
    description: "Clientes, casos, tareas y seguimientos",
    Icon: Scale,
    show: (role) => role === "admin" || role === "abogada" || role === "asistente",
  },
  {
    href: "/finanzas",
    title: "Finanzas",
    description: "Cotizaciones, facturas, cobros y gastos",
    Icon: Wallet,
    show: () => true,
  },
];

export default async function HomePage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/login");
  }

  // Bypass RLS para el lookup del perfil (mismo patrón que los módulos).
  const admin = createAdminClient();
  const { data: profile } = await admin
    .from("users")
    .select("full_name, role")
    .eq("id", user.id)
    .single();

  const userName = profile?.full_name || user.email || "Usuario";
  const userRole = (profile?.role as string) || "abogada";
  const firstName = userName.split(" ")[0];
  const greeting = getGreetingPanama();
  const visibleModules = MODULES.filter((m) => m.show(userRole));

  return (
    <div className="min-h-screen bg-gray-50">
      <HomeHeader userName={userName} userRole={userRole} />

      <main className="px-4 py-8 lg:py-16">
        <div className="mx-auto max-w-5xl">
          <div className="mb-8 lg:mb-12 text-center sm:text-left">
            <h1 className="text-2xl lg:text-3xl font-bold text-integra-navy">
              {greeting}, {firstName}
            </h1>
            <p className="mt-2 text-base text-gray-500">
              ¿Qué quieres gestionar hoy?
            </p>
          </div>

          <div className="grid gap-4 sm:gap-6 sm:grid-cols-2">
            {visibleModules.map((mod) => {
              const Icon = mod.Icon;
              return (
                <Link
                  key={mod.href}
                  href={mod.href}
                  aria-label={`Entrar a ${mod.title}`}
                  className="group block focus:outline-none focus-visible:ring-2 focus-visible:ring-integra-gold focus-visible:ring-offset-2 rounded-xl"
                >
                  <Card className="h-full border border-gray-200 bg-white shadow-sm transition-all duration-200 hover:shadow-md hover:-translate-y-0.5 active:translate-y-0">
                    <CardContent className="flex flex-col items-start gap-4 p-6 lg:p-8">
                      <div className="rounded-xl bg-integra-navy/5 p-3 text-integra-navy ring-1 ring-integra-gold/30">
                        <Icon size={36} strokeWidth={1.75} />
                      </div>
                      <div>
                        <h2 className="text-xl font-bold text-integra-navy">
                          {mod.title}
                        </h2>
                        <p className="mt-1 text-sm text-gray-500">
                          {mod.description}
                        </p>
                      </div>
                      <span
                        className="mt-2 inline-flex min-h-[48px] items-center gap-2 rounded-lg bg-integra-navy px-5 text-sm font-semibold text-white transition-colors group-hover:bg-integra-gold group-hover:text-integra-navy"
                      >
                        Entrar
                        <ArrowRight size={18} />
                      </span>
                    </CardContent>
                  </Card>
                </Link>
              );
            })}
          </div>
        </div>
      </main>
    </div>
  );
}
