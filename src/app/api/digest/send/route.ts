import { NextResponse } from "next/server";
import { z } from "zod";
import { getDefaultWorkspace } from "@/lib/db";
import { sendDigest } from "@/lib/ai/digest";

const bodySchema = z.object({
  kind: z.enum(["standup", "investor"]).default("standup"),
  channel: z.string().optional(),
});

// Manual "Send test digest now".
export async function POST(req: Request) {
  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  const kind = parsed.success ? parsed.data.kind : "standup";
  const channel = parsed.success ? parsed.data.channel : undefined;
  const ws = await getDefaultWorkspace();
  const result = await sendDigest(ws.id, kind, { channel });
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
