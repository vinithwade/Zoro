import "server-only";
import { db, getDefaultWorkspace } from "@/lib/db";
import { syncGithub } from "@/lib/github/sync";
import { syncSlack } from "@/lib/slack/sync";
import { syncStripe } from "@/lib/stripe/sync";
import { maybeRefreshEngineeringSession } from "@/lib/ai/engineering-session";
import { maybeRefreshCommunicationSession } from "@/lib/ai/communication-session";
import { sendDigest, type DigestKind } from "@/lib/ai/digest";

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
      const stripe = await syncStripe(ws.id).catch(() => ({ ingested: 0 }));
      const ingested = (gh.ingested ?? 0) + (slack.ingested ?? 0) + (stripe.ingested ?? 0);
      if (ingested > 0) {
        console.log(`[scheduler] ingested ${ingested} event(s)`);
        // Auto-refresh AI analysis when new events land (throttled once / 15 min).
        await maybeRefreshEngineeringSession(ws.id).catch(() => {});
        if ((slack.ingested ?? 0) > 0) {
          await maybeRefreshCommunicationSession(ws.id).catch(() => {});
        }
      }
      await maybeSendDigests(ws.id);
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

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Send each enabled digest at most once per period, at/after its local time —
// but ONLY when there's real activity (so quiet periods stay silent; it retries
// later the same day/week if activity appears).
async function maybeSendDigests(workspaceId: string) {
  const digests = await db.scheduledDigest.findMany({ where: { workspaceId, enabled: true } });
  if (digests.length === 0) return;
  const now = new Date();
  const today = ymd(now);
  const nowMinutes = now.getHours() * 60 + now.getMinutes();

  for (const d of digests) {
    if (!d.channel || d.lastSentOn === today) continue;
    if (d.cadence === "weekly" && now.getDay() !== d.dayOfWeek) continue;
    if (nowMinutes < d.hour * 60 + d.minute) continue;

    // Cheap activity gate before doing any AI/Slack work.
    const since = new Date(Date.now() - (d.kind === "investor" ? 7 * 24 : 24) * 60 * 60 * 1000);
    const [signal, total] = await Promise.all([
      db.event.count({ where: { workspaceId, importance: { gte: 2 }, occurredAt: { gte: since } } }),
      db.event.count({ where: { workspaceId, occurredAt: { gte: since } } }),
    ]);
    if (signal === 0 && total < 3) continue; // nothing worth sending — retry later

    const result = await sendDigest(workspaceId, d.kind as DigestKind).catch((e) => ({ ok: false, error: String(e) }));
    if (result.ok) {
      await db.scheduledDigest.update({ where: { id: d.id }, data: { lastSentOn: today } });
      console.log(`[scheduler] posted ${d.kind} digest to #${d.channel}`);
    } else {
      console.log(`[scheduler] ${d.kind} digest skipped: ${(result as { error?: string }).error}`);
    }
  }
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
