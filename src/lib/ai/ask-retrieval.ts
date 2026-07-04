// Pure retrieval helpers for Ask Zoro — keyword extraction and relevance
// ranking over events. No I/O, so this is unit-testable.

export type RankableEvent = {
  id: string;
  type: string;
  title: string;
  summary: string | null;
  actor: string | null;
  entityRef: string | null;
  importance: number;
  occurredAt: Date;
};

const STOP = new Set([
  "the", "and", "for", "are", "what", "why", "how", "who", "our", "this",
  "that", "with", "which", "was", "were", "has", "have", "does", "did",
  "any", "all", "can", "you", "zoro", "about", "into", "from", "when",
]);

export function tokenize(q: string): string[] {
  const tokens = q.toLowerCase().match(/#?\d+|[a-z][a-z0-9._-]{2,}/g) ?? [];
  return [...new Set(tokens.filter((t) => !STOP.has(t)))];
}

export function scoreEvent(e: RankableEvent, tokens: string[]): number {
  if (tokens.length === 0) return 0;
  const hay =
    `${e.type} ${e.title} ${e.summary ?? ""} ${e.entityRef ?? ""} ${e.actor ?? ""}`.toLowerCase();
  let score = 0;
  for (const t of tokens) {
    const needle = t.startsWith("#") ? t.slice(1) : t;
    if (hay.includes(needle)) score += 1;
  }
  return score;
}

// Rank by question relevance, then importance, then recency.
export function rankEvents<T extends RankableEvent>(
  events: T[],
  question: string,
  limit: number,
): T[] {
  const tokens = tokenize(question);
  return [...events]
    .map((e) => ({ e, score: scoreEvent(e, tokens) }))
    .sort(
      (a, b) =>
        b.score - a.score ||
        b.e.importance - a.e.importance ||
        b.e.occurredAt.getTime() - a.e.occurredAt.getTime(),
    )
    .slice(0, limit)
    .map((r) => r.e);
}
