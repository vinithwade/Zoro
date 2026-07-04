import "server-only";
import { db } from "@/lib/db";
import { detectBlockerCandidates, type EventLite } from "@/lib/ai/blocker-rules";

const WINDOW_DAYS = 30;

export type DashboardData = {
  connected: boolean;
  stats: {
    openPRs: number;
    failingCI: number;
    blockers: number;
    pendingApprovals: number;
  };
  health: "green" | "yellow" | "red" | null;
  summary: {
    text: string;
    createdAt: Date;
    blockers: { title: string; severity: string; explanation: string }[];
    decisionsNeeded: { question: string; context: string }[];
  } | null;
};

export async function getDashboardData(
  workspaceId: string,
): Promise<DashboardData> {
  const github = await db.integration.findUnique({
    where: { workspaceId_provider: { workspaceId, provider: "github" } },
  });

  const since = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const events = await db.event.findMany({
    where: { workspaceId, department: "engineering", occurredAt: { gte: since } },
    select: {
      id: true,
      type: true,
      entityRef: true,
      entityType: true,
      title: true,
      importance: true,
      occurredAt: true,
    },
  });

  // Derive open-PR count: a PR ref with pr.opened and no pr.merged/pr.closed.
  const prState = new Map<string, { opened: boolean; closed: boolean }>();
  for (const e of events) {
    if (!e.entityRef || !e.type.startsWith("pr.")) continue;
    const s = prState.get(e.entityRef) ?? { opened: false, closed: false };
    if (e.type === "pr.opened") s.opened = true;
    if (e.type === "pr.merged" || e.type === "pr.closed") s.closed = true;
    prState.set(e.entityRef, s);
  }
  const openPRs = [...prState.values()].filter((s) => s.opened && !s.closed).length;

  const candidates = detectBlockerCandidates(events as EventLite[]);
  const failingCI = candidates.filter((c) => c.kind === "ci_failing").length;

  const pendingApprovals = await db.proposedAction.count({
    where: { workspaceId, status: "pending" },
  });

  const summaryRow = await db.sessionSummary.findFirst({
    where: { workspaceId, department: "engineering" },
    orderBy: { createdAt: "desc" },
  });

  let health: DashboardData["health"] = null;
  let summary: DashboardData["summary"] = null;
  if (summaryRow) {
    const content = summaryRow.content as {
      summary: string;
      health: "green" | "yellow" | "red";
      blockers: { title: string; severity: string; explanation: string }[];
      decisionsNeeded: { question: string; context: string }[];
    };
    health = content.health;
    summary = {
      text: content.summary,
      createdAt: summaryRow.createdAt,
      blockers: content.blockers?.slice(0, 3) ?? [],
      decisionsNeeded: content.decisionsNeeded?.slice(0, 3) ?? [],
    };
  }

  return {
    connected: !!github,
    stats: {
      openPRs,
      failingCI,
      blockers: summary?.blockers.length ?? candidates.length,
      pendingApprovals,
    },
    health,
    summary,
  };
}
