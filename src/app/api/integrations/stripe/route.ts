import { NextResponse } from "next/server";
import { z } from "zod";
import { db, getDefaultWorkspace } from "@/lib/db";
import { encrypt } from "@/lib/crypto";
import { verifyStripeKey } from "@/lib/stripe/client";
import { syncStripe } from "@/lib/stripe/sync";

export async function GET() {
  const ws = await getDefaultWorkspace();
  const integration = await db.integration.findUnique({
    where: { workspaceId_provider: { workspaceId: ws.id, provider: "stripe" } },
  });
  if (!integration) return NextResponse.json({ connected: false });
  const config = integration.config as { accountName?: string; currency?: string; livemode?: boolean };
  return NextResponse.json({
    connected: true,
    status: integration.status,
    accountName: config.accountName,
    currency: config.currency,
    livemode: config.livemode,
    lastSyncedAt: integration.lastSyncedAt,
  });
}

const saveSchema = z.object({ key: z.string().min(10) });

export async function POST(req: Request) {
  const parsed = saveSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "A Stripe API key is required." }, { status: 400 });
  }
  const { key } = parsed.data;

  let config;
  try {
    config = await verifyStripeKey(key);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Invalid key";
    return NextResponse.json({ error: `Stripe rejected the key: ${message}` }, { status: 400 });
  }

  const ws = await getDefaultWorkspace();
  await db.integration.upsert({
    where: { workspaceId_provider: { workspaceId: ws.id, provider: "stripe" } },
    create: { workspaceId: ws.id, provider: "stripe", status: "connected", encryptedToken: encrypt(key), config, lastSyncedAt: null },
    update: { status: "connected", encryptedToken: encrypt(key), config, lastSyncedAt: null, lastError: null },
  });
  await db.auditLog.create({
    data: {
      workspaceId: ws.id, actorType: "human", actor: "founder", action: "integration.connected",
      targetType: "integration", metadata: { provider: "stripe", account: config.accountName, livemode: config.livemode },
    },
  });

  const result = await syncStripe(ws.id, { backfill: true });
  return NextResponse.json({ ok: true, account: config.accountName, currency: config.currency, livemode: config.livemode, backfill: result });
}
