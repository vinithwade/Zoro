// Deterministic blocker detection over the event stream. CODE decides what is
// blocked; the AI only prioritizes and explains. This is what prevents
// hallucinated blockers — every candidate is backed by real event ids.

export type EventLite = {
  id: string;
  type: string;
  entityRef: string | null;
  entityType: string | null;
  title: string;
  importance: number;
  occurredAt: Date;
};

export type BlockerCandidate = {
  kind: "ci_failing" | "stale_pr" | "awaiting_review" | "stale_urgent_issue";
  entityRef: string;
  description: string;
  ageHours: number;
  eventIds: string[];
};

const HOUR = 60 * 60 * 1000;
const STALE_PR_DAYS = 3;
const AWAITING_REVIEW_DAYS = 2;
const STALE_ISSUE_DAYS = 7;

export function detectBlockerCandidates(
  events: EventLite[],
  now: number = Date.now(),
): BlockerCandidate[] {
  const candidates: BlockerCandidate[] = [];

  // Group PR-related events (pr.* and ci.*) and issue events by entityRef.
  const prGroups = new Map<string, EventLite[]>();
  const issueGroups = new Map<string, EventLite[]>();
  const push = (m: Map<string, EventLite[]>, key: string, e: EventLite) => {
    const arr = m.get(key);
    if (arr) arr.push(e);
    else m.set(key, [e]);
  };
  for (const e of events) {
    if (!e.entityRef) continue;
    if (e.type.startsWith("pr.") || e.type.startsWith("ci.")) {
      push(prGroups, e.entityRef, e);
    } else if (e.type.startsWith("issue.")) {
      push(issueGroups, e.entityRef, e);
    }
  }

  for (const [ref, group] of prGroups) {
    const isClosed = group.some(
      (e) => e.type === "pr.merged" || e.type === "pr.closed",
    );
    if (isClosed) continue; // resolved — not a blocker

    const lastActivity = Math.max(...group.map((e) => e.occurredAt.getTime()));
    const ageHours = (now - lastActivity) / HOUR;

    const ciFail = group.find((e) => e.type === "ci.failed");
    if (ciFail) {
      candidates.push({
        kind: "ci_failing",
        entityRef: ref,
        description: `CI is failing on open PR ${ref}`,
        ageHours,
        eventIds: group.filter((e) => e.type === "ci.failed").map((e) => e.id),
      });
      continue; // failing CI dominates staleness for the same PR
    }

    const reviewReq = group.find((e) => e.type === "pr.review_requested");
    if (reviewReq && ageHours > AWAITING_REVIEW_DAYS * 24) {
      candidates.push({
        kind: "awaiting_review",
        entityRef: ref,
        description: `Open PR ${ref} has been awaiting review for ${Math.floor(ageHours / 24)}d`,
        ageHours,
        eventIds: [reviewReq.id],
      });
      continue;
    }

    if (ageHours > STALE_PR_DAYS * 24) {
      const opened = group.find((e) => e.type === "pr.opened");
      candidates.push({
        kind: "stale_pr",
        entityRef: ref,
        description: `Open PR ${ref} has had no activity for ${Math.floor(ageHours / 24)}d`,
        ageHours,
        eventIds: [opened?.id ?? group[0].id],
      });
    }
  }

  for (const [ref, group] of issueGroups) {
    const isClosed = group.some((e) => e.type === "issue.closed");
    if (isClosed) continue;
    const opened = group.find((e) => e.type === "issue.opened");
    if (!opened) continue;
    const ageHours = (now - opened.occurredAt.getTime()) / HOUR;
    // importance >= 3 means it was labeled bug/urgent/critical at ingest time.
    if (opened.importance >= 3 && ageHours > STALE_ISSUE_DAYS * 24) {
      candidates.push({
        kind: "stale_urgent_issue",
        entityRef: ref,
        description: `Urgent issue ${ref} ("${opened.title}") has been open ${Math.floor(ageHours / 24)}d`,
        ageHours,
        eventIds: [opened.id],
      });
    }
  }

  // Most-stale first.
  return candidates.sort((a, b) => b.ageHours - a.ageHours);
}
