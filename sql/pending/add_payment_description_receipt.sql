-- Add description, receipt_url, receipt_filename columns to client_payments
-- These enable payment editing (description field) and receipt attachments
-- Safe to run: only adds nullable columns, no data modification

ALTER TABLE client_payments
  ADD COLUMN IF NOT EXISTS description TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS receipt_url TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS receipt_filename TEXT DEFAULT NULL;
