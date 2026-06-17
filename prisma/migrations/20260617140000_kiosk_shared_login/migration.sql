-- Shared-login kiosk operators. Lets a team run multiple live-chat
-- operators off one shared terminal without each needing their own
-- email/OAuth login. Each operator identity is still a real User +
-- WorkspaceMember(role 'agent'); these tables only add the shared-PIN
-- door + per-operator PIN. Fully additive + idempotent.

CREATE TABLE IF NOT EXISTS "KioskCredential" (
  "id"             TEXT NOT NULL,
  "workspaceId"    TEXT NOT NULL,
  "secretHash"     TEXT NOT NULL,
  "lastFour"       TEXT,
  "createdBy"      TEXT NOT NULL,
  "disabledAt"     TIMESTAMP(3),
  "failedAttempts" INTEGER NOT NULL DEFAULT 0,
  "lockedUntil"    TIMESTAMP(3),
  "rotatedAt"      TIMESTAMP(3),
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "KioskCredential_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "KioskCredential_workspaceId_fkey" FOREIGN KEY ("workspaceId")
    REFERENCES "Workspace"("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "KioskCredential_workspaceId_key"
  ON "KioskCredential"("workspaceId");

CREATE TABLE IF NOT EXISTS "KioskOperator" (
  "id"             TEXT NOT NULL,
  "workspaceId"    TEXT NOT NULL,
  "userId"         TEXT NOT NULL,
  "pinHash"        TEXT NOT NULL,
  "displayName"    TEXT NOT NULL,
  "disabledAt"     TIMESTAMP(3),
  "createdBy"      TEXT NOT NULL,
  "failedAttempts" INTEGER NOT NULL DEFAULT 0,
  "lockedUntil"    TIMESTAMP(3),
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "KioskOperator_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "KioskOperator_workspaceId_fkey" FOREIGN KEY ("workspaceId")
    REFERENCES "Workspace"("id") ON DELETE CASCADE,
  CONSTRAINT "KioskOperator_userId_fkey" FOREIGN KEY ("userId")
    REFERENCES "User"("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "KioskOperator_userId_key"
  ON "KioskOperator"("userId");
CREATE INDEX IF NOT EXISTS "KioskOperator_workspaceId_idx"
  ON "KioskOperator"("workspaceId");
