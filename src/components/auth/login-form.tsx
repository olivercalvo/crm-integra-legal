"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { LogIn, Eye, EyeOff } from "lucide-react";

export function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  // Load remembered email on mount
  useEffect(() => {
    const savedEmail = localStorage.getItem("integra_remembered_email");
    if (savedEmail) {
      setEmail(savedEmail);
      setRememberMe(true);
    }
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const supabase = createClient();
      const { error: authError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (authError) {
        setError("Correo o contraseña incorrectos");
        setLoading(false);
        return;
      }

      // Handle "Remember me" — only saves email, never password
      if (rememberMe) {
        localStorage.setItem("integra_remembered_email", email);
      } else {
        localStorage.removeItem("integra_remembered_email");
      }

      router.push("/dashboard");
      router.refresh();
    } catch {
      setError("Error de conexión. Intente de nuevo.");
      setLoading(false);
    }
  }

  return (
    <Card className="border-0 bg-white/10 backdrop-blur-sm">
      <CardContent className="pt-6">
        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Email */}
          <div className="space-y-2">
            <Label htmlFor="email" className="text-integra-white/90">
              Correo electrónico
            </Label>
            <Input
              id="email"
              type="email"
              placeholder="usuario@integralegal.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="h-12 border-white/20 bg-white/10 text-white placeholder:text-white/40 focus:border-integra-gold focus:ring-integra-gold"
            />
          </div>

          {/* Password */}
          <div className="space-y-2">
            <Label htmlFor="password" className="text-integra-white/90">
              Contraseña
            </Label>
            <div className="relative">
              <Input
                id="password"
                type={showPassword ? "text" : "password"}
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="h-12 border-white/20 bg-white/10 pr-12 text-white placeholder:text-white/40 focus:border-integra-gold focus:ring-integra-gold"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-white/60 hover:text-white"
                tabIndex={-1}
              >
                {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
              </button>
            </div>
          </div>

          {/* Remember me */}
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="remember"
              checked={rememberMe}
              onChange={(e) => setRememberMe(e.target.checked)}
              className="h-4 w-4 rounded border-white/20 bg-white/10 text-integra-gold focus:ring-integra-gold"
            />
            <Label htmlFor="remember" className="cursor-pointer text-sm text-integra-white/70">
              Recordar mi correo
            </Label>
          </div>

          {/* Error */}
          {error && (
            <div className="rounded-md bg-red-500/20 px-4 py-2 text-sm text-red-200">
              {error}
            </div>
          )}

          {/* Submit */}
          <Button
            type="submit"
            disabled={loading}
            className="h-12 w-full bg-integra-gold text-integra-navy hover:bg-integra-gold/90 font-semibold text-base"
          >
            {loading ? (
              <span className="flex items-center gap-2">
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-integra-navy border-t-transparent" />
                Ingresando...
              </span>
            ) : (
              <span className="flex items-center gap-2">
                <LogIn size={20} />
                Ingresar
              </span>
            )}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
