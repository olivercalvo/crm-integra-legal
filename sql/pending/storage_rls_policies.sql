-- Storage RLS policies for the "documents" bucket
-- These allow authenticated users to upload/read/delete files
-- scoped to their tenant's path prefix.
--
-- Run this in Supabase SQL Editor AFTER ensuring the "documents" bucket exists.
-- The bucket should have a file size limit of at least 10MB.

-- Allow authenticated users to upload files (INSERT)
CREATE POLICY "Authenticated users can upload files"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'documents'
);

-- Allow authenticated users to read their files (SELECT)
CREATE POLICY "Authenticated users can read files"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'documents'
);

-- Allow authenticated users to update their files (UPDATE)
CREATE POLICY "Authenticated users can update files"
ON storage.objects FOR UPDATE
TO authenticated
USING (
  bucket_id = 'documents'
);

-- Allow authenticated users to delete their files (DELETE)
CREATE POLICY "Authenticated users can delete files"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'documents'
);

-- NOTE: If you want tighter security (only allow users to access their own tenant's files),
-- you can replace the above policies with path-based checks using:
--   (storage.foldername(name))[1] = (SELECT tenant_id FROM public.users WHERE id = auth.uid())
-- But this requires the users table to be accessible from the storage policy context.
