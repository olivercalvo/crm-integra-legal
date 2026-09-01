/**
 * Cliente de Resend, con un candado de ambiente.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * 🔴 FUERA DE PRODUCCIÓN NO SALE UN SOLO CORREO
 * ─────────────────────────────────────────────────────────────────────────────
 * `EMAIL_FROM` es un dominio REAL y verificado en Resend
 * (`notificaciones@integra-panama.com`). Un correo mandado desde staging llega
 * al destinatario **a nombre del bufete**, indistinguible de uno de verdad. Eso
 * no es un bug: es un problema con el cliente.
 *
 * El riesgo es concreto y no hipotético: el diálogo "Enviar cotización" deja
 * escribir CUALQUIER dirección. Alcanza con que alguien probando el ambiente
 * escriba su propio correo — o el de una licenciada — para que salga.
 *
 * Hasta hoy la única defensa era que `RESEND_API_KEY` estuviera ausente, y es
 * una defensa que depende de la configuración: en Vercel la variable está en
 * *All Environments*, así que los deploys de Preview/Staging SÍ la tienen. Este
 * candado vive en el código y no se puede desarmar por descuido en un panel.
 *
 * Cubre los cuatro puntos de envío de una sola vez, porque todos pasan por
 * `getResend()`: envío y reenvío de cotización, notificaciones del portal
 * público y el resumen diario del cron.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * 🔑 LA VÁLVULA
 * ─────────────────────────────────────────────────────────────────────────────
 * Para probar el envío a propósito —contra una dirección propia— hay que
 * declararlo:
 *
 *     ALLOW_REAL_EMAILS=1
 *
 * Es server-only (sin prefijo `NEXT_PUBLIC_`), así que no viaja al navegador, y
 * cada envío que pasa por ahí deja un WARNING en el log. Cuándo sí y cuándo no:
 * `sop.md` SOP-018.
 */
import { Resend } from "resend";

import { currentAppEnv } from "@/lib/env/app-env";

let client: Resend | null = null;

/** Nombre de la válvula. Server-only a propósito. */
const OVERRIDE_VAR = "ALLOW_REAL_EMAILS";

/**
 * Corta el envío si el ambiente no es producción.
 *
 * Tira en vez de simular un envío exitoso. Es deliberado: un "modo sandbox" que
 * dice "enviado" sin enviar es exactamente el bug del banner verde mentiroso que
 * ya se pagó una vez en el Sprint 2E.3 — la cotización figuraba enviada y nunca
 * llegaba. Que falle fuerte y con motivo es la única versión honesta.
 *
 * Los cuatro call sites ya tratan el fallo: la ruta devuelve
 * `email_sent: false` + `email_error`, y la UI lo muestra.
 */
export function assertRealEmailAllowed(): void {
  const env = currentAppEnv();
  if (env === "production") return;

  if (process.env[OVERRIDE_VAR] === "1") {
    console.warn(
      `[email] ${OVERRIDE_VAR}=1 — enviando correo REAL desde el entorno "${env}". ` +
        `El remitente es ${EMAIL_FROM}, o sea que sale a nombre del bufete. Ver sop.md SOP-018.`
    );
    return;
  }

  throw new Error(
    `Envío de correo desactivado en el ambiente de pruebas (entorno "${env}"). ` +
      `Todo lo demás funciona: el documento quedó registrado y el enlace público es válido, ` +
      `pero no se envió ningún correo real. Es a propósito — el remitente configurado es una ` +
      `dirección del bufete y un correo desde pruebas llegaría como si fuera auténtico.`
  );
}

export function getResend(): Resend {
  assertRealEmailAllowed();

  if (!client) {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      throw new Error("RESEND_API_KEY is not set");
    }
    client = new Resend(apiKey);
  }
  return client;
}

export const EMAIL_FROM = "Integra Legal <notificaciones@integra-panama.com>";
