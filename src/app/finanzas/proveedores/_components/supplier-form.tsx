"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Info, Loader2 } from "lucide-react";

import type { SupplierRow } from "@/lib/finanzas/types/supplier";
import {
  PAYMENT_TERMS_MAX,
  PAYMENT_TERMS_MIN,
  PAYMENT_TERMS_SUGERIDOS,
  paymentTermsLabel,
} from "@/lib/finanzas/types/supplier";
import { avisosDeRuc } from "@/lib/finanzas/validators/supplier";

/**
 * Formulario de proveedor, para crear y para editar.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * EL RUC AVISA, NO BLOQUEA
 * ─────────────────────────────────────────────────────────────────────────────
 * Los comentarios sobre el formato del RUC salen de `avisosDeRuc()` y se
 * muestran en ámbar mientras se escribe. NO impiden guardar, a propósito: en
 * Panamá conviven varias familias de RUC y un validador estricto terminaría
 * rechazando uno legítimo que no previmos, sin que la persona pueda seguir.
 *
 * 🔴 RUC y DV son dos campos, con dos labels, y viajan al servidor como dos
 * claves distintas. En ningún punto de este archivo se juntan.
 */

interface Props {
  /** null = alta. */
  proveedor: SupplierRow | null;
  /** Solo para el alta: el número que le va a tocar. */
  proximoNumero?: string | null;
}

type Errores = Record<string, string>;

export function SupplierForm({ proveedor, proximoNumero }: Props) {
  const router = useRouter();
  const editando = proveedor !== null;

  const [legalName, setLegalName] = useState(proveedor?.legal_name ?? "");
  const [tradeName, setTradeName] = useState(proveedor?.trade_name ?? "");
  const [ruc, setRuc] = useState(proveedor?.ruc ?? "");
  const [dv, setDv] = useState(proveedor?.dv ?? "");
  const [address, setAddress] = useState(proveedor?.address ?? "");
  const [phone, setPhone] = useState(proveedor?.phone ?? "");
  const [email, setEmail] = useState(proveedor?.email ?? "");
  const [plazo, setPlazo] = useState(String(proveedor?.payment_terms_days ?? 0));
  const [active, setActive] = useState(proveedor?.active ?? true);
  const [notes, setNotes] = useState(proveedor?.notes ?? "");

  const [errores, setErrores] = useState<Errores>({});
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  const avisos = useMemo(
    () => avisosDeRuc(ruc.trim() || null, dv.trim() || null),
    [ruc, dv]
  );

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    setGuardando(true);
    setErrores({});
    setErrorGeneral(null);

    const body = {
      legal_name: legalName,
      trade_name: tradeName || null,
      ruc: ruc || null,
      dv: dv || null,
      address: address || null,
      phone: phone || null,
      email: email || null,
      payment_terms_days: Number(plazo || 0),
      active,
      notes: notes || null,
    };

    const url = editando
      ? `/api/finanzas/suppliers/${proveedor.id}`
      : "/api/finanzas/suppliers";

    try {
      const res = await fetch(url, {
        method: editando ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));

      if (!res.ok) {
        if (json.fieldErrors) setErrores(json.fieldErrors as Errores);
        setErrorGeneral(json.error ?? "No se pudo guardar el proveedor");
        setGuardando(false);
        return;
      }

      router.push(`/finanzas/proveedores/${editando ? proveedor.id : json.id}`);
      router.refresh();
    } catch {
      setErrorGeneral("No se pudo conectar con el servidor");
      setGuardando(false);
    }
  }

  const inputCls =
    "block w-full rounded-md border border-gray-300 px-3 min-h-[44px] text-sm focus:border-integra-navy focus:outline-none";
  const labelCls = "mb-1 block text-xs font-medium text-gray-600";

  function Error({ campo }: { campo: string }) {
    if (!errores[campo]) return null;
    return <p className="mt-1 text-xs text-red-600">{errores[campo]}</p>;
  }

  return (
    <form onSubmit={guardar} className="space-y-4">
      {errorGeneral && (
        <p className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-800">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          {errorGeneral}
        </p>
      )}

      {/* ---------------- Identificación ---------------- */}
      <fieldset className="rounded-xl border bg-white p-4">
        <legend className="px-1 text-sm font-semibold text-integra-navy">Identificación</legend>

        {!editando && proximoNumero && (
          <p className="mb-3 text-xs text-gray-500">
            Se va a crear como <span className="font-mono font-semibold">{proximoNumero}</span>.
          </p>
        )}
        {editando && (
          <p className="mb-3 text-xs text-gray-500">
            Número <span className="font-mono font-semibold">{proveedor.supplier_number}</span>.
            No cambia.
          </p>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label htmlFor="legal_name" className={labelCls}>
              Razón social <span className="text-red-500">*</span>
            </label>
            <input
              id="legal_name"
              value={legalName}
              onChange={(e) => setLegalName(e.target.value)}
              className={inputCls}
              placeholder="INMOBILIARIA COSTA DEL ESTE, S.A."
            />
            <p className="mt-1 text-xs text-gray-500">La que figura en el RUC.</p>
            <Error campo="legal_name" />
          </div>

          <div className="sm:col-span-2">
            <label htmlFor="trade_name" className={labelCls}>
              Razón comercial
            </label>
            <input
              id="trade_name"
              value={tradeName}
              onChange={(e) => setTradeName(e.target.value)}
              className={inputCls}
              placeholder="Con la que se la conoce, si es distinta"
            />
            <Error campo="trade_name" />
          </div>
        </div>
      </fieldset>

      {/* ---------------- RUC y DV ---------------- */}
      <fieldset className="rounded-xl border bg-white p-4">
        <legend className="px-1 text-sm font-semibold text-integra-navy">RUC y DV</legend>

        <p className="mb-3 flex items-start gap-2 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-800">
          <Info size={14} className="mt-0.5 shrink-0" />
          <span>
            Van <strong>en dos campos separados</strong> porque así los pide el formulario de la
            DGI y así se arman los anexos de la declaración de renta.{" "}
            <strong>El DV no va dentro del RUC.</strong>
          </span>
        </p>

        <div className="grid gap-3 sm:grid-cols-3">
          <div className="sm:col-span-2">
            <label htmlFor="ruc" className={labelCls}>
              RUC <span className="font-normal text-gray-400">(sin el DV)</span>
            </label>
            <input
              id="ruc"
              value={ruc}
              onChange={(e) => setRuc(e.target.value)}
              className={`${inputCls} font-mono`}
              placeholder="155123456-2-2015"
            />
            <p className="mt-1 text-xs text-gray-500">
              Se acepta el formato tal como venga: 8-123-456, PE-8-123-456,
              155123456-2-2015 y los demás. No se valida la estructura para no rechazar un RUC
              legítimo.
            </p>
            <Error campo="ruc" />
          </div>

          <div>
            <label htmlFor="dv" className={labelCls}>
              DV
            </label>
            <input
              id="dv"
              value={dv}
              onChange={(e) => setDv(e.target.value)}
              inputMode="numeric"
              className={`${inputCls} font-mono`}
              placeholder="05"
            />
            <p className="mt-1 text-xs text-gray-500">Dígito verificador. En la DGI son 2 dígitos.</p>
            <Error campo="dv" />
          </div>
        </div>

        {avisos.length > 0 && (
          <ul className="mt-3 space-y-1 rounded-md border border-amber-200 bg-amber-50 px-3 py-2">
            {avisos.map((a) => (
              <li key={a} className="flex items-start gap-2 text-xs text-amber-900">
                <AlertTriangle size={13} className="mt-0.5 shrink-0" />
                <span>{a}</span>
              </li>
            ))}
            <li className="pt-1 text-[11px] italic text-amber-800">
              Son avisos, no errores: podés guardar igual.
            </li>
          </ul>
        )}
      </fieldset>

      {/* ---------------- Términos de pago ---------------- */}
      <fieldset className="rounded-xl border bg-white p-4">
        <legend className="px-1 text-sm font-semibold text-integra-navy">Términos de pago</legend>

        <p className="mb-3 text-xs text-gray-600">
          El plazo que da este proveedor. De acá sale el{" "}
          <strong>vencimiento por defecto de cada gasto</strong>, y del vencimiento salen los
          tramos de la antigüedad de cuentas por pagar. El vencimiento de cada gasto se puede
          cambiar después: manda lo que diga el comprobante.
        </p>

        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label htmlFor="plazo" className={labelCls}>
              Plazo en días
            </label>
            <input
              id="plazo"
              type="number"
              min={PAYMENT_TERMS_MIN}
              max={PAYMENT_TERMS_MAX}
              value={plazo}
              onChange={(e) => setPlazo(e.target.value)}
              className={`${inputCls} w-32 font-mono`}
            />
            <Error campo="payment_terms_days" />
          </div>

          <div className="flex flex-wrap gap-1.5 pb-1">
            {PAYMENT_TERMS_SUGERIDOS.map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setPlazo(String(d))}
                className={
                  "min-h-[36px] rounded-full border px-3 text-xs font-medium transition-colors " +
                  (Number(plazo) === d
                    ? "border-integra-navy bg-integra-navy text-white"
                    : "border-gray-300 bg-white text-gray-700 hover:border-integra-navy")
                }
              >
                {paymentTermsLabel(d)}
              </button>
            ))}
          </div>
        </div>
        <p className="mt-2 text-xs text-gray-500">
          Los botones son atajos. Se acepta cualquier plazo de {PAYMENT_TERMS_MIN} a{" "}
          {PAYMENT_TERMS_MAX} días.
        </p>
      </fieldset>

      {/* ---------------- Contacto ---------------- */}
      <fieldset className="rounded-xl border bg-white p-4">
        <legend className="px-1 text-sm font-semibold text-integra-navy">Contacto</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label htmlFor="address" className={labelCls}>
              Dirección
            </label>
            <input id="address" value={address} onChange={(e) => setAddress(e.target.value)} className={inputCls} />
            <Error campo="address" />
          </div>
          <div>
            <label htmlFor="phone" className={labelCls}>
              Teléfono
            </label>
            <input id="phone" value={phone} onChange={(e) => setPhone(e.target.value)} className={inputCls} />
            <Error campo="phone" />
          </div>
          <div>
            <label htmlFor="email" className={labelCls}>
              Correo
            </label>
            <input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={inputCls} />
            <Error campo="email" />
          </div>
        </div>
      </fieldset>

      {/* ---------------- Estado y notas ---------------- */}
      <fieldset className="rounded-xl border bg-white p-4">
        <legend className="px-1 text-sm font-semibold text-integra-navy">Estado y notas</legend>

        <label className="flex min-h-[44px] items-center gap-2 text-sm text-gray-800">
          <input
            type="checkbox"
            checked={active}
            onChange={(e) => setActive(e.target.checked)}
            className="h-5 w-5 rounded border-gray-300"
          />
          Activo
        </label>
        <p className="mb-3 text-xs text-gray-500">
          Un proveedor inactivo deja de ofrecerse al cargar gastos nuevos, pero su historial y sus
          gastos se conservan.
        </p>

        <label htmlFor="notes" className={labelCls}>
          Notas
        </label>
        <textarea
          id="notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-integra-navy focus:outline-none"
        />
        <Error campo="notes" />
      </fieldset>

      <div className="flex flex-wrap gap-2">
        <button
          type="submit"
          disabled={guardando}
          className="inline-flex min-h-[48px] items-center gap-2 rounded-md bg-integra-gold px-6 text-sm font-semibold text-integra-navy hover:bg-integra-gold/90 disabled:opacity-60"
        >
          {guardando && <Loader2 size={16} className="animate-spin" />}
          {guardando ? "Guardando…" : editando ? "Guardar cambios" : "Crear proveedor"}
        </button>
        <button
          type="button"
          onClick={() => router.back()}
          className="min-h-[48px] rounded-md border border-gray-300 px-6 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          Cancelar
        </button>
      </div>
    </form>
  );
}
