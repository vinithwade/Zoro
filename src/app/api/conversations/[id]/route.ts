import { NextResponse } from "next/server";
import { db, getDefaultWorkspace } from "@/lib/db";

// Full message thread for a conversation, with cited events resolved for display.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const ws = await getDefaultWorkspace();
  const conversation = await db.conversation.findFirst({
    where: { id, workspaceId: ws.id },
    include: { messages: { orderBy: { createdAt: "asc" } } },
  });
  if (!conversation) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const citedIds = new Set(conversation.messages.flatMap((m) => m.citedEventIds));
  const events = await db.event.findMany({
    where: { id: { in: [...citedIds] } },
    select: { id: true, type: true, entityRef: true, entityUrl: true, summary: true },
  });
  const eventMap = Object.fromEntries(events.map((e) => [e.id, e]));

  return NextResponse.json({
    id: conversation.id,
    title: conversation.title,
    messages: conversation.messages.map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      events: m.citedEventIds.map((cid) => eventMap[cid]).filter(Boolean),
    })),
  });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const ws = await getDefaultWorkspace();
  const deleted = await db.conversation.deleteMany({
    where: { id, workspaceId: ws.id },
  });
  return NextResponse.json({ ok: deleted.count > 0 });
}
