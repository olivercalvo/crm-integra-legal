import { NewPasswordForm } from "@/components/auth/new-password-form";

export const metadata = {
  title: "Contraseña nueva · Integra Legal",
};

/**
 * Pantalla para fijar una contraseña nueva.
 *
 * Se llega acá de dos maneras: desde el link de recuperación del email (que
 * pasa por /auth/recuperar, donde se canjea el código por una sesión) o de
 * manera voluntaria estando logueado.
 *
 * Requiere sesión: el middleware manda al login si no hay. La ruta está
 * exceptuada del gating por rol, porque cambiar la propia contraseña no
 * depende de ser abogada, asistente, contador o admin.
 */
export default function NuevaContrasenaPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-integra-navy px-4">
      <div className="w-full max-w-md space-y-8">
        <div className="text-center">
          <h1 className="text-4xl font-bold text-integra-white">Integra Legal</h1>
          <div className="mx-auto mt-2 h-1 w-16 bg-integra-gold" />
          <p className="mt-4 text-sm text-integra-white/70">
            Elige tu contraseña nueva
          </p>
        </div>

        <NewPasswordForm />
      </div>
    </main>
  );
}
