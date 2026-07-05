-- Daily AI-spend budget + alert config.
CREATE TABLE "SpendBudget" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "dailyUsd" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "alertSlack" BOOLEAN NOT NULL DEFAULT false,
    "channel" TEXT NOT NULL DEFAULT '',
    "lastAlertedOn" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SpendBudget_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SpendBudget_workspaceId_key" ON "SpendBudget"("workspaceId");
ALTER TABLE "SpendBudget" ADD CONSTRAINT "SpendBudget_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
