import { NextResponse } from "next/server";
import { getDefaultWorkspace } from "@/lib/db";
import { runEngineeringSession } from "@/lib/ai/engineering-session";

// Manual "Refresh analysis" — always runs (ignores the throttle).
export async function POST() {
  const ws = await getDefaultWorkspace();
  const result = await runEngineeringSession(ws.id);
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
