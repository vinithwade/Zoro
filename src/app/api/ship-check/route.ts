import { NextResponse } from "next/server";
import { z } from "zod";
import { getDefaultWorkspace } from "@/lib/db";
import { runShipCheck } from "@/lib/ai/ship-check";

const bodySchema = z.object({ what: z.string().min(1).max(500) });

export async function POST(req: Request) {
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, reason: "Describe what you want to ship." }, { status: 400 });
  }
  const ws = await getDefaultWorkspace();
  const result = await runShipCheck(ws.id, parsed.data.what);
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
