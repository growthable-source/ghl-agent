-- Back-in-stock interest signals: agent captures a customer's interest
-- in an OOS variant; webhook handler later DMs them when stock returns.
-- Idempotent — safe to re-run.

CREATE TABLE IF NOT EXISTS "ShopifyInterestSignal" (
  "id" TEXT NOT NULL,
  "shopId" TEXT NOT NULL,
  "variantId" TEXT NOT NULL,
  "channel" TEXT NOT NULL,
  "conversationId" TEXT NOT NULL,
  "productTitle" TEXT NOT NULL,
  "variantTitle" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "notifiedAt" TIMESTAMP(3),
  CONSTRAINT "ShopifyInterestSignal_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ShopifyInterestSignal_shopId_variantId_idx"
  ON "ShopifyInterestSignal"("shopId", "variantId");

CREATE INDEX IF NOT EXISTS "ShopifyInterestSignal_shopId_notifiedAt_idx"
  ON "ShopifyInterestSignal"("shopId", "notifiedAt");

DO $$ BEGIN
  ALTER TABLE "ShopifyInterestSignal"
    ADD CONSTRAINT "ShopifyInterestSignal_shopId_fkey"
    FOREIGN KEY ("shopId") REFERENCES "ShopifyShop"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
