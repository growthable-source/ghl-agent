-- Shopify store connection per workspace (MVP: one store per workspace).
-- Strictly additive. Idempotent — safe to re-run.

CREATE TABLE IF NOT EXISTS "ShopifyShop" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "accessToken" TEXT NOT NULL,
  "scope" TEXT NOT NULL,
  "installedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "uninstalledAt" TIMESTAMP(3),
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ShopifyShop_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ShopifyShop_workspaceId_key"
  ON "ShopifyShop"("workspaceId");

DO $$ BEGIN
  ALTER TABLE "ShopifyShop"
    ADD CONSTRAINT "ShopifyShop_workspaceId_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
