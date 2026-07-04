import type { SlackMessage } from "./client";

// Slack message → normalized CompanyEvent (source "slack", dept "communication").

export type SlackNormalizedEvent = {
  source: "slack";
  sourceId: string;
  type: string;
  department: "communication";
  title: string;
  summary: string;
  actor: string | null;
  entityType: string | null;
  entityRef: string | null;
  entityUrl: string | null;
  importance: number;
  occurredAt: Date;
  rawPayload: unknown;
};

// Signals that a message may describe a blocker / need. Code detects; AI explains.
const BLOCKER_TERMS = [
  "blocked", "blocker", "stuck", "waiting on", "can't", "cannot",
  "broken", "urgent", "asap", "not working", "need help", "help!",
  "failing", "is down", "regression", "stuck on",
];

export function messageImportance(text: string): number {
  const t = text.toLowerCase();
  return BLOCKER_TERMS.some((w) => t.includes(w)) ? 3 : 1;
}

// Resolve <@U123> mentions and <url|label> links into readable text.
export function cleanText(text: string, users: Map<string, string>): string {
  return text
    .replace(/<@([A-Z0-9]+)>/g, (_, id) => `@${users.get(id) ?? "someone"}`)
    .replace(/<#[A-Z0-9]+\|([^>]+)>/g, "#$1")
    .replace(/<([^>|]+)\|([^>]+)>/g, "$2")
    .replace(/<([^>]+)>/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function permalink(url: string, channelId: string, ts: string): string {
  const base = url.endsWith("/") ? url : url + "/";
  return `${base}archives/${channelId}/p${ts.replace(".", "")}`;
}

export function normalizeSlackMessage(
  channel: { id: string; name: string },
  msg: SlackMessage,
  users: Map<string, string>,
  botUserId: string,
  workspaceUrl: string,
): SlackNormalizedEvent | null {
  // Only real human messages — skip joins/leaves, edits, and the bot's own posts.
  if (msg.type !== "message") return null;
  if (msg.subtype) return null;
  if (msg.bot_id) return null;
  if (!msg.user || msg.user === botUserId) return null;
  const raw = (msg.text ?? "").trim();
  if (!raw) return null;

  const author = users.get(msg.user) ?? msg.user;
  const text = cleanText(raw, users);
  const short = text.length > 200 ? text.slice(0, 197) + "…" : text;

  return {
    source: "slack",
    sourceId: `slack:msg:${channel.id}:${msg.ts}`,
    type: "slack.message",
    department: "communication",
    title: `#${channel.name}`,
    summary: `@${author} in #${channel.name}: ${short}`,
    actor: author,
    entityType: "message",
    entityRef: `#${channel.name}`,
    entityUrl: permalink(workspaceUrl, channel.id, msg.ts),
    importance: messageImportance(text),
    occurredAt: new Date(parseFloat(msg.ts) * 1000),
    rawPayload: msg,
  };
}
