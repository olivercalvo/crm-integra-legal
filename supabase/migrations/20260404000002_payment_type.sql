-- ============================================================
-- Migration: Add payment_type to client_payments
-- Allows classifying payments as 'tramite' or 'administrativo'
-- to match expense types for separate balance tracking
-- ============================================================

ALTER TABLE client_payments
  ADD COLUMN IF NOT EXISTS payment_type TEXT NOT NULL DEFAULT 'tramite';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'client_payments_payment_type_check'
  ) THEN
    ALTER TABLE client_payments ADD CONSTRAINT client_payments_payment_type_check
      CHECK (payment_type IN ('tramite', 'administrativo'));
  END IF;
END $$;
