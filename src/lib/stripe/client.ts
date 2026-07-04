import "server-only";
import Stripe from "stripe";
import { db } from "@/lib/db";
import { decrypt } from "@/lib/crypto";

export type StripeConfig = {
  accountId: string;
  accountName: string | null;
  currency: string;
  livemode: boolean;
};

export async function getStripeClient(
  workspaceId: string,
): Promise<{ stripe: Stripe; config: StripeConfig } | null> {
  const integration = await db.integration.findUnique({
    where: { workspaceId_provider: { workspaceId, provider: "stripe" } },
  });
  if (!integration) return null;
  const key = decrypt(integration.encryptedToken);
  return {
    stripe: new Stripe(key),
    config: integration.config as StripeConfig,
  };
}

// Validate a Stripe key and return account info. Uses balance.retrieve (works
// with any read key) to confirm the key and derive the currency; the account
// display name is best-effort.
export async function verifyStripeKey(key: string): Promise<StripeConfig> {
  const stripe = new Stripe(key);
  const balance = await stripe.balance.retrieve();
  const currency = (balance.available[0]?.currency ?? "usd").toUpperCase();

  let accountId = "";
  let accountName: string | null = null;
  try {
    const account = await (stripe.accounts.retrieve as (id?: string | null) => Promise<Stripe.Account>)(null);
    accountId = account.id ?? "";
    accountName = account.settings?.dashboard?.display_name ?? account.business_profile?.name ?? null;
  } catch {
    // some restricted keys can't read the account object — that's fine
  }

  return { accountId, accountName, currency, livemode: key.includes("_live_") };
}
