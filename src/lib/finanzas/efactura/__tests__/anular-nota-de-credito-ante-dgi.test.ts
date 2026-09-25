/**
 * 🔒 REVERSAR UNA NC AUTORIZADA: PAC PRIMERO, `canceled`, LIBRO DESPUÉS.
 *
 *   npm test
 *
 * Hasta el 25/09/2026 «Reversar» sólo tocaba el libro: una NC autorizada
 * quedaba anulada en nuestros libros y VIVA ante la DGI. Este test congela el
 * ORDEN del orquestador nuevo, igual que `anular-factura-ante-dgi.test.ts` lo
 * hace con la factura. Un refactor que invierta dos `await` rompe estos.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { reversarNotaDeCredito } from "../orchestration/anular-nota-de-credito-ante-dgi";

Object.assign(process.env, {
  EFACTURA_EMISOR_RUC: "1234567",
  EFACTURA_EMISOR_DV: "12",
  EFACTURA_EMISOR_TIPO_CONTRIBUYENTE: "2",
  EFACTURA_EMISOR_RAZON_SOCIAL: "Integra Legal, S.A.",
  EFACTURA_EMISOR_SUCURSAL: "0000",
  EFACTURA_EMISOR_DIRECCION: "Calle 50",
  EFACTURA_EMISOR_UBICACION_CODIGO: "8-8-7",
  EFACTURA_EMISOR_CORREGIMIENTO: "Bella Vista",
  EFACTURA_EMISOR_DISTRITO: "Panamá",
  EFACTURA_EMISOR_PROVINCIA: "Panamá",
  EFACTURA_EMISOR_PUNTO_FACTURACION: "051",
  EFACTURA_I_AMB: "2",
  EFACTURA_EMISOR_CPBS_HON: "80131500",
  EFACTURA_EMISOR_CPBS_REI: "80131500",
});

const TENANT = "a0000000-0000-0000-0000-000000000001";
const USER = "b0000000-0000-0000-0000-000000000002";
const NC = "d0000000-0000-0000-0000-000000000004";
const CUFE = "FE0420000015555555552020202609250000000010512345678901234567890";
const MOTIVO_DGI = "Nota de credito emitida por error en el monto";
const AHORA = new Date("2026-09-25T12:00:00-05:00");

type Row = Record<string, unknown>;

function escenario(nc: Row) {
  const diario: string[] = [];
  const anulaciones: Row[] = [];
  const estado: { nc: Row } = { nc: { id: NC, status: "emitida", issue_date: "2026-09-25", ...nc } };

  class Q {
    private op: "select" | "insert" | "update" = "select";
    private payload: Row = {};
    constructor(private tabla: string) {}
    select() { return this; }
    insert(p: Row) { this.op = "insert"; this.payload = p; return this; }
    update(p: Row) { this.op = "update"; this.payload = p; return this; }
    eq() { return this; }
    order() { return this; }
    limit() { return this; }
    maybeSingle() { return this; }
    single() { return this; }
    then(res: (v: unknown) => void) {
      if (this.tabla === "credit_notes" && this.op === "select") return res({ data: estado.nc, error: null });
      if (this.tabla === "credit_notes" && this.op === "update") {
        diario.push(`UPDATE credit_notes fe_estado=${this.payload.fe_estado}`);
        Object.assign(estado.nc, this.payload);
        return res({ data: null, error: null });
      }
      if (this.tabla === "fe_anulaciones" && this.op === "select") {
        return res({ data: anulaciones.length ? { intento: anulaciones.length } : null, error: null });
      }
      if (this.tabla === "fe_anulaciones" && this.op === "insert") {
        diario.push(`INSERT fe_anulaciones credit_note_id intento=${this.payload.intento} resultado=${this.payload.resultado}`);
        anulaciones.push(this.payload);
        return res({ data: { id: `an-${anulaciones.length}` }, error: null });
      }
      if (this.tabla === "fe_anulaciones" && this.op === "update") {
        diario.push(`UPDATE fe_anulaciones resultado=${this.payload.resultado}`);
        return res({ data: null, error: null });
      }
      throw new Error(`caso no manejado ${this.tabla} ${this.op}`);
    }
  }
  const db = { from: (t: string) => new Q(t) };
  return { db, diario, estado };
}

const LIBRO_OK = async () => ({
  entry_id: "e", entry_number: 70, reversed_entry_number: 64, transaction_date: "2026-09-25",
  credit_note_number: "NC-000016",
  invoice: { invoice_id: "i", invoice_number: "FAC-HON-000020", credited_total: 0, balance_due: 10.7, status: "emitida" },
});

function deps(diario: string[], pac: () => unknown, libro: () => Promise<unknown> = LIBRO_OK) {
  return {
    tieneAsientoPropio: async () => true,
    anularEnPac: async () => { diario.push("POST CreateCancellation"); return pac(); },
    reversarEnElLibro: async () => { diario.push("RPC reverse_credit_note"); return libro() as never; },
  };
}

const AUTORIZADA = { fe_estado: "authorized", dgi_cufe: CUFE, dgi_fecha_autorizacion: "2026-09-25T10:22:00-05:00" };

test("🔒 NC autorizada: intento → PAC → canceled → libro, en ese orden", async () => {
  const { db, diario } = escenario(AUTORIZADA);
  const r = await reversarNotaDeCredito(db as never, db as never, TENANT, USER, NC, MOTIVO_DGI, AHORA,
    deps(diario, () => [{ codigo: "0600", mensaje: "Evento registrado con éxito" }]));
  assert.equal(r.estado, "reversada");
  assert.deepEqual(diario, [
    "INSERT fe_anulaciones credit_note_id intento=1 resultado=sin_respuesta",
    "POST CreateCancellation",
    "UPDATE fe_anulaciones resultado=anulada",
    "UPDATE credit_notes fe_estado=canceled",
    "RPC reverse_credit_note",
  ]);
});

test("🔴 la DGI rechaza: NI canceled NI libro", async () => {
  const { db, diario } = escenario(AUTORIZADA);
  const r = await reversarNotaDeCredito(db as never, db as never, TENANT, USER, NC, MOTIVO_DGI, AHORA,
    deps(diario, () => [{ codigo: "0301", mensaje: "No se pudo anular: el plazo de anulación está vencido" }]));
  assert.equal(r.estado, "rechazada_por_la_dgi");
  assert.ok(!diario.some((l) => l.startsWith("UPDATE credit_notes") || l.startsWith("RPC")), diario.join(" / "));
});

test("🔴 se cortó la red: nada fuera del intento", async () => {
  const { db, diario } = escenario(AUTORIZADA);
  const r = await reversarNotaDeCredito(db as never, db as never, TENANT, USER, NC, MOTIVO_DGI, AHORA,
    deps(diario, () => { throw new Error("ETIMEDOUT"); }));
  assert.equal(r.estado, "no_sabemos");
  assert.ok(!diario.some((l) => l.startsWith("UPDATE credit_notes") || l.startsWith("RPC")));
});

test("🔴 la DGI anuló y el libro falló: queda canceled, estado intermedio", async () => {
  const { db, diario, estado } = escenario(AUTORIZADA);
  const r = await reversarNotaDeCredito(db as never, db as never, TENANT, USER, NC, MOTIVO_DGI, AHORA,
    deps(diario, () => [{ codigo: "0600", mensaje: "ok" }], async () => { throw new Error("período cerrado"); }));
  assert.equal(r.estado, "anulada_en_dgi_falta_el_libro");
  assert.equal(estado.nc.fe_estado, "canceled");
});

test("el reintento VUELVE a preguntar al PAC antes del libro, y no reescribe canceled", async () => {
  const { db, diario } = escenario({ ...AUTORIZADA, fe_estado: "canceled" });
  const r = await reversarNotaDeCredito(db as never, db as never, TENANT, USER, NC, MOTIVO_DGI, AHORA,
    deps(diario, () => [{ codigo: "0622", mensaje: "Ya existe un evento de anulación para esta FE" }]));
  assert.equal(r.estado, "reversada");
  assert.deepEqual(diario, [
    "INSERT fe_anulaciones credit_note_id intento=1 resultado=sin_respuesta",
    "POST CreateCancellation",
    "UPDATE fe_anulaciones resultado=ya_anulada",
    "RPC reverse_credit_note",
  ]);
});

test("NC interna (sin CUFE): sólo el libro, motivo de 3 alcanza", async () => {
  const { db, diario } = escenario({ fe_estado: "no_emitida", dgi_cufe: null });
  const r = await reversarNotaDeCredito(db as never, db as never, TENANT, USER, NC, "Monto mal", AHORA,
    deps(diario, () => { throw new Error("no debería llamarse"); }));
  assert.equal(r.estado, "reversada");
  assert.deepEqual(diario, ["RPC reverse_credit_note"]);
});

test("🔴 si viaja a la DGI, el motivo exige 15 caracteres y no sale nada", async () => {
  const { db, diario } = escenario(AUTORIZADA);
  await assert.rejects(
    reversarNotaDeCredito(db as never, db as never, TENANT, USER, NC, "Monto mal", AHORA,
      deps(diario, () => [{ codigo: "0600" }])),
    (e: unknown) => (e as { status?: number }).status === 400
  );
  assert.deepEqual(diario, []);
});

test("🔒 la ruta pasa por el orquestador, nunca por reverseCreditNote directo", async () => {
  const { readFileSync } = await import("node:fs");
  const path = await import("node:path");
  const ruta = readFileSync(
    path.resolve(__dirname, "../../../../app/api/finanzas/credit-notes/[id]/reverse/route.ts"),
    "utf8"
  );
  assert.match(ruta, /reversarNotaDeCredito\(/);
  assert.doesNotMatch(ruta, /reverseCreditNote\(/);
});
