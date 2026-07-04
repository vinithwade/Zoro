import { test } from "node:test";
import assert from "node:assert/strict";
import { detectBlockerCandidates, type EventLite } from "./blocker-rules";

const NOW = new Date("2026-07-04T12:00:00Z").getTime();
const daysAgo = (d: number) => new Date(NOW - d * 24 * 60 * 60 * 1000);

function ev(p: Partial<EventLite> & Pick<EventLite, "id" | "type">): EventLite {
  return {
    entityRef: null,
    entityType: null,
    title: "",
    importance: 2,
    occurredAt: daysAgo(0),
    ...p,
  };
}

test("stale open PR (>3d, no activity) is a candidate", () => {
  const events = [
    ev({ id: "e1", type: "pr.opened", entityRef: "a/b#1", occurredAt: daysAgo(5) }),
  ];
  const c = detectBlockerCandidates(events, NOW);
  assert.equal(c.length, 1);
  assert.equal(c[0].kind, "stale_pr");
  assert.deepEqual(c[0].eventIds, ["e1"]);
});

test("merged PR is not a blocker", () => {
  const events = [
    ev({ id: "e1", type: "pr.opened", entityRef: "a/b#1", occurredAt: daysAgo(5) }),
    ev({ id: "e2", type: "pr.merged", entityRef: "a/b#1", occurredAt: daysAgo(4) }),
  ];
  assert.equal(detectBlockerCandidates(events, NOW).length, 0);
});

test("failing CI on an open PR is a candidate and dominates staleness", () => {
  const events = [
    ev({ id: "e1", type: "pr.opened", entityRef: "a/b#2", occurredAt: daysAgo(6) }),
    ev({ id: "e2", type: "ci.failed", entityRef: "a/b#2", importance: 4, occurredAt: daysAgo(1) }),
  ];
  const c = detectBlockerCandidates(events, NOW);
  assert.equal(c.length, 1);
  assert.equal(c[0].kind, "ci_failing");
  assert.deepEqual(c[0].eventIds, ["e2"]);
});

test("recent open PR (<3d) is not stale", () => {
  const events = [
    ev({ id: "e1", type: "pr.opened", entityRef: "a/b#9", occurredAt: daysAgo(1) }),
  ];
  assert.equal(detectBlockerCandidates(events, NOW).length, 0);
});

test("urgent issue open >7d is a candidate; normal issue is not", () => {
  const events = [
    ev({ id: "u1", type: "issue.opened", entityRef: "a/b#3", importance: 3, occurredAt: daysAgo(10), title: "Login broken" }),
    ev({ id: "n1", type: "issue.opened", entityRef: "a/b#4", importance: 2, occurredAt: daysAgo(10) }),
  ];
  const c = detectBlockerCandidates(events, NOW);
  assert.equal(c.length, 1);
  assert.equal(c[0].kind, "stale_urgent_issue");
  assert.deepEqual(c[0].eventIds, ["u1"]);
});

test("closed urgent issue is not a candidate", () => {
  const events = [
    ev({ id: "u1", type: "issue.opened", entityRef: "a/b#3", importance: 3, occurredAt: daysAgo(10) }),
    ev({ id: "u2", type: "issue.closed", entityRef: "a/b#3", occurredAt: daysAgo(1) }),
  ];
  assert.equal(detectBlockerCandidates(events, NOW).length, 0);
});
