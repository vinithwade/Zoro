import "server-only";
import { z } from "zod";
import { db } from "@/lib/db";
import { getOpenAIClient, generateStructured } from "./openai";
import { proposeAction } from "@/lib/actions/propose";
import { ACTION_REGISTRY } from "@/lib/actions/registry";
import type { SlackConfig } from "@/lib/slack/client";

const WINDOW_HOURS = 72;
const MAX_CONTEXT = 150;
const REFRESH_THROTTLE_MS = 15 * 60 * 1000;

export type RefreshResult =
  | { ok: true; summaryId: string; proposedActions: number }
  | { ok: false; reason: string };

const Output = z.object({
  summary: z.string(),
  health: z.enum(["green", "yellow", "red"]),
  blockers: z.array(
    z.object({
      title: z.string(),
      severity: z.enum(["low", "medium", "high"]),
      explanation: z.string(),
      eventIds: z.array(z.string()),
    }),
  ),
  decisionsNeeded: z.array(
    z.object({ question: z.string(), context: z.string(), eventIds: z.array(z.string()) }),
  ),
  recommendations: z.array(z.object({ text: z.string(), eventIds: z.array(z.string()) })),
  suggestedActions: z.array(
    z.object({
      actionType: z.literal("slack.post_message"),
      title: z.string(),
      reasoning: z.string(),
      payload: z.object({ channel: z.string(), text: z.string() }),
      sourceEventIds: z.array(z.string()),
    }),
  ).max(2),
});
type OutputType = z.infer<typeof Output>;

const JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "health", "blockers", "decisionsNeeded", "recommendations", "suggestedActions"],
  properties: {
    summary: { type: "string" },
    health: { type: "string", enum: ["green", "yellow", "red"] },
    blockers: {
      type: "array",
      items: {
        type: "object", additionalProperties: false,
        required: ["title", "severity", "explanation", "eventIds"],
        properties: {
          title: { type: "string" },
          severity: { type: "string", enum: ["low", "medium", "high"] },
          explanation: { type: "string" },
          eventIds: { type: "array", items: { type: "string" } },
        },
      },
    },
    decisionsNeeded: {
      type: "array",
      items: {
        type: "object", additionalProperties: false,
        required: ["question", "context", "eventIds"],
        properties: {
          question: { type: "string" }, context: { type: "string" },
          eventIds: { type: "array", items: { type: "string" } },
        },
      },
    },
    recommendations: {
      type: "array",
      items: {
        type: "object", additionalProperties: false,
        required: ["text", "eventIds"],
        properties: { text: { type: "string" }, eventIds: { type: "array", items: { type: "string" } } },
      },
    },
    suggestedActions: {
      type: "array",
      items: {
        type: "object", additionalProperties: false,
        required: ["actionType", "title", "reasoning", "payload", "sourceEventIds"],
        properties: {
          actionType: { type: "string", enum: ["slack.post_message"] },
          title: { type: "string" },
          reasoning: { type: "string" },
          payload: {
            type: "object", additionalProperties: false,
            required: ["channel", "text"],
            properties: { channel: { type: "string" }, text: { type: "string" } },
          },
          sourceEventIds: { type: "array", items: { type: "string" } },
        },
      },
    },
  },
} as const;

export async function maybeRefreshCommunicationSession(workspaceId: string): Promise<RefreshResult> {
  const last = await db.sessionSummary.findFirst({
    where: { workspaceId, department: "communication" },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });
  if (last && Date.now() - last.createdAt.getTime() < REFRESH_THROTTLE_MS) {
    return { ok: false, reason: "throttled" };
  }
  return runCommunicationSession(workspaceId);
}

export async function runCommunicationSession(workspaceId: string): Promise<RefreshResult> {
  const client = await getOpenAIClient(workspaceId);
  if (!client) return { ok: false, reason: "OpenAI is not connected." };

  const slack = await db.integration.findUnique({
    where: { workspaceId_provider: { workspaceId, provider: "slack" } },
  });
  const channels = new Set(
    ((slack?.config as SlackConfig | undefined)?.channels ?? []).map((c) => c.name),
  );

  const since = new Date(Date.now() - WINDOW_HOURS * 60 * 60 * 1000);
  const events = await db.event.findMany({
    where: { workspaceId, department: "communication", occurredAt: { gte: since } },
    orderBy: [{ importance: "desc" }, { occurredAt: "desc" }],
    take: MAX_CONTEXT,
    select: { id: true, type: true, title: true, summary: true, actor: true, entityRef: true, importance: true, occurredAt: true },
  });
  if (events.length === 0) {
    return { ok: false, reason: "No Slack activity yet. Connect Slack and run a sync." };
  }

  const eventIdSet = new Set(events.map((e) => e.id));
  // Blocker candidates: messages flagged high-importance by the keyword detector.
  const candidates = events.filter((e) => e.importance >= 3).slice(0, 12);

  const run = await db.agentRun.create({
    data: {
      workspaceId, kind: "communication_session", model: "pending", status: "running",
      inputSummary: { eventCount: events.length, blockerCandidateCount: candidates.length },
    },
  });

  try {
    const eventLines = events
      .map((e) => `[${e.id}] ${e.occurredAt.toISOString().slice(0, 16)} (imp${e.importance}) ${e.summary ?? e.title}`)
      .join("\n");
    const candidateLines = candidates.length
      ? candidates.map((c) => `- ${c.summary} [${c.id}]`).join("\n")
      : "(none flagged)";

    const system = [
      "You are Zoro's Communication analyst for a startup founder, reading Slack activity.",
      "Use ONLY the messages provided. Do NOT invent people, channels, or facts.",
      "Every blocker, decision, recommendation, and action MUST cite the message event id(s) it is based on.",
      "Report blockers ONLY from the flagged blocker candidates; you may merge, prioritize, and explain them.",
      "You MAY suggest at most 2 actions of type slack.post_message to help unblock or inform the team (e.g. summarize a decision, nudge for an answer). Only use channels that exist. Keep messages short and professional.",
      "Summary: 3-5 sentences. health: red if there are urgent unresolved blockers, yellow if minor, green otherwise.",
    ].join("\n");
    const user = [
      `SLACK MESSAGES (most important first):\n${eventLines}`,
      `\nBLOCKER CANDIDATES (only source of blockers):\n${candidateLines}`,
      `\nCHANNELS YOU MAY POST TO: ${[...channels].map((c) => `#${c}`).join(", ") || "(none)"}`,
    ].join("\n");

    const result = await generateStructured<OutputType>(client, {
      system, user, schemaName: "communication_session",
      jsonSchema: JSON_SCHEMA as unknown as Record<string, unknown>,
    });
    const parsed = Output.parse(result.data);

    const known = (ids: string[]) => ids.filter((id) => eventIdSet.has(id));
    const grounded: OutputType = {
      summary: parsed.summary,
      health: parsed.health,
      blockers: parsed.blockers.map((b) => ({ ...b, eventIds: known(b.eventIds) })).filter((b) => b.eventIds.length),
      decisionsNeeded: parsed.decisionsNeeded.map((d) => ({ ...d, eventIds: known(d.eventIds) })).filter((d) => d.eventIds.length),
      recommendations: parsed.recommendations.map((r) => ({ ...r, eventIds: known(r.eventIds) })).filter((r) => r.eventIds.length),
      suggestedActions: parsed.suggestedActions.filter((a) => {
        const ch = a.payload.channel.replace(/^#/, "");
        return channels.has(ch) && ACTION_REGISTRY["slack.post_message"].payloadSchema.safeParse({ channel: ch, text: a.payload.text }).success;
      }),
    };

    const summary = await db.sessionSummary.create({
      data: { workspaceId, department: "communication", content: grounded as object, eventIdsUsed: [...eventIdSet], agentRunId: run.id },
    });
    await db.agentRun.update({
      where: { id: run.id },
      data: {
        status: "succeeded", model: result.model, rawOutput: result.data as object,
        promptTokens: result.promptTokens, completionTokens: result.completionTokens, finishedAt: new Date(),
      },
    });
    await db.auditLog.create({
      data: {
        workspaceId, actorType: "ai", actor: "communication-agent", action: "agent.run",
        targetType: "session_summary", targetId: summary.id,
        metadata: { blockers: grounded.blockers.length, suggestedActions: grounded.suggestedActions.length },
      },
    });

    let proposed = 0;
    for (const a of grounded.suggestedActions) {
      const created = await proposeAction({
        workspaceId, agentRunId: run.id, actionType: "slack.post_message",
        title: a.title, reasoning: a.reasoning,
        payload: { channel: a.payload.channel.replace(/^#/, ""), text: a.payload.text },
        riskLevel: "medium", sourceEventIds: a.sourceEventIds, actor: "communication-agent",
      });
      if (created) proposed++;
    }

    return { ok: true, summaryId: summary.id, proposedActions: proposed };
  } catch (err) {
    await db.agentRun.update({
      where: { id: run.id },
      data: { status: "failed", error: err instanceof Error ? err.message : String(err), finishedAt: new Date() },
    });
    return { ok: false, reason: err instanceof Error ? err.message : "Analysis failed" };
  }
}
