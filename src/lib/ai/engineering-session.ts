import "server-only";
import { createHash } from "node:crypto";
import { db } from "@/lib/db";
import { getOpenAIClient, generateStructured } from "./openai";
import {
  EngineeringSessionOutput,
  ENGINEERING_SESSION_JSON_SCHEMA,
  type EngineeringSessionOutputType,
} from "./schemas";
import { detectBlockerCandidates, type EventLite } from "./blocker-rules";
import { groundOutput } from "./grounding";
import { notify, hashKey } from "@/lib/notifications";
import {
  ACTION_REGISTRY,
  buildActionPayload,
  isActionType,
  type AiActionPayload,
} from "@/lib/actions/registry";
import type { GithubConfig } from "@/lib/github/client";

const CONTEXT_WINDOW_DAYS = 30; // blocker detection needs current open-state
const MAX_CONTEXT_EVENTS = 150;
const REFRESH_THROTTLE_MS = 15 * 60 * 1000;

export type RefreshResult =
  | { ok: true; summaryId: string; proposedActions: number }
  | { ok: false; reason: string };

// Only run if the last analysis is older than the throttle (scheduler uses this).
export async function maybeRefreshEngineeringSession(
  workspaceId: string,
): Promise<RefreshResult> {
  const last = await db.sessionSummary.findFirst({
    where: { workspaceId, department: "engineering" },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });
  if (last && Date.now() - last.createdAt.getTime() < REFRESH_THROTTLE_MS) {
    return { ok: false, reason: "throttled" };
  }
  return runEngineeringSession(workspaceId);
}

export async function runEngineeringSession(
  workspaceId: string,
): Promise<RefreshResult> {
  const client = await getOpenAIClient(workspaceId);
  if (!client) return { ok: false, reason: "OpenAI is not connected." };

  const githubIntegration = await db.integration.findUnique({
    where: { workspaceId_provider: { workspaceId, provider: "github" } },
  });
  const connectedRepos = new Set(
    ((githubIntegration?.config as GithubConfig | undefined)?.repos ?? []),
  );

  const since = new Date(Date.now() - CONTEXT_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const events = await db.event.findMany({
    where: { workspaceId, department: "engineering", occurredAt: { gte: since } },
    orderBy: [{ importance: "desc" }, { occurredAt: "desc" }],
    take: MAX_CONTEXT_EVENTS,
    select: {
      id: true,
      type: true,
      title: true,
      summary: true,
      actor: true,
      entityRef: true,
      entityType: true,
      importance: true,
      occurredAt: true,
    },
  });

  if (events.length === 0) {
    return { ok: false, reason: "No GitHub activity yet. Run a sync first." };
  }

  const eventIdSet = new Set(events.map((e) => e.id));
  const refNumbers = new Set(
    events.map((e) => e.entityRef).filter(Boolean) as string[],
  );

  const lite: EventLite[] = events.map((e) => ({
    id: e.id,
    type: e.type,
    entityRef: e.entityRef,
    entityType: e.entityType,
    title: e.title,
    importance: e.importance,
    occurredAt: e.occurredAt,
  }));
  const candidates = detectBlockerCandidates(lite);

  const run = await db.agentRun.create({
    data: {
      workspaceId,
      kind: "engineering_session",
      model: "pending",
      status: "running",
      inputSummary: {
        eventCount: events.length,
        blockerCandidateCount: candidates.length,
      },
    },
  });

  try {
    const eventLines = events
      .map(
        (e) =>
          `[${e.id}] ${e.occurredAt.toISOString().slice(0, 16)} ${e.type} (imp${e.importance}) — ${e.summary ?? e.title}${e.entityRef ? ` — ${e.entityRef}` : ""}`,
      )
      .join("\n");

    const candidateLines = candidates.length
      ? candidates
          .map(
            (c) =>
              `- (${c.kind}) ${c.description} [eventIds: ${c.eventIds.join(", ")}]`,
          )
          .join("\n")
      : "(none detected by the rules engine)";

    const system = [
      "You are Zoro's Engineering analyst for a startup founder.",
      "Use ONLY the events provided below. Do NOT invent repos, PRs, issues, or people.",
      "Every blocker, decision, recommendation, and suggested action MUST cite the exact event id(s) it is based on, drawn from the provided list.",
      "Report blockers ONLY from the pre-computed blocker candidates — do not invent new ones. You may prioritize, merge, and explain them.",
      "Suggested actions may only use these action types: github.comment_issue, github.comment_pr, github.create_issue. Propose at most 3, and only when genuinely useful. For comments, set issueOrPrNumber to the PR/issue number and issueTitle to null. For github.create_issue, set issueTitle and leave issueOrPrNumber null.",
      "Keep the summary to 3-5 sentences. Set health: red if any critical blocker (e.g. failing CI) exists, yellow if there are non-critical blockers, green otherwise.",
    ].join("\n");

    const user = [
      `EVENTS (most important first):\n${eventLines}`,
      `\nBLOCKER CANDIDATES (only source of blockers):\n${candidateLines}`,
      `\nCONNECTED REPOS: ${[...connectedRepos].join(", ") || "(unknown)"}`,
    ].join("\n");

    const result = await generateStructured<EngineeringSessionOutputType>(
      client,
      {
        system,
        user,
        schemaName: "engineering_session",
        jsonSchema: ENGINEERING_SESSION_JSON_SCHEMA as unknown as Record<
          string,
          unknown
        >,
      },
    );

    const parsed = EngineeringSessionOutput.parse(result.data);
    const grounded = groundOutput(parsed, eventIdSet, refNumbers, connectedRepos);

    const summary = await db.sessionSummary.create({
      data: {
        workspaceId,
        department: "engineering",
        content: grounded as object,
        eventIdsUsed: [...eventIdSet],
        agentRunId: run.id,
      },
    });

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

    await db.auditLog.create({
      data: {
        workspaceId,
        actorType: "ai",
        actor: "engineering-agent",
        action: "agent.run",
        targetType: "session_summary",
        targetId: summary.id,
        metadata: {
          blockers: grounded.blockers.length,
          recommendations: grounded.recommendations.length,
          suggestedActions: grounded.suggestedActions.length,
        },
      },
    });

    const proposed = await createProposedActions(
      workspaceId,
      run.id,
      grounded.suggestedActions,
    );

    for (const d of grounded.decisionsNeeded) {
      await notify(workspaceId, {
        type: "decision",
        title: "Decision needed (Engineering)",
        body: d.question,
        href: "/sessions/engineering",
        dedupeKey: `decision:eng:${hashKey(d.question)}`,
      });
    }

    return { ok: true, summaryId: summary.id, proposedActions: proposed };
  } catch (err) {
    await db.agentRun.update({
      where: { id: run.id },
      data: {
        status: "failed",
        error: err instanceof Error ? err.message : String(err),
        finishedAt: new Date(),
      },
    });
    return {
      ok: false,
      reason: err instanceof Error ? err.message : "Analysis failed",
    };
  }
}

async function createProposedActions(
  workspaceId: string,
  agentRunId: string,
  actions: EngineeringSessionOutputType["suggestedActions"],
): Promise<number> {
  let created = 0;
  for (const a of actions) {
    if (!isActionType(a.actionType)) continue;
    const payload = buildActionPayload(a.actionType, a.payload as AiActionPayload);
    if (!payload) continue;

    const idempotencyKey = createHash("sha256")
      .update(`${workspaceId}|${a.actionType}|${canonicalJson(payload)}`)
      .digest("hex");

    try {
      const action = await db.proposedAction.create({
        data: {
          workspaceId,
          agentRunId,
          actionType: a.actionType,
          title: a.title,
          reasoning: a.reasoning,
          payload: payload as object,
          riskLevel: ACTION_REGISTRY[a.actionType].risk,
          status: "pending",
          sourceEventIds: a.sourceEventIds,
          idempotencyKey,
        },
      });
      await db.auditLog.create({
        data: {
          workspaceId,
          actorType: "ai",
          actor: "engineering-agent",
          action: "action.proposed",
          targetType: "proposed_action",
          targetId: action.id,
          metadata: { actionType: a.actionType, risk: action.riskLevel },
        },
      });
      await notify(workspaceId, {
        type: "approval",
        title: "Action needs your approval",
        body: a.title,
        href: "/approvals",
        dedupeKey: `approval:${idempotencyKey}`,
      });
      created++;
    } catch {
      // Unique idempotencyKey collision — this exact action already proposed. Skip.
    }
  }
  return created;
}

function canonicalJson(obj: Record<string, unknown>): string {
  return JSON.stringify(obj, Object.keys(obj).sort());
}
