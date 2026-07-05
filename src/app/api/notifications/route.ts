import { NextResponse } from "next/server";
import { db, getDefaultWorkspace } from "@/lib/db";

export async function GET() {
  const ws = await getDefaultWorkspace();
  const [items, unread] = await Promise.all([
    db.notification.findMany({
      where: { workspaceId: ws.id },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
    db.notification.count({ where: { workspaceId: ws.id, read: false } }),
  ]);
  return NextResponse.json({ unread, items });
}
