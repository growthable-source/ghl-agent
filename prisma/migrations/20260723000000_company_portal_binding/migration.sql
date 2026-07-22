-- CreateTable
CREATE TABLE "CompanyPortalBinding" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "portalUrl" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompanyPortalBinding_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CompanyPortalBinding_companyId_key" ON "CompanyPortalBinding"("companyId");
