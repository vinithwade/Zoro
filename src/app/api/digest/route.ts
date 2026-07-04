import { NextResponse } from "next/server";
import { z } from "zod";
import { db, getDefaultWorkspace } from "@/lib/db";
import type { SlackConfig } from "@/lib/slack/client";

type DigestKind = "standup" | "investor";

function defaults(kind: DigestKind, channel: string) {
  return kind === "investor"
    ? { enabled: false, cadence: "weekly", channel, hour: 9, minute: 0, dayOfWeek: 1, lastSentOn: null }
    : { enabled: false, cadence: "daily", channel, hour: 9, minute: 0, dayOfWeek: 1, lastSentOn: null };
}

export async function GET() {
  const ws = await getDefaultWorkspace();
  const [rows, slack] = await Promise.all([
    db.scheduledDigest.findMany({ where: { workspaceId: ws.id } }),
    db.integration.findUnique({ where: { workspaceId_provider: { workspaceId: ws.id, provider: "slack" } } }),
  ]);
  const channels = ((slack?.config as SlackConfig | undefined)?.channels ?? []).map((c) => c.name);
  const byKind = Object.fromEntries(rows.map((r) => [r.kind, r]));

  const build = (kind: DigestKind) => {
    const r = byKind[kind];
    const d = defaults(kind, channels[0] ?? "");
    return r
      ? { enabled: r.enabled, cadence: r.cadence, channel: r.channel || d.channel, hour: r.hour, minute: r.minute, dayOfWeek: r.dayOfWeek, lastSentOn: r.lastSentOn }
      : d;
  };

  return NextResponse.json({
    slackConnected: !!slack,
    channels,
    digests: { standup: build("standup"), investor: build("investor") },
  });
}

const putSchema = z.object({
  kind: z.enum(["standup", "investor"]),
  enabled: z.boolean(),
  channel: z.string(),
  hour: z.number().int().min(0).max(23),
  minute: z.number().int().min(0).max(59),
  dayOfWeek: z.number().int().min(0).max(6).optional(),
});

export async function PUT(req: Request) {
  const parsed = putSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid digest settings" }, { status: 400 });
  }
  const ws = await getDefaultWorkspace();
  const { kind, enabled, channel, hour, minute } = parsed.data;
  const cadence = kind === "investor" ? "weekly" : "daily";
  const dayOfWeek = parsed.data.dayOfWeek ?? 1;
  await db.scheduledDigest.upsert({
    where: { workspaceId_kind: { workspaceId: ws.id, kind } },
    create: { workspaceId: ws.id, kind, cadence, enabled, channel, hour, minute, dayOfWeek },
    update: { cadence, enabled, channel, hour, minute, dayOfWeek },
  });
  return NextResponse.json({ ok: true });
}
