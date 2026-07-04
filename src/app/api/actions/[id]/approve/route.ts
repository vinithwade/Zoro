import { NextResponse } from "next/server";
import { getDefaultWorkspace } from "@/lib/db";
import { executeAction } from "@/lib/actions/execute";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const ws = await getDefaultWorkspace();
  const result = await executeAction(ws.id, id);
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
