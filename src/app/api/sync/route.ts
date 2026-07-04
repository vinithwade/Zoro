import { NextResponse } from "next/server";
import { getDefaultWorkspace } from "@/lib/db";
import { syncGithub } from "@/lib/github/sync";

// Manual "Sync now". The scheduler (M3) calls syncGithub on an interval too.
export async function POST() {
  const ws = await getDefaultWorkspace();
  const result = await syncGithub(ws.id);
  const status = result.ok ? 200 : 400;
  return NextResponse.json(result, { status });
}
