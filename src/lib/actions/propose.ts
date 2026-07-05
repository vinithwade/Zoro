import "server-only";
import { createHash } from "node:crypto";
import { db } from "@/lib/db";
import { notify } from "@/lib/notifications";

function canonicalJson(obj: Record<string, unknown>): string {
  return JSON.stringify(obj, Object.keys(obj).sort());
}

// Create a single pending ProposedAction with idempotency + audit.
// Returns true if created, false if a duplicate (same action already proposed).
export async function proposeAction(input: {
  workspaceId: string;
  agentRunId?: string;
  actionType: string;
  title: string;
  reasoning: string;
  payload: Record<string, unknown>;
  riskLevel: "low" | "medium";
  sourceEventIds: string[];
  actor?: string;
}): Promise<boolean> {
  const idempotencyKey = createHash("sha256")
    .update(`${input.workspaceId}|${input.actionType}|${canonicalJson(input.payload)}`)
    .digest("hex");
  try {
    const action = await db.proposedAction.create({
      data: {
        workspaceId: input.workspaceId,
        agentRunId: input.agentRunId,
        actionType: input.actionType,
        title: input.title,
        reasoning: input.reasoning,
        payload: input.payload as object,
        riskLevel: input.riskLevel,
        status: "pending",
        sourceEventIds: input.sourceEventIds,
        idempotencyKey,
      },
    });
    await db.auditLog.create({
      data: {
        workspaceId: input.workspaceId,
        actorType: "ai",
        actor: input.actor ?? "zoro-agent",
        action: "action.proposed",
        targetType: "proposed_action",
        targetId: action.id,
        metadata: { actionType: input.actionType, risk: input.riskLevel },
      },
    });
    await notify(input.workspaceId, {
      type: "approval",
      title: "Action needs your approval",
      body: input.title,
      href: "/approvals",
      dedupeKey: `approval:${idempotencyKey}`,
    });
    return true;
  } catch {
    return false; // unique idempotencyKey collision — already proposed
  }
}
