-- ============================================================================
-- 092 · «Registrar factura emitida fuera»: una factura que la DGI ya autorizó
--        desde otro punto (QuickBooks 050, portal 100) entra al CRM con su CUFE
-- ============================================================================
-- Pedido de Oliver (05/10/2026), sobre docs/finanzas/propuesta-facturas-emitidas-fuera.md.
-- Casos que la motivan: las 3 del punto 100 que no están en el CRM (MEI Tower 1C
-- y 2B del 14/07, Mi Condado del 01/08) y, si Josuarth lo prefiere a su
-- importación, los 7 de QuickBooks del 01 al 03/07.
--
-- Qué deja la migración:
--   1. dgi_cufe_origen admite 'externo' (además de 'crm' y 'portal_050').
--   2. 🔴 UN CUFE, UNA FACTURA: índice único por bufete sobre el CUFE
--      normalizado. Vale para todos los orígenes: lo que devolvió el PAC (051),
--      lo cargado a mano (portal_050 y la tarjeta DGI vieja) y lo externo.
--      Pre-flight: si hoy hay un CUFE repetido, la migración aborta y lo lista.
--   3. Serie propia FAC-EXT- (secuencia 'invoice_ext'). FAC-HON- y FAC-REI-
--      siguen siendo «lo que emitió el CRM» y cruzan 1 a 1 con el 051.
--   4. 🔴 RPC register_external_invoice: número, factura, líneas, asiento y CUFE
--      en UNA transacción. Si algo falla, no queda nada: ni factura, ni
--      asiento, ni hueco en FAC-EXT-. Nunca habla con el PAC y nunca toca el
--      correlativo del 051 (fe_secuencias). La base VUELVE A LEER el CUFE
--      (tipo, fecha, número, punto, ambiente) y rechaza si no coincide con lo
--      cargado, y rechaza si la base y el ITBMS no son los del documento
--      autorizado. El asiento lo arma la app (construirAsientoDeFactura) y la
--      base lo VERIFICA cuenta por cuenta contra las líneas.
--   5. 🔴 Guard: una factura sólo llega a 'externo' por ese RPC, y una vez ahí
--      su CUFE, punto, número y estado fiscal NO cambian. fe_estado queda en
--      'no_emitida' para siempre: el orquestador no puede pasarla a 'pending',
--      que es el primer paso de todo envío al PAC.
--
-- Estructura del CUFE (66 caracteres), verificada contra los 238 documentos del
-- facturador del 05/10 (03_Documentos/facturador-2026-01-01-a-2026-10-05.xlsx):
--   FE | tipo(2) | tipoRuc(1) | RUC(20) | DV(3) | sucursal(4) | AAAAMMDD(8) |
--   número(10) | punto(3) | tipoEmisión(2) | ambiente(1) | seguridad(9) | dv(1)
--   posiciones 1-based: tipo 3, fecha 33, número 41, punto 51, ambiente 56.
--   La MISMA lectura vive en src/lib/finanzas/efactura/cufe/leer-cufe.ts.
--
-- 🛡️ Sólo staging hasta el «aplica» de Oliver. En producción va en la ventana.
-- ============================================================================
BEGIN;

-- ── 0. Pre-flight: ningún CUFE repetido hoy ─────────────────────────────────
DO $$
DECLARE
  v_rep text;
BEGIN
  SELECT string_agg(format('%s (%s)', c, facturas), '; ')
    INTO v_rep
    FROM (
      SELECT upper(btrim(dgi_cufe)) AS c, string_agg(invoice_number, ', ' ORDER BY invoice_number) AS facturas
        FROM public.invoices
       WHERE dgi_cufe IS NOT NULL AND btrim(dgi_cufe) <> ''
       GROUP BY tenant_id, upper(btrim(dgi_cufe))
      HAVING count(*) > 1
    ) d;
  IF v_rep IS NOT NULL THEN
    RAISE EXCEPTION '092: hay CUFE repetidos entre facturas, no se crea el índice único: %', v_rep;
  END IF;
END $$;

-- ── 1. Origen 'externo' ─────────────────────────────────────────────────────
ALTER TABLE public.invoices DROP CONSTRAINT IF EXISTS invoices_dgi_cufe_origen_check;
ALTER TABLE public.invoices ADD CONSTRAINT invoices_dgi_cufe_origen_check
  CHECK (
    (dgi_cufe IS NULL AND dgi_cufe_origen IS NULL)
    OR (dgi_cufe IS NOT NULL AND dgi_cufe_origen IS NOT NULL
        AND dgi_cufe_origen IN ('crm', 'portal_050', 'externo'))
  );

-- ── 2. Un CUFE, una factura ─────────────────────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS invoices_cufe_unico
  ON public.invoices (tenant_id, upper(btrim(dgi_cufe)))
  WHERE dgi_cufe IS NOT NULL;

-- ── 3. Serie FAC-EXT- ───────────────────────────────────────────────────────
ALTER TABLE public.numbering_sequences DROP CONSTRAINT IF EXISTS numbering_sequences_sequence_type_check;
ALTER TABLE public.numbering_sequences ADD CONSTRAINT numbering_sequences_sequence_type_check
  CHECK (sequence_type = ANY (ARRAY['quote'::text, 'invoice_hon'::text, 'invoice_reim'::text, 'credit_note'::text,
    'client'::text, 'supplier'::text, 'payment'::text, 'supplier_payment'::text, 'supplier_credit_note'::text,
    'purchase'::text, 'manual_entry'::text, 'debit_note'::text, 'invoice_ext'::text]));

INSERT INTO public.numbering_sequences (tenant_id, sequence_type, last_number)
SELECT tn.id, 'invoice_ext', 0 FROM public.tenants tn
 WHERE NOT EXISTS (SELECT 1 FROM public.numbering_sequences ns
                    WHERE ns.tenant_id = tn.id AND ns.sequence_type = 'invoice_ext');

-- ── 5. Guard de la factura externa ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.finanzas_factura_externa_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_por_el_rpc boolean := coalesce(current_setting('finanzas.registro_externo', true), '') = 'on';
BEGIN
  -- Nadie llega a 'externo' si no es por register_external_invoice.
  IF TG_OP = 'INSERT' THEN
    IF NEW.dgi_cufe_origen = 'externo' AND NOT v_por_el_rpc THEN
      RAISE EXCEPTION 'Una factura emitida fuera del CRM sólo se registra con «Registrar factura emitida fuera».'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.dgi_cufe_origen = 'externo' AND OLD.dgi_cufe_origen IS DISTINCT FROM 'externo' AND NOT v_por_el_rpc THEN
    RAISE EXCEPTION 'Una factura emitida fuera del CRM sólo se registra con «Registrar factura emitida fuera».'
      USING ERRCODE = 'check_violation';
  END IF;

  IF OLD.dgi_cufe_origen = 'externo' THEN
    IF NEW.dgi_cufe                   IS DISTINCT FROM OLD.dgi_cufe
       OR NEW.dgi_cufe_origen         IS DISTINCT FROM OLD.dgi_cufe_origen
       OR NEW.punto_facturacion       IS DISTINCT FROM OLD.punto_facturacion
       OR NEW.numero_documento        IS DISTINCT FROM OLD.numero_documento
       OR NEW.fe_estado               IS DISTINCT FROM OLD.fe_estado
       OR NEW.i_amb                   IS DISTINCT FROM OLD.i_amb
       OR NEW.dgi_numero_documento    IS DISTINCT FROM OLD.dgi_numero_documento
       OR NEW.dgi_protocolo_autorizacion IS DISTINCT FROM OLD.dgi_protocolo_autorizacion
       OR NEW.ef_invoice_uuid         IS DISTINCT FROM OLD.ef_invoice_uuid THEN
      RAISE EXCEPTION 'La factura % se emitió fuera del CRM: su CUFE, su punto, su número y su estado ante la DGI no se modifican, y no se envía a la DGI.',
        OLD.invoice_number
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_factura_externa_guard ON public.invoices;
CREATE TRIGGER trg_factura_externa_guard
  BEFORE INSERT OR UPDATE ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.finanzas_factura_externa_guard();

-- ── 4. El RPC ───────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.register_external_invoice(
  p_tenant_id        uuid,
  p_client_id        uuid,
  p_invoice_kind     text,       -- HONORARIOS (tipo 01) | REEMBOLSO (tipo 09)
  p_case_id          uuid,
  p_issue_date       date,       -- fecha del DOCUMENTO: la del CUFE
  p_accounting_date  date,       -- fecha de REGISTRO, elegida
  p_due_date         date,
  p_notes            text,
  p_cufe             text,
  p_punto            text,       -- lo que se cargó; se compara con el CUFE
  p_numero_documento bigint,     -- ídem
  p_base_autorizada  numeric,    -- «Monto total» del documento autorizado (sin ITBMS)
  p_itbms_autorizado numeric,
  p_lineas           jsonb,      -- [{service_id, description, quantity, unit_price, tax_code_id, tax_code, tax_rate}]
  p_asiento          jsonb,      -- líneas de construirAsientoDeFactura; «{numero}» se reemplaza por el número
  p_created_by       uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_cufe       text := upper(regexp_replace(coalesce(p_cufe, ''), '\s', '', 'g'));
  v_tipo       text;
  v_fecha_txt  text;
  v_fecha      date;
  v_numero_doc bigint;
  v_punto      text;
  v_amb        text;
  v_ya         text;
  v_cliente    text;
  v_x          jsonb;
  v_orden      int := 0;
  v_seq        int;
  v_numero     text;
  v_id         uuid;
  v_inv        record;
  v_dif        int;
  v_malas      text;
  v_asiento    jsonb;
  v_entry_id   uuid;
  v_entry_nro  bigint;
  v_ref_ext    text;
  v_tipo_esperado text;
  v_svc_esperado  text;
BEGIN
  IF p_tenant_id IS NULL OR p_client_id IS NULL THEN
    RAISE EXCEPTION 'register_external_invoice: faltan el bufete o el cliente';
  END IF;
  IF p_invoice_kind NOT IN ('HONORARIOS', 'REEMBOLSO') THEN
    RAISE EXCEPTION 'Una factura emitida fuera es de honorarios (tipo 01) o de reembolso (tipo 09).';
  END IF;
  IF p_issue_date IS NULL OR p_accounting_date IS NULL OR p_due_date IS NULL THEN
    RAISE EXCEPTION 'Faltan la fecha del documento, la de registro o el vencimiento.';
  END IF;
  IF p_lineas IS NULL OR jsonb_typeof(p_lineas) <> 'array' OR jsonb_array_length(p_lineas) = 0 THEN
    RAISE EXCEPTION 'La factura necesita al menos una línea.';
  END IF;

  -- ── El CUFE: forma ───────────────────────────────────────────────────────
  IF char_length(v_cufe) <> 66 OR left(v_cufe, 2) <> 'FE' THEN
    RAISE EXCEPTION 'El CUFE tiene que tener 66 caracteres y empezar con FE (tiene %).', char_length(v_cufe);
  END IF;

  -- ── Un CUFE, una factura (antes que el resto: es lo primero que hay que saber)
  SELECT invoice_number INTO v_ya
    FROM public.invoices
   WHERE tenant_id = p_tenant_id AND dgi_cufe IS NOT NULL AND upper(btrim(dgi_cufe)) = v_cufe
   LIMIT 1;
  IF v_ya IS NOT NULL THEN
    RAISE EXCEPTION 'Ese CUFE ya está registrado en la factura %. Un documento autorizado por la DGI entra al CRM una sola vez.', v_ya
      USING ERRCODE = 'unique_violation';
  END IF;
  SELECT credit_note_number INTO v_ya
    FROM public.credit_notes
   WHERE tenant_id = p_tenant_id AND dgi_cufe IS NOT NULL AND upper(btrim(dgi_cufe)) = v_cufe
   LIMIT 1;
  IF v_ya IS NOT NULL THEN
    RAISE EXCEPTION 'Ese CUFE es de la nota de crédito %, no de una factura.', v_ya
      USING ERRCODE = 'unique_violation';
  END IF;

  -- ── El CUFE: lo que dice adentro ─────────────────────────────────────────
  v_tipo      := substr(v_cufe, 3, 2);
  v_fecha_txt := substr(v_cufe, 33, 8);
  v_punto     := substr(v_cufe, 51, 3);
  v_amb       := substr(v_cufe, 56, 1);
  IF substr(v_cufe, 41, 10) !~ '^[0-9]{10}$' OR v_fecha_txt !~ '^[0-9]{8}$' OR v_punto !~ '^[0-9]{3}$' THEN
    RAISE EXCEPTION 'El CUFE no tiene la forma de la DGI: no se pueden leer su fecha, su número o su punto.';
  END IF;
  v_numero_doc := substr(v_cufe, 41, 10)::bigint;
  BEGIN
    v_fecha := to_date(v_fecha_txt, 'YYYYMMDD');
  EXCEPTION WHEN others THEN
    RAISE EXCEPTION 'El CUFE trae una fecha que no existe (%).', v_fecha_txt;
  END;
  IF to_char(v_fecha, 'YYYYMMDD') <> v_fecha_txt THEN
    RAISE EXCEPTION 'El CUFE trae una fecha que no existe (%).', v_fecha_txt;
  END IF;

  v_tipo_esperado := CASE p_invoice_kind WHEN 'HONORARIOS' THEN '01' ELSE '09' END;
  IF v_tipo <> v_tipo_esperado THEN
    RAISE EXCEPTION 'El CUFE es de un documento tipo % y la factura se cargó como % (tipo %).',
      v_tipo, lower(p_invoice_kind), v_tipo_esperado;
  END IF;
  IF v_fecha <> p_issue_date THEN
    RAISE EXCEPTION 'El CUFE es de un documento del % y la fecha del documento se cargó como %.',
      to_char(v_fecha, 'DD/MM/YYYY'), to_char(p_issue_date, 'DD/MM/YYYY');
  END IF;
  IF v_punto <> coalesce(p_punto, '') OR v_numero_doc IS DISTINCT FROM p_numero_documento THEN
    RAISE EXCEPTION 'El CUFE es del punto % n.º % y se cargó el punto % n.º %.',
      v_punto, v_numero_doc, coalesce(p_punto, '(vacío)'), coalesce(p_numero_documento::text, '(vacío)');
  END IF;
  IF v_punto = '051' THEN
    RAISE EXCEPTION 'Ese CUFE es del punto 051, que es el del CRM: esa factura ya la emitió el CRM, búsquela en el listado.';
  END IF;
  IF v_amb <> '1' THEN
    RAISE EXCEPTION 'Ese CUFE es del ambiente de pruebas de la DGI, no de un documento real.';
  END IF;

  -- ── El cliente ───────────────────────────────────────────────────────────
  SELECT name INTO v_cliente FROM public.clients WHERE tenant_id = p_tenant_id AND id = p_client_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cliente no encontrado.';
  END IF;

  -- ── Número, factura y líneas. El número dentro de la transacción: si algo
  --    falla después, también se deshace y no queda hueco.
  v_seq := public.get_next_sequence_number(p_tenant_id, 'invoice_ext');
  v_numero := 'FAC-EXT-' || lpad(v_seq::text, 6, '0');

  INSERT INTO public.invoices (
    tenant_id, invoice_number, invoice_kind, client_id, case_id,
    issue_date, accounting_date, due_date, status, currency, notes, created_by)
  VALUES (p_tenant_id, v_numero, p_invoice_kind, p_client_id, p_case_id,
    p_issue_date, p_accounting_date, p_due_date, 'borrador', 'USD',
    nullif(btrim(coalesce(p_notes, '')), ''), p_created_by)
  RETURNING id INTO v_id;

  FOR v_x IN SELECT * FROM jsonb_array_elements(p_lineas) LOOP
    INSERT INTO public.invoice_lines (
      tenant_id, invoice_id, line_order, service_id, description,
      quantity, unit_price, tax_code, tax_rate, tax_code_id, created_by)
    VALUES (p_tenant_id, v_id, v_orden,
      nullif(v_x->>'service_id', '')::uuid,
      btrim(coalesce(v_x->>'description', '')),
      (v_x->>'quantity')::numeric, (v_x->>'unit_price')::numeric,
      coalesce(v_x->>'tax_code', ''), coalesce((v_x->>'tax_rate')::numeric, 0),
      nullif(v_x->>'tax_code_id', '')::uuid, p_created_by);
    v_orden := v_orden + 1;
  END LOOP;

  -- Cada línea con un servicio del catálogo, de su tipo, y con su tasa del catálogo.
  v_svc_esperado := CASE p_invoice_kind WHEN 'HONORARIOS' THEN 'honorarios' ELSE 'reembolso' END;
  SELECT string_agg((il.line_order + 1)::text, ', ' ORDER BY il.line_order) INTO v_malas
    FROM public.invoice_lines il
    LEFT JOIN public.services_catalog s ON s.tenant_id = p_tenant_id AND s.id = il.service_id
   WHERE il.invoice_id = v_id
     AND (s.id IS NULL OR s.revenue_account IS NULL OR s.service_type IS DISTINCT FROM v_svc_esperado);
  IF v_malas IS NOT NULL THEN
    RAISE EXCEPTION 'Línea(s) %: cada línea necesita un servicio del catálogo de %, con su cuenta de ingreso.',
      v_malas, lower(p_invoice_kind);
  END IF;
  SELECT string_agg((il.line_order + 1)::text, ', ' ORDER BY il.line_order) INTO v_malas
    FROM public.invoice_lines il
    LEFT JOIN public.tax_codes tc ON tc.tenant_id = p_tenant_id AND tc.id = il.tax_code_id
   WHERE il.invoice_id = v_id
     AND (tc.id IS NULL OR tc.rate IS DISTINCT FROM il.tax_rate);
  IF v_malas IS NOT NULL THEN
    RAISE EXCEPTION 'Línea(s) %: la tasa de impuesto tiene que ser una del catálogo, con su porcentaje.', v_malas;
  END IF;

  -- ── Los montos del documento autorizado ──────────────────────────────────
  SELECT subtotal_total, tax_total, grand_total INTO v_inv FROM public.invoices WHERE id = v_id;
  IF v_inv.subtotal_total <> round(coalesce(p_base_autorizada, -1), 2)
     OR v_inv.tax_total <> round(coalesce(p_itbms_autorizado, -1), 2) THEN
    RAISE EXCEPTION 'Los montos no coinciden con el documento autorizado: las líneas dan base B/. % e ITBMS B/. %, y el documento dice base B/. % e ITBMS B/. %.',
      v_inv.subtotal_total, v_inv.tax_total, round(coalesce(p_base_autorizada, 0), 2), round(coalesce(p_itbms_autorizado, 0), 2);
  END IF;

  -- ── El asiento: el número en su lugar, y EXACTAMENTE el de estas líneas ──
  SELECT jsonb_agg(
           CASE WHEN x ? 'description' AND jsonb_typeof(x->'description') = 'string'
                THEN jsonb_set(x, '{description}', to_jsonb(replace(x->>'description', '{numero}', v_numero)))
                ELSE x END
           ORDER BY ord)
    INTO v_asiento
    FROM jsonb_array_elements(coalesce(p_asiento, '[]'::jsonb)) WITH ORDINALITY AS t(x, ord);

  WITH lin AS (
    SELECT round(il.subtotal, 2) AS sub, round(il.tax_amount, 2) AS tax,
           s.revenue_account AS ingreso,
           coalesce(nullif(btrim(tc.account_code), ''), '200003') AS cuenta_tax
      FROM public.invoice_lines il
      JOIN public.services_catalog s ON s.tenant_id = p_tenant_id AND s.id = il.service_id
      LEFT JOIN public.tax_codes tc ON tc.tenant_id = p_tenant_id AND tc.id = il.tax_code_id
     WHERE il.invoice_id = v_id
  ), esperado AS (
    SELECT '100004'::text AS code, round(v_inv.grand_total, 2) AS debit, 0::numeric AS credit
    UNION ALL
    SELECT ingreso, 0, sum(sub) FROM lin WHERE sub <> 0 GROUP BY ingreso
    UNION ALL
    SELECT cuenta_tax, 0, sum(tax) FROM lin WHERE tax <> 0 GROUP BY cuenta_tax
  ), esperado_neto AS (
    SELECT code, round(sum(debit), 2) AS debit, round(sum(credit), 2) AS credit FROM esperado GROUP BY code
  ), recibido AS (
    SELECT btrim(x->>'account_code') AS code,
           round(sum(coalesce((x->>'debit')::numeric, 0)), 2) AS debit,
           round(sum(coalesce((x->>'credit')::numeric, 0)), 2) AS credit
      FROM jsonb_array_elements(coalesce(v_asiento, '[]'::jsonb)) x
     GROUP BY btrim(x->>'account_code')
  )
  SELECT count(*) INTO v_dif FROM (
    (SELECT code, debit, credit FROM esperado_neto EXCEPT SELECT code, debit, credit FROM recibido)
    UNION ALL
    (SELECT code, debit, credit FROM recibido EXCEPT SELECT code, debit, credit FROM esperado_neto)
  ) d;
  IF v_dif > 0 THEN
    RAISE EXCEPTION 'El asiento no coincide con la factura (cuentas o montos distintos). No se registró nada.';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_asiento) x
              WHERE btrim(x->>'account_code') = '100004'
                AND (x->>'client_id') IS DISTINCT FROM p_client_id::text) THEN
    RAISE EXCEPTION 'La línea de cuentas por cobrar (100004) tiene que nombrar al cliente de la factura.';
  END IF;

  -- ── Posteo: mismo source_type que una factura del CRM ────────────────────
  v_ref_ext := v_punto || '-' || lpad(v_numero_doc::text, 10, '0');
  v_entry_id := public.post_journal_entry(
    p_tenant_id, p_accounting_date,
    format('Factura %s — %s', v_numero, v_cliente),
    'factura', v_asiento,
    v_id, v_cufe, NULL, NULL, p_created_by, NULL, v_numero, 'factura:' || v_id::text,
    v_ref_ext
  );
  SELECT entry_number INTO v_entry_nro FROM public.journal_entries WHERE id = v_entry_id;

  -- ── Emitida, con su CUFE. Sólo este RPC puede escribir 'externo' (guard).
  PERFORM set_config('finanzas.registro_externo', 'on', true);
  UPDATE public.invoices
     SET status = 'emitida',
         dgi_cufe = v_cufe,
         dgi_cufe_origen = 'externo',
         punto_facturacion = v_punto,
         numero_documento = v_numero_doc
   WHERE id = v_id;
  PERFORM set_config('finanzas.registro_externo', 'off', true);

  RETURN jsonb_build_object(
    'id', v_id, 'invoice_number', v_numero,
    'subtotal', v_inv.subtotal_total, 'tax', v_inv.tax_total, 'total', v_inv.grand_total,
    'punto', v_punto, 'numero_documento', v_numero_doc,
    'entry_id', v_entry_id, 'entry_number', v_entry_nro
  );
END $$;

REVOKE ALL ON FUNCTION public.register_external_invoice(uuid, uuid, text, uuid, date, date, date, text, text, text, bigint, numeric, numeric, jsonb, jsonb, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.register_external_invoice(uuid, uuid, text, uuid, date, date, date, text, text, text, bigint, numeric, numeric, jsonb, jsonb, uuid) TO service_role;

-- ── Verificación ───────────────────────────────────────────────────────────
DO $$
DECLARE
  v_n int;
BEGIN
  SELECT count(*) INTO v_n FROM public.tenants tn
   WHERE NOT EXISTS (SELECT 1 FROM public.numbering_sequences ns
                      WHERE ns.tenant_id = tn.id AND ns.sequence_type = 'invoice_ext');
  IF v_n > 0 THEN
    RAISE EXCEPTION '092: % bufete(s) sin la secuencia invoice_ext', v_n;
  END IF;
  IF to_regclass('public.invoices_cufe_unico') IS NULL THEN
    RAISE EXCEPTION '092: falta el índice único del CUFE';
  END IF;
  IF has_function_privilege('authenticated',
       'public.register_external_invoice(uuid,uuid,text,uuid,date,date,date,text,text,text,bigint,numeric,numeric,jsonb,jsonb,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION '092: register_external_invoice quedó ejecutable por authenticated';
  END IF;
  SELECT count(*) INTO v_n FROM public.invoices WHERE dgi_cufe_origen = 'externo';
  RAISE NOTICE '092 OK: serie FAC-EXT-, índice único de CUFE, guard y RPC. Facturas externas hoy: %.', v_n;
END $$;

COMMIT;
