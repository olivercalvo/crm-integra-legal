"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { KeyRound, Eye, EyeOff, CheckCircle2 } from "lucide-react";

/**
 * Formulario para fijar una contraseña nueva.
 *
 * Sirve para los dos caminos:
 *   - Recuperación: se llega desde /auth/recuperar, que ya canjeó el código del
 *     email por una sesión.
 *   - Cambio voluntario: cualquier usuario con sesión puede entrar y cambiarla.
 *
 * El mínimo de 8 caracteres es el mismo que exige el alta de usuarios
 * (api/admin/users), para no tener dos reglas distintas en el mismo sistema.
 */

const MIN_LENGTH = 8;

export function NewPasswordForm() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (password.length < MIN_LENGTH) {
      setError(`La contraseña debe tener al menos ${MIN_LENGTH} caracteres`);
      return;
    }
    if (password !== confirm) {
      setError("Las dos contraseñas no coinciden");
      return;
    }

    setLoading(true);
    try {
      const supabase = createClient();
      const { error: updateError } = await supabase.auth.updateUser({ password });

      if (updateError) {
        // El caso típico: la sesión de recuperación venció mientras completaba
        // el formulario. Decirlo con todas las letras evita el reintento ciego.
        setError(
          updateError.message.toLowerCase().includes("session")
            ? "La sesión de recuperación venció. Solicite un enlace nuevo desde el login."
            : "No se pudo cambiar la contraseña. Intente de nuevo."
        );
        setLoading(false);
        return;
      }

      setDone(true);
      // Un respiro para que se lea la confirmación antes de entrar al CRM.
      setTimeout(() => {
        router.push("/");
        router.refresh();
      }, 1800);
    } catch {
      setError("Error de conexión. Intente de nuevo.");
      setLoading(false);
    }
  }

  if (done) {
    return (
      <Card className="border-0 bg-white/10 backdrop-blur-sm">
        <CardContent className="pt-6">
          <div className="flex flex-col items-center gap-3 py-4 text-center">
            <CheckCircle2 size={40} className="text-green-300" />
            <p className="text-lg font-semibold text-integra-white">
              Contraseña actualizada
            </p>
            <p className="text-sm text-integra-white/70">
              Entrando al sistema…
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-0 bg-white/10 backdrop-blur-sm">
      <CardContent className="pt-6">
        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="password" className="text-integra-white/90">
              Contraseña nueva
            </Label>
            <div className="relative">
              <Input
                id="password"
                type={showPassword ? "text" : "password"}
                placeholder="Mínimo 8 caracteres"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="new-password"
                autoFocus
                className="h-12 border-white/20 bg-white/10 pr-12 text-white placeholder:text-white/40 focus:border-integra-gold focus:ring-integra-gold"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-white/60 hover:text-white"
                tabIndex={-1}
                aria-label={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"}
              >
                {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
              </button>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="confirm" className="text-integra-white/90">
              Repetir la contraseña
            </Label>
            <Input
              id="confirm"
              type={showPassword ? "text" : "password"}
              placeholder="••••••••"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              required
              autoComplete="new-password"
              className="h-12 border-white/20 bg-white/10 text-white placeholder:text-white/40 focus:border-integra-gold focus:ring-integra-gold"
            />
          </div>

          {error && (
            <div className="rounded-md bg-red-500/20 px-4 py-2 text-sm text-red-200">
              {error}
            </div>
          )}

          <Button
            type="submit"
            disabled={loading}
            className="h-12 w-full bg-integra-gold text-integra-navy hover:bg-integra-gold/90 font-semibold text-base"
          >
            {loading ? (
              <span className="flex items-center gap-2">
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-integra-navy border-t-transparent" />
                Guardando...
              </span>
            ) : (
              <span className="flex items-center gap-2">
                <KeyRound size={20} />
                Guardar contraseña
              </span>
            )}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
