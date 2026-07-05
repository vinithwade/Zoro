import "server-only";
import { createHash } from "node:crypto";
import { db } from "@/lib/db";

// Create a notification, deduped by key (same alert never created twice).
export async function notify(
  workspaceId: string,
  n: { type: "approval" | "decision" | "blocker" | "budget"; title: string; body?: string; href?: string; dedupeKey: string },
): Promise<void> {
  await db.notification.upsert({
    where: { workspaceId_dedupeKey: { workspaceId, dedupeKey: n.dedupeKey } },
    create: {
      workspaceId,
      type: n.type,
      title: n.title,
      body: n.body,
      href: n.href,
      dedupeKey: n.dedupeKey,
    },
    update: {}, // already exists — don't duplicate or resurface
  });
}

export function hashKey(...parts: string[]): string {
  return createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 24);
}
