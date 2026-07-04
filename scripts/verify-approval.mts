// Verify the DB-level guarantees the approval state machine relies on:
//  - unique idempotencyKey rejects duplicate proposals
//  - the atomic updateMany status-guard (pending→executing) that execute.ts uses
//    returns count=1 for the first caller and count=0 for a racing second caller
// These are the exact queries in src/lib/actions/execute.ts.
import { PrismaClient } from "../src/generated/prisma/index.js";

const db = new PrismaClient();

async function main() {
  const ws = await db.workspace.create({ data: { name: `verify-appr-${Date.now()}` } });
  const results: string[] = [];
  const check = (name: string, cond: boolean) => results.push(`${cond ? "✅" : "❌"} ${name}`);

  // 1. Proposal idempotency — unique idempotencyKey.
  const key = "dup-" + Date.now();
  const mk = (idempotencyKey: string) => ({
    workspaceId: ws.id, actionType: "github.comment_pr", title: "t", reasoning: "r",
    payload: { repo: "acme/app", number: 1, body: "x" }, riskLevel: "low",
    status: "pending", sourceEventIds: [], idempotencyKey,
  });
  const action = await db.proposedAction.create({ data: mk(key) });
  let dupThrew = false;
  try { await db.proposedAction.create({ data: mk(key) }); } catch { dupThrew = true; }
  check("duplicate idempotencyKey is rejected", dupThrew);

  // 2. Atomic claim guard — the exact query execute.ts runs to claim an action.
  const claim = () =>
    db.proposedAction.updateMany({
      where: { id: action.id, workspaceId: ws.id, status: "pending" },
      data: { status: "executing" },
    });
  const first = await claim();
  const second = await claim();
  check("first claim wins (count=1)", first.count === 1);
  check("second claim is a no-op (count=0)", second.count === 0);

  // 3. Reject guard — same atomic pattern for the reject path.
  const action2 = await db.proposedAction.create({ data: mk("rej-" + Date.now()) });
  const rejectGuard = () =>
    db.proposedAction.updateMany({
      where: { id: action2.id, workspaceId: ws.id, status: "pending" },
      data: { status: "rejected" },
    });
  const rej1 = await rejectGuard();
  const rej2 = await rejectGuard();
  check("first reject wins (count=1)", rej1.count === 1);
  check("double-reject is a no-op (count=0)", rej2.count === 0);

  await db.workspace.delete({ where: { id: ws.id } });
  console.log("\n" + results.join("\n"));
  const allPass = results.every((r) => r.startsWith("✅"));
  console.log(`\n${allPass ? "✅ APPROVAL GUARANTEES VERIFIED" : "❌ SOME CHECKS FAILED"}`);
  await db.$disconnect();
  process.exit(allPass ? 0 : 1);
}

main().catch(async (e) => {
  console.error("ERROR:", e);
  await db.$disconnect();
  process.exit(1);
});
