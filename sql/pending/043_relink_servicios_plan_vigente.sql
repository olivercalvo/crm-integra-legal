-- ============================================================================
-- 043 — LOS SERVICIOS DE HONORARIOS APUNTAN AL PLAN VIGENTE
-- ============================================================================
--
-- Reunión del 09/09/2026 con RM. La demo no pudo llevar una factura de
-- honorarios al libro porque los siete servicios `HON-*` apuntan a `4101`
-- («Honorarios profesionales»), que es del plan ANTERIOR al de Josuarth y está
-- INACTIVA desde que se cargó el plan nuevo.
--
-- `asiento-factura.ts` rechaza el asiento cuando la cuenta de ingreso de un
-- servicio no existe o está inactiva, y lo hace nombrando el servicio y la
-- cuenta. Ese rechazo es correcto y NO se toca: lo que estaba mal era el dato.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- LAS CINCO QUE JOSUARTH CONFIRMÓ, Y SOLO ESAS
-- ─────────────────────────────────────────────────────────────────────────────
--   HON-COR → 400001  Derecho Corporativo
--   HON-LAB → 400003  Derecho Laboral
--   HON-CIV → 400004  Derecho Civil
--   HON-PEN → 400005  Derecho Penal
--   HON-MIG → 400007  Derecho Migratorio
--
-- 🔴 `HON-FAM` y `HON-OTROS` NO SE TOCAN. Siguen en `4101` y siguen rechazando
--    el posteo, a propósito. El bufete todavía no decidió a qué cuenta de
--    ingreso van. Mandarlos a una cuenta «parecida» convertiría una decisión
--    pendiente en un ingreso mal clasificado dentro de un libro inmutable, que
--    es exactamente lo que el rechazo de `asiento-factura.ts` existe para
--    impedir. Un error ruidoso es reversible; uno silencioso no.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- LAS 34 CUENTAS DEL PLAN VIEJO SE QUEDAN, Y SE QUEDAN INACTIVAS
-- ─────────────────────────────────────────────────────────────────────────────
-- Esta migración NO borra ni reactiva ninguna cuenta. `journal_entries` es
-- inmutable por los triggers de la `023` y sus líneas apuntan a `account_id`:
-- borrar una cuenta rompería asientos ya certificados. Hoy `4101` no tiene
-- ninguna línea de asiento (verificado el 09/09), pero la regla no depende de
-- eso — depende de que el libro no se toca.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- IDEMPOTENTE Y CON RED
-- ─────────────────────────────────────────────────────────────────────────────
-- Se puede correr dos veces sin efecto. Y ABORTA sin escribir nada si alguna
-- cuenta destino no existe o no está activa: dejar la mitad de los servicios
-- relinkeados sería peor que no empezar.
-- ============================================================================

DO $$
DECLARE
  m            RECORD;
  v_tenant     uuid;
  v_faltantes  text := '';
  v_cambiados  int  := 0;
  v_ya_ok      int  := 0;
BEGIN
  -- El mapa, en un solo lugar. Se recorre dos veces: una para verificar y otra
  -- para escribir. Verificar primero es lo que permite abortar entero.
  CREATE TEMP TABLE _relink(servicio text, cuenta text) ON COMMIT DROP;
  INSERT INTO _relink VALUES
    ('HON-COR', '400001'),
    ('HON-LAB', '400003'),
    ('HON-CIV', '400004'),
    ('HON-PEN', '400005'),
    ('HON-MIG', '400007');

  -- ---- 1) Verificación: toda cuenta destino existe, está ACTIVA y es de
  --         tipo `income`. Un servicio de honorarios que acredite algo que no
  --         es ingreso descuadraría el Estado de Resultado sin avisar.
  FOR m IN SELECT * FROM _relink LOOP
    IF NOT EXISTS (
      SELECT 1 FROM chart_of_accounts
      WHERE code = m.cuenta AND active AND account_type = 'income'
    ) THEN
      v_faltantes := v_faltantes || format('%s→%s ', m.servicio, m.cuenta);
    END IF;
  END LOOP;

  IF v_faltantes <> '' THEN
    RAISE EXCEPTION
      'ABORTADO sin escribir nada. Cuenta(s) destino inexistentes, inactivas o que no son de ingreso: %',
      v_faltantes;
  END IF;

  -- ---- 2) La escritura, por tenant.
  FOR v_tenant IN SELECT DISTINCT tenant_id FROM services_catalog LOOP
    FOR m IN SELECT * FROM _relink LOOP
      UPDATE services_catalog
         SET revenue_account = m.cuenta,
             updated_at      = NOW()
       WHERE tenant_id       = v_tenant
         AND code            = m.servicio
         AND revenue_account IS DISTINCT FROM m.cuenta;

      IF FOUND THEN
        v_cambiados := v_cambiados + 1;
        RAISE NOTICE '  % → %', m.servicio, m.cuenta;
      ELSE
        v_ya_ok := v_ya_ok + 1;
      END IF;
    END LOOP;
  END LOOP;

  RAISE NOTICE 'Relink listo: % servicio(s) actualizado(s), % ya estaba(n) bien.',
    v_cambiados, v_ya_ok;

  -- ---- 3) Lo que queda pendiente A PROPÓSITO, dicho en voz alta para que no
  --         se lea como un olvido cuando alguien revise los logs.
  FOR m IN
    SELECT s.code, s.revenue_account
      FROM services_catalog s
      LEFT JOIN chart_of_accounts c ON c.code = s.revenue_account AND c.tenant_id = s.tenant_id
     WHERE c.id IS NULL OR NOT c.active
     ORDER BY s.code
  LOOP
    RAISE NOTICE 'PENDIENTE (esperado): % sigue en % — falta la decisión del bufete.',
      m.code, m.revenue_account;
  END LOOP;
END $$;
