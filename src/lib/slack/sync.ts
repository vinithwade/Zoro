import "server-only";
import { db } from "@/lib/db";
import { getSlackClient, fetchUserMap, fetchChannelHistory } from "./client";
import { normalizeSlackMessage, type SlackNormalizedEvent } from "./normalize";
import { embedMissingEvents } from "@/lib/ai/embeddings";

const BACKFILL_DAYS = 14;
const OVERLAP_MS = 5 * 60 * 1000;

const syncing = new Set<string>();

export type SlackSyncResult = {
  ok: boolean;
  ingested: number;
  channelsScanned: number;
  skipped?: boolean;
  error?: string;
  perChannelErrors?: { channel: string; error: string }[];
};

export function isSlackSyncing(workspaceId: string): boolean {
  return syncing.has(workspaceId);
}

export async function syncSlack(
  workspaceId: string,
  opts: { backfill?: boolean } = {},
): Promise<SlackSyncResult> {
  if (syncing.has(workspaceId)) {
    return { ok: true, ingested: 0, channelsScanned: 0, skipped: true };
  }
  syncing.add(workspaceId);
  try {
    return await run(workspaceId, opts);
  } finally {
    syncing.delete(workspaceId);
  }
}

async function run(
  workspaceId: string,
  opts: { backfill?: boolean },
): Promise<SlackSyncResult> {
  const client = await getSlackClient(workspaceId);
  if (!client) return { ok: false, ingested: 0, channelsScanned: 0, error: "Slack not connected" };
  const { token, config } = client;

  const integration = await db.integration.findUnique({
    where: { workspaceId_provider: { workspaceId, provider: "slack" } },
  });
  const isBackfill = opts.backfill || !integration?.lastSyncedAt;
  const sinceMs = isBackfill
    ? Date.now() - BACKFILL_DAYS * 24 * 60 * 60 * 1000
    : integration!.lastSyncedAt!.getTime() - OVERLAP_MS;
  const oldestUnix = sinceMs / 1000;

  const users = await fetchUserMap(token);
  const all: SlackNormalizedEvent[] = [];
  const perChannelErrors: { channel: string; error: string }[] = [];
  const channels = config.channels ?? [];

  for (const ch of channels) {
    try {
      const messages = await fetchChannelHistory(token, ch.id, oldestUnix);
      for (const m of messages) {
        const ev = normalizeSlackMessage(ch, m, users, config.botUserId, config.url);
        if (ev) all.push(ev);
      }
    } catch (err) {
      perChannelErrors.push({
        channel: ch.name,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const seen = new Set<string>();
  const rows = all
    .filter((e) => (seen.has(e.sourceId) ? false : (seen.add(e.sourceId), true)))
    .map((e) => ({ ...e, workspaceId, rawPayload: e.rawPayload as object }));

  let ingested = 0;
  if (rows.length > 0) {
    const result = await db.event.createMany({ data: rows, skipDuplicates: true });
    ingested = result.count;
  }
  if (ingested > 0) await embedMissingEvents(workspaceId).catch(() => {});

  await db.integration.update({
    where: { workspaceId_provider: { workspaceId, provider: "slack" } },
    data: {
      lastSyncedAt: new Date(),
      status: perChannelErrors.length && !ingested ? "error" : "connected",
      lastError: perChannelErrors.length ? JSON.stringify(perChannelErrors) : null,
    },
  });

  if (ingested > 0) {
    await db.auditLog.create({
      data: {
        workspaceId,
        actorType: "system",
        actor: "slack-sync",
        action: "sync.completed",
        metadata: { source: "slack", ingested, channelsScanned: channels.length, backfill: isBackfill },
      },
    });
  }

  return {
    ok: true,
    ingested,
    channelsScanned: channels.length,
    perChannelErrors: perChannelErrors.length ? perChannelErrors : undefined,
  };
}
