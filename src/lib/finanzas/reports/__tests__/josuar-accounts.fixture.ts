/**
 * FIXTURE: las 62 cuentas activas del plan de cuentas de Josuar, con su saldo de
 * apertura real, exportadas de la BD el 2026-08-14.
 *
 * Generado desde `chart_of_accounts` (active = true) — no editar a mano. Sirve
 * para verificar que los reportes dan EXACTAMENTE los mismos totales que el
 * Excel de Josuar; si alguien rompe el agrupamiento o los signos, los tests que
 * comparan contra estos números lo cazan.
 *
 * Saldos en convención de balanza: débito positivo, crédito negativo.
 */

import type { ReportAccount } from "@/lib/finanzas/reports/accounting-reports";

export const JOSUAR_ACCOUNTS: ReportAccount[] = [
  { code: "100001", name: "Banco General Operativa", account_type: "asset", subcategoria: "activo_corriente", saldo: 60700.91 },
  { code: "100002", name: "Banco General Inversiones", account_type: "asset", subcategoria: "activo_corriente", saldo: 0 },
  { code: "100003", name: "Banco General Saldo Clientes", account_type: "asset", subcategoria: "activo_corriente", saldo: 0 },
  { code: "100004", name: "Cuentas por Cobrar Clientes", account_type: "asset", subcategoria: "activo_corriente", saldo: 191947.55 },
  { code: "100005", name: "Gastos Pagados por Anticipado", account_type: "asset", subcategoria: "activo_corriente", saldo: -2200 },
  { code: "110001", name: "Mobiliario y equipo", account_type: "asset", subcategoria: "propiedad_planta_equipo", saldo: 0 },
  { code: "112001", name: "Depr. de Mobiliario y equipo", account_type: "asset", subcategoria: "propiedad_planta_equipo", saldo: 0 },
  { code: "130002", name: "Impuesto sobre la renta", account_type: "asset", subcategoria: "activo_no_corriente", saldo: 0 },
  { code: "130003", name: "Fondo Legales de Clientes", account_type: "asset", subcategoria: "activo_corriente", saldo: 2519.11 },
  { code: "130004", name: "Otros Activos", account_type: "asset", subcategoria: "activo_no_corriente", saldo: 4934.89 },
  { code: "200001", name: "Cuentas por pagar", account_type: "liability", subcategoria: "pasivo_corriente", saldo: -3400.48 },
  { code: "200002", name: "Salarios por Pagar", account_type: "liability", subcategoria: "pasivo_corriente", saldo: 0 },
  { code: "200003", name: "ITBMS por Pagar", account_type: "liability", subcategoria: "pasivo_corriente", saldo: -10025.07 },
  { code: "220001", name: "Prestamo Banco General", account_type: "liability", subcategoria: "pasivo_no_corriente", saldo: 0 },
  { code: "300001", name: "Capital Social", account_type: "equity", subcategoria: "patrimonio", saldo: 0 },
  { code: "300002", name: "Perdida Retenidas", account_type: "equity", subcategoria: "patrimonio", saldo: 0 },
  { code: "300003", name: "Utilidad del Ejercicio", account_type: "equity", subcategoria: "patrimonio", saldo: 0 },
  { code: "400001", name: "Derecho Corporativo", account_type: "income", subcategoria: "ingreso", saldo: -289800.31 },
  { code: "400002", name: "Derecho Tributario", account_type: "income", subcategoria: "ingreso", saldo: 0 },
  { code: "400003", name: "Derecho Laboral", account_type: "income", subcategoria: "ingreso", saldo: 0 },
  { code: "400004", name: "Derecho Civil", account_type: "income", subcategoria: "ingreso", saldo: 0 },
  { code: "400005", name: "Derecho Penal", account_type: "income", subcategoria: "ingreso", saldo: 0 },
  { code: "400006", name: "Derecho Administrativo", account_type: "income", subcategoria: "ingreso", saldo: 0 },
  { code: "400007", name: "Derecho Migratorio", account_type: "income", subcategoria: "ingreso", saldo: 0 },
  { code: "400008", name: "Litigios", account_type: "income", subcategoria: "ingreso", saldo: 0 },
  { code: "430001", name: "Descuentos otorgados", account_type: "income", subcategoria: "ingreso", saldo: 663.25 },
  { code: "500001", name: "Traductores Oficiales", account_type: "expense", subcategoria: "costo", saldo: 0 },
  { code: "500002", name: "Notarios", account_type: "expense", subcategoria: "costo", saldo: 0 },
  { code: "500003", name: "Mensajeria Especializada", account_type: "expense", subcategoria: "costo", saldo: 3697.98 },
  { code: "500004", name: "Honorarios Profesionales Externos", account_type: "expense", subcategoria: "costo", saldo: 0 },
  { code: "500005", name: "Costos tramites legales", account_type: "expense", subcategoria: "costo", saldo: 6180.4 },
  { code: "500006", name: "Investigadores", account_type: "expense", subcategoria: "costo", saldo: 0 },
  { code: "600001", name: "Sueldos", account_type: "expense", subcategoria: "gasto_operativo", saldo: 0 },
  { code: "600002", name: "Prestaciones Laborales", account_type: "expense", subcategoria: "gasto_operativo", saldo: 0 },
  { code: "600003", name: "Vacaciones", account_type: "expense", subcategoria: "gasto_operativo", saldo: 0 },
  { code: "600004", name: "Decimo Tercer Mes", account_type: "expense", subcategoria: "gasto_operativo", saldo: 0 },
  { code: "600005", name: "Prima de Antiguedad", account_type: "expense", subcategoria: "gasto_operativo", saldo: 0 },
  { code: "600006", name: "CSS Patronal", account_type: "expense", subcategoria: "gasto_operativo", saldo: 0 },
  { code: "600007", name: "Seguro Educativo", account_type: "expense", subcategoria: "gasto_operativo", saldo: 0 },
  { code: "600008", name: "Riesgo Profesional", account_type: "expense", subcategoria: "gasto_operativo", saldo: 0 },
  { code: "610001", name: "Alquiler", account_type: "expense", subcategoria: "gasto_operativo", saldo: 11472.78 },
  { code: "610002", name: "Honorarios Profesionales", account_type: "expense", subcategoria: "gasto_operativo", saldo: 13419.25 },
  { code: "610003", name: "Electricidad", account_type: "expense", subcategoria: "gasto_operativo", saldo: 0 },
  { code: "610004", name: "Agua", account_type: "expense", subcategoria: "gasto_operativo", saldo: 0 },
  { code: "610005", name: "Internet", account_type: "expense", subcategoria: "gasto_operativo", saldo: 0 },
  { code: "610006", name: "Telefonia", account_type: "expense", subcategoria: "gasto_operativo", saldo: 0 },
  { code: "610007", name: "Atencion al empleado", account_type: "expense", subcategoria: "gasto_operativo", saldo: 33.65 },
  { code: "610008", name: "Utiles de Oficina", account_type: "expense", subcategoria: "gasto_operativo", saldo: 4030.98 },
  { code: "610009", name: "Combustible", account_type: "expense", subcategoria: "gasto_operativo", saldo: 1100.56 },
  { code: "610010", name: "Limpieza", account_type: "expense", subcategoria: "gasto_operativo", saldo: 0 },
  { code: "610011", name: "Mantenimiento", account_type: "expense", subcategoria: "gasto_operativo", saldo: 1520.2 },
  { code: "610012", name: "Seguros", account_type: "expense", subcategoria: "gasto_operativo", saldo: 0 },
  { code: "610013", name: "Gastos administrativos", account_type: "expense", subcategoria: "gasto_operativo", saldo: 620.75 },
  { code: "610014", name: "Marketing & Publicidad", account_type: "expense", subcategoria: "gasto_operativo", saldo: 10.25 },
  { code: "610015", name: "Hosting y Dominio", account_type: "expense", subcategoria: "gasto_operativo", saldo: 0 },
  { code: "610016", name: "Biblioteca Juridica", account_type: "expense", subcategoria: "gasto_operativo", saldo: 0 },
  { code: "610017", name: "Capacitacion", account_type: "expense", subcategoria: "gasto_operativo", saldo: 0 },
  { code: "610018", name: "Gastos de viajes", account_type: "expense", subcategoria: "gasto_operativo", saldo: 316.95 },
  { code: "610019", name: "Otros gastos", account_type: "expense", subcategoria: "gasto_operativo", saldo: 1146.16 },
  { code: "620001", name: "Depreciacion", account_type: "expense", subcategoria: "gasto_operativo", saldo: 0 },
  { code: "620002", name: "Amortizacion", account_type: "expense", subcategoria: "gasto_operativo", saldo: 0 },
  { code: "700001", name: "Gastos Bancarios", account_type: "expense", subcategoria: "gasto_operativo", saldo: 1110.24 },
];
