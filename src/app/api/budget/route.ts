import { NextResponse } from "next/server";
import { z } from "zod";
import { db, getDefaultWorkspace } from "@/lib/db";
import { getTodaySpendUsd } from "@/lib/ai/cost";
import type { SlackConfig } from "@/lib/slack/client";

export async function GET() {
  const ws = await getDefaultWorkspace();
  const [budget, slack, todaySpend] = await Promise.all([
    db.spendBudget.findUnique({ where: { workspaceId: ws.id } }),
    db.integration.findUnique({ where: { workspaceId_provider: { workspaceId: ws.id, provider: "slack" } } }),
    getTodaySpendUsd(ws.id),
  ]);
  const channels = ((slack?.config as SlackConfig | undefined)?.channels ?? []).map((c) => c.name);

  return NextResponse.json({
    slackConnected: !!slack,
    channels,
    todaySpend,
    config: {
      dailyUsd: budget?.dailyUsd ?? 1.0,
      alertSlack: budget?.alertSlack ?? false,
      channel: budget?.channel || channels[0] || "",
    },
  });
}

const putSchema = z.object({
  dailyUsd: z.number().min(0).max(1000),
  alertSlack: z.boolean(),
  channel: z.string(),
});

export async function PUT(req: Request) {
  const parsed = putSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid budget settings" }, { status: 400 });
  }
  const ws = await getDefaultWorkspace();
  const { dailyUsd, alertSlack, channel } = parsed.data;
  await db.spendBudget.upsert({
    where: { workspaceId: ws.id },
    create: { workspaceId: ws.id, dailyUsd, alertSlack, channel },
    update: { dailyUsd, alertSlack, channel },
  });
  return NextResponse.json({ ok: true });
}
