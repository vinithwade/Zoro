import { NextResponse } from "next/server";
import { z } from "zod";
import { verifySlackToken } from "@/lib/slack/client";

const bodySchema = z.object({ token: z.string().min(10) });

export async function POST(req: Request) {
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "A Slack bot token is required." }, { status: 400 });
  }
  try {
    const info = await verifySlackToken(parsed.data.token);
    return NextResponse.json(info);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not verify token";
    return NextResponse.json(
      { error: `Slack rejected the token: ${message}` },
      { status: 400 },
    );
  }
}
