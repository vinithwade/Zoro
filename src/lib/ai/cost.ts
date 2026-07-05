import "server-only";
import { db } from "@/lib/db";

// Rough OpenAI pricing (USD per 1M tokens). Fallback = gpt-4o-mini rates.
export const PRICING: Record<string, { in: number; out: number }> = {
  "gpt-4o-mini": { in: 0.15, out: 0.6 },
  "gpt-4o": { in: 2.5, out: 10 },
  "gpt-4.1-mini": { in: 0.4, out: 1.6 },
  "gpt-4.1": { in: 2, out: 8 },
  "gpt-4.1-nano": { in: 0.1, out: 0.4 },
};

export function costOf(model: string, inTok: number, outTok: number): number {
  const p = PRICING[model] ?? PRICING["gpt-4o-mini"];
  return (inTok / 1e6) * p.in + (outTok / 1e6) * p.out;
}

export function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

// Sum today's AI spend across all agent runs (local day).
export async function getTodaySpendUsd(workspaceId: string): Promise<number> {
  const runs = await db.agentRun.findMany({
    where: { workspaceId, startedAt: { gte: startOfToday() } },
    select: { model: true, promptTokens: true, completionTokens: true },
  });
  return runs.reduce(
    (sum, r) => sum + costOf(r.model, r.promptTokens ?? 0, r.completionTokens ?? 0),
    0,
  );
}
