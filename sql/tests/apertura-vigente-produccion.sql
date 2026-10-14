SELECT t.name                AS bufete,
       j.reference           AS numero_ad,
       j.entry_number        AS asiento,
       to_char(a.fecha, 'DD/MM/YYYY') AS fecha,
       a.total_debitos       AS total,
       a.lineas,
       a.file_name           AS archivo,
       to_char(a.created_at AT TIME ZONE 'America/Panama', 'DD/MM/YYYY HH24:MI') AS registrada,
       (SELECT count(*) FROM public.aperturas x WHERE x.tenant_id = a.tenant_id) AS aperturas_en_total
  FROM public.aperturas a
  JOIN public.journal_entries j ON j.id = a.entry_id
  JOIN public.tenants t ON t.id = a.tenant_id
 WHERE a.estado = 'vigente'
UNION ALL
SELECT 'SIN APERTURA VIGENTE', NULL, NULL, NULL, NULL, NULL, NULL, NULL, (SELECT count(*) FROM public.aperturas)
 WHERE NOT EXISTS (SELECT 1 FROM public.aperturas WHERE estado = 'vigente');
