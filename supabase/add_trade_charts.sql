-- Migration: Add chart screenshot support to trades
-- Run this in the Supabase SQL editor (Dashboard → SQL Editor → New query)

-- 1. Add chart URL columns to trades table
ALTER TABLE trades
  ADD COLUMN IF NOT EXISTS entry_chart_url text,
  ADD COLUMN IF NOT EXISTS exit_chart_url text;

-- 2. Create the trade-charts storage bucket (public read, authenticated write)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'trade-charts',
  'trade-charts',
  true,
  10485760,
  ARRAY['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
)
ON CONFLICT (id) DO NOTHING;

-- 3. Storage RLS: users can upload/manage only their own folder ({user_id}/...)
CREATE POLICY "Users can upload own trade charts"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'trade-charts' AND
    auth.uid()::text = (storage.foldername(name))[1]
  );

CREATE POLICY "Public can read trade charts"
  ON storage.objects FOR SELECT
  TO public
  USING (bucket_id = 'trade-charts');

CREATE POLICY "Users can update own trade charts"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'trade-charts' AND
    auth.uid()::text = (storage.foldername(name))[1]
  );

CREATE POLICY "Users can delete own trade charts"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'trade-charts' AND
    auth.uid()::text = (storage.foldername(name))[1]
  );
