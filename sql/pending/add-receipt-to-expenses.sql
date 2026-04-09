-- Add receipt/document attachment columns to expenses table
-- These columns store the reference to the uploaded receipt file in Supabase Storage
-- Both columns are nullable so existing expenses continue working without changes
-- DO NOT execute this SQL automatically — run manually after review

ALTER TABLE expenses ADD COLUMN IF NOT EXISTS receipt_url TEXT;
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS receipt_filename TEXT;
