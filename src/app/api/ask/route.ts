import { NextResponse } from "next/server";
import { z } from "zod";
import { db, getDefaultWorkspace } from "@/lib/db";
import { askZoro, type AskMessage } from "@/lib/ai/ask";
import { getOpenAIClient } from "@/lib/ai/openai";
import {
  embedText,
  embedMissingMessages,
  recallPastMessages,
  setMessageEmbedding,
  setConversationEmbedding,
  type PastNote,
} from "@/lib/ai/embeddings";

const bodySchema = z.object({
  question: z.string().min(1).max(2000),
  // Accept null (new chat sends conversationId: null) as well as undefined.
  conversationId: z.string().nullish(),
});

function titleFrom(question: string): string {
  const t = question.trim().replace(/\s+/g, " ");
  return t.length > 60 ? t.slice(0, 57) + "…" : t;
}

export async function POST(req: Request) {
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    const reason = parsed.error.issues[0]?.message ?? "Invalid request.";
    return NextResponse.json({ ok: false, reason }, { status: 400 });
  }
  const ws = await getDefaultWorkspace();
  const { question } = parsed.data;

  let conversation = parsed.data.conversationId
    ? await db.conversation.findFirst({
        where: { id: parsed.data.conversationId, workspaceId: ws.id },
      })
    : null;
  if (!conversation) {
    conversation = await db.conversation.create({
      data: { workspaceId: ws.id, title: titleFrom(question) },
    });
  }

  const prior = await db.chatMessage.findMany({
    where: { conversationId: conversation.id },
    orderBy: { createdAt: "asc" },
    select: { role: true, content: true },
  });
  const history: AskMessage[] = prior.map((m) => ({
    role: m.role as "user" | "assistant",
    content: m.content,
  }));

  // Embed the question once — reused for recall AND for storing the user message.
  const client = await getOpenAIClient(ws.id);
  let questionVec: number[] | null = null;
  let pastNotes: PastNote[] = [];
  if (client) {
    try {
      await embedMissingMessages(ws.id); // backfill so older chats are recallable
      questionVec = await embedText(client, question);
      pastNotes = await recallPastMessages(ws.id, questionVec, conversation.id);
    } catch {
      // embedding/recall is best-effort; never block the answer
    }
  }

  const userMsg = await db.chatMessage.create({
    data: { conversationId: conversation.id, role: "user", content: question },
  });
  if (questionVec) await setMessageEmbedding(userMsg.id, questionVec).catch(() => {});

  const result = await askZoro(ws.id, question, history, pastNotes);

  const answerText = result.ok ? result.answer : result.reason;
  const citedEventIds = result.ok ? result.events.map((e) => e.id) : [];
  const assistantMsg = await db.chatMessage.create({
    data: {
      conversationId: conversation.id,
      role: "assistant",
      content: answerText,
      citedEventIds,
    },
  });

  // Best-effort: embed the answer + refresh the conversation embedding.
  if (client && result.ok) {
    try {
      const answerVec = await embedText(client, answerText);
      await setMessageEmbedding(assistantMsg.id, answerVec);
      const convVec = await embedText(client, `${conversation.title}\n${question}\n${answerText}`);
      await setConversationEmbedding(conversation.id, convVec);
    } catch {
      /* ignore */
    }
  }

  await db.conversation.update({
    where: { id: conversation.id },
    data: { updatedAt: new Date() },
  });

  return NextResponse.json(
    { ...result, conversationId: conversation.id, title: conversation.title },
    { status: result.ok ? 200 : 400 },
  );
}
