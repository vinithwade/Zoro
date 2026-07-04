-- ScheduledDigest table for the automated daily Slack standup.
CREATE TABLE "ScheduledDigest" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "channel" TEXT NOT NULL DEFAULT '',
    "hour" INTEGER NOT NULL DEFAULT 9,
    "minute" INTEGER NOT NULL DEFAULT 0,
    "lastSentOn" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ScheduledDigest_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ScheduledDigest_workspaceId_key" ON "ScheduledDigest"("workspaceId");
ALTER TABLE "ScheduledDigest" ADD CONSTRAINT "ScheduledDigest_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
