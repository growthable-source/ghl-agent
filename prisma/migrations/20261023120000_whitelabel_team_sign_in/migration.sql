-- AlterTable
ALTER TABLE "Workspace" ADD COLUMN     "whitelabelLogoUrl" TEXT,
ADD COLUMN     "whitelabelAccentColor" TEXT,
ADD COLUMN     "whitelabelLoginHeading" TEXT,
ADD COLUMN     "whitelabelLoginMessage" TEXT;

-- CreateTable
CREATE TABLE "WorkspaceLoginCode" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkspaceLoginCode_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WorkspaceLoginCode_workspaceId_email_createdAt_idx" ON "WorkspaceLoginCode"("workspaceId", "email", "createdAt");

-- CreateIndex
CREATE INDEX "WorkspaceLoginCode_ip_createdAt_idx" ON "WorkspaceLoginCode"("ip", "createdAt");

-- AddForeignKey
ALTER TABLE "WorkspaceLoginCode" ADD CONSTRAINT "WorkspaceLoginCode_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
