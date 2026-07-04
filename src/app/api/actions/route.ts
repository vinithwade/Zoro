import { NextResponse } from "next/server";
import { db, getDefaultWorkspace } from "@/lib/db";

// List proposed actions. ?status=pending (default) or ?status=history.
export async function GET(req: Request) {
  const ws = await getDefaultWorkspace();
  const url = new URL(req.url);
  const view = url.searchParams.get("status") ?? "pending";

  const where =
    view === "history"
      ? {
          workspaceId: ws.id,
          status: { in: ["executed", "failed", "rejected", "expired"] },
        }
      : { workspaceId: ws.id, status: "pending" };

  const actions = await db.proposedAction.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  // Attach light info for the cited source events.
  const eventIds = new Set(actions.flatMap((a) => a.sourceEventIds));
  const events = await db.event.findMany({
    where: { id: { in: [...eventIds] } },
    select: { id: true, type: true, entityRef: true, entityUrl: true, summary: true },
  });
  const eventMap = Object.fromEntries(events.map((e) => [e.id, e]));

  return NextResponse.json({
    actions: actions.map((a) => ({
      id: a.id,
      actionType: a.actionType,
      title: a.title,
      reasoning: a.reasoning,
      payload: a.payload,
      riskLevel: a.riskLevel,
      status: a.status,
      sourceEvents: a.sourceEventIds.map((id) => eventMap[id]).filter(Boolean),
      externalResult: a.externalResult,
      error: a.error,
      createdAt: a.createdAt,
    })),
  });
}
