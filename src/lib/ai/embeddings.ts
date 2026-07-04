import "server-only";
import type OpenAI from "openai";
import { db } from "@/lib/db";
import { Prisma } from "@/generated/prisma";
import { getOpenAIClient } from "./openai";

// pgvector-backed embeddings for semantic memory + similarity edges.
// Model: text-embedding-3-small (1536 dims, cheap).

const MODEL = "text-embedding-3-small";

export function toVectorLiteral(vec: number[]): string {
  return "[" + vec.join(",") + "]";
}

export function parseVector(s: string): number[] {
  return s.replace(/^\[|\]$/g, "").split(",").map(Number);
}

export function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}

export async function embedTexts(
  client: OpenAI,
  texts: string[],
): Promise<number[][]> {
  if (texts.length === 0) return [];
  const res = await client.embeddings.create({ model: MODEL, input: texts });
  return res.data.map((d) => d.embedding as number[]);
}

export async function embedText(client: OpenAI, text: string): Promise<number[]> {
  const [v] = await embedTexts(client, [text.slice(0, 8000)]);
  return v;
}

// Embed any events that don't yet have an embedding. Idempotent + cheap after
// the first run (only touches rows where embedding IS NULL).
export async function embedMissingEvents(
  workspaceId: string,
  limit = 200,
): Promise<number> {
  const client = await getOpenAIClient(workspaceId);
  if (!client) return 0;
  const rows = await db.$queryRaw<
    { id: string; type: string; title: string; summary: string | null; entityRef: string | null }[]
  >`SELECT id, type, title, summary, "entityRef" FROM "Event"
    WHERE "workspaceId" = ${workspaceId} AND embedding IS NULL
    ORDER BY "occurredAt" DESC LIMIT ${limit}`;
  if (rows.length === 0) return 0;

  const texts = rows.map(
    (r) => `${r.type}: ${r.summary ?? r.title}${r.entityRef ? ` (${r.entityRef})` : ""}`,
  );
  const vecs = await embedTexts(client, texts);
  for (let i = 0; i < rows.length; i++) {
    await db.$executeRaw`UPDATE "Event" SET embedding = ${toVectorLiteral(vecs[i])}::vector WHERE id = ${rows[i].id}`;
  }
  return rows.length;
}

// Embed conversations (title + a snippet of the thread) for graph similarity.
export async function embedMissingConversations(
  workspaceId: string,
  limit = 100,
): Promise<number> {
  const client = await getOpenAIClient(workspaceId);
  if (!client) return 0;
  const rows = await db.$queryRaw<{ id: string; title: string }[]>`
    SELECT id, title FROM "Conversation"
    WHERE "workspaceId" = ${workspaceId} AND embedding IS NULL
    ORDER BY "updatedAt" DESC LIMIT ${limit}`;
  if (rows.length === 0) return 0;

  for (const row of rows) {
    const msgs = await db.chatMessage.findMany({
      where: { conversationId: row.id },
      orderBy: { createdAt: "asc" },
      take: 6,
      select: { content: true },
    });
    const text = `${row.title}\n${msgs.map((m) => m.content).join("\n")}`.slice(0, 4000);
    const vec = await embedText(client, text);
    await db.$executeRaw`UPDATE "Conversation" SET embedding = ${toVectorLiteral(vec)}::vector WHERE id = ${row.id}`;
  }
  return rows.length;
}

// Embed assistant messages that don't yet have an embedding (so older chats
// become recallable). Idempotent.
export async function embedMissingMessages(
  workspaceId: string,
  limit = 200,
): Promise<number> {
  const client = await getOpenAIClient(workspaceId);
  if (!client) return 0;
  const rows = await db.$queryRaw<{ id: string; content: string }[]>`
    SELECT m.id, m.content FROM "ChatMessage" m
    JOIN "Conversation" c ON c.id = m."conversationId"
    WHERE c."workspaceId" = ${workspaceId} AND m.embedding IS NULL AND m.role = 'assistant'
    ORDER BY m."createdAt" DESC LIMIT ${limit}`;
  if (rows.length === 0) return 0;
  const vecs = await embedTexts(client, rows.map((r) => r.content.slice(0, 8000)));
  for (let i = 0; i < rows.length; i++) {
    await db.$executeRaw`UPDATE "ChatMessage" SET embedding = ${toVectorLiteral(vecs[i])}::vector WHERE id = ${rows[i].id}`;
  }
  return rows.length;
}

// Store a precomputed embedding for a message (called after answering).
export async function setMessageEmbedding(messageId: string, vec: number[]) {
  await db.$executeRaw`UPDATE "ChatMessage" SET embedding = ${toVectorLiteral(vec)}::vector WHERE id = ${messageId}`;
}

export async function setConversationEmbedding(conversationId: string, vec: number[]) {
  await db.$executeRaw`UPDATE "Conversation" SET embedding = ${toVectorLiteral(vec)}::vector WHERE id = ${conversationId}`;
}

export type PastNote = { title: string; content: string; distance: number };

// Cross-conversation recall: assistant answers from OTHER threads most similar
// to the current question. This is what lets Zoro "remember" past chats.
export async function recallPastMessages(
  workspaceId: string,
  queryVec: number[],
  excludeConversationId: string | null,
  k = 4,
  maxDistance = 0.55,
): Promise<PastNote[]> {
  const qlit = toVectorLiteral(queryVec);
  const exclude = excludeConversationId
    ? Prisma.sql`AND m."conversationId" <> ${excludeConversationId}`
    : Prisma.empty;
  const rows = await db.$queryRaw<PastNote[]>(Prisma.sql`
    SELECT c.title AS title, m.content AS content,
           (m.embedding <=> ${qlit}::vector) AS distance
    FROM "ChatMessage" m
    JOIN "Conversation" c ON c.id = m."conversationId"
    WHERE c."workspaceId" = ${workspaceId}
      AND m.embedding IS NOT NULL
      AND m.role = 'assistant'
      ${exclude}
    ORDER BY m.embedding <=> ${qlit}::vector
    LIMIT ${k}`);
  return rows.filter((r) => Number(r.distance) < maxDistance);
}
