import { LoginForm } from "@/components/auth/login-form";

/**
 * Avisos que llegan por query string. El middleware y /auth/recuperar ya
 * mandaban estos parámetros, pero la pantalla nunca los mostraba: el usuario
 * volvía al login sin ninguna explicación de por qué.
 */
const NOTICES: Record<string, string> = {
  expired: "Tu sesión expiró por inactividad. Ingresa de nuevo.",
  recovery_expired:
    "El enlace de recuperación venció o ya fue usado. Solicita uno nuevo con “¿Olvidaste tu contraseña?”.",
  recovery:
    "No pudimos validar el enlace de recuperación. Solicita uno nuevo con “¿Olvidaste tu contraseña?”.",
  recovery_otro_navegador:
    "Ese enlace se pidió desde otro navegador o dispositivo. Solicita uno nuevo acá y ábrelo en este mismo equipo.",
  auth: "No pudimos validar el enlace. Ingresa con tu correo y contraseña.",
  "no-role":
    "Tu usuario no tiene un rol asignado. Contacta al administrador del sistema.",
};

interface PageProps {
  searchParams: { error?: string; expired?: string };
}

export default function LoginPage({ searchParams }: PageProps) {
  const noticeKey = searchParams.expired === "true" ? "expired" : searchParams.error;
  const notice = noticeKey ? NOTICES[noticeKey] : undefined;

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
            Gestión Legal Integral
          </p>
        </div>

        {/* Login Form */}
        <LoginForm notice={notice} />
      </div>
    </main>
  );
}
