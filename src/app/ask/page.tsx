"use client";

import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Sparkles,
  ArrowUp,
  ExternalLink,
  Loader2,
  Plus,
  MessageSquare,
  Trash2,
} from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { cn, timeAgo } from "@/lib/utils";

type CitedEvent = {
  id: string;
  type: string;
  entityRef: string | null;
  entityUrl: string | null;
  summary: string | null;
};

type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
  events?: CitedEvent[];
  error?: boolean;
};

type Thread = {
  id: string;
  title: string;
  updatedAt: string;
  messageCount: number;
};

const SUGGESTIONS = [
  "What's blocking engineering right now?",
  "Summarize this week's activity.",
  "What needs my decision?",
  "Which PRs are stuck and why?",
];

export default function AskPage() {
  const queryClient = useQueryClient();
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const nextId = useRef(0);

  const { data: threadsData } = useQuery({
    queryKey: ["conversations"],
    queryFn: async () => {
      const res = await fetch("/api/conversations");
      return res.json() as Promise<{ conversations: Thread[] }>;
    },
  });
  const threads = threadsData?.conversations ?? [];

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, loading]);

  function newChat() {
    setConversationId(null);
    setMessages([]);
    setInput("");
  }

  async function openThread(id: string) {
    if (id === conversationId) return;
    const res = await fetch(`/api/conversations/${id}`);
    if (!res.ok) return;
    const data = await res.json();
    setConversationId(id);
    setMessages(
      data.messages.map((m: Message) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        events: m.events,
      })),
    );
  }

  async function deleteThread(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    await fetch(`/api/conversations/${id}`, { method: "DELETE" });
    if (id === conversationId) newChat();
    queryClient.invalidateQueries({ queryKey: ["conversations"] });
  }

  async function send(question: string) {
    const q = question.trim();
    if (!q || loading) return;
    setMessages((prev) => [...prev, { id: `u${nextId.current++}`, role: "user", content: q }]);
    setInput("");
    setLoading(true);
    try {
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q, conversationId }),
      });
      const data = await res.json();
      if (data.conversationId) setConversationId(data.conversationId);
      setMessages((prev) => [
        ...prev,
        data.ok
          ? { id: `a${nextId.current++}`, role: "assistant", content: data.answer, events: data.events }
          : { id: `a${nextId.current++}`, role: "assistant", content: data.reason ?? "Something went wrong.", error: true },
      ]);
      queryClient.invalidateQueries({ queryKey: ["conversations"] });
    } catch {
      setMessages((prev) => [
        ...prev,
        { id: `a${nextId.current++}`, role: "assistant", content: "Network error — is the app still running?", error: true },
      ]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex h-full">
      {/* Thread list — conversation memory */}
      <div className="hidden w-64 shrink-0 flex-col border-r border-border bg-surface md:flex">
        <div className="p-2">
          <button
            onClick={newChat}
            className="flex w-full items-center gap-2 rounded-md border border-border bg-white/[0.03] px-3 py-2 text-[13px] font-medium transition-colors hover:bg-white/[0.06]"
          >
            <Plus className="h-4 w-4" /> New chat
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-2 pb-2">
          {threads.length === 0 ? (
            <p className="px-2 py-4 text-xs text-faint">No saved chats yet.</p>
          ) : (
            <ul className="flex flex-col gap-0.5">
              {threads.map((t) => (
                <li key={t.id}>
                  <button
                    onClick={() => openThread(t.id)}
                    className={cn(
                      "group/thread flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] transition-colors",
                      t.id === conversationId
                        ? "bg-white/[0.06] text-foreground"
                        : "text-muted hover:bg-white/[0.04] hover:text-foreground",
                    )}
                  >
                    <MessageSquare className="h-3.5 w-3.5 shrink-0 text-faint" />
                    <span className="flex-1 truncate">{t.title}</span>
                    <Trash2
                      onClick={(e) => deleteThread(t.id, e)}
                      className="h-3.5 w-3.5 shrink-0 text-faint opacity-0 transition-opacity hover:text-red group-hover/thread:opacity-100"
                    />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Chat */}
      <div className="flex h-full flex-1 flex-col">
        <PageHeader
          title="Ask Zoro"
          subtitle="Questions about your company, answered from real events."
        />

        <div ref={scrollRef} className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-3xl px-8 py-6">
            {messages.length === 0 ? (
              <div className="mt-10 flex flex-col items-center text-center">
                <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent/15">
                  <Sparkles className="h-5 w-5 text-accent" />
                </span>
                <h2 className="mt-4 text-[15px] font-medium">Ask about your startup</h2>
                <p className="mt-1 max-w-sm text-[13px] text-muted">
                  Zoro answers from your real GitHub activity, blockers, and summaries —
                  and cites the events it used. Chats are saved so you can revisit them.
                </p>
                <div className="mt-6 flex w-full max-w-md flex-col gap-2">
                  {SUGGESTIONS.map((s) => (
                    <button
                      key={s}
                      onClick={() => send(s)}
                      className="rounded-md border border-border bg-surface px-3 py-2 text-left text-[13px] text-muted transition-colors hover:bg-white/[0.04] hover:text-foreground"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="space-y-6">
                {messages.map((m) => (
                  <MessageBubble key={m.id} message={m} />
                ))}
                {loading ? (
                  <div className="flex items-center gap-3 text-[13px] text-muted">
                    <span className="flex h-6 w-6 items-center justify-center rounded-md bg-accent/15">
                      <Sparkles className="h-3.5 w-3.5 text-accent" />
                    </span>
                    <span className="flex items-center gap-1.5">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" /> Thinking…
                    </span>
                  </div>
                ) : null}
              </div>
            )}
          </div>
        </div>

        <div className="border-t border-border">
          <div className="mx-auto max-w-3xl px-8 py-4">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                send(input);
              }}
              className="flex items-end gap-2 rounded-lg border border-border bg-surface px-3 py-2 focus-within:border-border-strong"
            >
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    send(input);
                  }
                }}
                rows={1}
                placeholder="Ask a question…  (Enter to send, Shift+Enter for a new line)"
                className="max-h-40 min-h-[24px] flex-1 resize-none bg-transparent text-[13px] outline-none placeholder:text-faint"
              />
              <button
                type="submit"
                disabled={!input.trim() || loading}
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-accent text-accent-fg transition-colors hover:bg-[#6872d9] disabled:opacity-40"
              >
                <ArrowUp className="h-4 w-4" />
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}

function MessageBubble({ message }: { message: Message }) {
  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] rounded-lg bg-surface-2 px-3 py-2 text-[13px]">
          {message.content}
        </div>
      </div>
    );
  }
  return (
    <div className="flex gap-3">
      <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-accent/15">
        <Sparkles className="h-3.5 w-3.5 text-accent" />
      </span>
      <div className="min-w-0 flex-1">
        <p
          className={cn(
            "whitespace-pre-wrap text-[13px] leading-relaxed",
            message.error ? "text-red" : "text-foreground",
          )}
        >
          {message.content}
        </p>
        {message.events && message.events.length > 0 ? (
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="text-[11px] text-faint">Sources:</span>
            {message.events.map((e) =>
              e.entityUrl ? (
                <a
                  key={e.id}
                  href={e.entityUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-0.5 font-mono text-[11px] text-faint underline decoration-border underline-offset-2 hover:text-muted"
                >
                  {e.entityRef ?? e.type} <ExternalLink className="h-2.5 w-2.5" />
                </a>
              ) : (
                <span key={e.id} className="font-mono text-[11px] text-faint">
                  {e.entityRef ?? e.type}
                </span>
              ),
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}
