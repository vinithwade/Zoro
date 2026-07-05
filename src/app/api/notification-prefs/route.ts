import { NextResponse } from "next/server";
import { z } from "zod";
import { db, getDefaultWorkspace } from "@/lib/db";
import type { SlackConfig } from "@/lib/slack/client";

export async function GET() {
  const ws = await getDefaultWorkspace();
  const [pref, slack] = await Promise.all([
    db.notificationPref.findUnique({ where: { workspaceId: ws.id } }),
    db.integration.findUnique({ where: { workspaceId_provider: { workspaceId: ws.id, provider: "slack" } } }),
  ]);
  const channels = ((slack?.config as SlackConfig | undefined)?.channels ?? []).map((c) => c.name);
  return NextResponse.json({
    slackConnected: !!slack,
    channels,
    slackEnabled: pref?.slackEnabled ?? false,
    channel: pref?.channel || channels[0] || "",
  });
}

const putSchema = z.object({ slackEnabled: z.boolean(), channel: z.string() });

export async function PUT(req: Request) {
  const parsed = putSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid settings" }, { status: 400 });
  }
  const ws = await getDefaultWorkspace();
  const { slackEnabled, channel } = parsed.data;
  await db.notificationPref.upsert({
    where: { workspaceId: ws.id },
    create: { workspaceId: ws.id, slackEnabled, channel },
    update: { slackEnabled, channel },
  });
  return NextResponse.json({ ok: true });
}
