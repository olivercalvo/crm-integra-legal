"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, UserPlus, Eye, EyeOff } from "lucide-react";
import type { UserRole } from "@/types/database";

const ROLE_LABELS: Record<UserRole, string> = {
  admin: "Administrador",
  abogada: "Abogada",
  asistente: "Asistente",
};

export function UserForm() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const [form, setForm] = useState({
    email: "",
    full_name: "",
    password: "",
    role: "abogada" as UserRole,
  });

  function handleChange(field: keyof typeof form, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
    setError(null);
  }

  function validate(): string | null {
    if (!form.email.trim()) return "El email es requerido.";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) {
      return "El email no tiene un formato válido.";
    }
    if (!form.full_name.trim()) return "El nombre completo es requerido.";
    if (!form.password) return "La contraseña es requerida.";
    if (form.password.length < 8) return "La contraseña debe tener al menos 8 caracteres.";
    if (!form.role) return "El rol es requerido.";
    return null;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: form.email.trim().toLowerCase(),
          full_name: form.full_name.trim(),
          password: form.password,
          role: form.role,
        }),
      });

      const json = await res.json();

      if (!res.ok) {
        throw new Error(json.error || "Error al crear el usuario");
      }

      setSuccess(true);
      // Redirect after short delay so user sees success state
      setTimeout(() => {
        router.push("/admin/usuarios");
        router.refresh();
      }, 1200);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error desconocido");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card className="max-w-xl">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 font-serif text-lg text-integra-navy">
          <UserPlus size={20} className="text-integra-gold" />
          Crear Nuevo Usuario
        </CardTitle>
      </CardHeader>

      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-5" noValidate>
          {/* Full name */}
          <div className="space-y-1.5">
            <Label htmlFor="full_name">
              Nombre completo <span className="text-red-500">*</span>
            </Label>
            <Input
              id="full_name"
              type="text"
              value={form.full_name}
              onChange={(e) => handleChange("full_name", e.target.value)}
              placeholder="Ej. María González"
              autoComplete="name"
              disabled={loading || success}
              className="h-12"
            />
          </div>

          {/* Email */}
          <div className="space-y-1.5">
            <Label htmlFor="email">
              Correo electrónico <span className="text-red-500">*</span>
            </Label>
            <Input
              id="email"
              type="email"
              value={form.email}
              onChange={(e) => handleChange("email", e.target.value)}
              placeholder="usuario@integralegal.com"
              autoComplete="email"
              disabled={loading || success}
              className="h-12"
            />
          </div>

          {/* Password */}
          <div className="space-y-1.5">
            <Label htmlFor="password">
              Contraseña <span className="text-red-500">*</span>
            </Label>
            <div className="relative">
              <Input
                id="password"
                type={showPassword ? "text" : "password"}
                value={form.password}
                onChange={(e) => handleChange("password", e.target.value)}
                placeholder="Mínimo 8 caracteres"
                autoComplete="new-password"
                disabled={loading || success}
                className="h-12 pr-12"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 focus:outline-none"
                tabIndex={-1}
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
            <p className="text-xs text-gray-400">
              Mínimo 8 caracteres. El usuario puede cambiarla después.
            </p>
          </div>

          {/* Role */}
          <div className="space-y-1.5">
            <Label htmlFor="role">
              Rol <span className="text-red-500">*</span>
            </Label>
            <div className="grid grid-cols-3 gap-2">
              {(Object.entries(ROLE_LABELS) as [UserRole, string][]).map(
                ([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => handleChange("role", value)}
                    disabled={loading || success}
                    className={`rounded-lg border-2 px-3 py-3 text-sm font-medium transition-all min-h-[48px] ${
                      form.role === value
                        ? "border-integra-navy bg-integra-navy text-white"
                        : "border-gray-200 bg-white text-gray-700 hover:border-integra-navy/40"
                    }`}
                  >
                    {label}
                  </button>
                )
              )}
            </div>
          </div>

          {/* Error */}
          {error && (
            <div className="rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          )}

          {/* Success */}
          {success && (
            <div className="rounded-md bg-emerald-50 border border-emerald-200 px-4 py-3 text-sm text-emerald-700">
              Usuario creado exitosamente. Redirigiendo...
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-3 pt-2">
            <Button
              type="submit"
              disabled={loading || success}
              className="min-h-[48px] flex-1 bg-integra-navy text-white hover:bg-integra-navy/90"
            >
              {loading ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  Creando...
                </>
              ) : success ? (
                "Usuario creado"
              ) : (
                <>
                  <UserPlus size={16} />
                  Crear Usuario
                </>
              )}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => router.back()}
              disabled={loading || success}
              className="min-h-[48px]"
            >
              Cancelar
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
