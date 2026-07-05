import "server-only";
import { createHash } from "node:crypto";
import { db } from "@/lib/db";
import { getSlackClient, postSlackMessage } from "@/lib/slack/client";

// Create a notification, deduped by key (same alert never created twice).
// New notifications are optionally pushed to Slack.
export async function notify(
  workspaceId: string,
  n: { type: "approval" | "decision" | "blocker" | "budget"; title: string; body?: string; href?: string; dedupeKey: string },
): Promise<void> {
  const existing = await db.notification.findUnique({
    where: { workspaceId_dedupeKey: { workspaceId, dedupeKey: n.dedupeKey } },
    select: { id: true },
  });
  if (existing) return; // already alerted — don't duplicate or resurface

  await db.notification.create({
    data: { workspaceId, type: n.type, title: n.title, body: n.body, href: n.href, dedupeKey: n.dedupeKey },
  });

  // Push to Slack if enabled. (Budget has its own dedicated Slack alert, so skip it here.)
  if (n.type === "budget") return;
  try {
    const pref = await db.notificationPref.findUnique({ where: { workspaceId } });
    if (!pref?.slackEnabled || !pref.channel) return;
    const slack = await getSlackClient(workspaceId);
    if (!slack) return;
    const ch = slack.config.channels.find((c) => c.name === pref.channel || c.id === pref.channel);
    if (!ch) return;
    await postSlackMessage(slack.token, ch.id, `🔔 *${n.title}*${n.body ? `\n${n.body}` : ""}`);
  } catch {
    // Slack push is best-effort — never block the in-app notification.
  }
}

export function hashKey(...parts: string[]): string {
  return createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 24);
}
