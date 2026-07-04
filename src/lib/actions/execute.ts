import "server-only";
import { db } from "@/lib/db";
import { getGithubClient } from "@/lib/github/client";
import { getSlackClient, postSlackMessage, type SlackConfig } from "@/lib/slack/client";
import { ACTION_REGISTRY, isActionType, type ActionType } from "./registry";
import type { Octokit } from "octokit";

export type ExecuteResult =
  | { ok: true; externalResult: { htmlUrl: string; ref?: number } }
  | { ok: false; error: string };

// Approve + execute a proposed action. The atomic status guard makes
// double-clicks and races a no-op (idempotency layer #1). The unique
// idempotencyKey at proposal time is layer #2.
export async function executeAction(
  workspaceId: string,
  actionId: string,
): Promise<ExecuteResult> {
  // Claim the action: only the caller who flips pending→executing proceeds.
  const claimed = await db.proposedAction.updateMany({
    where: { id: actionId, workspaceId, status: "pending" },
    data: { status: "executing", decidedAt: new Date() },
  });
  if (claimed.count === 0) {
    return { ok: false, error: "This action is no longer pending." };
  }

  const action = await db.proposedAction.findUnique({ where: { id: actionId } });
  if (!action) return { ok: false, error: "Action not found." };

  await db.auditLog.create({
    data: {
      workspaceId,
      actorType: "human",
      actor: "founder",
      action: "action.approved",
      targetType: "proposed_action",
      targetId: action.id,
      metadata: { actionType: action.actionType },
    },
  });

  try {
    if (!isActionType(action.actionType)) {
      throw new Error(`Unknown action type: ${action.actionType}`);
    }
    // Re-validate the payload at execution time — never trust a stored blob.
    const payload = ACTION_REGISTRY[action.actionType].payloadSchema.parse(
      action.payload,
    ) as Record<string, unknown>;

    const externalResult = action.actionType.startsWith("slack.")
      ? await runSlackExecutor(workspaceId, action.actionType, payload)
      : await runGithubExecutor(workspaceId, action.actionType, payload);

    await db.proposedAction.update({
      where: { id: action.id },
      data: {
        status: "executed",
        executedAt: new Date(),
        externalResult: externalResult as object,
        error: null,
      },
    });

    await db.auditLog.create({
      data: {
        workspaceId,
        actorType: "system",
        actor: "action-engine",
        action: "action.executed",
        targetType: "proposed_action",
        targetId: action.id,
        metadata: { actionType: action.actionType, url: externalResult.htmlUrl },
      },
    });

    return { ok: true, externalResult };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db.proposedAction.update({
      where: { id: action.id },
      data: { status: "failed", error: message },
    });
    await db.auditLog.create({
      data: {
        workspaceId,
        actorType: "system",
        actor: "action-engine",
        action: "action.failed",
        targetType: "proposed_action",
        targetId: action.id,
        metadata: { error: message },
      },
    });
    return { ok: false, error: message };
  }
}

export async function rejectAction(
  workspaceId: string,
  actionId: string,
): Promise<{ ok: boolean; error?: string }> {
  const rejected = await db.proposedAction.updateMany({
    where: { id: actionId, workspaceId, status: "pending" },
    data: { status: "rejected", decidedAt: new Date() },
  });
  if (rejected.count === 0) {
    return { ok: false, error: "This action is no longer pending." };
  }
  await db.auditLog.create({
    data: {
      workspaceId,
      actorType: "human",
      actor: "founder",
      action: "action.rejected",
      targetType: "proposed_action",
      targetId: actionId,
    },
  });
  return { ok: true };
}

// Retry a previously failed action (explicit — never automatic).
export async function retryAction(
  workspaceId: string,
  actionId: string,
): Promise<ExecuteResult> {
  const reset = await db.proposedAction.updateMany({
    where: { id: actionId, workspaceId, status: "failed" },
    data: { status: "pending", error: null },
  });
  if (reset.count === 0) return { ok: false, error: "Action is not in a failed state." };
  return executeAction(workspaceId, actionId);
}

async function runGithubExecutor(
  workspaceId: string,
  actionType: ActionType,
  payload: Record<string, unknown>,
): Promise<{ htmlUrl: string; ref?: number }> {
  const client = await getGithubClient(workspaceId);
  if (!client) throw new Error("GitHub is not connected.");
  const octokit: Octokit = client.octokit;
  const repo = String(payload.repo);
  const [owner, name] = repo.split("/");

  if (actionType === "github.create_issue") {
    const { data } = await octokit.rest.issues.create({
      owner,
      repo: name,
      title: String(payload.title),
      body: String(payload.body),
    });
    return { htmlUrl: data.html_url, ref: data.number };
  }

  // comment_issue and comment_pr both post a comment (PRs are issues for comments).
  const { data } = await octokit.rest.issues.createComment({
    owner,
    repo: name,
    issue_number: Number(payload.number),
    body: String(payload.body),
  });
  return { htmlUrl: data.html_url };
}

async function runSlackExecutor(
  workspaceId: string,
  _actionType: ActionType,
  payload: Record<string, unknown>,
): Promise<{ htmlUrl: string }> {
  const client = await getSlackClient(workspaceId);
  if (!client) throw new Error("Slack is not connected.");
  const config = client.config as SlackConfig;
  const requested = String(payload.channel).replace(/^#/, "");
  // Resolve a channel name to its id; allow passing an id directly.
  const match = config.channels.find(
    (c) => c.name === requested || c.id === requested,
  );
  const channelId = match?.id ?? requested;
  const posted = await postSlackMessage(client.token, channelId, String(payload.text));
  const base = config.url.endsWith("/") ? config.url : config.url + "/";
  return { htmlUrl: `${base}archives/${posted.channel}/p${posted.ts.replace(".", "")}` };
}
