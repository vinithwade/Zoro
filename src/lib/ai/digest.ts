import "server-only";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { getOpenAIClient } from "./openai";
import { getSlackClient, postSlackMessage, fetchMentionMap, mentionFor } from "@/lib/slack/client";

export type DigestKind = "standup" | "investor";

type SummaryContent = {
  summary?: string;
  blockers?: { title: string; severity: string; eventIds: string[] }[];
};

// Resolve each blocker's owner (from cited events' actor) into a Slack mention.
async function buildBlockerOwners(
  workspaceId: string,
  mentions: Map<string, string>,
): Promise<string[]> {
  const [eng, comm] = await Promise.all([
    db.sessionSummary.findFirst({ where: { workspaceId, department: "engineering" }, orderBy: { createdAt: "desc" } }),
    db.sessionSummary.findFirst({ where: { workspaceId, department: "communication" }, orderBy: { createdAt: "desc" } }),
  ]);
  const blockers = [
    ...((eng?.content as SummaryContent)?.blockers ?? []),
    ...((comm?.content as SummaryContent)?.blockers ?? []),
  ];
  if (blockers.length === 0) return [];

  const allEventIds = [...new Set(blockers.flatMap((b) => b.eventIds ?? []))];
  const events = await db.event.findMany({
    where: { id: { in: allEventIds } },
    select: { id: true, actor: true },
  });
  const actorByEvent = new Map(events.map((e) => [e.id, e.actor]));

  return blockers.map((b) => {
    const owner = (b.eventIds ?? []).map((id) => actorByEvent.get(id)).find(Boolean) ?? null;
    const who = owner ? ` — owner: ${mentionFor(owner, mentions)}` : "";
    return `${b.title} (${b.severity})${who}`;
  });
}

export async function generateDigest(
  workspaceId: string,
  kind: DigestKind,
  mentions: Map<string, string>,
): Promise<string | null> {
  const client = await getOpenAIClient(workspaceId);
  if (!client) return null;

  const windowHours = kind === "investor" ? 24 * 7 : 24;
  const since = new Date(Date.now() - windowHours * 60 * 60 * 1000);
  const events = await db.event.findMany({
    where: { workspaceId, occurredAt: { gte: since } },
    orderBy: [{ importance: "desc" }, { occurredAt: "desc" }],
    take: kind === "investor" ? 250 : 120,
    select: { department: true, type: true, summary: true, title: true, importance: true },
  });

  // "Only send on real activity" — skip trivial days for the standup.
  const meaningful = events.filter((e) => e.importance >= 2).length > 0 || events.length >= 3;
  if (!meaningful) return null;

  const lines = events
    .map((e) => `[${e.department}] ${e.type} (imp${e.importance}) — ${e.summary ?? e.title}`)
    .join("\n");
  const blockerOwners = await buildBlockerOwners(workspaceId, mentions);

  let system: string;
  if (kind === "investor") {
    const counts: Record<string, number> = {};
    for (const e of events) counts[e.type] = (counts[e.type] ?? 0) + 1;
    const metrics = Object.entries(counts).map(([t, n]) => `${t}: ${n}`).join(", ");
    system = [
      "You are Zoro, writing a WEEKLY INVESTOR UPDATE for a startup founder to post in a private Slack channel.",
      "Use Slack mrkdwn: *bold* headers, '•' bullets. Sections, omitting any that are empty: *📦 Shipped this week*, *📊 Progress*, *🚧 Challenges*, *🎯 Next week & asks*.",
      "Tone: confident, concise, honest — written for investors. Use ONLY the provided activity; do not invent metrics or facts. Under ~1600 characters. Start with '*Weekly update* — week of <date>'. No sign-off.",
      `Rough activity counts to reference where useful: ${metrics}.`,
    ].join("\n");
  } else {
    system = [
      "You are Zoro. Write a concise DAILY STANDUP update for a startup founder to post in Slack.",
      "Use Slack mrkdwn: *bold* headers, '•' bullets. Sections, omitting any that are empty: *🚀 Shipped*, *🔨 In progress*, *🚧 Blockers*, *🤔 Decisions needed*.",
      "In the Blockers section, @-mention each blocker's owner using the EXACT token provided in the blocker-owners list (e.g. <@U123> or @name) — do not alter these tokens.",
      "Use ONLY the provided activity — do not invent anything. Keep it tight, under ~1200 characters. Start with '*Daily standup* — <today>'. No preamble or sign-off.",
    ].join("\n");
  }

  const user = [
    `ACTIVITY (last ${kind === "investor" ? "7 days" : "24h"}):\n${lines}`,
    blockerOwners.length ? `\nBLOCKERS WITH OWNERS (use these mention tokens verbatim):\n${blockerOwners.map((b) => `• ${b}`).join("\n")}` : "",
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
  kind: DigestKind,
  opts: { channel?: string } = {},
): Promise<{ ok: boolean; text?: string; error?: string }> {
  const slack = await getSlackClient(workspaceId);
  if (!slack) return { ok: false, error: "Slack is not connected." };

  const cfg = await db.scheduledDigest.findUnique({
    where: { workspaceId_kind: { workspaceId, kind } },
  });
  const channelName = (opts.channel ?? cfg?.channel ?? "").replace(/^#/, "");
  if (!channelName) return { ok: false, error: "No channel configured." };

  const match = slack.config.channels.find((c) => c.name === channelName || c.id === channelName);
  if (!match) return { ok: false, error: "That channel isn't connected (invite the bot and re-select it)." };

  const mentions = await fetchMentionMap(slack.token).catch(() => new Map<string, string>());
  const text = await generateDigest(workspaceId, kind, mentions);
  if (!text) {
    return {
      ok: false,
      error: kind === "investor" ? "No activity this week to summarize." : "No meaningful activity to summarize yet.",
    };
  }

  await postSlackMessage(slack.token, match.id, text);
  await db.auditLog.create({
    data: { workspaceId, actorType: "ai", actor: "digest-agent", action: "digest.sent", metadata: { kind, channel: channelName } },
  });
  return { ok: true, text };
}
