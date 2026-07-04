import { NextResponse } from "next/server";
import { z } from "zod";
import { db, getDefaultWorkspace } from "@/lib/db";
import { encrypt } from "@/lib/crypto";
import { verifyGithubToken } from "@/lib/github/client";
import { syncGithub } from "@/lib/github/sync";

const saveSchema = z.object({
  token: z.string().min(10),
  repos: z.array(z.string()).min(1, "Select at least one repository."),
});

// Current GitHub integration status (never returns the token).
export async function GET() {
  const ws = await getDefaultWorkspace();
  const integration = await db.integration.findUnique({
    where: { workspaceId_provider: { workspaceId: ws.id, provider: "github" } },
  });
  if (!integration) return NextResponse.json({ connected: false });
  const config = integration.config as { login?: string; repos?: string[] };
  return NextResponse.json({
    connected: true,
    status: integration.status,
    login: config.login,
    repos: config.repos ?? [],
    lastSyncedAt: integration.lastSyncedAt,
    lastError: integration.lastError,
  });
}

// Save the encrypted PAT + selected repos, then kick off the initial backfill.
export async function POST(req: Request) {
  const parsed = saveSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request" },
      { status: 400 },
    );
  }
  const { token, repos } = parsed.data;

  let login: string;
  try {
    const info = await verifyGithubToken(token);
    login = info.login;
    const allowed = new Set(info.repos.map((r) => r.fullName));
    const invalid = repos.filter((r) => !allowed.has(r));
    if (invalid.length > 0) {
      return NextResponse.json(
        { error: `Token cannot access: ${invalid.join(", ")}` },
        { status: 400 },
      );
    }
  } catch {
    return NextResponse.json({ error: "Invalid GitHub token" }, { status: 400 });
  }

  const ws = await getDefaultWorkspace();
  await db.integration.upsert({
    where: { workspaceId_provider: { workspaceId: ws.id, provider: "github" } },
    create: {
      workspaceId: ws.id,
      provider: "github",
      status: "connected",
      encryptedToken: encrypt(token),
      config: { owner: login, login, repos },
      // reset sync state so re-connecting triggers a fresh backfill
      lastSyncedAt: null,
      syncCursor: undefined,
    },
    update: {
      status: "connected",
      encryptedToken: encrypt(token),
      config: { owner: login, login, repos },
      lastSyncedAt: null,
      lastError: null,
    },
  });

  await db.auditLog.create({
    data: {
      workspaceId: ws.id,
      actorType: "human",
      actor: "founder",
      action: "integration.connected",
      targetType: "integration",
      metadata: { provider: "github", login, repos },
    },
  });

  // Backfill inline so the feed is populated by the time the UI redirects.
  const result = await syncGithub(ws.id, { backfill: true });

  return NextResponse.json({ ok: true, login, backfill: result });
}
