import { test } from "node:test";
import assert from "node:assert/strict";
import { groundOutput } from "./grounding";
import type { EngineeringSessionOutputType } from "./schemas";

const base: EngineeringSessionOutputType = {
  summary: "s",
  health: "yellow",
  blockers: [],
  decisionsNeeded: [],
  recommendations: [],
  suggestedActions: [],
};

const eventIds = new Set(["e1", "e2"]);
const refNumbers = new Set(["acme/app#42"]);
const repos = new Set(["acme/app"]);

test("blocker citing an unknown event id is dropped", () => {
  const out = groundOutput(
    { ...base, blockers: [{ title: "x", severity: "high", explanation: "", eventIds: ["nope"] }] },
    eventIds, refNumbers, repos,
  );
  assert.equal(out.blockers.length, 0);
});

test("blocker keeps only known event ids", () => {
  const out = groundOutput(
    { ...base, blockers: [{ title: "x", severity: "high", explanation: "", eventIds: ["e1", "nope"] }] },
    eventIds, refNumbers, repos,
  );
  assert.deepEqual(out.blockers[0].eventIds, ["e1"]);
});

test("action for an unconnected repo is dropped", () => {
  const out = groundOutput(
    {
      ...base,
      suggestedActions: [{
        actionType: "github.comment_pr", title: "t", reasoning: "r",
        payload: { repo: "evil/repo", issueOrPrNumber: 42, issueTitle: null, body: "hi" },
        sourceEventIds: ["e1"],
      }],
    },
    eventIds, refNumbers, repos,
  );
  assert.equal(out.suggestedActions.length, 0);
});

test("comment action referencing a number not in events is dropped", () => {
  const out = groundOutput(
    {
      ...base,
      suggestedActions: [{
        actionType: "github.comment_pr", title: "t", reasoning: "r",
        payload: { repo: "acme/app", issueOrPrNumber: 999, issueTitle: null, body: "hi" },
        sourceEventIds: ["e1"],
      }],
    },
    eventIds, refNumbers, repos,
  );
  assert.equal(out.suggestedActions.length, 0);
});

test("valid comment action survives", () => {
  const out = groundOutput(
    {
      ...base,
      suggestedActions: [{
        actionType: "github.comment_pr", title: "t", reasoning: "r",
        payload: { repo: "acme/app", issueOrPrNumber: 42, issueTitle: null, body: "Please rebase." },
        sourceEventIds: ["e1"],
      }],
    },
    eventIds, refNumbers, repos,
  );
  assert.equal(out.suggestedActions.length, 1);
});

test("comment action with empty body fails registry validation and is dropped", () => {
  const out = groundOutput(
    {
      ...base,
      suggestedActions: [{
        actionType: "github.comment_pr", title: "t", reasoning: "r",
        payload: { repo: "acme/app", issueOrPrNumber: 42, issueTitle: null, body: "" },
        sourceEventIds: ["e1"],
      }],
    },
    eventIds, refNumbers, repos,
  );
  assert.equal(out.suggestedActions.length, 0);
});

test("create_issue with valid repo survives (no number check)", () => {
  const out = groundOutput(
    {
      ...base,
      suggestedActions: [{
        actionType: "github.create_issue", title: "t", reasoning: "r",
        payload: { repo: "acme/app", issueOrPrNumber: null, issueTitle: "Track the flaky test", body: "details" },
        sourceEventIds: ["e1"],
      }],
    },
    eventIds, refNumbers, repos,
  );
  assert.equal(out.suggestedActions.length, 1);
});
