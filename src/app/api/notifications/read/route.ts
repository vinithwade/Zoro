import { NextResponse } from "next/server";
import { z } from "zod";
import { db, getDefaultWorkspace } from "@/lib/db";

const bodySchema = z.object({ id: z.string().optional() }); // omit id = mark all read

// Mark one (id) or all notifications as read.
export async function POST(req: Request) {
  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  const id = parsed.success ? parsed.data.id : undefined;
  const ws = await getDefaultWorkspace();
  await db.notification.updateMany({
    where: { workspaceId: ws.id, read: false, ...(id ? { id } : {}) },
    data: { read: true },
  });
  return NextResponse.json({ ok: true });
}
