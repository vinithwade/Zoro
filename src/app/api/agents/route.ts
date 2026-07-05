import { NextResponse } from "next/server";
import { db, getDefaultWorkspace } from "@/lib/db";
import { costOf } from "@/lib/ai/cost";

type Json = Record<string, unknown>;

export async function GET() {
  const ws = await getDefaultWorkspace();
  const runs = await db.agentRun.findMany({
    where: { workspaceId: ws.id },
    orderBy: { startedAt: "desc" },
    take: 100,
  });

  // Count proposed actions linked to these runs.
  const runIds = runs.map((r) => r.id);
  const grouped = await db.proposedAction.groupBy({
    by: ["agentRunId"],
    where: { workspaceId: ws.id, agentRunId: { in: runIds } },
    _count: { _all: true },
  });
  const actionsByRun = new Map(grouped.map((g) => [g.agentRunId, g._count._all]));

  const items = runs.map((r) => {
    const input = (r.inputSummary ?? {}) as Json;
    const output = (r.rawOutput ?? {}) as Json;
    const inTok = r.promptTokens ?? 0;
    const outTok = r.completionTokens ?? 0;
    return {
      id: r.id,
      kind: r.kind,
      status: r.status,
      model: r.model,
      startedAt: r.startedAt,
      durationMs: r.finishedAt ? r.finishedAt.getTime() - r.startedAt.getTime() : null,
      promptTokens: inTok,
      completionTokens: outTok,
      cost: costOf(r.model, inTok, outTok),
      error: r.error,
      proposedActions: actionsByRun.get(r.id) ?? 0,
      input: {
        question: typeof input.question === "string" ? input.question : null,
        eventCount: typeof input.eventCount === "number" ? input.eventCount : null,
        blockerCandidateCount:
          typeof input.blockerCandidateCount === "number" ? input.blockerCandidateCount : null,
      },
      output: {
        blockers: Array.isArray(output.blockers) ? output.blockers.length : null,
        suggestedActions: Array.isArray(output.suggestedActions) ? output.suggestedActions.length : null,
        recommendations: Array.isArray(output.recommendations) ? output.recommendations.length : null,
        answerPreview:
          typeof output.answer === "string" ? (output.answer as string).slice(0, 160) : null,
      },
    };
  });

  // Aggregate stats.
  const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
  const succeeded = runs.filter((r) => r.status === "succeeded").length;
  const finished = runs.filter((r) => r.status !== "running").length;
  const totalCost = items.reduce((s, r) => s + r.cost, 0);
  const totalTokens = items.reduce((s, r) => s + r.promptTokens + r.completionTokens, 0);

  return NextResponse.json({
    stats: {
      total: runs.length,
      last24h: runs.filter((r) => r.startedAt.getTime() >= dayAgo).length,
      successRate: finished ? Math.round((succeeded / finished) * 100) : null,
      failed: runs.filter((r) => r.status === "failed").length,
      totalTokens,
      totalCost,
    },
    runs: items,
  });
}
