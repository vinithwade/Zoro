import { NextResponse } from "next/server";
import { z } from "zod";
import { db, getDefaultWorkspace } from "@/lib/db";
import { encrypt } from "@/lib/crypto";
import { verifySlackToken } from "@/lib/slack/client";
import { syncSlack } from "@/lib/slack/sync";

const saveSchema = z.object({
  token: z.string().min(10),
  channels: z
    .array(z.object({ id: z.string(), name: z.string() }))
    .min(1, "Select at least one channel."),
});

export async function GET() {
  const ws = await getDefaultWorkspace();
  const integration = await db.integration.findUnique({
    where: { workspaceId_provider: { workspaceId: ws.id, provider: "slack" } },
  });
  if (!integration) return NextResponse.json({ connected: false });
  const config = integration.config as { teamName?: string; channels?: { name: string }[] };
  return NextResponse.json({
    connected: true,
    status: integration.status,
    teamName: config.teamName,
    channels: config.channels ?? [],
    lastSyncedAt: integration.lastSyncedAt,
  });
}

export async function POST(req: Request) {
  const parsed = saveSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request" },
      { status: 400 },
    );
  }
  const { token, channels } = parsed.data;

  let info;
  try {
    info = await verifySlackToken(token);
  } catch {
    return NextResponse.json({ error: "Invalid Slack token" }, { status: 400 });
  }

  const ws = await getDefaultWorkspace();
  await db.integration.upsert({
    where: { workspaceId_provider: { workspaceId: ws.id, provider: "slack" } },
    create: {
      workspaceId: ws.id,
      provider: "slack",
      status: "connected",
      encryptedToken: encrypt(token),
      config: {
        teamId: info.teamId,
        teamName: info.teamName,
        botUserId: info.botUserId,
        url: info.url,
        channels,
      },
      lastSyncedAt: null,
    },
    update: {
      status: "connected",
      encryptedToken: encrypt(token),
      config: {
        teamId: info.teamId,
        teamName: info.teamName,
        botUserId: info.botUserId,
        url: info.url,
        channels,
      },
      lastSyncedAt: null,
      lastError: null,
    },
  });

  await db.auditLog.create({
    data: {
      workspaceId: ws.id,
      actorType: "human",
      actor: "founder",
      action: "integration.connected",
      targetType: "integration",
      metadata: { provider: "slack", team: info.teamName, channels: channels.map((c) => c.name) },
    },
  });

  const result = await syncSlack(ws.id, { backfill: true });
  return NextResponse.json({ ok: true, team: info.teamName, backfill: result });
}
