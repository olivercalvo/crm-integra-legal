import { LoginForm } from "@/components/auth/login-form";

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-integra-navy px-4">
      <div className="w-full max-w-md space-y-8">
        {/* Logo / Branding */}
        <div className="text-center">
          <h1 className="text-4xl font-bold text-integra-white">
            Integra Legal
          </h1>
          <div className="mx-auto mt-2 h-1 w-16 bg-integra-gold" />
          <p className="mt-4 text-sm text-integra-white/70">
            Sistema de Gestión de Casos
          </p>
        </div>

        {/* Login Form */}
        <LoginForm />
      </div>
    </main>
  );
}
