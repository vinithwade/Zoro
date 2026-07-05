import "server-only";
import { z } from "zod";
import { db } from "@/lib/db";
import { getOpenAIClient, generateStructured } from "./openai";
import { detectBlockerCandidates, type EventLite } from "./blocker-rules";
import { rankEvents } from "./ask-retrieval";
import { getStoredMetrics, formatMoney } from "@/lib/stripe/metrics";

const WINDOW_DAYS = 45;
const MAX_EVENTS = 70;

export type ShipReport = {
  verdict: "ready" | "at_risk" | "not_ready";
  headline: string;
  areas: { name: string; status: "green" | "yellow" | "red"; summary: string; blockers: string[] }[];
  recommendedNextSteps: string[];
  earliestDate: string;
};

export type ShipResult = { ok: true; report: ShipReport } | { ok: false; reason: string };

const Output = z.object({
  verdict: z.enum(["ready", "at_risk", "not_ready"]),
  headline: z.string(),
  areas: z.array(
    z.object({
      name: z.string(),
      status: z.enum(["green", "yellow", "red"]),
      summary: z.string(),
      blockers: z.array(z.string()),
    }),
  ),
  recommendedNextSteps: z.array(z.string()),
  earliestDate: z.string(),
});

const JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["verdict", "headline", "areas", "recommendedNextSteps", "earliestDate"],
  properties: {
    verdict: { type: "string", enum: ["ready", "at_risk", "not_ready"] },
    headline: { type: "string" },
    areas: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "status", "summary", "blockers"],
        properties: {
          name: { type: "string" },
          status: { type: "string", enum: ["green", "yellow", "red"] },
          summary: { type: "string" },
          blockers: { type: "array", items: { type: "string" } },
        },
      },
    },
    recommendedNextSteps: { type: "array", items: { type: "string" } },
    earliestDate: { type: "string" },
  },
} as const;

export async function runShipCheck(workspaceId: string, what: string): Promise<ShipResult> {
  const client = await getOpenAIClient(workspaceId);
  if (!client) return { ok: false, reason: "OpenAI is not connected." };

  const since = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const pool = await db.event.findMany({
    where: { workspaceId, occurredAt: { gte: since } },
    orderBy: [{ importance: "desc" }, { occurredAt: "desc" }],
    take: 250,
    select: {
      id: true, type: true, title: true, summary: true, actor: true,
      entityRef: true, entityUrl: true, importance: true, occurredAt: true, department: true,
    },
  });

  const [engSummary, commSummary] = await Promise.all([
    db.sessionSummary.findFirst({ where: { workspaceId, department: "engineering" }, orderBy: { createdAt: "desc" } }),
    db.sessionSummary.findFirst({ where: { workspaceId, department: "communication" }, orderBy: { createdAt: "desc" } }),
  ]);
  const pending = await db.proposedAction.findMany({
    where: { workspaceId, status: "pending" }, select: { title: true }, take: 20,
  });
  const metrics = await getStoredMetrics(workspaceId);

  // Engineering state signals.
  const engEvents = pool.filter((e) => e.department === "engineering");
  const prState = new Map<string, { opened: boolean; closed: boolean }>();
  for (const e of engEvents) {
    if (!e.entityRef || !e.type.startsWith("pr.")) continue;
    const s = prState.get(e.entityRef) ?? { opened: false, closed: false };
    if (e.type === "pr.opened") s.opened = true;
    if (e.type === "pr.merged" || e.type === "pr.closed") s.closed = true;
    prState.set(e.entityRef, s);
  }
  const openPRs = [...prState.values()].filter((s) => s.opened && !s.closed).length;
  const candidates = detectBlockerCandidates(
    engEvents.map((e): EventLite => ({
      id: e.id, type: e.type, entityRef: e.entityRef, entityType: null,
      title: e.title, importance: e.importance, occurredAt: e.occurredAt,
    })),
  ).slice(0, 12);
  const failingCI = candidates.filter((c) => c.kind === "ci_failing").length;

  const ranked = rankEvents(pool, what, MAX_EVENTS);

  const ctx: string[] = [];
  ctx.push(
    `ENGINEERING STATE: ${openPRs} open PR(s), ${failingCI} with failing CI, ${candidates.length} rule-detected blocker(s).`,
  );
  if (candidates.length) ctx.push("ENGINEERING BLOCKERS:\n" + candidates.map((c) => `- ${c.description}`).join("\n"));
  if (engSummary) ctx.push(`LATEST ENGINEERING SUMMARY:\n${(engSummary.content as { summary?: string }).summary ?? ""}`);
  if (commSummary) ctx.push(`LATEST COMMUNICATION SUMMARY:\n${(commSummary.content as { summary?: string }).summary ?? ""}`);
  if (pending.length) ctx.push("PENDING APPROVALS:\n" + pending.map((p) => `- ${p.title}`).join("\n"));
  if (metrics) ctx.push(`REVENUE: MRR ${formatMoney(metrics.mrr, metrics.currency)}, ${metrics.activeSubscriptions} active subs, ${metrics.failedPayments7d} failed payments (7d).`);
  ctx.push(
    "RELEVANT ACTIVITY:\n" +
      ranked.map((e) => `[${e.department}] ${e.type} — ${e.summary ?? e.title}${e.entityRef ? ` (${e.entityRef})` : ""}`).join("\n"),
  );

  const run = await db.agentRun.create({
    data: { workspaceId, kind: "ship_check", model: "pending", status: "running", inputSummary: { what, eventCount: ranked.length } },
  });

  try {
    const system = [
      "You are Zoro, assessing whether a startup is READY TO SHIP a specific thing the founder names.",
      "Reason across the areas covered by the context — Engineering, Communication/Team, and Revenue/Ops if present. Assess each area's status (green=ready, yellow=at risk, red=blocking).",
      "Use ONLY the provided context — do not invent PRs, blockers, people, or facts. If a signal is missing, note the uncertainty rather than assuming.",
      "verdict: 'ready' only if nothing is red and the specific thing appears complete; 'not_ready' if any red blockers directly affect it; otherwise 'at_risk'.",
      "headline: one direct sentence answering the question. earliestDate: a realistic estimate like 'Thursday', 'in ~1 week', or '' if you can't tell. Keep everything concise and specific.",
    ].join("\n");
    const user = `FOUNDER WANTS TO SHIP: "${what}"\n\nCONTEXT:\n${ctx.join("\n\n")}`;

    const result = await generateStructured<z.infer<typeof Output>>(client, {
      system, user, schemaName: "ship_check", jsonSchema: JSON_SCHEMA as unknown as Record<string, unknown>,
    });
    const report = Output.parse(result.data);

    await db.agentRun.update({
      where: { id: run.id },
      data: {
        status: "succeeded", model: result.model, rawOutput: result.data as object,
        promptTokens: result.promptTokens, completionTokens: result.completionTokens, finishedAt: new Date(),
      },
    });
    return { ok: true, report };
  } catch (err) {
    await db.agentRun.update({
      where: { id: run.id },
      data: { status: "failed", error: err instanceof Error ? err.message : String(err), finishedAt: new Date() },
    });
    return { ok: false, reason: err instanceof Error ? err.message : "Check failed" };
  }
}
