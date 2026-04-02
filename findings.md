# FINDINGS.MD — CRM INTEGRA LEGAL

## FND-001: Datos del Excel con inconsistencias
**Fecha:** 2026-04-02
**Contexto:** Análisis del archivo REGISTRO_DE_EXPEDIENTES_OFICINA_INTEGRA_LEGAL-2026.xlsx
**Hallazgos:**
- Fechas en 4 formatos distintos: `DD/MM/YYYY`, `YYYY` (solo año), `datetime` (Python), `D/M/YYYY` (sin cero)
- Responsables con aliases y espacios trailing: `Daveiva`, `Daveiva `, `Dave`, `Dave `, `Milena `, `Mile ` → Solo 2 personas reales (Daveiva y Milena, socias)
- Tipos de cliente con inconsistencias: `Corporativo`, `Corporativo `, `corporativo `, `Regulatorio `
- Columna UBICACIÓN FÍSICA mezcla ubicación del archivero (`Archivo - Sección Clientes`) con institución (`MINSA`, `CORPORATIVO`)
- Columna COLOR completamente vacía — ligada a clasificación pero no implementada
- Filas placeholder vacías (CLI-046 a CLI-050, expedientes 47-50) con N° pero sin datos
- Solo 2 de 7 clasificaciones en uso: CORPORATIVO y REGULATORIO
- No existe columna de Institución separada en el Excel

**Impacto:** Requiere limpieza automática en la migración inicial
**Decisión:** Script de migración con normalización: trim, unificar aliases, parsear fechas, eliminar vacíos, separar institución de ubicación

---

## FND-002: Campo Ubicación Física — Pendiente de definición
**Fecha:** 2026-04-02
**Contexto:** El campo "Ubicación Física" es para localizar el expediente en el archivero/gavetero de la oficina
**Hallazgo:** Las socias aún no han definido cómo van a clasificar los gaveteros
**Decisión:** Implementar como texto libre buscable. Cuando definan su sistema de clasificación, se puede convertir en catálogo editable

---

## FND-003: Reportes específicos — Pendiente de validación
**Fecha:** 2026-04-02
**Contexto:** Se necesita funcionalidad de exportación pero no se han definido los reportes específicos
**Decisión:** Construir infraestructura genérica de exportación (PDF/Excel). Los reportes específicos se definen después de validar con las socias

---

## FND-004: Notificaciones — Fuera del MVP
**Fecha:** 2026-04-02
**Contexto:** No se implementan notificaciones (email, push, in-app) en el MVP
**Aplica a:** Gastos en rojo, tareas asignadas, fechas límite
**Decisión:** Solo indicadores visuales en dashboard. Se evalúa con las socias post-MVP si necesitan notificaciones
