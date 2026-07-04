import Link from "next/link";
import { PageHeader, EmptyState } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { EventFeed } from "@/components/event-feed";
import { SyncStatus } from "@/components/sync-status";
import { SessionAnalysis } from "@/components/session-analysis";
import { db, getDefaultWorkspace } from "@/lib/db";

async function isGithubConnected(): Promise<boolean> {
  const ws = await getDefaultWorkspace();
  const integration = await db.integration.findUnique({
    where: { workspaceId_provider: { workspaceId: ws.id, provider: "github" } },
  });
  return !!integration;
}

export default async function EngineeringSessionPage() {
  const connected = await isGithubConnected();

  return (
    <div>
      <PageHeader
        title="Engineering"
        subtitle="AI summary, blockers, and the live GitHub event feed."
      />
      <div className="px-8 py-6">
        {!connected ? (
          <EmptyState
            title="GitHub isn't connected yet"
            description="Connect a repository to start streaming engineering activity into Zoro."
          >
            <Link href="/connect">
              <Button>Connect GitHub</Button>
            </Link>
          </EmptyState>
        ) : (
          <div className="mx-auto max-w-3xl space-y-6">
            <SessionAnalysis />
            <div className="rounded-lg border border-border bg-surface">
              <div className="flex h-9 items-center gap-2 border-b border-border px-3">
                <span className="text-[13px] font-medium">Live events</span>
              </div>
              <div className="p-1">
                <EventFeed />
              </div>
              <SyncStatus />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
