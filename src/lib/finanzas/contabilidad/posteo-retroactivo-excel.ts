/**
 * El Excel «en seco» del posteo de documentos existentes, para el contador.
 *
 * Lo tiene que entender alguien que NO conoce el CRM: la primera hoja explica
 * en palabras qué es, qué período cubre, cuánto suma y qué no entra; después
 * van los asientos línea por línea, los totales por cuenta (que cuadran) y las
 * dos listas de lo que no se contabiliza (a propósito, o por un problema que
 * hay que corregir antes).
 */

import { generarXlsx, texto, numero, fecha, entero, VACIA, type Celda, type HojaExport } from "@/lib/finanzas/reports/exportar-xlsx";
import { fechaCorta } from "@/lib/finanzas/contabilidad/inicio-contable";
import { ETIQUETA_DE_TIPO, terceroDelAsiento, totalesPorCuenta, type Plan } from "@/lib/finanzas/contabilidad/posteo-retroactivo";

const r2 = (n: number) => Math.round(n * 100) / 100;

export function hojasDelPlan(plan: Plan, generadoEl: string): HojaExport[] {
  const totales = totalesPorCuenta(plan.items);
  const debitos = r2(totales.reduce((s, t) => s + t.debito, 0));
  const creditos = r2(totales.reduce((s, t) => s + t.credito, 0));
  const nombreTercero = (it: Plan["items"][number]) => {
    const t = terceroDelAsiento(it.asiento);
    const id = t.client_id ?? t.supplier_id;
    return id ? plan.terceros[id] ?? "" : "";
  };

  const porTipo = new Map<string, number>();
  for (const it of plan.items) porTipo.set(ETIQUETA_DE_TIPO[it.tipo], (porTipo.get(ETIQUETA_DE_TIPO[it.tipo]) ?? 0) + 1);

  const leame: Celda[][] = [
    [texto("Qué es este archivo")],
    [texto(
      "Es la vista previa (en seco) de los asientos que el sistema registraría en el libro contable para los documentos de este " +
        "período que todavía no tienen asiento: facturas, notas de débito y de crédito, cobros, compras, gastos de trámite y pagos a proveedores. " +
        "Cada asiento es el mismo que el sistema arma cuando se emite o se registra el documento. Todavía NO se registró nada."
    )],
    [VACIA],
    [texto("Período"), texto(`${fechaCorta(plan.desde)} al ${fechaCorta(plan.hasta)}`)],
    [texto("Inicio contable"), texto(`${fechaCorta(plan.inicio)}. Lo anterior ya está en sus libros (QuickBooks) y no se repite acá.`)],
    [texto("Asientos"), entero(plan.items.length)],
    ...Array.from(porTipo.entries()).map(([t, n]) => [texto(`   ${t}`), entero(n)]),
    [texto("Total débitos"), numero(debitos)],
    [texto("Total créditos"), numero(creditos)],
    [texto("¿Cuadra?"), texto(Math.abs(debitos - creditos) < 0.005 ? "Sí: débitos = créditos." : "NO: revisar antes de contabilizar.")],
    [texto("No se contabilizan (a propósito)"), entero(plan.excluidos.length)],
    [texto("Con problemas (hay que corregirlos antes)"), entero(plan.problemas.length)],
    [VACIA],
    [texto("Cómo leer las hojas")],
    [texto("Asientos: una fila por línea de cada asiento, en orden de fecha. Débito y crédito en balboas.")],
    [texto("Totales por cuenta: lo que el período movería en cada cuenta.")],
    [texto("No se contabilizan: documentos que quedan fuera a propósito, con el motivo.")],
    [texto("Con problemas: documentos que no se pueden registrar hasta corregirlos (por ejemplo, un gasto sin proveedor o un cobro sin banco).")],
    [VACIA],
    [texto(plan.bloqueos.length > 0 ? "Antes de contabilizar" : "Listo para contabilizar")],
    ...(plan.bloqueos.length > 0
      ? plan.bloqueos.map((b) => [texto(`• ${b}`)])
      : [[texto("No hay nada que impida contabilizar este período tal como está.")]]),
    ...(plan.avisos.length > 0 ? [[VACIA], [texto("Avisos")], ...plan.avisos.map((a) => [texto(`• ${a}`)])] : []),
    [VACIA],
    [texto(`Generado el ${generadoEl}`)],
  ];

  const asientos: Celda[][] = [];
  plan.items.forEach((it, i) => {
    for (const l of it.asiento.lines) {
      asientos.push([
        entero(i + 1),
        texto(ETIQUETA_DE_TIPO[it.tipo]),
        texto(it.numeroPendiente ? `${it.numero} (N.º FAC-CO- se asigna al contabilizar)` : it.numero),
        fecha(it.fecha),
        texto(nombreTercero(it)),
        texto(l.account_code),
        texto(plan.cuentas[l.account_code] ?? ""),
        texto(l.description ?? it.asiento.description),
        Number(l.debit) > 0 ? numero(Number(l.debit)) : VACIA,
        Number(l.credit) > 0 ? numero(Number(l.credit)) : VACIA,
      ]);
    }
  });
  asientos.push([VACIA, VACIA, VACIA, VACIA, VACIA, VACIA, VACIA, texto("TOTAL"), numero(debitos), numero(creditos)]);

  const filasTotales: Celda[][] = totales.map((t) => [
    texto(t.cuenta),
    texto(plan.cuentas[t.cuenta] ?? ""),
    numero(t.debito),
    numero(t.credito),
    numero(r2(t.debito - t.credito)),
  ]);
  filasTotales.push([texto("TOTAL"), VACIA, numero(debitos), numero(creditos), numero(r2(debitos - creditos))]);

  const lista = (xs: Plan["excluidos"]) =>
    xs.map((x) => [texto(ETIQUETA_DE_TIPO[x.tipo]), texto(x.numero), fecha(x.fecha), texto(x.motivo)]);

  return [
    { nombre: "Léame", columnas: [{ titulo: "", ancho: 60 }, { titulo: "", ancho: 70 }], filas: leame },
    {
      nombre: "Asientos",
      encabezado: [[`Asientos del ${fechaCorta(plan.desde)} al ${fechaCorta(plan.hasta)} (en seco: todavía no registrados)`]],
      columnas: [
        { titulo: "Asiento N.º", ancho: 10 },
        { titulo: "Tipo de documento", ancho: 20 },
        { titulo: "Documento", ancho: 26 },
        { titulo: "Fecha", ancho: 12 },
        { titulo: "Cliente o proveedor", ancho: 34 },
        { titulo: "Cuenta", ancho: 10 },
        { titulo: "Nombre de la cuenta", ancho: 32 },
        { titulo: "Descripción", ancho: 48 },
        { titulo: "Débito", ancho: 14 },
        { titulo: "Crédito", ancho: 14 },
      ],
      filas: asientos,
    },
    {
      nombre: "Totales por cuenta",
      columnas: [
        { titulo: "Cuenta", ancho: 10 },
        { titulo: "Nombre de la cuenta", ancho: 36 },
        { titulo: "Débito", ancho: 14 },
        { titulo: "Crédito", ancho: 14 },
        { titulo: "Neto (débito − crédito)", ancho: 22 },
      ],
      filas: filasTotales,
    },
    {
      nombre: "No se contabilizan",
      columnas: [{ titulo: "Tipo", ancho: 20 }, { titulo: "Documento", ancho: 24 }, { titulo: "Fecha", ancho: 12 }, { titulo: "Motivo", ancho: 90 }],
      filas: lista(plan.excluidos),
    },
    {
      nombre: "Con problemas",
      columnas: [{ titulo: "Tipo", ancho: 20 }, { titulo: "Documento", ancho: 24 }, { titulo: "Fecha", ancho: 12 }, { titulo: "Qué falta", ancho: 90 }],
      filas: lista(plan.problemas),
    },
  ];
}

export function excelDelPlan(plan: Plan, generadoEl: string): Buffer {
  return generarXlsx(hojasDelPlan(plan, generadoEl));
}
