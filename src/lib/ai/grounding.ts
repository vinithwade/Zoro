import {
  buildActionPayload,
  isActionType,
  type AiActionPayload,
} from "@/lib/actions/registry";
import type { EngineeringSessionOutputType } from "./schemas";

// The non-negotiable grounding gate: drop anything that cites unknown events or
// references not present in the event set. Pure + testable (no I/O).
export function groundOutput(
  out: EngineeringSessionOutputType,
  eventIds: Set<string>,
  refNumbers: Set<string>,
  connectedRepos: Set<string>,
): EngineeringSessionOutputType {
  const known = (ids: string[]) => ids.filter((id) => eventIds.has(id));

  return {
    summary: out.summary,
    health: out.health,
    blockers: out.blockers
      .map((b) => ({ ...b, eventIds: known(b.eventIds) }))
      .filter((b) => b.eventIds.length > 0),
    decisionsNeeded: out.decisionsNeeded
      .map((d) => ({ ...d, eventIds: known(d.eventIds) }))
      .filter((d) => d.eventIds.length > 0),
    recommendations: out.recommendations
      .map((r) => ({ ...r, eventIds: known(r.eventIds) }))
      .filter((r) => r.eventIds.length > 0),
    suggestedActions: out.suggestedActions.filter((a) => {
      if (!isActionType(a.actionType)) return false;
      if (!connectedRepos.has(a.payload.repo)) return false;
      if (a.actionType !== "github.create_issue") {
        const ref = `${a.payload.repo}#${a.payload.issueOrPrNumber}`;
        if (!refNumbers.has(ref)) return false;
      }
      return buildActionPayload(a.actionType, a.payload as AiActionPayload) !== null;
    }),
  };
}
