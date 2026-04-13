# Variables de Entorno — Email Diario Automático

## 1. RESEND_API_KEY
- **Ya configurada en Vercel.**
- Para desarrollo local, agregar en `.env.local`:
  ```
  RESEND_API_KEY=<valor proporcionado>
  ```

## 2. CRON_SECRET
Protege el endpoint `/api/cron/daily-summary` contra acceso no autorizado.

**Valor generado:**
```
4f5ee72a6e421d3740d3c3ea47981759
```

**Agregar en:**
- **Vercel:** Settings > Environment Variables > `CRON_SECRET` = `4f5ee72a6e421d3740d3c3ea47981759`
- **Local (.env.local):**
  ```
  CRON_SECRET=4f5ee72a6e421d3740d3c3ea47981759
  ```

## 3. Enviar email de HOY manualmente

### Modo producción (envía a las abogadas):
```bash
curl -H "Authorization: Bearer 4f5ee72a6e421d3740d3c3ea47981759" \
  https://crm-integra-legal.vercel.app/api/cron/daily-summary
```

### Modo test (envía solo a oliver@clienteenelcentro.com):
```bash
curl -H "Authorization: Bearer 4f5ee72a6e421d3740d3c3ea47981759" \
  "https://crm-integra-legal.vercel.app/api/cron/daily-summary?test=true"
```

### Desarrollo local:
```bash
curl -H "Authorization: Bearer 4f5ee72a6e421d3740d3c3ea47981759" \
  "http://localhost:3000/api/cron/daily-summary?test=true"
```

## 4. Vercel Cron
El cron está configurado en `vercel.json`:
- **Schedule:** `0 14 * * 1-6` = 14:00 UTC = **9:00 AM Panamá (UTC-5)**, Lunes a Sábado
- **No se envía los domingos** (validado también en el código)
