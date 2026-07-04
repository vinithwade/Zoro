import { NextResponse } from "next/server";
import { db, getDefaultWorkspace } from "@/lib/db";

// Paginated engineering event feed (most recent first).
export async function GET(req: Request) {
  const ws = await getDefaultWorkspace();
  const url = new URL(req.url);
  const limit = Math.min(Number(url.searchParams.get("limit") ?? 50), 200);
  const cursor = url.searchParams.get("cursor");

  const events = await db.event.findMany({
    where: { workspaceId: ws.id, department: "engineering" },
    orderBy: { occurredAt: "desc" },
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    select: {
      id: true,
      type: true,
      title: true,
      summary: true,
      actor: true,
      entityRef: true,
      entityUrl: true,
      importance: true,
      occurredAt: true,
    },
  });

  const hasMore = events.length > limit;
  const items = hasMore ? events.slice(0, limit) : events;
  return NextResponse.json({
    items,
    nextCursor: hasMore ? items[items.length - 1]?.id : null,
  });
}
