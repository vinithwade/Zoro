import { NextResponse } from "next/server";
import { db, getDefaultWorkspace } from "@/lib/db";

// Latest engineering analysis (for rendering the session page).
export async function GET() {
  const ws = await getDefaultWorkspace();
  const summary = await db.sessionSummary.findFirst({
    where: { workspaceId: ws.id, department: "engineering" },
    orderBy: { createdAt: "desc" },
  });
  if (!summary) return NextResponse.json({ exists: false });

  // Map cited event ids → light event info so the UI can link to sources.
  const content = summary.content as Record<string, unknown>;
  const citedIds = new Set<string>();
  for (const key of ["blockers", "decisionsNeeded", "recommendations"]) {
    for (const item of (content[key] as { eventIds?: string[] }[]) ?? []) {
      (item.eventIds ?? []).forEach((id) => citedIds.add(id));
    }
  }
  const events = await db.event.findMany({
    where: { id: { in: [...citedIds] } },
    select: { id: true, type: true, entityRef: true, entityUrl: true, summary: true },
  });

  return NextResponse.json({
    exists: true,
    createdAt: summary.createdAt,
    content,
    events: Object.fromEntries(events.map((e) => [e.id, e])),
  });
}
