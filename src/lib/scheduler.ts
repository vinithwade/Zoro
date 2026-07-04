import "server-only";
import { db, getDefaultWorkspace } from "@/lib/db";
import { syncGithub } from "@/lib/github/sync";
import { maybeRefreshEngineeringSession } from "@/lib/ai/engineering-session";

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
      const result = await syncGithub(ws.id);
      if (result.ok && result.ingested > 0) {
        console.log(`[scheduler] ingested ${result.ingested} event(s)`);
        // Auto-refresh AI analysis when new events land (throttled once / 15 min).
        await maybeRefreshEngineeringSession(ws.id).catch(() => {});
      }
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
