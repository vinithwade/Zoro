import "server-only";
import { db } from "@/lib/db";
import { Prisma } from "@/generated/prisma";
import {
  cosine,
  parseVector,
  embedMissingEvents,
  embedMissingConversations,
} from "@/lib/ai/embeddings";

// Build a knowledge graph of the company's "memory" from the real event store
// and saved conversations. Nodes: people, repos, PRs, issues, conversations.
// Edges: authored / in-repo / committed / references.

export type GraphNode = {
  id: string;
  type: "repo" | "person" | "pull_request" | "issue" | "conversation";
  label: string;
  sublabel?: string;
  url?: string | null;
  weight: number; // drives node size
};

export type GraphLink = {
  source: string;
  target: string;
  kind: "in" | "authored" | "committed" | "references" | "similar";
};

export type MemoryGraph = {
  nodes: GraphNode[];
  links: GraphLink[];
  stats: { people: number; repos: number; entities: number; conversations: number };
};

const WINDOW_DAYS = 60;
const MAX_ENTITIES = 60;

// Extract "owner/repo" from an entityRef ("owner/repo#12") or a github URL.
function repoOf(entityRef: string | null, entityUrl: string | null): string | null {
  if (entityRef && entityRef.includes("/") && entityRef.includes("#")) {
    return entityRef.split("#")[0];
  }
  if (entityUrl) {
    const m = entityUrl.match(/github\.com\/([^/]+\/[^/]+)/);
    if (m) return m[1];
  }
  return null;
}

export async function buildMemoryGraph(workspaceId: string): Promise<MemoryGraph> {
  // Ensure embeddings exist (idempotent — no-op once everything is embedded).
  await embedMissingEvents(workspaceId).catch(() => {});
  await embedMissingConversations(workspaceId).catch(() => {});

  const since = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const events = await db.event.findMany({
    where: { workspaceId, occurredAt: { gte: since } },
    orderBy: [{ importance: "desc" }, { occurredAt: "desc" }],
    take: 500,
    select: {
      id: true, type: true, title: true, summary: true, actor: true,
      entityType: true, entityRef: true, entityUrl: true, importance: true,
    },
  });

  const nodes = new Map<string, GraphNode>();
  const linkSet = new Set<string>();
  const links: GraphLink[] = [];
  const eventToEntity = new Map<string, string>(); // event.id -> entity/repo node id
  const entityRep = new Map<string, string>(); // entity node id -> representative event id

  const addNode = (n: GraphNode) => {
    const existing = nodes.get(n.id);
    if (existing) existing.weight += n.weight;
    else nodes.set(n.id, n);
  };
  const addLink = (l: GraphLink) => {
    const key = `${l.source}->${l.target}:${l.kind}`;
    if (linkSet.has(key)) return;
    linkSet.add(key);
    links.push(l);
  };

  // Repos from the connected integration (always present as anchors).
  const integration = await db.integration.findUnique({
    where: { workspaceId_provider: { workspaceId, provider: "github" } },
  });
  const cfgRepos = (integration?.config as { repos?: string[] } | undefined)?.repos ?? [];
  for (const r of cfgRepos) {
    addNode({ id: `repo:${r}`, type: "repo", label: r, weight: 4 });
  }

  let entityCount = 0;
  for (const e of events) {
    const repo = repoOf(e.entityRef, e.entityUrl);
    if (repo) addNode({ id: `repo:${repo}`, type: "repo", label: repo, weight: 2 });

    // Person node
    if (e.actor) {
      addNode({ id: `person:${e.actor}`, type: "person", label: `@${e.actor}`, weight: 1 });
    }

    // Entity node (PR / issue), capped to keep the graph legible
    const isEntity =
      (e.entityType === "pull_request" || e.entityType === "issue") &&
      e.entityRef &&
      entityCount < MAX_ENTITIES;
    if (isEntity && e.entityRef) {
      const nodeType = e.entityType === "pull_request" ? "pull_request" : "issue";
      const id = `entity:${e.entityRef}`;
      if (!nodes.has(id)) entityCount++;
      addNode({
        id,
        type: nodeType,
        label: e.entityRef,
        sublabel: e.title,
        url: e.entityUrl,
        weight: 1 + e.importance * 0.5,
      });
      eventToEntity.set(e.id, id);
      if (!entityRep.has(id)) entityRep.set(id, e.id); // first (most important) event
      if (repo) addLink({ source: id, target: `repo:${repo}`, kind: "in" });
      if (e.actor) addLink({ source: `person:${e.actor}`, target: id, kind: "authored" });
    } else if (repo) {
      // non-entity event (e.g. commit) links the person to the repo
      eventToEntity.set(e.id, `repo:${repo}`);
      if (e.actor) addLink({ source: `person:${e.actor}`, target: `repo:${repo}`, kind: "committed" });
    }
  }

  // Conversation nodes + reference edges (this is what makes it "memory").
  const conversations = await db.conversation.findMany({
    where: { workspaceId },
    orderBy: { updatedAt: "desc" },
    take: 30,
    select: { id: true, title: true, messages: { select: { citedEventIds: true } } },
  });
  for (const c of conversations) {
    const convId = `conv:${c.id}`;
    addNode({ id: convId, type: "conversation", label: c.title, weight: 2 });
    const cited = new Set(c.messages.flatMap((m) => m.citedEventIds));
    for (const eid of cited) {
      const target = eventToEntity.get(eid);
      if (target && nodes.has(target)) {
        addLink({ source: convId, target, kind: "references" });
      }
    }
  }

  // Semantic similarity edges (the "vector graph") — connect entity and
  // conversation nodes whose embeddings are close in meaning.
  await addSemanticEdges(nodes, entityRep, addLink);

  // Drop links that point at nodes we capped out of existence.
  const validLinks = links.filter((l) => nodes.has(l.source) && nodes.has(l.target));

  const nodeList = [...nodes.values()];
  return {
    nodes: nodeList,
    links: validLinks,
    stats: {
      people: nodeList.filter((n) => n.type === "person").length,
      repos: nodeList.filter((n) => n.type === "repo").length,
      entities: nodeList.filter((n) => n.type === "pull_request" || n.type === "issue").length,
      conversations: nodeList.filter((n) => n.type === "conversation").length,
    },
  };
}

const SIM_THRESHOLD = 0.4; // cosine similarity above which two nodes are "related"
const SIM_PER_NODE = 3; // max similarity edges per node
const SIM_TOTAL_CAP = 60;

async function addSemanticEdges(
  nodes: Map<string, GraphNode>,
  entityRep: Map<string, string>,
  addLink: (l: GraphLink) => void,
) {
  // Gather the vectors backing each embeddable node.
  const eventIds = [...entityRep.values()];
  const convIds = [...nodes.keys()]
    .filter((id) => id.startsWith("conv:"))
    .map((id) => id.slice("conv:".length));

  const vectors = new Map<string, number[]>(); // nodeId -> vector

  if (eventIds.length) {
    const rows = await db.$queryRaw<{ id: string; emb: string }[]>(Prisma.sql`
      SELECT id, embedding::text AS emb FROM "Event"
      WHERE id IN (${Prisma.join(eventIds)}) AND embedding IS NOT NULL`);
    const byEvent = new Map(rows.map((r) => [r.id, parseVector(r.emb)]));
    for (const [nodeId, evId] of entityRep) {
      const v = byEvent.get(evId);
      if (v) vectors.set(nodeId, v);
    }
  }
  if (convIds.length) {
    const rows = await db.$queryRaw<{ id: string; emb: string }[]>(Prisma.sql`
      SELECT id, embedding::text AS emb FROM "Conversation"
      WHERE id IN (${Prisma.join(convIds)}) AND embedding IS NOT NULL`);
    for (const r of rows) vectors.set(`conv:${r.id}`, parseVector(r.emb));
  }

  const ids = [...vectors.keys()];
  if (ids.length < 2) return;

  // Pairwise cosine; keep each node's top-N most-similar neighbours.
  const perNode = new Map<string, { other: string; sim: number }[]>();
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const sim = cosine(vectors.get(ids[i])!, vectors.get(ids[j])!);
      if (sim < SIM_THRESHOLD) continue;
      for (const [a, b] of [[ids[i], ids[j]], [ids[j], ids[i]]] as const) {
        const arr = perNode.get(a) ?? [];
        arr.push({ other: b, sim });
        perNode.set(a, arr);
      }
    }
  }

  const emitted = new Set<string>();
  let total = 0;
  for (const [node, arr] of perNode) {
    arr.sort((x, y) => y.sim - x.sim);
    for (const { other } of arr.slice(0, SIM_PER_NODE)) {
      const key = [node, other].sort().join("|");
      if (emitted.has(key)) continue;
      emitted.add(key);
      if (total++ >= SIM_TOTAL_CAP) return;
      addLink({ source: node, target: other, kind: "similar" });
    }
  }
}
