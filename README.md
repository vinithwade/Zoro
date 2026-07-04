# Zoro — Startup Command Center

Zoro is an **AI coordination layer** that sits on top of the tools your startup already uses (starting with **GitHub**). It ingests everything into one normalized event store, uses AI to summarize what's happening and detect blockers, and **proposes actions you approve** — nothing risky ever runs without a human clicking "Approve." Every AI action is logged and traceable to the source events.

This is **Slice 1**: the full loop, proven end-to-end with GitHub only.
`connect → event store → Engineering session + CEO dashboard → AI summary/blockers → propose action → approve → execute on GitHub → audit`

---

## What you need (one-time)

1. **PostgreSQL running locally** (already installed via Homebrew here):
   ```bash
   brew services start postgresql@14
   createdb zoro          # if it doesn't exist yet
   ```
   Zoro uses **pgvector** for semantic memory (Ask Zoro recall + the Memory graph). Install it once:
   ```bash
   brew install pgvector   # if the bottle isn't built for your Postgres, build from source:
   #   git clone --branch v0.8.0 https://github.com/pgvector/pgvector && cd pgvector
   #   make PG_CONFIG=/opt/homebrew/opt/postgresql@14/bin/pg_config
   #   make install PG_CONFIG=/opt/homebrew/opt/postgresql@14/bin/pg_config
   ```
   The `prisma migrate` step below runs `CREATE EXTENSION vector` for you.
2. **A GitHub fine-grained Personal Access Token** — the simplest way to connect (no app registration, no tunnels):
   - GitHub → **Settings → Developer settings → Fine-grained tokens → Generate new token**
   - Name it "Zoro", 90-day expiry, **Resource owner** = you/your org
   - **Repository access** → "Only select repositories" → pick the repo(s) Zoro should watch
   - **Permissions** → Repository:
     - Contents: **Read**
     - Issues: **Read and write**
     - Pull requests: **Read and write**
     - Checks / Commit statuses: **Read**
     - Metadata: Read (added automatically)
   - Generate and copy the `github_pat_…` string
3. **An OpenAI API key** — from [platform.openai.com](https://platform.openai.com) → API keys. Add a little billing credit.

You'll paste the GitHub token and OpenAI key into Zoro's **Connect Tools** page — not into any file.

---

## Setup

```bash
npm install
cp .env.example .env          # then set the values below
npm run db:migrate            # create the database tables
npm run dev                   # start the app
```

In `.env`:
- `DATABASE_URL` — defaults to `postgresql://USER@localhost:5432/zoro`; set `USER` to your macOS username.
- `APP_ENCRYPTION_KEY` — generate one with `openssl rand -base64 32`. This encrypts your tokens at rest.
- `OPENAI_MODEL` — defaults to `gpt-4o-mini` (cheap and fast). Bump to `gpt-4o` for higher quality.

Open **http://localhost:3000**.

---

## Try it in 3 minutes

### Option A — preview with demo data (no accounts needed)
```bash
npm run demo:seed     # loads a realistic fake startup into the default workspace
```
Open http://localhost:3000 to see the dashboard, Engineering session, Approvals inbox, and Audit log fully populated. When you're ready for real data:
```bash
npm run demo:clear    # wipe the demo data
```

### Option B — connect your real GitHub
1. Go to **Connect Tools**, paste your GitHub token → **Test** → select your repo(s) → **Connect & sync**.
2. Paste your OpenAI key → **Save key**.
3. Open **Engineering** — you'll see your real PRs/issues in the live feed. Click **Refresh analysis** to get an AI summary + blockers.
4. If the AI proposes an action, open **Approvals**, review the exact content, and click **Approve** — Zoro posts it to GitHub and records the whole chain in the **Audit Log**.

The app polls GitHub every 60 seconds, so merging a PR or opening an issue shows up within a minute (or click **Sync now**).

---

## How it works (the important guarantees)

- **AI never invents facts.** Blockers are detected by deterministic rules over real events; the AI only prioritizes and explains them. Every blocker, recommendation, and action must cite real event ids or it's dropped.
- **Nothing executes without you.** The AI can only *propose*. You approve or reject. There are no dangerous actions in Slice 1 (no merge, close, deploy).
- **Double-clicks are safe.** An atomic status guard + a unique idempotency key mean an action executes at most once.
- **Everything is auditable.** Proposals, approvals, executions, and syncs are all logged with actor and timestamp.
- **Your secrets are encrypted at rest** (AES-256-GCM) and only leave your machine to call GitHub / OpenAI.

---

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Start the app (http://localhost:3000) |
| `npm run db:migrate` | Create/update database tables |
| `npm run demo:seed` / `npm run demo:clear` | Load / remove demo data |
| `npm test` | Run the unit tests (crypto, GitHub normalization, blocker rules, grounding) |
| `npm run typecheck` | TypeScript check |
| `npm run db:studio` | Browse the database in Prisma Studio |

---

## Tech

Next.js 16 (App Router) · TypeScript · Tailwind · PostgreSQL + Prisma · OpenAI (structured outputs) · Octokit · an in-process 60s poller (no Redis). Single local app, single workspace — the schema is already multi-tenant-ready for later.

## Troubleshooting

- **Dev server is slow or throws a manifest `SyntaxError`** → the `.next` cache got corrupted. Fix: `rm -rf .next && npm run dev`.
- **"OpenAI rejected the key"** → double-check the key and that the account has billing credit.
- **GitHub token can't access a repo** → make sure that repo is selected in the token's "Only select repositories" list with the permissions above.

## What's intentionally not built yet (later slices)

Real-time webhooks (vs polling) · semantic search over events (pgvector) · Linear/Slack/Stripe and the other department sessions · multi-user auth · dangerous actions · deployment/hosting. The architecture is designed so each of these slots in without a rewrite.
