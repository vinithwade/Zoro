// Populate the default workspace with realistic DEMO data so you can see the
// whole app working before connecting real tools.
//   npm run demo:seed    → load demo data
//   npm run demo:clear   → remove it (wipes the default workspace's data)
// The demo GitHub integration uses a fake token, so live sync / approving
// actions won't reach GitHub — it's purely to preview the UI.
import { createHash } from "node:crypto";
import { PrismaClient } from "../src/generated/prisma/index.js";
import { encrypt } from "../src/lib/crypto.ts";

const db = new PrismaClient();
const REPO = "acme/webapp";
const daysAgo = (d: number) => new Date(Date.now() - d * 24 * 60 * 60 * 1000);

async function getWs() {
  const existing = await db.workspace.findFirst({ where: { name: "default" } });
  return existing ?? db.workspace.create({ data: { name: "default" } });
}

async function clear() {
  const ws = await getWs();
  await db.$transaction([
    db.auditLog.deleteMany({ where: { workspaceId: ws.id } }),
    db.proposedAction.deleteMany({ where: { workspaceId: ws.id } }),
    db.sessionSummary.deleteMany({ where: { workspaceId: ws.id } }),
    db.event.deleteMany({ where: { workspaceId: ws.id } }),
    db.integration.deleteMany({ where: { workspaceId: ws.id } }),
  ]);
  console.log("✓ cleared demo data from the default workspace");
}

async function seed() {
  const ws = await getWs();
  await clear();

  await db.integration.create({
    data: {
      workspaceId: ws.id,
      provider: "github",
      status: "connected",
      encryptedToken: encrypt("github_pat_DEMO_fake_token"),
      config: { owner: "acme", login: "acme", repos: [REPO] },
      lastSyncedAt: daysAgo(0),
    },
  });

  const mk = (e: {
    type: string;
    sourceId: string;
    title: string;
    summary: string;
    actor: string;
    entityRef: string;
    entityType: string;
    importance: number;
    occurredAt: Date;
  }) =>
    db.event.create({
      data: {
        workspaceId: ws.id,
        source: "github",
        department: "engineering",
        entityUrl: `https://github.com/${REPO}`,
        rawPayload: {},
        ...e,
      },
    });

  const ci = await mk({
    type: "ci.failed", sourceId: "demo:ci:131", title: "CI failing on PR #131",
    summary: `CI is failing on PR #131 "Refactor auth middleware" in ${REPO} (auth-tests)`,
    actor: "priya", entityRef: `${REPO}#131`, entityType: "check_run", importance: 4, occurredAt: daysAgo(1),
  });
  const stalePr = await mk({
    type: "pr.opened", sourceId: "demo:pr:128", title: 'PR #128: Add Stripe webhook handler',
    summary: `@dev opened PR #128 "Add Stripe webhook handler" in ${REPO}`,
    actor: "dev", entityRef: `${REPO}#128`, entityType: "pull_request", importance: 2, occurredAt: daysAgo(5),
  });
  const urgentIssue = await mk({
    type: "issue.opened", sourceId: "demo:issue:140", title: "Issue #140: Login fails on Safari",
    summary: `@qa opened issue #140 "Login fails on Safari" [bug] in ${REPO}`,
    actor: "qa", entityRef: `${REPO}#140`, entityType: "issue", importance: 3, occurredAt: daysAgo(9),
  });
  await mk({
    type: "pr.merged", sourceId: "demo:pr:125:m", title: "PR #125 merged: Fix mobile nav",
    summary: `PR #125 "Fix mobile nav" was merged in ${REPO}`,
    actor: "sam", entityRef: `${REPO}#125`, entityType: "pull_request", importance: 3, occurredAt: daysAgo(1),
  });
  await mk({
    type: "pr.opened", sourceId: "demo:pr:131:o", title: "PR #131: Refactor auth middleware",
    summary: `@priya opened PR #131 "Refactor auth middleware" in ${REPO}`,
    actor: "priya", entityRef: `${REPO}#131`, entityType: "pull_request", importance: 2, occurredAt: daysAgo(2),
  });
  await mk({
    type: "commit.pushed", sourceId: "demo:commits", title: `4 commits to ${REPO}`,
    summary: `4 commits pushed to ${REPO} by @dev, @sam`,
    actor: "dev", entityRef: "a1b2c3d", entityType: "commit", importance: 1, occurredAt: daysAgo(0),
  });

  // Session summary grounded in the demo events.
  await db.sessionSummary.create({
    data: {
      workspaceId: ws.id,
      department: "engineering",
      eventIdsUsed: [ci.id, stalePr.id, urgentIssue.id],
      content: {
        summary:
          "Engineering shipped the mobile nav fix, but momentum is at risk: CI is failing on the auth-middleware refactor (PR #131), the Stripe webhook PR (#128) has stalled for 5 days, and a Safari login bug reported 9 days ago is still open. Recommend unblocking CI first, then triaging the Safari bug.",
        health: "red",
        blockers: [
          { title: "CI failing on PR #131 (auth middleware)", severity: "high", explanation: "The auth-tests check is failing, blocking the refactor from merging.", eventIds: [ci.id] },
          { title: "Stripe webhook PR #128 stalled 5 days", severity: "medium", explanation: "No activity for 5 days; may be blocking billing work.", eventIds: [stalePr.id] },
          { title: "Safari login bug open 9 days", severity: "high", explanation: "Customer-facing login failure reported 9 days ago, still unassigned.", eventIds: [urgentIssue.id] },
        ],
        decisionsNeeded: [
          { question: "Should the Safari login bug jump the queue?", context: "It's customer-facing and 9 days old, but engineering is mid-refactor.", eventIds: [urgentIssue.id] },
        ],
        recommendations: [
          { text: "Assign an owner to fix the failing auth-tests on PR #131 before it grows stale.", eventIds: [ci.id] },
          { text: "Ping the author of PR #128 to unblock the Stripe webhook work.", eventIds: [stalePr.id] },
        ],
        suggestedActions: [],
      },
    },
  });

  // Two pending proposed actions.
  const actions = [
    {
      actionType: "github.comment_pr",
      title: "Nudge PR #131 about failing CI",
      reasoning: "CI has been failing for a day and the PR is blocking the auth refactor. A gentle nudge can unblock it.",
      payload: { repo: REPO, number: 131, body: "Heads up — the `auth-tests` check is failing on this PR. Could you take a look so we can get the refactor merged? 🙏" },
      riskLevel: "low",
      sourceEventIds: [ci.id],
    },
    {
      actionType: "github.create_issue",
      title: "Track the Safari login bug as a priority",
      reasoning: "The Safari login failure has been open 9 days with no owner. Creating a prioritized tracking issue makes it actionable.",
      payload: { repo: REPO, title: "[P1] Safari login failure — triage and assign owner", body: "Reported 9 days ago in #140. Customer-facing. Needs an owner and a repro on Safari." },
      riskLevel: "medium",
      sourceEventIds: [urgentIssue.id],
    },
  ];
  for (const a of actions) {
    const idempotencyKey = createHash("sha256")
      .update(`${ws.id}|${a.actionType}|${JSON.stringify(a.payload)}`)
      .digest("hex");
    const created = await db.proposedAction.create({
      data: { workspaceId: ws.id, status: "pending", idempotencyKey, ...a },
    });
    await db.auditLog.create({
      data: { workspaceId: ws.id, actorType: "ai", actor: "engineering-agent", action: "action.proposed", targetType: "proposed_action", targetId: created.id, metadata: { actionType: a.actionType } },
    });
  }
  await db.auditLog.create({
    data: { workspaceId: ws.id, actorType: "ai", actor: "engineering-agent", action: "agent.run", metadata: { blockers: 3, recommendations: 2 } },
  });
  await db.auditLog.create({
    data: { workspaceId: ws.id, actorType: "system", actor: "github-sync", action: "sync.completed", metadata: { ingested: 6, backfill: true } },
  });

  console.log(`✓ seeded demo data into the default workspace (repo ${REPO})`);
  console.log("  open http://localhost:3000 to see the dashboard populated.");
}

const mode = process.argv[2] === "clear" ? clear : seed;
mode()
  .then(() => db.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await db.$disconnect();
    process.exit(1);
  });
