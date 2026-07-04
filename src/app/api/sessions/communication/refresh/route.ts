import { NextResponse } from "next/server";
import { getDefaultWorkspace } from "@/lib/db";
import { runCommunicationSession } from "@/lib/ai/communication-session";

export async function POST() {
  const ws = await getDefaultWorkspace();
  const result = await runCommunicationSession(ws.id);
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
