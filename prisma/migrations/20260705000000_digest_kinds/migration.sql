-- Generalize digests: multiple kinds (standup, investor) per workspace.
ALTER TABLE "ScheduledDigest" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'standup';
ALTER TABLE "ScheduledDigest" ADD COLUMN "cadence" TEXT NOT NULL DEFAULT 'daily';
ALTER TABLE "ScheduledDigest" ADD COLUMN "dayOfWeek" INTEGER NOT NULL DEFAULT 1;
DROP INDEX "ScheduledDigest_workspaceId_key";
CREATE UNIQUE INDEX "ScheduledDigest_workspaceId_kind_key" ON "ScheduledDigest"("workspaceId", "kind");
