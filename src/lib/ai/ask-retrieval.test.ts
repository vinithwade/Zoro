import { test } from "node:test";
import assert from "node:assert/strict";
import { tokenize, scoreEvent, rankEvents, type RankableEvent } from "./ask-retrieval";

function ev(p: Partial<RankableEvent> & Pick<RankableEvent, "id">): RankableEvent {
  return {
    type: "pr.opened", title: "", summary: null, actor: null, entityRef: null,
    importance: 2, occurredAt: new Date("2026-07-01T00:00:00Z"), ...p,
  };
}

test("tokenize drops stopwords and keeps issue numbers", () => {
  const t = tokenize("Why is PR #131 blocked for the auth work?");
  assert.ok(t.includes("#131"));
  assert.ok(t.includes("blocked"));
  assert.ok(t.includes("auth"));
  assert.ok(!t.includes("the"));
  assert.ok(!t.includes("why"));
});

test("scoreEvent counts matching tokens across fields", () => {
  const e = ev({ id: "e1", summary: "CI failing on PR #131 auth middleware", entityRef: "acme/app#131" });
  assert.equal(scoreEvent(e, tokenize("auth #131")), 2); // both 'auth' and '131' present
  assert.equal(scoreEvent(e, tokenize("stripe billing")), 0);
});

test("rankEvents surfaces the question-relevant event first", () => {
  const events = [
    ev({ id: "recent-irrelevant", summary: "Docs update", occurredAt: new Date("2026-07-04T00:00:00Z"), importance: 1 }),
    ev({ id: "relevant", summary: "CI failing on PR #131 auth", entityRef: "acme/app#131", occurredAt: new Date("2026-06-20T00:00:00Z"), importance: 2 }),
  ];
  const ranked = rankEvents(events, "why is #131 failing?", 10);
  assert.equal(ranked[0].id, "relevant");
});

test("with no keyword matches, ranking falls back to importance then recency", () => {
  const events = [
    ev({ id: "low", importance: 1, occurredAt: new Date("2026-07-04T00:00:00Z") }),
    ev({ id: "critical", importance: 4, occurredAt: new Date("2026-06-01T00:00:00Z") }),
  ];
  const ranked = rankEvents(events, "general status?", 10);
  assert.equal(ranked[0].id, "critical");
});
