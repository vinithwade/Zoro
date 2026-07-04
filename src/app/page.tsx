import Link from "next/link";
import {
  GitPullRequest,
  XCircle,
  AlertTriangle,
  Inbox,
  Sparkles,
  HelpCircle,
  ArrowRight,
} from "lucide-react";
import { PageHeader, EmptyState } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { StatTile } from "@/components/stat-tile";
import { getDashboardData } from "@/lib/dashboard";
import { getDefaultWorkspace } from "@/lib/db";
import { timeAgo } from "@/lib/utils";

const HEALTH: Record<string, { label: string; variant: "green" | "yellow" | "red" }> = {
  green: { label: "Healthy", variant: "green" },
  yellow: { label: "Warning", variant: "yellow" },
  red: { label: "Blocked", variant: "red" },
};

const SEVERITY: Record<string, "red" | "yellow" | "blue"> = {
  high: "red",
  medium: "yellow",
  low: "blue",
};

export default async function DashboardPage() {
  const ws = await getDefaultWorkspace();
  const data = await getDashboardData(ws.id);

  if (!data.connected) {
    return (
      <div>
        <PageHeader
          title="CEO Dashboard"
          subtitle="What's happening, what's blocked, what needs your decision."
        />
        <div className="p-8">
          <EmptyState
            title="Connect GitHub to get started"
            description="Zoro reads your repositories, builds a live activity feed, and surfaces blockers and decisions here."
          >
            <Link href="/connect">
              <Button>Connect Tools</Button>
            </Link>
          </EmptyState>
        </div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="CEO Dashboard"
        subtitle="What's happening, what's blocked, what needs your decision."
        actions={
          data.health ? (
            <Badge variant={HEALTH[data.health].variant}>
              {HEALTH[data.health].label}
            </Badge>
          ) : undefined
        }
      />
      <div className="space-y-6 px-8 py-6">
        <div className="grid grid-cols-2 divide-x divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface lg:grid-cols-4 lg:divide-y-0">
          <StatTile label="Open PRs" value={data.stats.openPRs} icon={GitPullRequest} />
          <StatTile label="Failing CI" value={data.stats.failingCI} icon={XCircle} tone="red" />
          <StatTile label="Blockers" value={data.stats.blockers} icon={AlertTriangle} tone="yellow" />
          <Link href="/approvals" className="block">
            <StatTile label="Pending approvals" value={data.stats.pendingApprovals} icon={Inbox} tone="accent" interactive />
          </Link>
        </div>

        {data.stats.pendingApprovals > 0 ? (
          <Link href="/approvals">
            <Card className="border-accent/40 bg-accent/5 transition-colors hover:bg-accent/10">
              <CardContent className="flex items-center justify-between py-4">
                <span className="text-sm">
                  <span className="font-semibold text-accent">
                    {data.stats.pendingApprovals} action
                    {data.stats.pendingApprovals === 1 ? "" : "s"}
                  </span>{" "}
                  awaiting your approval
                </span>
                <ArrowRight className="h-4 w-4 text-accent" />
              </CardContent>
            </Card>
          </Link>
        ) : null}

        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader className="flex-row items-center justify-between">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-accent" />
                <CardTitle>Engineering summary</CardTitle>
              </div>
              <Link href="/sessions/engineering" className="text-xs text-faint hover:text-foreground">
                Open session →
              </Link>
            </CardHeader>
            <CardContent>
              {data.summary ? (
                <>
                  <p className="text-sm leading-relaxed">{data.summary.text}</p>
                  <p className="mt-3 text-xs text-faint">
                    generated {timeAgo(data.summary.createdAt)}
                  </p>
                </>
              ) : (
                <p className="text-sm text-muted">
                  No AI analysis yet.{" "}
                  <Link href="/sessions/engineering" className="text-accent hover:underline">
                    Open the Engineering session
                  </Link>{" "}
                  and run an analysis.
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-red" />
                <CardTitle>Top blockers</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              {data.summary && data.summary.blockers.length > 0 ? (
                <ul className="space-y-2">
                  {data.summary.blockers.map((b, i) => (
                    <li key={i} className="flex items-center gap-2.5">
                      <Badge
                        variant={SEVERITY[b.severity] ?? "default"}
                        className="w-16 shrink-0 justify-center"
                      >
                        {b.severity}
                      </Badge>
                      <span className="text-[13px]">{b.title}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted">No blockers detected.</p>
              )}
            </CardContent>
          </Card>
        </div>

        {data.summary && data.summary.decisionsNeeded.length > 0 ? (
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <HelpCircle className="h-4 w-4 text-yellow" />
                <CardTitle>Decisions needed</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              <ul className="space-y-3">
                {data.summary.decisionsNeeded.map((d, i) => (
                  <li key={i}>
                    <p className="text-sm font-medium">{d.question}</p>
                    <p className="text-sm text-muted">{d.context}</p>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        ) : null}
      </div>
    </div>
  );
}
