import "server-only";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { getOpenAIClient } from "./openai";
import { getSlackClient, postSlackMessage } from "@/lib/slack/client";

// Compose a daily standup digest from the last 24h of activity (all sources).
export async function generateDigestText(workspaceId: string): Promise<string | null> {
  const client = await getOpenAIClient(workspaceId);
  if (!client) return null;

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const events = await db.event.findMany({
    where: { workspaceId, occurredAt: { gte: since } },
    orderBy: [{ importance: "desc" }, { occurredAt: "desc" }],
    take: 120,
    select: { department: true, type: true, summary: true, title: true, importance: true },
  });
  if (events.length === 0) return null;

  const lines = events
    .map((e) => `[${e.department}] ${e.type} (imp${e.importance}) — ${e.summary ?? e.title}`)
    .join("\n");

  const [eng, comm] = await Promise.all([
    db.sessionSummary.findFirst({ where: { workspaceId, department: "engineering" }, orderBy: { createdAt: "desc" } }),
    db.sessionSummary.findFirst({ where: { workspaceId, department: "communication" }, orderBy: { createdAt: "desc" } }),
  ]);
  const engText = (eng?.content as { summary?: string } | undefined)?.summary ?? "";
  const commText = (comm?.content as { summary?: string } | undefined)?.summary ?? "";

  const system = [
    "You are Zoro. Write a concise DAILY STANDUP update for a startup founder to post in Slack.",
    "Use Slack mrkdwn: *bold* for section headers, '•' for bullets. Sections in this order, but OMIT any that have nothing: *🚀 Shipped*, *🔨 In progress*, *🚧 Blockers*, *🤔 Decisions needed*.",
    "Use ONLY the provided activity — do not invent anything. Keep it tight: a few bullets per section, under ~1200 characters total. Start directly with a one-line header like '*Daily standup* — <today>'. No preamble or sign-off.",
  ].join("\n");
  const user = [
    `ACTIVITY (last 24h):\n${lines}`,
    engText ? `\nEngineering summary: ${engText}` : "",
    commText ? `\nComms summary: ${commText}` : "",
  ].join("\n");

  const completion = await client.chat.completions.create({
    model: env.OPENAI_MODEL,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  });
  return completion.choices[0]?.message?.content?.trim() || null;
}

export async function sendDigest(
  workspaceId: string,
  opts: { channel?: string } = {},
): Promise<{ ok: boolean; text?: string; error?: string }> {
  const slack = await getSlackClient(workspaceId);
  if (!slack) return { ok: false, error: "Slack is not connected." };

  const cfg = await db.scheduledDigest.findUnique({ where: { workspaceId } });
  const channelName = (opts.channel ?? cfg?.channel ?? "").replace(/^#/, "");
  if (!channelName) return { ok: false, error: "No channel configured." };

  const match = slack.config.channels.find((c) => c.name === channelName || c.id === channelName);
  if (!match) return { ok: false, error: "That channel isn't connected (invite the bot and re-select it)." };

  const text = await generateDigestText(workspaceId);
  if (!text) return { ok: false, error: "No activity in the last 24h to summarize." };

  await postSlackMessage(slack.token, match.id, text);
  await db.auditLog.create({
    data: {
      workspaceId,
      actorType: "ai",
      actor: "digest-agent",
      action: "digest.sent",
      metadata: { channel: channelName },
    },
  });
  return { ok: true, text };
}
