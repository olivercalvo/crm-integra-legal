/**
 * ORDEN DE LA VENTANA DE PRODUCCIÓN — fuente única del ensayo y del runbook.
 *
 * Lo consume `scripts/ensayo-ventana/ensayo.mjs`. El runbook
 * (`docs/finanzas/runbooks/ventana-bloque-1.md`) copia estas listas: si se
 * cambia una, se cambian las dos y se vuelve a ensayar.
 *
 * Producción hoy (05/10/2026): `main` en 24b227a (cola hasta la 024) + la 084
 * (hotfix aplicado a mano el 03/10). Marcador del corte: no existe
 * `chart_of_accounts.cuenta_control` (la crea la 025).
 */

import { BUNDLE_1, BUNDLE_2 } from "../staging-migration-order.mjs";

/** El commit de `main` que está en producción. Los archivos de la base se leen de ahí. */
export const COMMIT_PRODUCCION = "24b227a";

/**
 * Lo que producción tiene aplicado, en el orden en que lo arma staging, hasta
 * la 024 inclusive. Más `storage_rls_tenant_scoped.sql` (políticas por bufete
 * del bucket; producción las tiene, ver P-4 del runbook viejo).
 * Fuera: los seeds de datos reales (Ley 81), las limpiezas de datos (001, 018)
 * y la 022 (decisión explícita: no se aplica).
 */
const CORTE = BUNDLE_2.indexOf("sql/pending/025_niif18_tipo_costo_y_subcategorias.sql");
export const BASE_PRODUCCION = [
  ...BUNDLE_1,
  ...BUNDLE_2.slice(0, CORTE),
  "sql/pending/storage_rls_tenant_scoped.sql",
];

/** Aplicada en producción el 03/10/2026, sobre la 024. Idéntica en 9b00b12 y hoy. */
export const HOTFIX_PRODUCCION = ["sql/pending/084_audit_log_solo_agregar.sql"];

const p = (n) => `sql/pending/${n}`;

/**
 * BLOQUE A — con la app de `main` arriba. Ninguna altera lo que `main` muestra.
 * Tal cual el runbook despliegue-025-055.md §3.
 */
export const BLOQUE_A = [
  "026_cuenta_distribucion_socias", "027_saldo_inicial_fecha",
  "028_fase2_motor_posteo", "029_restaurar_check_reversion", "030_ledger_permisos_y_periodos",
  "031_bucket_documents_privado", "032_amount_paid_derivado", "033_proveedores_entidad",
  "034_asiento_unico_por_documento", "036_expense_lines", "038_gasto_tramite_al_ledger",
  "039_asientos_manuales", "041_banco_del_cobro", "042_pago_proveedor_source_type",
  "044_gasto_numero_factura_proveedor", "046_reversion_de_cobro", "047_recibo_de_caja",
  "051_nota_de_credito_contable", "052_anulacion_con_reversion_y_nc", "053_anulacion_rechaza_nc_parcial",
  "054_tercero_por_linea", "055_reversion_de_asiento_manual", "057_proveedor_cuenta_por_defecto_y_contacto",
  "059_registro_de_anulaciones_ante_la_dgi", "065_fe_anulaciones_de_nota_de_credito",
  "060_reversion_de_nota_de_credito", "062_fe_emisiones_de_nota_de_credito",
  "063_anular_con_nc_reversada", "067_importacion_de_asientos",
].map((n) => p(`${n}.sql`));

/**
 * BLOQUE B — congelado (nadie emite, anula, cobra ni carga un CUFE).
 * Runbook §5, con la 025 al final. Después del 043: el paso de datos de P-15
 * («Reasignar»), que la 082 reemplaza (HON-OTROS → 400010); ver el runbook nuevo.
 */
export const BLOQUE_B = [
  "035_reembolso_a_fondos_legales", "043_relink_servicios_plan_vigente",
  "040_compras_con_lineas", "037_expense_lines_cuenta_obligatoria", "045_expense_lines_tax_code_id",
  "048_pagos_a_proveedores", "093_compra_nace_pendiente", "049_pago_de_gasto_de_tramite", "050_reversion_de_gasto_de_tramite",
  "066_nc_de_compra", "058_motivo_de_anulacion_minimo_15", "061_cufe_cargado_a_mano",
  "064_cufe_origen_no_nulo", "025_niif18_tipo_costo_y_subcategorias",
].map((n) => p(`${n}.sql`));

/**
 * BLOQUE C — también congelado, inmediatamente después de la 025 y antes del
 * merge. Del Bloque 1 (E1 a E11) y lo posterior. Van DESPUÉS del B porque:
 *   · la 069 reescribe RPC de la 048, la 050 y la 066;
 *   · la 079 (subcategorías) parte de las de la 025;
 *   · la 071 no es compatible con el código de `main` (va con el merge).
 * La 084 ya está en producción: entra igual y no cambia nada (idempotente).
 * La 094 (marca de prueba por documento) va al final: después de ella, el paso
 * de datos sql/ventana/marcar-datos-de-prueba.sql (ensayo: fase `marcar-pruebas`).
 * La 056 está reservada (saldos iniciales, P-2(b)) y no existe.
 */
export const BLOQUE_C = [
  "068_fechas_de_registro", "069_reversion_con_fecha_elegida", "070_gasto_tramite_factura_proveedor",
  "071_motor_v4_referencias_y_terceros", "072_hash_v5_y_verificador", "073_tasa_con_cuenta",
  "074_cobro_con_excedente", "075_ancla_de_la_cadena", "076_nc_modulo_propio", "077_nota_de_debito",
  "078_parametros_del_bufete_isr", "079_subcategorias_y_cuentas_nuevas", "080_cierre_anual",
  "081_correcciones_076_y_079", "082_otros_servicios_y_nc_sin_bancos", "083_fe_estado_interna",
  "084_audit_log_solo_agregar", "085_motivo_pendiente_dgi", "092_factura_emitida_fuera",
  "094_documentos_de_prueba",
].map((n) => p(`${n}.sql`));

/** Ventana APARTE, después de la del Bloque 1. La 088 (legado) no va todavía. */
export const BITACORAS = [
  "086_bitacoras_nucleo", "087_bitacoras_captura", "089_bitacoras_documento_de_casos",
  "090_bitacoras_orden_de_candados", "091_bitacoras_error_claro",
].map((n) => p(`${n}.sql`));

/**
 * La verificación que acompaña a cada migración (todas son BEGIN … ROLLBACK).
 * Clave: el archivo de la migración DESPUÉS del cual se corre.
 */
export const VERIFICACIONES = {
  [p("038_gasto_tramite_al_ledger.sql")]: ["sql/tests/verificacion-038-inmutabilidad.sql"],
  [p("039_asientos_manuales.sql")]: ["sql/tests/verificacion-039-manual.sql"],
  [p("045_expense_lines_tax_code_id.sql")]: ["sql/tests/verificacion-045-tax-code-id.sql"],
  [p("046_reversion_de_cobro.sql")]: ["sql/tests/verificacion-046-reversion-cobro.sql"],
  [p("047_recibo_de_caja.sql")]: ["sql/tests/verificacion-047-recibo-de-caja.sql"],
  [p("048_pagos_a_proveedores.sql")]: ["sql/tests/verificacion-048-pagos-a-proveedores.sql"],
  [p("093_compra_nace_pendiente.sql")]: ["sql/tests/verificacion-093-compra-nace-pendiente.sql"],
  [p("049_pago_de_gasto_de_tramite.sql")]: ["sql/tests/verificacion-049-pago-de-gasto-de-tramite.sql"],
  [p("050_reversion_de_gasto_de_tramite.sql")]: ["sql/tests/verificacion-050-reversion-de-gasto-de-tramite.sql"],
  [p("051_nota_de_credito_contable.sql")]: ["sql/tests/verificacion-051-nota-de-credito.sql"],
  [p("052_anulacion_con_reversion_y_nc.sql")]: ["sql/tests/verificacion-052-anulacion-con-reversion.sql"],
  [p("053_anulacion_rechaza_nc_parcial.sql")]: ["sql/tests/verificacion-053-anulacion-con-nc-parcial.sql"],
  [p("054_tercero_por_linea.sql")]: ["sql/tests/verificacion-054-tercero-por-linea.sql"],
  [p("055_reversion_de_asiento_manual.sql")]: ["sql/tests/verificacion-055-reversion-de-asiento.sql"],
  [p("057_proveedor_cuenta_por_defecto_y_contacto.sql")]: ["sql/tests/verificacion-057-proveedor-campos.sql"],
  [p("058_motivo_de_anulacion_minimo_15.sql")]: ["sql/tests/verificacion-058-motivo-anulacion.sql"],
  [p("059_registro_de_anulaciones_ante_la_dgi.sql")]: ["sql/tests/verificacion-059-registro-anulaciones.sql"],
  [p("060_reversion_de_nota_de_credito.sql")]: ["sql/tests/verificacion-060-reversion-nota-de-credito.sql"],
  [p("063_anular_con_nc_reversada.sql")]: ["sql/tests/verificacion-063-anular-con-nc-reversada.sql"],
  [p("066_nc_de_compra.sql")]: ["sql/tests/verificacion-066-nc-de-compra.sql"],
  // La de la 067 usa chart_of_accounts.cuenta_control, que crea la 025 (al final
  // del B): pegada a la 067 falla. Ensayo del 05/10/2026.
  [p("025_niif18_tipo_costo_y_subcategorias.sql")]: ["sql/tests/verificacion-067-importacion-de-asientos.sql"],
  [p("069_reversion_con_fecha_elegida.sql")]: ["sql/tests/verificacion-068-069-fecha-de-registro.sql"],
  [p("071_motor_v4_referencias_y_terceros.sql")]: ["sql/tests/verificacion-071-motor-v4.sql"],
  [p("072_hash_v5_y_verificador.sql")]: ["sql/tests/verificacion-072-hash-v5-verificador.sql"],
  [p("074_cobro_con_excedente.sql")]: ["sql/tests/verificacion-073-074.sql"],
  [p("075_ancla_de_la_cadena.sql")]: ["sql/tests/verificacion-075-ancla.sql"],
  [p("076_nc_modulo_propio.sql")]: ["sql/tests/verificacion-076-nc-modulo.sql"],
  [p("077_nota_de_debito.sql")]: ["sql/tests/verificacion-077-nota-de-debito.sql"],
  [p("078_parametros_del_bufete_isr.sql")]: ["sql/tests/verificacion-078-parametros-isr.sql"],
  [p("079_subcategorias_y_cuentas_nuevas.sql")]: ["sql/tests/verificacion-079-plan-de-cuentas.sql"],
  [p("080_cierre_anual.sql")]: ["sql/tests/verificacion-080-cierre-anual.sql"],
  [p("082_otros_servicios_y_nc_sin_bancos.sql")]: ["sql/tests/verificacion-082-otros-servicios-y-bancos.sql"],
  [p("083_fe_estado_interna.sql")]: ["sql/tests/verificacion-083-fe-estado-interna.sql"],
  [p("094_documentos_de_prueba.sql")]: ["sql/tests/verificacion-094-documentos-de-prueba.sql"],
  [p("084_audit_log_solo_agregar.sql")]: ["sql/tests/verificacion-084-audit-log-solo-agregar.sql"],
};
