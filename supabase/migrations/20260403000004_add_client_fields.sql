-- =============================================
-- Migration: Add address and client_since to clients
-- Date: 2026-04-03
-- =============================================

ALTER TABLE clients ADD COLUMN IF NOT EXISTS address TEXT;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS client_since DATE;
