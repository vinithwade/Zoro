import "server-only";
import { db } from "@/lib/db";
import { getGithubClient, type GithubConfig } from "./client";
import {
  normalizePull,
  normalizeIssue,
  normalizeCommits,
  normalizeFailedChecks,
  type NormalizedEvent,
  type GhPull,
  type GhIssue,
  type GhCommit,
  type GhCheckRun,
} from "./normalize";

const BACKFILL_DAYS = 30;
const OVERLAP_MS = 5 * 60 * 1000; // re-scan a 5-min window; dedupe absorbs it
const PER_PAGE = 100;

// In-process lock so the scheduler and a manual "Sync now" can't overlap.
const syncing = new Set<string>();

export type SyncResult = {
  ok: boolean;
  ingested: number;
  reposScanned: number;
  skipped?: boolean;
  error?: string;
  perRepoErrors?: { repo: string; error: string }[];
};

export function isSyncing(workspaceId: string): boolean {
  return syncing.has(workspaceId);
}

export async function syncGithub(
  workspaceId: string,
  opts: { backfill?: boolean } = {},
): Promise<SyncResult> {
  if (syncing.has(workspaceId)) {
    return { ok: true, ingested: 0, reposScanned: 0, skipped: true };
  }
  syncing.add(workspaceId);
  try {
    return await runSync(workspaceId, opts);
  } finally {
    syncing.delete(workspaceId);
  }
}

async function runSync(
  workspaceId: string,
  opts: { backfill?: boolean },
): Promise<SyncResult> {
  const client = await getGithubClient(workspaceId);
  if (!client) {
    return { ok: false, ingested: 0, reposScanned: 0, error: "GitHub not connected" };
  }
  const { octokit, config } = client;

  const integration = await db.integration.findUnique({
    where: { workspaceId_provider: { workspaceId, provider: "github" } },
  });
  const isBackfill = opts.backfill || !integration?.lastSyncedAt;
  const since = isBackfill
    ? new Date(Date.now() - BACKFILL_DAYS * 24 * 60 * 60 * 1000)
    : new Date(integration!.lastSyncedAt!.getTime() - OVERLAP_MS);
  const sinceIso = since.toISOString();

  const allEvents: NormalizedEvent[] = [];
  const perRepoErrors: { repo: string; error: string }[] = [];
  const repos = config.repos ?? [];

  for (const fullName of repos) {
    const [owner, repo] = fullName.split("/");
    if (!owner || !repo) continue;
    try {
      allEvents.push(...(await syncRepo(octokit, fullName, owner, repo, sinceIso)));
    } catch (err) {
      perRepoErrors.push({
        repo: fullName,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Dedupe within this batch, then persist (DB unique constraint dedupes across syncs).
  const seen = new Set<string>();
  const rows = allEvents
    .filter((e) => (seen.has(e.sourceId) ? false : (seen.add(e.sourceId), true)))
    .map((e) => ({ ...e, workspaceId, rawPayload: e.rawPayload as object }));

  let ingested = 0;
  if (rows.length > 0) {
    const result = await db.event.createMany({ data: rows, skipDuplicates: true });
    ingested = result.count;
  }

  await db.integration.update({
    where: { workspaceId_provider: { workspaceId, provider: "github" } },
    data: {
      lastSyncedAt: new Date(),
      status: perRepoErrors.length && !ingested ? "error" : "connected",
      lastError: perRepoErrors.length ? JSON.stringify(perRepoErrors) : null,
    },
  });

  // Only record a sync in the audit log when it actually ingested events —
  // routine "nothing changed" polls every 60s would otherwise flood it.
  // (Sync failures are surfaced via integration.status + lastError instead.)
  if (ingested > 0) {
    await db.auditLog.create({
      data: {
        workspaceId,
        actorType: "system",
        actor: "github-sync",
        action: "sync.completed",
        metadata: {
          ingested,
          reposScanned: repos.length,
          backfill: isBackfill,
          perRepoErrors,
        },
      },
    });
  }

  return {
    ok: true,
    ingested,
    reposScanned: repos.length,
    perRepoErrors: perRepoErrors.length ? perRepoErrors : undefined,
  };
}

async function syncRepo(
  octokit: NonNullable<Awaited<ReturnType<typeof getGithubClient>>>["octokit"],
  fullName: string,
  owner: string,
  repo: string,
  sinceIso: string,
): Promise<NormalizedEvent[]> {
  const events: NormalizedEvent[] = [];

  // Pull requests (state=all, most-recently-updated first).
  const { data: pulls } = await octokit.rest.pulls.list({
    owner,
    repo,
    state: "all",
    sort: "updated",
    direction: "desc",
    per_page: PER_PAGE,
  });
  const recentPulls = (pulls as unknown as GhPull[]).filter(
    (p) => new Date(p.updated_at) >= new Date(sinceIso),
  );
  for (const pr of recentPulls) {
    events.push(...normalizePull(fullName, pr));

    // Failed CI on OPEN PRs only (one checks call per open PR).
    if (pr.state === "open" && pr.head?.sha) {
      try {
        const { data: checks } = await octokit.rest.checks.listForRef({
          owner,
          repo,
          ref: pr.head.sha,
          per_page: PER_PAGE,
        });
        events.push(
          ...normalizeFailedChecks(
            fullName,
            pr,
            checks.check_runs as unknown as GhCheckRun[],
          ),
        );
      } catch {
        // "Checks: Read" permission may be absent — don't fail the whole sync.
      }
    }
  }

  // Issues (excludes PRs inside normalizeIssue).
  const { data: issues } = await octokit.rest.issues.listForRepo({
    owner,
    repo,
    state: "all",
    since: sinceIso,
    sort: "updated",
    direction: "desc",
    per_page: PER_PAGE,
  });
  for (const issue of issues as unknown as GhIssue[]) {
    events.push(...normalizeIssue(fullName, issue));
  }

  // Commits on the default branch since the window start.
  try {
    const { data: commits } = await octokit.rest.repos.listCommits({
      owner,
      repo,
      since: sinceIso,
      per_page: PER_PAGE,
    });
    events.push(
      ...normalizeCommits(fullName, commits as unknown as GhCommit[]),
    );
  } catch {
    // empty repo / no commits in range
  }

  return events;
}
