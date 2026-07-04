import { NextResponse } from "next/server";
import { z } from "zod";
import { getDefaultWorkspace } from "@/lib/db";
import { sendDigest } from "@/lib/ai/digest";

const bodySchema = z.object({ channel: z.string().optional() });

// Manual "Send test digest now".
export async function POST(req: Request) {
  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  const ws = await getDefaultWorkspace();
  const result = await sendDigest(ws.id, { channel: parsed.success ? parsed.data.channel : undefined });
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
