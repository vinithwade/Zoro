// Standalone verification of the GitHub ingestion pipeline against REAL data.
// Runs as a one-shot process (which has network, unlike the sandboxed dev server).
// 1. Fetch real PRs/issues/commits from a public repo (unauthenticated Octokit).
// 2. Normalize them with the SAME functions the app uses.
// 3. Persist to a throwaway workspace, then re-run to prove dedupe (2nd = 0 new).
import { Octokit } from "octokit";
import {
  normalizePull,
  normalizeIssue,
  normalizeCommits,
  type GhPull,
  type GhIssue,
  type GhCommit,
} from "../src/lib/github/normalize.ts";
import { PrismaClient } from "../src/generated/prisma/index.js";

const REPO = process.env.TEST_REPO ?? "octokit/core.js";
const [owner, repo] = REPO.split("/");
const octokit = new Octokit(); // unauthenticated: fine for a public repo
const db = new PrismaClient();

async function main() {
  console.log(`\n=== Fetching real data from ${REPO} ===`);
  const { data: pulls } = await octokit.rest.pulls.list({
    owner, repo, state: "all", sort: "updated", direction: "desc", per_page: 20,
  });
  const { data: issues } = await octokit.rest.issues.listForRepo({
    owner, repo, state: "all", sort: "updated", direction: "desc", per_page: 20,
  });
  const { data: commits } = await octokit.rest.repos.listCommits({
    owner, repo, per_page: 20,
  });
  console.log(`fetched ${pulls.length} pulls, ${issues.length} issues, ${commits.length} commits`);

  const events = [
    ...(pulls as unknown as GhPull[]).flatMap((p) => normalizePull(REPO, p)),
    ...(issues as unknown as GhIssue[]).flatMap((i) => normalizeIssue(REPO, i)),
    ...normalizeCommits(REPO, commits as unknown as GhCommit[]),
  ];
  console.log(`\n=== Normalized into ${events.length} CompanyEvents ===`);
  const byType: Record<string, number> = {};
  for (const e of events) byType[e.type] = (byType[e.type] ?? 0) + 1;
  console.log("by type:", JSON.stringify(byType));
  console.log("\nsample events:");
  for (const e of events.slice(0, 5)) {
    console.log(`  [imp${e.importance}] ${e.type}  ${e.sourceId}`);
    console.log(`         ${e.summary}`);
  }

  const bad = events.filter(
    (e) => !e.sourceId || !e.type || !e.title || !e.occurredAt || isNaN(e.occurredAt.getTime()),
  );
  console.log(`\nmalformed events: ${bad.length} (expect 0)`);

  const ws = await db.workspace.create({ data: { name: `verify-${Date.now()}` } });
  const rows = events.map((e) => ({ ...e, workspaceId: ws.id, rawPayload: e.rawPayload as object }));
  const first = await db.event.createMany({ data: rows, skipDuplicates: true });
  const second = await db.event.createMany({ data: rows, skipDuplicates: true });
  console.log(`\n=== Persistence ===`);
  console.log(`first insert:  ${first.count} rows`);
  console.log(`second insert: ${second.count} rows (expect 0 — dedupe via unique sourceId)`);
  const stored = await db.event.count({ where: { workspaceId: ws.id } });
  console.log(`stored total:  ${stored}`);

  await db.workspace.delete({ where: { id: ws.id } });
  console.log(`\ncleaned up throwaway workspace ✓`);

  const pass = bad.length === 0 && second.count === 0 && first.count === stored;
  console.log(`\n${pass ? "✅ INGESTION PIPELINE VERIFIED" : "❌ VERIFICATION FAILED"}`);
  await db.$disconnect();
  process.exit(pass ? 0 : 1);
}

main().catch(async (e) => {
  console.error("ERROR:", e);
  await db.$disconnect();
  process.exit(1);
});
