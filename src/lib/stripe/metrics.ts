import "server-only";
import { db } from "@/lib/db";
import { getStripeClient } from "./client";

export type RevenueMetrics = {
  currency: string;
  mrr: number; // monthly recurring revenue, in currency units (not cents)
  activeSubscriptions: number;
  newCustomers7d: number;
  newMrr7d: number;
  failedPayments7d: number;
  history: { date: string; mrr: number }[]; // ~30 daily points, oldest → newest
};

const HISTORY_DAYS = 30;
const DAY = 24 * 60 * 60;

function ymd(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toISOString().slice(0, 10);
}

// Multiplier to normalize a per-interval amount to a monthly figure.
const TO_MONTHLY: Record<string, number> = {
  day: 30,
  week: 52 / 12,
  month: 1,
  year: 1 / 12,
};

function monthlyCents(
  price: { unit_amount: number | null; recurring: { interval: string; interval_count: number } | null } | null,
  quantity: number | undefined,
): number {
  if (!price?.recurring || price.unit_amount == null) return 0;
  const amount = price.unit_amount * (quantity ?? 1);
  const factor = TO_MONTHLY[price.recurring.interval] ?? 1;
  return (amount * factor) / (price.recurring.interval_count || 1);
}

export async function getRevenueMetrics(workspaceId: string): Promise<RevenueMetrics | null> {
  const client = await getStripeClient(workspaceId);
  if (!client) return null;
  const { stripe, config } = client;
  const since7 = Math.floor((Date.now() - 7 * 24 * 60 * 60 * 1000) / 1000);

  try {
    // Pull ALL subscriptions (incl. canceled) so we can reconstruct history.
    const subs: { created: number; canceledAt: number | null; status: string; monthlyCents: number }[] = [];
    let scanned = 0;
    for await (const sub of stripe.subscriptions.list({ status: "all", limit: 100 })) {
      let m = 0;
      for (const item of sub.items.data) m += monthlyCents(item.price, item.quantity);
      subs.push({ created: sub.created, canceledAt: sub.canceled_at ?? null, status: sub.status, monthlyCents: m });
      if (++scanned >= 1000) break;
    }

    // Current MRR = live subscriptions only.
    const isLive = (s: string) => s === "active" || s === "trialing";
    let mrrCents = 0;
    let newMrrCents = 0;
    let active = 0;
    for (const s of subs) {
      if (!isLive(s.status)) continue;
      active++;
      mrrCents += s.monthlyCents;
      if (s.created >= since7) newMrrCents += s.monthlyCents;
    }

    // Daily MRR series: a subscription counts on day t if it existed and wasn't
    // yet canceled at t (approximates historical MRR from created/canceled_at).
    const nowSec = Math.floor(Date.now() / 1000);
    const history: { date: string; mrr: number }[] = [];
    for (let i = HISTORY_DAYS - 1; i >= 0; i--) {
      const t = nowSec - i * DAY;
      let cents = 0;
      for (const s of subs) {
        if (s.created <= t && (s.canceledAt == null || s.canceledAt > t)) cents += s.monthlyCents;
      }
      history.push({ date: ymd(t), mrr: Math.round(cents) / 100 });
    }

    let newCustomers = 0;
    scanned = 0;
    for await (const _c of stripe.customers.list({ created: { gte: since7 }, limit: 100 })) {
      void _c;
      newCustomers++;
      if (++scanned >= 1000) break;
    }

    let failed = 0;
    scanned = 0;
    for await (const ch of stripe.charges.list({ created: { gte: since7 }, limit: 100 })) {
      if (ch.status === "failed") failed++;
      if (++scanned >= 1000) break;
    }

    return {
      currency: config.currency,
      mrr: Math.round(mrrCents) / 100,
      activeSubscriptions: active,
      newCustomers7d: newCustomers,
      newMrr7d: Math.round(newMrrCents) / 100,
      failedPayments7d: failed,
      history,
    };
  } catch {
    return null;
  }
}

// Fast read of the last-computed metrics cached on the integration (no API call).
export async function getStoredMetrics(workspaceId: string): Promise<RevenueMetrics | null> {
  const integration = await db.integration.findUnique({
    where: { workspaceId_provider: { workspaceId, provider: "stripe" } },
    select: { syncCursor: true },
  });
  const cursor = integration?.syncCursor as { metrics?: RevenueMetrics } | null;
  return cursor?.metrics ?? null;
}

// Compact human-readable money, e.g. $1.2k, $980.
export function formatMoney(amount: number, currency: string): string {
  const symbol = currency === "USD" ? "$" : currency === "EUR" ? "€" : currency === "GBP" ? "£" : "";
  const prefix = symbol || "";
  const suffix = symbol ? "" : ` ${currency}`;
  if (amount >= 1000) return `${prefix}${(amount / 1000).toFixed(amount >= 10000 ? 0 : 1)}k${suffix}`;
  return `${prefix}${amount.toFixed(amount % 1 === 0 ? 0 : 2)}${suffix}`;
}
