-- AlterTable
ALTER TABLE "Brand" ADD COLUMN     "ticketAssigneeUserId" TEXT,
ADD COLUMN     "ticketPoolUserIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "ticketRoutingLastAssignedUserId" TEXT,
ADD COLUMN     "ticketRoutingMode" TEXT NOT NULL DEFAULT 'manual';

-- AlterTable
ALTER TABLE "TicketMessage" ADD COLUMN     "sentByPortalUserId" TEXT;

-- AlterTable
ALTER TABLE "TicketingSettings" ADD COLUMN     "defaultTicketAssigneeUserId" TEXT,
ADD COLUMN     "defaultTicketPoolUserIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "defaultTicketRoutingLastAssignedUserId" TEXT,
ADD COLUMN     "defaultTicketRoutingMode" TEXT NOT NULL DEFAULT 'manual';

-- AddForeignKey
ALTER TABLE "TicketMessage" ADD CONSTRAINT "TicketMessage_sentByPortalUserId_fkey" FOREIGN KEY ("sentByPortalUserId") REFERENCES "PortalUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;
