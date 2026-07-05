-- Slack push preference for notifications.
CREATE TABLE "NotificationPref" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "slackEnabled" BOOLEAN NOT NULL DEFAULT false,
    "channel" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "NotificationPref_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "NotificationPref_workspaceId_key" ON "NotificationPref"("workspaceId");
ALTER TABLE "NotificationPref" ADD CONSTRAINT "NotificationPref_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
