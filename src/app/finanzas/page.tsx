import Link from "next/link";
import { Wallet, ArrowLeft, Construction } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

export default function FinanzasPlaceholderPage() {
  return (
    <div className="space-y-6">
      <Link
        href="/"
        className="inline-flex items-center gap-2 text-sm font-medium text-gray-500 hover:text-integra-navy transition-colors"
      >
        <ArrowLeft size={16} />
        Volver al selector
      </Link>

      <Card className="border border-integra-gold/30 bg-white shadow-sm">
        <CardContent className="flex flex-col items-center gap-5 p-10 lg:p-16 text-center">
          <div className="rounded-2xl bg-integra-navy/5 p-5 text-integra-navy ring-1 ring-integra-gold/40">
            <Wallet size={56} strokeWidth={1.5} />
          </div>

          <div>
            <h1 className="text-3xl font-bold text-integra-navy">Finanzas</h1>
            <p className="mt-2 text-sm font-medium uppercase tracking-wider text-integra-gold">
              Próximamente
            </p>
          </div>

          <p className="max-w-lg text-base text-gray-600">
            El módulo de Finanzas está en construcción. Pronto tendrás aquí
            cotizaciones, facturas, cobros y gastos — todo conectado con el
            módulo de Gestión Legal.
          </p>

          <div className="mt-2 inline-flex items-center gap-2 rounded-full bg-amber-50 px-4 py-2 text-sm font-medium text-amber-800">
            <Construction size={16} />
            En desarrollo
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
