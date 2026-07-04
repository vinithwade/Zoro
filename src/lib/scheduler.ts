import "server-only";
import { db, getDefaultWorkspace } from "@/lib/db";
import { syncGithub } from "@/lib/github/sync";
import { syncSlack } from "@/lib/slack/sync";
import { maybeRefreshEngineeringSession } from "@/lib/ai/engineering-session";
import { maybeRefreshCommunicationSession } from "@/lib/ai/communication-session";
import { sendDigest } from "@/lib/ai/digest";

// In-process background poller. No Redis/BullMQ — for one local user a guarded
// setInterval is the simplest thing that works. Sync/AI are plain async fns, so
// this lifts into a real queue later without touching business logic.

const SYNC_INTERVAL_MS = 60_000;
const EXPIRY_SWEEP_EVERY_TICKS = 15; // ~every 15 min
const ACTION_TTL_DAYS = 7;

// Survive Next hot-reload: store the flag on globalThis so we don't stack timers.
const g = globalThis as unknown as { __zoroScheduler?: boolean };

export function startScheduler() {
  if (g.__zoroScheduler) return;
  g.__zoroScheduler = true;
  console.log("[scheduler] started — polling GitHub every 60s");

  let ticks = 0;
  const tick = async () => {
    ticks++;
    try {
      const ws = await getDefaultWorkspace();
      const gh = await syncGithub(ws.id);
      const slack = await syncSlack(ws.id).catch(() => ({ ingested: 0 }));
      const ingested = (gh.ingested ?? 0) + (slack.ingested ?? 0);
      if (ingested > 0) {
        console.log(`[scheduler] ingested ${ingested} event(s)`);
        // Auto-refresh AI analysis when new events land (throttled once / 15 min).
        await maybeRefreshEngineeringSession(ws.id).catch(() => {});
        if ((slack.ingested ?? 0) > 0) {
          await maybeRefreshCommunicationSession(ws.id).catch(() => {});
        }
      }
      await maybeSendDigest(ws.id);
      if (ticks % EXPIRY_SWEEP_EVERY_TICKS === 0) {
        await expireStaleActions(ws.id);
      }
    } catch (err) {
      console.error("[scheduler] tick failed:", err);
    }
  };

  // First tick after one interval (avoid a boot-time storm during hot reload).
  setInterval(tick, SYNC_INTERVAL_MS);
}

// Send the daily digest at most once per day, at/after the configured local time.
async function maybeSendDigest(workspaceId: string) {
  const cfg = await db.scheduledDigest.findUnique({ where: { workspaceId } });
  if (!cfg || !cfg.enabled || !cfg.channel) return;

  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  if (cfg.lastSentOn === today) return;

  const dueMinutes = cfg.hour * 60 + cfg.minute;
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  if (nowMinutes < dueMinutes) return;

  // Claim the slot first so a slow send can't double-fire.
  await db.scheduledDigest.update({ where: { workspaceId }, data: { lastSentOn: today } });
  const result = await sendDigest(workspaceId).catch((e) => ({ ok: false, error: String(e) }));
  if (result.ok) console.log(`[scheduler] posted daily digest to #${cfg.channel}`);
  else console.log(`[scheduler] digest skipped: ${(result as { error?: string }).error}`);
}

async function expireStaleActions(workspaceId: string) {
  const cutoff = new Date(Date.now() - ACTION_TTL_DAYS * 24 * 60 * 60 * 1000);
  const result = await db.proposedAction.updateMany({
    where: { workspaceId, status: "pending", createdAt: { lt: cutoff } },
    data: { status: "expired" },
  });
  if (result.count > 0) {
    console.log(`[scheduler] expired ${result.count} stale action(s)`);
  }
}
