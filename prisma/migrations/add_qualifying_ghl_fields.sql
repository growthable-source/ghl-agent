-- Migration: Add GHL field mapping columns to QualifyingQuestion
ALTER TABLE "QualifyingQuestion"
  ADD COLUMN IF NOT EXISTS "ghlFieldKey" TEXT,
  ADD COLUMN IF NOT EXISTS "overwrite" BOOLEAN NOT NULL DEFAULT false;
