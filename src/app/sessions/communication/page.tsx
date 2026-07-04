import Link from "next/link";
import { PageHeader, EmptyState } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { EventFeed } from "@/components/event-feed";
import { SessionAnalysis } from "@/components/session-analysis";
import { db, getDefaultWorkspace } from "@/lib/db";

async function isSlackConnected(): Promise<boolean> {
  const ws = await getDefaultWorkspace();
  const integration = await db.integration.findUnique({
    where: { workspaceId_provider: { workspaceId: ws.id, provider: "slack" } },
  });
  return !!integration;
}

export default async function CommunicationSessionPage() {
  const connected = await isSlackConnected();

  return (
    <div>
      <PageHeader
        title="Communication"
        subtitle="AI summary, blockers, and the live Slack feed."
      />
      <div className="px-8 py-6">
        {!connected ? (
          <EmptyState
            title="Slack isn't connected yet"
            description="Connect a Slack workspace to stream conversations into Zoro and surface blockers from what your team is saying."
          >
            <Link href="/connect">
              <Button>Connect Slack</Button>
            </Link>
          </EmptyState>
        ) : (
          <div className="mx-auto max-w-3xl space-y-6">
            <SessionAnalysis department="communication" />
            <div className="rounded-lg border border-border bg-surface">
              <div className="flex h-9 items-center gap-2 border-b border-border px-3">
                <span className="text-[13px] font-medium">Live messages</span>
              </div>
              <div className="p-1">
                <EventFeed department="communication" />
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
