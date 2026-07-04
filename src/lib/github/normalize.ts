// GitHub state → normalized CompanyEvent(s).
//
// We poll snapshots, not an event stream, so `sourceId` encodes the specific
// STATE TRANSITION (opened / merged / closed / ci-failed). Re-polling the same
// state produces the same sourceId, which the DB's @@unique(workspaceId,
// sourceId) turns into a no-op. `summary` is deterministic templating — never
// AI. The AI layer only ever READS these rows.

export type NormalizedEvent = {
  source: "github";
  sourceId: string;
  type: string;
  department: "engineering";
  title: string;
  summary: string;
  actor: string | null;
  entityType: string | null;
  entityRef: string | null;
  entityUrl: string | null;
  importance: number; // 1 low, 2 normal, 3 high, 4 critical
  occurredAt: Date;
  rawPayload: unknown;
};

// ---- minimal shapes of the GitHub REST objects we consume ----

export interface GhPull {
  number: number;
  title: string;
  html_url: string;
  state: string; // "open" | "closed"
  draft?: boolean;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
  merged_at: string | null;
  user: { login: string } | null;
  head?: { sha: string };
  requested_reviewers?: { login: string }[] | null;
}

export interface GhIssue {
  number: number;
  title: string;
  html_url: string;
  state: string;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
  user: { login: string } | null;
  labels: (string | { name?: string })[];
  pull_request?: unknown; // present when the "issue" is actually a PR
}

export interface GhCommit {
  sha: string;
  html_url: string;
  commit: { message: string; author: { name?: string; date?: string } | null };
  author: { login: string } | null;
}

export interface GhCheckRun {
  name: string;
  status: string; // "queued" | "in_progress" | "completed"
  conclusion: string | null; // "success" | "failure" | "cancelled" | ...
  html_url: string | null;
  completed_at: string | null;
}

const IMPORTANCE = {
  low: 1,
  normal: 2,
  high: 3,
  critical: 4,
} as const;

function labelNames(labels: GhIssue["labels"]): string[] {
  return labels
    .map((l) => (typeof l === "string" ? l : (l.name ?? "")))
    .filter(Boolean)
    .map((l) => l.toLowerCase());
}

const URGENT_LABELS = ["bug", "critical", "urgent", "p0", "p1", "security"];

export function normalizePull(repo: string, pr: GhPull): NormalizedEvent[] {
  const ref = `${repo}#${pr.number}`;
  const events: NormalizedEvent[] = [];
  const author = pr.user?.login ?? null;

  // opened
  events.push({
    source: "github",
    sourceId: `github:pr:${ref}:opened`,
    type: "pr.opened",
    department: "engineering",
    title: `PR #${pr.number}: ${pr.title}`,
    summary: `@${author ?? "someone"} opened PR #${pr.number} "${pr.title}" in ${repo}`,
    actor: author,
    entityType: "pull_request",
    entityRef: ref,
    entityUrl: pr.html_url,
    importance: IMPORTANCE.normal,
    occurredAt: new Date(pr.created_at),
    rawPayload: pr,
  });

  if (pr.merged_at) {
    events.push({
      source: "github",
      sourceId: `github:pr:${ref}:merged`,
      type: "pr.merged",
      department: "engineering",
      title: `PR #${pr.number} merged: ${pr.title}`,
      summary: `PR #${pr.number} "${pr.title}" was merged in ${repo}`,
      actor: author,
      entityType: "pull_request",
      entityRef: ref,
      entityUrl: pr.html_url,
      importance: IMPORTANCE.high,
      occurredAt: new Date(pr.merged_at),
      rawPayload: pr,
    });
  } else if (pr.state === "closed" && pr.closed_at) {
    events.push({
      source: "github",
      sourceId: `github:pr:${ref}:closed`,
      type: "pr.closed",
      department: "engineering",
      title: `PR #${pr.number} closed without merge: ${pr.title}`,
      summary: `PR #${pr.number} "${pr.title}" was closed without merging in ${repo}`,
      actor: author,
      entityType: "pull_request",
      entityRef: ref,
      entityUrl: pr.html_url,
      importance: IMPORTANCE.normal,
      occurredAt: new Date(pr.closed_at),
      rawPayload: pr,
    });
  }

  // review requested (only meaningful while open)
  if (pr.state === "open" && (pr.requested_reviewers?.length ?? 0) > 0) {
    const reviewers = pr
      .requested_reviewers!.map((r) => `@${r.login}`)
      .join(", ");
    events.push({
      source: "github",
      sourceId: `github:pr:${ref}:review_requested:${pr.updated_at}`,
      type: "pr.review_requested",
      department: "engineering",
      title: `Review requested on PR #${pr.number}`,
      summary: `PR #${pr.number} "${pr.title}" is awaiting review from ${reviewers}`,
      actor: author,
      entityType: "pull_request",
      entityRef: ref,
      entityUrl: pr.html_url,
      importance: IMPORTANCE.normal,
      occurredAt: new Date(pr.updated_at),
      rawPayload: pr,
    });
  }

  return events;
}

export function normalizeIssue(repo: string, issue: GhIssue): NormalizedEvent[] {
  if (issue.pull_request) return []; // GitHub returns PRs from the issues endpoint — skip them
  const ref = `${repo}#${issue.number}`;
  const author = issue.user?.login ?? null;
  const labels = labelNames(issue.labels);
  const isUrgent = labels.some((l) => URGENT_LABELS.includes(l));
  const events: NormalizedEvent[] = [];

  events.push({
    source: "github",
    sourceId: `github:issue:${ref}:opened`,
    type: "issue.opened",
    department: "engineering",
    title: `Issue #${issue.number}: ${issue.title}`,
    summary: `@${author ?? "someone"} opened issue #${issue.number} "${issue.title}"${
      labels.length ? ` [${labels.join(", ")}]` : ""
    } in ${repo}`,
    actor: author,
    entityType: "issue",
    entityRef: ref,
    entityUrl: issue.html_url,
    importance: isUrgent ? IMPORTANCE.high : IMPORTANCE.normal,
    occurredAt: new Date(issue.created_at),
    rawPayload: issue,
  });

  if (issue.state === "closed" && issue.closed_at) {
    events.push({
      source: "github",
      sourceId: `github:issue:${ref}:closed`,
      type: "issue.closed",
      department: "engineering",
      title: `Issue #${issue.number} closed: ${issue.title}`,
      summary: `Issue #${issue.number} "${issue.title}" was closed in ${repo}`,
      actor: author,
      entityType: "issue",
      entityRef: ref,
      entityUrl: issue.html_url,
      importance: IMPORTANCE.normal,
      occurredAt: new Date(issue.closed_at),
      rawPayload: issue,
    });
  }

  return events;
}

// Failed CI on an OPEN PR is the highest-signal engineering event.
export function normalizeFailedChecks(
  repo: string,
  pr: GhPull,
  checkRuns: GhCheckRun[],
): NormalizedEvent[] {
  if (!pr.head?.sha) return [];
  const sha = pr.head.sha;
  const failed = checkRuns.filter(
    (c) =>
      c.status === "completed" &&
      (c.conclusion === "failure" || c.conclusion === "timed_out"),
  );
  if (failed.length === 0) return [];
  const names = failed.map((c) => c.name).join(", ");
  const occurredAt =
    failed
      .map((c) => c.completed_at)
      .filter(Boolean)
      .sort()
      .at(-1) ?? pr.updated_at;
  return [
    {
      source: "github",
      sourceId: `github:check:${repo}:${sha}:failed`,
      type: "ci.failed",
      department: "engineering",
      title: `CI failing on PR #${pr.number}`,
      summary: `CI is failing on PR #${pr.number} "${pr.title}" in ${repo} (${names})`,
      actor: pr.user?.login ?? null,
      entityType: "check_run",
      entityRef: `${repo}#${pr.number}`,
      entityUrl: failed[0].html_url ?? pr.html_url,
      importance: IMPORTANCE.critical,
      occurredAt: new Date(occurredAt),
      rawPayload: { pr: pr.number, sha, failed },
    },
  ];
}

// Commits are batched into a single low-importance event per sync per repo.
export function normalizeCommits(
  repo: string,
  commits: GhCommit[],
): NormalizedEvent[] {
  if (commits.length === 0) return [];
  const headSha = commits[0].sha;
  const authors = Array.from(
    new Set(
      commits
        .map((c) => c.author?.login ?? c.commit.author?.name)
        .filter(Boolean) as string[],
    ),
  ).slice(0, 4);
  const when = commits[0].commit.author?.date ?? new Date().toISOString();
  return [
    {
      source: "github",
      sourceId: `github:commits:${repo}:${headSha}`,
      type: "commit.pushed",
      department: "engineering",
      title: `${commits.length} commit${commits.length === 1 ? "" : "s"} to ${repo}`,
      summary: `${commits.length} commit${
        commits.length === 1 ? "" : "s"
      } pushed to ${repo} by ${authors.map((a) => `@${a}`).join(", ")}`,
      actor: authors[0] ?? null,
      entityType: "commit",
      entityRef: headSha.slice(0, 7),
      entityUrl: commits[0].html_url,
      importance: 1,
      occurredAt: new Date(when),
      rawPayload: { count: commits.length, headSha, authors },
    },
  ];
}
