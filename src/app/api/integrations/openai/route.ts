import { NextResponse } from "next/server";
import { z } from "zod";
import OpenAI from "openai";
import { db, getDefaultWorkspace } from "@/lib/db";
import { encrypt } from "@/lib/crypto";

const saveSchema = z.object({ key: z.string().min(10) });

export async function GET() {
  const ws = await getDefaultWorkspace();
  const integration = await db.integration.findUnique({
    where: { workspaceId_provider: { workspaceId: ws.id, provider: "openai" } },
  });
  return NextResponse.json({
    connected: !!integration,
    status: integration?.status ?? "disconnected",
  });
}

// Validate the OpenAI key with a no-cost models.list call, then store encrypted.
export async function POST(req: Request) {
  const parsed = saveSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "An OpenAI API key is required." },
      { status: 400 },
    );
  }
  const { key } = parsed.data;
  try {
    const client = new OpenAI({ apiKey: key });
    await client.models.list();
  } catch {
    return NextResponse.json(
      { error: "OpenAI rejected the key. Check it and try again." },
      { status: 400 },
    );
  }

  const ws = await getDefaultWorkspace();
  await db.integration.upsert({
    where: { workspaceId_provider: { workspaceId: ws.id, provider: "openai" } },
    create: {
      workspaceId: ws.id,
      provider: "openai",
      status: "connected",
      encryptedToken: encrypt(key),
      config: {},
    },
    update: { status: "connected", encryptedToken: encrypt(key) },
  });

  return NextResponse.json({ ok: true });
}
