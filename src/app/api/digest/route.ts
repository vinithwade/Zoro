import { NextResponse } from "next/server";
import { z } from "zod";
import { db, getDefaultWorkspace } from "@/lib/db";
import type { SlackConfig } from "@/lib/slack/client";

export async function GET() {
  const ws = await getDefaultWorkspace();
  const [config, slack] = await Promise.all([
    db.scheduledDigest.findUnique({ where: { workspaceId: ws.id } }),
    db.integration.findUnique({ where: { workspaceId_provider: { workspaceId: ws.id, provider: "slack" } } }),
  ]);
  const channels = ((slack?.config as SlackConfig | undefined)?.channels ?? []).map((c) => c.name);
  return NextResponse.json({
    slackConnected: !!slack,
    channels,
    config: {
      enabled: config?.enabled ?? false,
      channel: config?.channel ?? channels[0] ?? "",
      hour: config?.hour ?? 9,
      minute: config?.minute ?? 0,
      lastSentOn: config?.lastSentOn ?? null,
    },
  });
}

const putSchema = z.object({
  enabled: z.boolean(),
  channel: z.string(),
  hour: z.number().int().min(0).max(23),
  minute: z.number().int().min(0).max(59),
});

export async function PUT(req: Request) {
  const parsed = putSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid digest settings" }, { status: 400 });
  }
  const ws = await getDefaultWorkspace();
  const { enabled, channel, hour, minute } = parsed.data;
  await db.scheduledDigest.upsert({
    where: { workspaceId: ws.id },
    create: { workspaceId: ws.id, enabled, channel, hour, minute },
    update: { enabled, channel, hour, minute },
  });
  return NextResponse.json({ ok: true });
}
