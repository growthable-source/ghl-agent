-- ShopifyShop: add refresh_token + expiresAt for the new expiring
-- offline-token model. Shopify started rejecting non-expiring tokens
-- with HTTP 403 in 2026, so every reconnect now returns a token pair.
-- Idempotent — safe to re-run.

DO $$ BEGIN
  ALTER TABLE "ShopifyShop" ADD COLUMN "refreshToken" TEXT;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "ShopifyShop" ADD COLUMN "expiresAt" TIMESTAMP(3);
EXCEPTION WHEN duplicate_column THEN NULL; END $$;
