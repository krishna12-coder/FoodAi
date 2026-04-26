/*
  # Food Photo App Schema

  ## Overview
  Sets up the core schema for a food photo submission app where:
  - Users authenticate via email OTP
  - Each user can upload up to 3 food photos
  - Uploads are tracked per email address
  - Photos are stored in a private Supabase Storage bucket

  ## New Tables
  - `user_uploads`
    - `id` (uuid, primary key) - unique upload identifier
    - `email` (text) - uploader's email address
    - `user_id` (uuid) - references auth.users
    - `file_path` (text) - storage path of the uploaded file
    - `file_name` (text) - original file name
    - `uploaded_at` (timestamptz) - timestamp of upload

  ## Storage
  - Bucket: `food-photos` (private) for storing user-uploaded images

  ## Security
  - RLS enabled on user_uploads with strict ownership policies
  - Storage policies restrict access to authenticated users only
  - Users can only read/insert their own upload records
*/

-- Create user_uploads table
CREATE TABLE IF NOT EXISTS user_uploads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  file_path text NOT NULL,
  file_name text NOT NULL,
  uploaded_at timestamptz DEFAULT now()
);

-- Enable RLS
ALTER TABLE user_uploads ENABLE ROW LEVEL SECURITY;

-- Policy: users can view only their own uploads
CREATE POLICY "Users can view own uploads"
  ON user_uploads FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- Policy: users can insert only their own uploads
CREATE POLICY "Users can insert own uploads"
  ON user_uploads FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Index for fast lookup by user
CREATE INDEX IF NOT EXISTS idx_user_uploads_user_id ON user_uploads(user_id);
CREATE INDEX IF NOT EXISTS idx_user_uploads_email ON user_uploads(email);

-- Create storage bucket for food photos
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'food-photos',
  'food-photos',
  false,
  10485760,
  ARRAY['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif']
)
ON CONFLICT (id) DO NOTHING;

-- Storage RLS: authenticated users can upload to their own folder
CREATE POLICY "Authenticated users can upload food photos"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'food-photos'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- Storage RLS: authenticated users can read their own files
CREATE POLICY "Users can read own food photos"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'food-photos'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );
