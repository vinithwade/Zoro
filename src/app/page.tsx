import Link from "next/link";
import {
  GitPullRequest,
  XCircle,
  AlertTriangle,
  Inbox,
  MessagesSquare,
  DollarSign,
  Sparkles,
  HelpCircle,
  ArrowRight,
} from "lucide-react";
import { PageHeader, EmptyState } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { StatTile } from "@/components/stat-tile";
import { Sparkline } from "@/components/sparkline";
import { getDashboardData } from "@/lib/dashboard";
import { getDefaultWorkspace } from "@/lib/db";
import { cn, timeAgo } from "@/lib/utils";

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
            title="Connect your tools to get started"
            description="Zoro reads your GitHub and Slack, builds a live activity feed, and surfaces blockers and decisions here."
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
            <Badge variant={HEALTH[data.health].variant}>{HEALTH[data.health].label}</Badge>
          ) : undefined
        }
      />
      <div className="space-y-6 px-8 py-6">
        {data.mrr && data.revenue ? (
          <Card>
            <CardContent className="flex items-center justify-between gap-4 py-4">
              <div>
                <div className="flex items-center gap-1.5 text-xs text-muted">
                  <DollarSign className="h-3.5 w-3.5 text-faint" />
                  Monthly recurring revenue
                </div>
                <div className="mt-1 flex items-baseline gap-2">
                  <span className="text-2xl font-semibold tabular-nums">{data.mrr}</span>
                  {data.revenue.deltaPct != null ? (
                    <span className={cn("text-xs font-medium", data.revenue.up ? "text-green" : "text-red")}>
                      {data.revenue.up ? "▲" : "▼"} {Math.abs(data.revenue.deltaPct)}%
                      <span className="ml-1 text-faint">30d</span>
                    </span>
                  ) : null}
                </div>
              </div>
              <Sparkline values={data.revenue.history} up={data.revenue.up} width={200} height={48} />
            </CardContent>
          </Card>
        ) : null}

        <div className="grid grid-cols-2 divide-x divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface md:grid-cols-3 md:divide-y-0 lg:grid-cols-5">
          <StatTile label="Open PRs" value={data.stats.openPRs} icon={GitPullRequest} />
          <StatTile label="Failing CI" value={data.stats.failingCI} icon={XCircle} tone="red" />
          <StatTile label="Blockers" value={data.stats.blockers} icon={AlertTriangle} tone="yellow" />
          <StatTile label="Messages" value={data.stats.messages} icon={MessagesSquare} />
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
                    {data.stats.pendingApprovals} action{data.stats.pendingApprovals === 1 ? "" : "s"}
                  </span>{" "}
                  awaiting your approval
                </span>
                <ArrowRight className="h-4 w-4 text-accent" />
              </CardContent>
            </Card>
          </Link>
        ) : null}

        <div className="grid gap-6 lg:grid-cols-2">
          <SummaryCard
            title="Engineering"
            href="/sessions/engineering"
            summary={data.engineering}
            connected={data.githubConnected}
            connectLabel="Connect GitHub"
          />
          <SummaryCard
            title="Communication"
            href="/sessions/communication"
            summary={data.communication}
            connected={data.slackConnected}
            connectLabel="Connect Slack"
          />
        </div>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-red" />
              <CardTitle>Top blockers</CardTitle>
              <span className="text-xs text-faint">{data.blockers.length}</span>
            </div>
          </CardHeader>
          <CardContent>
            {data.blockers.length > 0 ? (
              <ul className="space-y-2">
                {data.blockers.map((b, i) => (
                  <li key={i} className="flex items-center gap-2.5">
                    <Badge variant={SEVERITY[b.severity] ?? "default"} className="w-16 shrink-0 justify-center">
                      {b.severity}
                    </Badge>
                    <span className="flex-1 text-[13px]">{b.title}</span>
                    <Badge variant={b.source === "Slack" ? "blue" : "default"}>{b.source}</Badge>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted">No blockers detected across code or comms.</p>
            )}
          </CardContent>
        </Card>

        {data.decisions.length > 0 ? (
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <HelpCircle className="h-4 w-4 text-yellow" />
                <CardTitle>Decisions needed</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              <ul className="space-y-3">
                {data.decisions.map((d, i) => (
                  <li key={i}>
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium">{d.question}</p>
                      <Badge variant={d.source === "Slack" ? "blue" : "default"}>{d.source}</Badge>
                    </div>
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

function SummaryCard({
  title,
  href,
  summary,
  connected,
  connectLabel,
}: {
  title: string;
  href: string;
  summary: { text: string; createdAt: Date } | null;
  connected: boolean;
  connectLabel: string;
}) {
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-accent" />
          <CardTitle>{title} summary</CardTitle>
        </div>
        <Link href={connected ? href : "/connect"} className="text-xs text-faint hover:text-foreground">
          {connected ? "Open session →" : "Connect →"}
        </Link>
      </CardHeader>
      <CardContent>
        {summary ? (
          <>
            <p className="text-sm leading-relaxed">{summary.text}</p>
            <p className="mt-3 text-xs text-faint">generated {timeAgo(summary.createdAt)}</p>
          </>
        ) : connected ? (
          <p className="text-sm text-muted">
            No analysis yet.{" "}
            <Link href={href} className="text-accent hover:underline">Open the session</Link> and run one.
          </p>
        ) : (
          <p className="text-sm text-muted">
            <Link href="/connect" className="text-accent hover:underline">{connectLabel}</Link> to see a summary here.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
