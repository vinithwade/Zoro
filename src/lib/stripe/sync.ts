import "server-only";
import type Stripe from "stripe";
import { db } from "@/lib/db";
import { Prisma } from "@/generated/prisma";
import { getStripeClient, type StripeConfig } from "./client";
import { getRevenueMetrics } from "./metrics";
import { embedMissingEvents } from "@/lib/ai/embeddings";

const METRICS_TTL_MS = 10 * 60 * 1000;

const BACKFILL_DAYS = 30;
const OVERLAP_MS = 5 * 60 * 1000;
const MAX_EVENTS = 400;

const syncing = new Set<string>();

const WATCHED: Record<string, { type: string; importance: number; label: string }> = {
  "customer.created": { type: "stripe.customer_created", importance: 1, label: "New customer" },
  "customer.subscription.created": { type: "stripe.subscription_created", importance: 2, label: "New subscription" },
  "customer.subscription.deleted": { type: "stripe.subscription_canceled", importance: 3, label: "Subscription canceled" },
  "invoice.payment_failed": { type: "stripe.payment_failed", importance: 3, label: "Payment failed" },
  "charge.failed": { type: "stripe.payment_failed", importance: 3, label: "Charge failed" },
};

export type StripeSyncResult = { ok: boolean; ingested: number; skipped?: boolean; error?: string };

function dashboardUrl(config: StripeConfig, obj: Stripe.Event.Data.Object): string {
  const prefix = config.livemode ? "" : "test/";
  const o = obj as { object?: string; id?: string; customer?: string };
  const map: Record<string, string> = {
    customer: "customers",
    subscription: "subscriptions",
    invoice: "invoices",
    charge: "payments",
  };
  const path = map[o.object ?? ""] ?? "";
  return `https://dashboard.stripe.com/${prefix}${path}${o.id ? `/${o.id}` : ""}`;
}

function describe(evtType: string, obj: Stripe.Event.Data.Object): { summary: string; actor: string | null; ref: string | null } {
  const o = obj as { id?: string; email?: string; name?: string; customer?: string; amount?: number; currency?: string };
  const who = o.email ?? o.name ?? (typeof o.customer === "string" ? o.customer : null);
  const meta = WATCHED[evtType];
  const amount = o.amount != null ? ` (${(o.amount / 100).toFixed(2)} ${String(o.currency ?? "").toUpperCase()})` : "";
  return {
    summary: `${meta.label}${who ? `: ${who}` : ""}${amount}`,
    actor: who,
    ref: o.id ?? null,
  };
}

export async function syncStripe(
  workspaceId: string,
  opts: { backfill?: boolean } = {},
): Promise<StripeSyncResult> {
  if (syncing.has(workspaceId)) return { ok: true, ingested: 0, skipped: true };
  syncing.add(workspaceId);
  try {
    return await run(workspaceId, opts);
  } finally {
    syncing.delete(workspaceId);
  }
}

async function run(workspaceId: string, opts: { backfill?: boolean }): Promise<StripeSyncResult> {
  const client = await getStripeClient(workspaceId);
  if (!client) return { ok: false, ingested: 0, error: "Stripe not connected" };
  const { stripe, config } = client;

  const integration = await db.integration.findUnique({
    where: { workspaceId_provider: { workspaceId, provider: "stripe" } },
  });
  const isBackfill = opts.backfill || !integration?.lastSyncedAt;
  const sinceMs = isBackfill
    ? Date.now() - BACKFILL_DAYS * 24 * 60 * 60 * 1000
    : integration!.lastSyncedAt!.getTime() - OVERLAP_MS;
  const since = Math.floor(sinceMs / 1000);

  const rows: Prisma.EventCreateManyInput[] = [];
  let scanned = 0;
  try {
    for await (const evt of stripe.events.list({ created: { gte: since }, limit: 100 })) {
      if (++scanned > MAX_EVENTS) break;
      const meta = WATCHED[evt.type];
      if (!meta) continue;
      const obj = evt.data.object;
      const d = describe(evt.type, obj);
      rows.push({
        workspaceId,
        source: "stripe",
        sourceId: `stripe:evt:${evt.id}`,
        type: meta.type,
        department: "revenue",
        title: meta.label,
        summary: d.summary,
        actor: d.actor,
        entityType: (obj as { object?: string }).object ?? null,
        entityRef: d.ref,
        entityUrl: dashboardUrl(config, obj),
        importance: meta.importance,
        occurredAt: new Date(evt.created * 1000),
        rawPayload: evt as object,
      });
    }
  } catch (err) {
    await db.integration.update({
      where: { workspaceId_provider: { workspaceId, provider: "stripe" } },
      data: { status: "error", lastError: err instanceof Error ? err.message : String(err), lastSyncedAt: new Date() },
    });
    return { ok: false, ingested: 0, error: err instanceof Error ? err.message : String(err) };
  }

  let ingested = 0;
  if (rows.length > 0) {
    const result = await db.event.createMany({ data: rows, skipDuplicates: true });
    ingested = result.count;
  }
  if (ingested > 0) await embedMissingEvents(workspaceId).catch(() => {});

  await db.integration.update({
    where: { workspaceId_provider: { workspaceId, provider: "stripe" } },
    data: { status: "connected", lastError: null, lastSyncedAt: new Date() },
  });

  // Refresh cached revenue metrics (throttled) so the dashboard reads them fast.
  const cursor = (integration?.syncCursor as { computedAt?: number } | null) ?? {};
  if (!cursor.computedAt || Date.now() - cursor.computedAt > METRICS_TTL_MS) {
    const metrics = await getRevenueMetrics(workspaceId).catch(() => null);
    if (metrics) {
      await db.integration.update({
        where: { workspaceId_provider: { workspaceId, provider: "stripe" } },
        data: { syncCursor: { metrics, computedAt: Date.now() } },
      });
    }
  }

  if (ingested > 0) {
    await db.auditLog.create({
      data: { workspaceId, actorType: "system", actor: "stripe-sync", action: "sync.completed", metadata: { source: "stripe", ingested, backfill: isBackfill } },
    });
  }

  return { ok: true, ingested };
}
