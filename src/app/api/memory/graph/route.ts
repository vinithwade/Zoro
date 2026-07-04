import { NextResponse } from "next/server";
import { getDefaultWorkspace } from "@/lib/db";
import { buildMemoryGraph } from "@/lib/memory-graph";

export async function GET() {
  const ws = await getDefaultWorkspace();
  const graph = await buildMemoryGraph(ws.id);
  return NextResponse.json(graph);
}
