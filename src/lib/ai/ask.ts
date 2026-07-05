import "server-only";
import { z } from "zod";
import { db } from "@/lib/db";
import { getOpenAIClient, generateStructured } from "./openai";
import { detectBlockerCandidates, type EventLite } from "./blocker-rules";
import { rankEvents } from "./ask-retrieval";
import { formatMoney, type RevenueMetrics } from "@/lib/stripe/metrics";

const SUPPORTED_TOOLS = [
  { provider: "github", name: "GitHub" },
  { provider: "slack", name: "Slack" },
  { provider: "stripe", name: "Stripe" },
  { provider: "openai", name: "OpenAI" },
] as const;

// Summarize which tools are connected (so Zoro can answer setup/status questions).
async function buildToolStatus(
  workspaceId: string,
): Promise<{ text: string; anyConnected: boolean }> {
  const rows = await db.integration.findMany({ where: { workspaceId } });
  const byProvider = new Map(rows.map((r) => [r.provider, r]));
  const lines: string[] = [];

  for (const { provider, name } of SUPPORTED_TOOLS) {
    const r = byProvider.get(provider);
    if (!r) {
      lines.push(`- ${name}: NOT connected.`);
      continue;
    }
    const cfg = (r.config ?? {}) as {
      login?: string; repos?: string[]; teamName?: string;
      channels?: { name: string }[]; accountName?: string; livemode?: boolean;
    };
    let detail = "";
    if (provider === "github") {
      detail = `as @${cfg.login ?? "?"}, watching ${cfg.repos?.length ?? 0} repo(s)${cfg.repos?.length ? ` (${cfg.repos.join(", ")})` : ""}`;
    } else if (provider === "slack") {
      detail = `workspace "${cfg.teamName ?? "?"}", watching ${cfg.channels?.length ?? 0} channel(s)`;
    } else if (provider === "stripe") {
      const m = (r.syncCursor as { metrics?: RevenueMetrics } | null)?.metrics;
      detail = `account "${cfg.accountName ?? "unknown"}" (${cfg.livemode ? "live" : "test"} mode)${m ? `, MRR ${formatMoney(m.mrr, m.currency)}` : ""}`;
    } else {
      detail = "AI features enabled";
    }
    const synced = r.lastSyncedAt ? `, last synced ${r.lastSyncedAt.toISOString().slice(0, 16)}` : "";
    const status = r.status && r.status !== "connected" ? ` [status: ${r.status}]` : "";
    lines.push(`- ${name}: CONNECTED — ${detail}${synced}${status}.`);
  }

  return { text: "CONNECTED TOOLS & SETUP:\n" + lines.join("\n"), anyConnected: rows.length > 0 };
}

const CONTEXT_WINDOW_DAYS = 45;
const CANDIDATE_POOL = 250; // events pulled before ranking
const MAX_CONTEXT_EVENTS = 120; // events sent to the model

export type AskMessage = { role: "user" | "assistant"; content: string };

export type CitedEvent = {
  id: string;
  type: string;
  entityRef: string | null;
  entityUrl: string | null;
  summary: string | null;
};

export type AskResult =
  | { ok: true; answer: string; events: CitedEvent[] }
  | { ok: false; reason: string };

const AskOutput = z.object({
  answer: z.string(),
  citedEventIds: z.array(z.string()),
});

const ASK_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["answer", "citedEventIds"],
  properties: {
    answer: { type: "string" },
    citedEventIds: { type: "array", items: { type: "string" } },
  },
} as const;

export async function askZoro(
  workspaceId: string,
  question: string,
  history: AskMessage[] = [],
  pastNotes: { title: string; content: string }[] = [],
): Promise<AskResult> {
  const client = await getOpenAIClient(workspaceId);
  if (!client) return { ok: false, reason: "OpenAI is not connected. Add your key in Connect Tools." };

  const toolStatus = await buildToolStatus(workspaceId);

  const since = new Date(Date.now() - CONTEXT_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const pool = await db.event.findMany({
    where: { workspaceId, occurredAt: { gte: since } },
    orderBy: [{ importance: "desc" }, { occurredAt: "desc" }],
    take: CANDIDATE_POOL,
    select: {
      id: true, type: true, title: true, summary: true, actor: true,
      entityRef: true, entityUrl: true, importance: true, occurredAt: true,
    },
  });

  // Only bail if there's genuinely nothing to talk about (no events AND no tools).
  if (pool.length === 0 && !toolStatus.anyConnected) {
    return { ok: false, reason: "No tools are connected yet. Connect one in Connect Tools." };
  }

  // Rank: question relevance first, then importance, then recency.
  const ranked = rankEvents(pool, question, MAX_CONTEXT_EVENTS);
  const eventIdSet = new Set(ranked.map((e) => e.id));

  // Deterministic blockers over the full pool (grounded, not invented).
  const candidates = detectBlockerCandidates(
    pool.map(
      (e): EventLite => ({
        id: e.id, type: e.type, entityRef: e.entityRef, entityType: null,
        title: e.title, importance: e.importance, occurredAt: e.occurredAt,
      }),
    ),
  ).slice(0, 12);

  const summary = await db.sessionSummary.findFirst({
    where: { workspaceId, department: "engineering" },
    orderBy: { createdAt: "desc" },
    select: { content: true, createdAt: true },
  });

  const pending = await db.proposedAction.findMany({
    where: { workspaceId, status: "pending" },
    select: { title: true, actionType: true },
    take: 20,
  });

  const contextParts: string[] = [toolStatus.text];

  if (summary) {
    const c = summary.content as { summary?: string; health?: string };
    contextParts.push(
      `LATEST ENGINEERING SUMMARY (health: ${c.health ?? "unknown"}):\n${c.summary ?? ""}`,
    );
  }
  if (candidates.length) {
    contextParts.push(
      "RULE-DETECTED BLOCKERS:\n" +
        candidates
          .map((c) => `- ${c.description} [${c.eventIds.join(", ")}]`)
          .join("\n"),
    );
  }
  if (pending.length) {
    contextParts.push(
      "PENDING APPROVALS:\n" +
        pending.map((p) => `- ${p.title} (${p.actionType})`).join("\n"),
    );
  }
  if (pastNotes.length) {
    contextParts.push(
      "RELEVANT NOTES FROM PAST CONVERSATIONS (things you told the founder before):\n" +
        pastNotes
          .map((n) => `- (re: "${n.title}") ${n.content}`)
          .join("\n"),
    );
  }
  contextParts.push(
    "EVENTS:\n" +
      ranked
        .map(
          (e) =>
            `[${e.id}] ${e.occurredAt.toISOString().slice(0, 16)} ${e.type} (imp${e.importance}) — ${e.summary ?? e.title}${e.entityRef ? ` — ${e.entityRef}` : ""}`,
        )
        .join("\n"),
  );

  const system = [
    "You are Zoro, an assistant for a startup founder. Answer the founder's question using ONLY the company context provided below (connected tools, events, summaries, blockers, pending approvals).",
    "For setup/status questions (e.g. 'is Stripe connected?', 'which repos are we watching?', 'what's our MRR?'), answer directly from the CONNECTED TOOLS & SETUP section — no event citations are needed for those.",
    "Be concise, specific, and direct — a few sentences, and bullet points when listing. Refer to real PRs/issues/people by name when relevant.",
    "When you rely on activity events, cite the event ids in citedEventIds (the bracketed [id] values). Do NOT put the raw ids in the answer text.",
    "If the context does not contain enough information to answer, say so plainly. Never invent tools, PRs, issues, people, dates, numbers, or facts that are not in the context.",
  ].join("\n");

  const run = await db.agentRun.create({
    data: {
      workspaceId,
      kind: "ask_zoro",
      model: "pending",
      status: "running",
      inputSummary: { question, eventCount: ranked.length },
    },
  });

  try {
    const historyText = history
      .slice(-6)
      .map((m) => `${m.role === "user" ? "Founder" : "Zoro"}: ${m.content}`)
      .join("\n");

    const user = [
      "COMPANY CONTEXT\n" + contextParts.join("\n\n"),
      historyText ? `\nCONVERSATION SO FAR:\n${historyText}` : "",
      `\nFOUNDER'S QUESTION: ${question}`,
    ].join("\n");

    const result = await generateStructured<z.infer<typeof AskOutput>>(client, {
      system,
      user,
      schemaName: "zoro_answer",
      jsonSchema: ASK_JSON_SCHEMA as unknown as Record<string, unknown>,
    });
    const parsed = AskOutput.parse(result.data);

    // Grounding: keep only citations that exist in the provided event set.
    const citedIds = parsed.citedEventIds.filter((id) => eventIdSet.has(id));
    const events: CitedEvent[] = ranked
      .filter((e) => citedIds.includes(e.id))
      .map((e) => ({
        id: e.id, type: e.type, entityRef: e.entityRef,
        entityUrl: e.entityUrl, summary: e.summary,
      }));

    await db.agentRun.update({
      where: { id: run.id },
      data: {
        status: "succeeded",
        model: result.model,
        rawOutput: result.data as object,
        promptTokens: result.promptTokens,
        completionTokens: result.completionTokens,
        finishedAt: new Date(),
      },
    });

    return { ok: true, answer: parsed.answer, events };
  } catch (err) {
    await db.agentRun.update({
      where: { id: run.id },
      data: {
        status: "failed",
        error: err instanceof Error ? err.message : String(err),
        finishedAt: new Date(),
      },
    });
    return { ok: false, reason: err instanceof Error ? err.message : "Failed to answer" };
  }
}
