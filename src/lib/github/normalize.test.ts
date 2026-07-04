import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizePull,
  normalizeIssue,
  normalizeFailedChecks,
  normalizeCommits,
  type GhPull,
  type GhIssue,
  type GhCheckRun,
  type GhCommit,
} from "./normalize";

const repo = "acme/app";

test("open PR yields a single pr.opened event", () => {
  const pr: GhPull = {
    number: 42,
    title: "Fix auth",
    html_url: "https://github.com/acme/app/pull/42",
    state: "open",
    created_at: "2026-07-01T10:00:00Z",
    updated_at: "2026-07-02T10:00:00Z",
    closed_at: null,
    merged_at: null,
    user: { login: "wade" },
    head: { sha: "abc123" },
  };
  const events = normalizePull(repo, pr);
  assert.equal(events.length, 1);
  assert.equal(events[0].type, "pr.opened");
  assert.equal(events[0].sourceId, "github:pr:acme/app#42:opened");
  assert.equal(events[0].importance, 2);
});

test("merged PR yields opened + merged (merged is high importance)", () => {
  const pr: GhPull = {
    number: 7,
    title: "Ship it",
    html_url: "u",
    state: "closed",
    created_at: "2026-07-01T10:00:00Z",
    updated_at: "2026-07-03T10:00:00Z",
    closed_at: "2026-07-03T10:00:00Z",
    merged_at: "2026-07-03T10:00:00Z",
    user: { login: "wade" },
  };
  const events = normalizePull(repo, pr);
  const types = events.map((e) => e.type);
  assert.deepEqual(types, ["pr.opened", "pr.merged"]);
  assert.equal(events.find((e) => e.type === "pr.merged")!.importance, 3);
});

test("closed-unmerged PR does not emit pr.merged", () => {
  const pr: GhPull = {
    number: 8,
    title: "Abandoned",
    html_url: "u",
    state: "closed",
    created_at: "2026-07-01T10:00:00Z",
    updated_at: "2026-07-03T10:00:00Z",
    closed_at: "2026-07-03T10:00:00Z",
    merged_at: null,
    user: { login: "wade" },
  };
  const types = normalizePull(repo, pr).map((e) => e.type);
  assert.deepEqual(types, ["pr.opened", "pr.closed"]);
});

test("issues endpoint items that are actually PRs are skipped", () => {
  const issue: GhIssue = {
    number: 1,
    title: "A PR masquerading as an issue",
    html_url: "u",
    state: "open",
    created_at: "2026-07-01T10:00:00Z",
    updated_at: "2026-07-01T10:00:00Z",
    closed_at: null,
    user: { login: "wade" },
    labels: [],
    pull_request: { url: "..." },
  };
  assert.equal(normalizeIssue(repo, issue).length, 0);
});

test("bug-labeled issue is high importance", () => {
  const issue: GhIssue = {
    number: 5,
    title: "Login broken",
    html_url: "u",
    state: "open",
    created_at: "2026-07-01T10:00:00Z",
    updated_at: "2026-07-01T10:00:00Z",
    closed_at: null,
    user: { login: "wade" },
    labels: [{ name: "bug" }],
  };
  const events = normalizeIssue(repo, issue);
  assert.equal(events[0].type, "issue.opened");
  assert.equal(events[0].importance, 3);
});

test("failed CI on open PR is critical", () => {
  const pr: GhPull = {
    number: 42,
    title: "Fix auth",
    html_url: "u",
    state: "open",
    created_at: "2026-07-01T10:00:00Z",
    updated_at: "2026-07-02T10:00:00Z",
    closed_at: null,
    merged_at: null,
    user: { login: "wade" },
    head: { sha: "abc123" },
  };
  const checks: GhCheckRun[] = [
    { name: "build", status: "completed", conclusion: "success", html_url: "u", completed_at: "2026-07-02T09:00:00Z" },
    { name: "test", status: "completed", conclusion: "failure", html_url: "u", completed_at: "2026-07-02T09:05:00Z" },
  ];
  const events = normalizeFailedChecks(repo, pr, checks);
  assert.equal(events.length, 1);
  assert.equal(events[0].type, "ci.failed");
  assert.equal(events[0].importance, 4);
  assert.equal(events[0].sourceId, "github:check:acme/app:abc123:failed");
});

test("all-passing CI yields no event", () => {
  const pr: GhPull = {
    number: 42, title: "x", html_url: "u", state: "open",
    created_at: "2026-07-01T10:00:00Z", updated_at: "2026-07-02T10:00:00Z",
    closed_at: null, merged_at: null, user: { login: "wade" }, head: { sha: "abc" },
  };
  const checks: GhCheckRun[] = [
    { name: "build", status: "completed", conclusion: "success", html_url: "u", completed_at: "2026-07-02T09:00:00Z" },
  ];
  assert.equal(normalizeFailedChecks(repo, pr, checks).length, 0);
});

test("commits are batched into one low-importance event", () => {
  const commits: GhCommit[] = [
    { sha: "sha1abcdef", html_url: "u", commit: { message: "a", author: { name: "Wade", date: "2026-07-03T10:00:00Z" } }, author: { login: "wade" } },
    { sha: "sha2", html_url: "u", commit: { message: "b", author: { name: "Ro", date: "2026-07-03T09:00:00Z" } }, author: { login: "rohan" } },
  ];
  const events = normalizeCommits(repo, commits);
  assert.equal(events.length, 1);
  assert.equal(events[0].type, "commit.pushed");
  assert.equal(events[0].importance, 1);
  assert.equal(events[0].sourceId, "github:commits:acme/app:sha1abcdef");
});
