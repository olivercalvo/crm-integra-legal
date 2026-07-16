/**
 * Unit tests del gate fiscal del RECEPTOR + validación de ubicación del EMISOR.
 *
 * Ejecución:
 *   npx tsx --test src/lib/finanzas/efactura/__tests__/validate-client-fiscal-gate.test.ts
 *
 * Contexto (2026-07-09): la ubicación del receptor (codigo_ubicacion,
 * corregimiento, distrito, provincia) se relajó del gate tras confirmar contra
 * la Ficha Técnica DGI v1.00 que su ausencia es efecto "N" (Notificación), NO
 * rechazo — la FE se autoriza igual (código 0260). Estos tests fijan el
 * contrato para que no vuelva a apretarse por error:
 *   - Receptor 01 con RUC+DV pero SIN ubicación PASA (caso HERMANI).
 *   - Receptor 01 sin DV sigue FALLANDO (el DV sí es obligatorio).
 *   - La ubicación del EMISOR faltante sigue FALLANDO (no rompimos esa vía).
 */

import test from "node:test";
import assert from "node:assert/strict";

import { validateClientFiscalGate } from "@/lib/finanzas/efactura/data/fetch-invoice-efactura-bundle";
import { loadEmisorConfig } from "@/lib/finanzas/efactura/config/emisor-config";
import { MutationError } from "@/lib/finanzas/api/errors";

// ---------------------------------------------------------------------------
// Fixtures del receptor (fila cruda de `clients`, snake_case, como la recibe
// el gate desde el join de Supabase).
// ---------------------------------------------------------------------------

type ClientRow = Record<string, unknown>;

/** Contribuyente (01) completo con RUC + DV, SIN ningún campo de ubicación. */
function receptor01SinUbicacion(): ClientRow {
  return {
    client_status: "active",
    tipo_receptor_fe: "01",
    client_type: "persona_juridica",
    tax_id: "155555555-2-2020",
    ruc: null,
    digito_verificador: "45",
    codigo_ubicacion: null,
    corregimiento: null,
    distrito: null,
    provincia: null,
    id_extranjero: null,
    pais_receptor: null,
  };
}

// ---------------------------------------------------------------------------
// RECEPTOR — casos que deben PASAR (no lanzan)
// ---------------------------------------------------------------------------

test("receptor 01 con RUC+DV pero SIN ubicación PASA el gate (caso HERMANI)", () => {
  assert.doesNotThrow(() => validateClientFiscalGate(receptor01SinUbicacion()));
});

test("receptor 03 (gobierno) con RUC+DV y sin ubicación PASA", () => {
  const row = { ...receptor01SinUbicacion(), tipo_receptor_fe: "03" };
  assert.doesNotThrow(() => validateClientFiscalGate(row));
});

test("receptor 02 (consumidor final) sin RUC/DV/ubicación PASA (solo tipo)", () => {
  const row: ClientRow = {
    client_status: "active",
    tipo_receptor_fe: "02",
    tax_id: null,
    ruc: null,
    digito_verificador: null,
    codigo_ubicacion: null,
    corregimiento: null,
    distrito: null,
    provincia: null,
  };
  assert.doesNotThrow(() => validateClientFiscalGate(row));
});

test("receptor 01 con ubicación COMPLETA sigue pasando (no regresión)", () => {
  const row = {
    ...receptor01SinUbicacion(),
    codigo_ubicacion: "8-8-7",
    corregimiento: "Bella Vista",
    distrito: "Panamá",
    provincia: "Panamá",
  };
  assert.doesNotThrow(() => validateClientFiscalGate(row));
});

test("receptor 01 con ruc legacy (sin tax_id) + DV PASA", () => {
  const row = { ...receptor01SinUbicacion(), tax_id: null, ruc: "8-123-456" };
  assert.doesNotThrow(() => validateClientFiscalGate(row));
});

test("receptor 02 (consumidor final) con client_type NULL PASA (control: 02 no usa client_type)", () => {
  const row: ClientRow = {
    client_status: "active",
    tipo_receptor_fe: "02",
    client_type: null,
    tax_id: null,
    ruc: null,
    digito_verificador: null,
    codigo_ubicacion: null,
    corregimiento: null,
    distrito: null,
    provincia: null,
  };
  assert.doesNotThrow(() => validateClientFiscalGate(row));
});

// ---------------------------------------------------------------------------
// RECEPTOR — casos que deben FALLAR (lanzan MutationError 400)
// ---------------------------------------------------------------------------

test("receptor 01 SIN DV sigue FALLANDO (el DV es obligatorio)", () => {
  const row = { ...receptor01SinUbicacion(), digito_verificador: null };
  assert.throws(
    () => validateClientFiscalGate(row),
    (err: unknown) => {
      assert.ok(err instanceof MutationError);
      assert.equal((err as MutationError).status, 400);
      assert.match((err as MutationError).message, /dígito verificador \(DV\)/);
      return true;
    }
  );
});

test("receptor 01 SIN RUC ni tax_id FALLA", () => {
  const row = { ...receptor01SinUbicacion(), tax_id: null, ruc: null };
  assert.throws(
    () => validateClientFiscalGate(row),
    (err: unknown) => {
      assert.ok(err instanceof MutationError);
      assert.match((err as MutationError).message, /RUC o documento de identidad/);
      return true;
    }
  );
});

test("receptor 01 con client_type NULL FALLA (caso FAC-REI-000039 / CLI-116)", () => {
  const row = { ...receptor01SinUbicacion(), client_type: null };
  assert.throws(
    () => validateClientFiscalGate(row),
    (err: unknown) => {
      assert.ok(err instanceof MutationError);
      assert.equal((err as MutationError).status, 400);
      assert.match((err as MutationError).message, /tipo de contribuyente/);
      return true;
    }
  );
});

test("receptor 03 (gobierno) con client_type NULL FALLA", () => {
  const row = { ...receptor01SinUbicacion(), tipo_receptor_fe: "03", client_type: null };
  assert.throws(
    () => validateClientFiscalGate(row),
    (err: unknown) => {
      assert.ok(err instanceof MutationError);
      assert.equal((err as MutationError).status, 400);
      assert.match((err as MutationError).message, /tipo de contribuyente/);
      return true;
    }
  );
});

test("receptor 04 (extranjero) sin id_extranjero ni país FALLA", () => {
  const row: ClientRow = {
    client_status: "active",
    tipo_receptor_fe: "04",
    tax_id: null,
    ruc: null,
    digito_verificador: null,
    id_extranjero: null,
    pais_receptor: null,
  };
  assert.throws(
    () => validateClientFiscalGate(row),
    (err: unknown) => {
      assert.ok(err instanceof MutationError);
      assert.match((err as MutationError).message, /ID extranjero/);
      assert.match((err as MutationError).message, /país del receptor/);
      return true;
    }
  );
});

test("receptor sin tipo_receptor_fe FALLA", () => {
  const row = { ...receptor01SinUbicacion(), tipo_receptor_fe: null };
  assert.throws(
    () => validateClientFiscalGate(row),
    (err: unknown) => {
      assert.ok(err instanceof MutationError);
      assert.match((err as MutationError).message, /tipo de receptor FE/);
      return true;
    }
  );
});

test("cliente inactivo FALLA con mensaje de activación", () => {
  const row = { ...receptor01SinUbicacion(), client_status: "prospect" };
  assert.throws(
    () => validateClientFiscalGate(row),
    (err: unknown) => {
      assert.ok(err instanceof MutationError);
      assert.match((err as MutationError).message, /Activá el cliente/);
      return true;
    }
  );
});

// ---------------------------------------------------------------------------
// EMISOR — la ubicación del emisor SIGUE siendo obligatoria (loadEmisorConfig)
// ---------------------------------------------------------------------------

/** Env completo y válido del emisor. */
function emisorEnvCompleto(): Record<string, string> {
  return {
    EFACTURA_EMISOR_RUC: "1234567",
    EFACTURA_EMISOR_DV: "12",
    EFACTURA_EMISOR_TIPO_CONTRIBUYENTE: "2",
    EFACTURA_EMISOR_RAZON_SOCIAL: "Integra Legal, S.A.",
    EFACTURA_EMISOR_SUCURSAL: "0000",
    EFACTURA_EMISOR_DIRECCION: "Calle 50, Edif. Ejemplo",
    EFACTURA_EMISOR_UBICACION_CODIGO: "8-8-7",
    EFACTURA_EMISOR_CORREGIMIENTO: "Bella Vista",
    EFACTURA_EMISOR_DISTRITO: "Panamá",
    EFACTURA_EMISOR_PROVINCIA: "Panamá",
    EFACTURA_EMISOR_PUNTO_FACTURACION: "001",
    EFACTURA_I_AMB: "2",
    EFACTURA_EMISOR_CPBS_HON: "80131500",
    EFACTURA_EMISOR_CPBS_REI: "80131500",
  };
}

test("emisor con ubicación completa carga OK (control positivo)", () => {
  const cfg = loadEmisorConfig(emisorEnvCompleto());
  assert.equal(cfg.ubicacion.provincia, "Panamá");
  assert.equal(cfg.ubicacion.distrito, "Panamá");
  assert.equal(cfg.ubicacion.corregimiento, "Bella Vista");
  assert.equal(cfg.ubicacion.codigoUbicacion, "8-8-7");
});

test("emisor SIN provincia sigue FALLANDO (ubicación emisor obligatoria)", () => {
  const env = emisorEnvCompleto();
  delete env.EFACTURA_EMISOR_PROVINCIA;
  assert.throws(
    () => loadEmisorConfig(env),
    /EFACTURA_EMISOR_PROVINCIA/
  );
});

test("emisor SIN distrito sigue FALLANDO", () => {
  const env = emisorEnvCompleto();
  delete env.EFACTURA_EMISOR_DISTRITO;
  assert.throws(() => loadEmisorConfig(env), /EFACTURA_EMISOR_DISTRITO/);
});

test("emisor SIN código de ubicación sigue FALLANDO", () => {
  const env = emisorEnvCompleto();
  delete env.EFACTURA_EMISOR_UBICACION_CODIGO;
  assert.throws(() => loadEmisorConfig(env), /EFACTURA_EMISOR_UBICACION_CODIGO/);
});
