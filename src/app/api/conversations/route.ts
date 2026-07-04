import { NextResponse } from "next/server";
import { db, getDefaultWorkspace } from "@/lib/db";

// List saved conversations (most recently active first).
export async function GET() {
  const ws = await getDefaultWorkspace();
  const conversations = await db.conversation.findMany({
    where: { workspaceId: ws.id },
    orderBy: { updatedAt: "desc" },
    take: 100,
    select: {
      id: true,
      title: true,
      updatedAt: true,
      _count: { select: { messages: true } },
    },
  });
  return NextResponse.json({
    conversations: conversations.map((c) => ({
      id: c.id,
      title: c.title,
      updatedAt: c.updatedAt,
      messageCount: c._count.messages,
    })),
  });
}
