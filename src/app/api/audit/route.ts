import { NextResponse } from "next/server";
import { db, getDefaultWorkspace } from "@/lib/db";

export async function GET() {
  const ws = await getDefaultWorkspace();
  const logs = await db.auditLog.findMany({
    where: { workspaceId: ws.id },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  return NextResponse.json({ logs });
}
