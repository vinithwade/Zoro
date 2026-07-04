import "server-only";
import { db } from "@/lib/db";
import { detectBlockerCandidates, type EventLite } from "@/lib/ai/blocker-rules";
import { getStoredMetrics, formatMoney } from "@/lib/stripe/metrics";

const WINDOW_DAYS = 30;

type Health = "green" | "yellow" | "red" | null;

type SummaryContent = {
  summary: string;
  health: "green" | "yellow" | "red";
  blockers: { title: string; severity: string; explanation: string }[];
  decisionsNeeded: { question: string; context: string }[];
};

export type DashboardData = {
  connected: boolean;
  githubConnected: boolean;
  slackConnected: boolean;
  stripeConnected: boolean;
  mrr: string | null;
  stats: {
    openPRs: number;
    failingCI: number;
    blockers: number;
    messages: number;
    pendingApprovals: number;
  };
  health: Health;
  engineering: { text: string; createdAt: Date } | null;
  communication: { text: string; createdAt: Date } | null;
  blockers: { source: "Engineering" | "Slack"; title: string; severity: string }[];
  decisions: { source: "Engineering" | "Slack"; question: string; context: string }[];
};

const SEVERITY_RANK: Record<string, number> = { high: 3, medium: 2, low: 1 };

function worseHealth(a: Health, b: Health): Health {
  const rank = { red: 3, yellow: 2, green: 1 } as const;
  const av = a ? rank[a] : 0;
  const bv = b ? rank[b] : 0;
  if (av === 0 && bv === 0) return null;
  return av >= bv ? a : b;
}

async function latestSummary(
  workspaceId: string,
  department: string,
): Promise<{ content: SummaryContent; createdAt: Date } | null> {
  const row = await db.sessionSummary.findFirst({
    where: { workspaceId, department },
    orderBy: { createdAt: "desc" },
  });
  if (!row) return null;
  return { content: row.content as SummaryContent, createdAt: row.createdAt };
}

export async function getDashboardData(workspaceId: string): Promise<DashboardData> {
  const [github, slack, stripe, metrics] = await Promise.all([
    db.integration.findUnique({
      where: { workspaceId_provider: { workspaceId, provider: "github" } },
    }),
    db.integration.findUnique({
      where: { workspaceId_provider: { workspaceId, provider: "slack" } },
    }),
    db.integration.findUnique({
      where: { workspaceId_provider: { workspaceId, provider: "stripe" } },
    }),
    getStoredMetrics(workspaceId),
  ]);

  const since = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const engEvents = await db.event.findMany({
    where: { workspaceId, department: "engineering", occurredAt: { gte: since } },
    select: { id: true, type: true, entityRef: true, entityType: true, title: true, importance: true, occurredAt: true },
  });

  const prState = new Map<string, { opened: boolean; closed: boolean }>();
  for (const e of engEvents) {
    if (!e.entityRef || !e.type.startsWith("pr.")) continue;
    const s = prState.get(e.entityRef) ?? { opened: false, closed: false };
    if (e.type === "pr.opened") s.opened = true;
    if (e.type === "pr.merged" || e.type === "pr.closed") s.closed = true;
    prState.set(e.entityRef, s);
  }
  const openPRs = [...prState.values()].filter((s) => s.opened && !s.closed).length;
  const candidates = detectBlockerCandidates(engEvents as EventLite[]);
  const failingCI = candidates.filter((c) => c.kind === "ci_failing").length;

  const messages = await db.event.count({
    where: { workspaceId, department: "communication", occurredAt: { gte: since } },
  });
  const pendingApprovals = await db.proposedAction.count({
    where: { workspaceId, status: "pending" },
  });

  const [eng, comm] = await Promise.all([
    latestSummary(workspaceId, "engineering"),
    latestSummary(workspaceId, "communication"),
  ]);

  // Merge blockers + decisions across both departments, tagged with a source.
  const blockers = [
    ...(eng?.content.blockers ?? []).map((b) => ({ source: "Engineering" as const, title: b.title, severity: b.severity })),
    ...(comm?.content.blockers ?? []).map((b) => ({ source: "Slack" as const, title: b.title, severity: b.severity })),
  ]
    .sort((a, b) => (SEVERITY_RANK[b.severity] ?? 0) - (SEVERITY_RANK[a.severity] ?? 0))
    .slice(0, 5);

  const decisions = [
    ...(eng?.content.decisionsNeeded ?? []).map((d) => ({ source: "Engineering" as const, question: d.question, context: d.context })),
    ...(comm?.content.decisionsNeeded ?? []).map((d) => ({ source: "Slack" as const, question: d.question, context: d.context })),
  ].slice(0, 4);

  const blockerCount =
    (eng?.content.blockers.length ?? (github ? candidates.length : 0)) +
    (comm?.content.blockers.length ?? 0);

  return {
    connected: !!github || !!slack || !!stripe,
    githubConnected: !!github,
    slackConnected: !!slack,
    stripeConnected: !!stripe,
    mrr: metrics ? formatMoney(metrics.mrr, metrics.currency) : null,
    stats: { openPRs, failingCI, blockers: blockerCount, messages, pendingApprovals },
    health: worseHealth(eng?.content.health ?? null, comm?.content.health ?? null),
    engineering: eng ? { text: eng.content.summary, createdAt: eng.createdAt } : null,
    communication: comm ? { text: comm.content.summary, createdAt: comm.createdAt } : null,
    blockers,
    decisions,
  };
}
