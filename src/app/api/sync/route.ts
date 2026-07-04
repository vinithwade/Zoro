import { NextResponse } from "next/server";
import { getDefaultWorkspace } from "@/lib/db";
import { syncGithub } from "@/lib/github/sync";
import { syncSlack } from "@/lib/slack/sync";

// Manual "Sync now" — runs every connected source.
export async function POST() {
  const ws = await getDefaultWorkspace();
  const gh = await syncGithub(ws.id);
  const slack = await syncSlack(ws.id).catch(() => ({ ok: false, ingested: 0 }));
  const ingested = (gh.ingested ?? 0) + (slack.ingested ?? 0);
  return NextResponse.json({ ok: gh.ok, ingested, github: gh, slack });
}
