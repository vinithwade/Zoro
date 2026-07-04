"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight } from "lucide-react";
import { cn, timeAgo } from "@/lib/utils";

type FeedEvent = {
  id: string;
  type: string;
  title: string;
  summary: string | null;
  actor: string | null;
  entityRef: string | null;
  entityUrl: string | null;
  importance: number;
  occurredAt: string;
};

const IMPORTANCE_DOT: Record<number, string> = {
  4: "bg-red",
  3: "bg-yellow",
  2: "bg-blue",
  1: "bg-faint",
};

const TYPE_LABEL: Record<string, string> = {
  "pr.opened": "PR opened",
  "pr.merged": "PR merged",
  "pr.closed": "PR closed",
  "pr.review_requested": "Review requested",
  "ci.failed": "CI failed",
  "issue.opened": "Issue opened",
  "issue.closed": "Issue closed",
  "commit.pushed": "Commits",
};

export function EventFeed({ pollMs = 10_000 }: { pollMs?: number }) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["events"],
    queryFn: async () => {
      const res = await fetch("/api/events?limit=100");
      if (!res.ok) throw new Error("Failed to load events");
      return res.json() as Promise<{ items: FeedEvent[] }>;
    },
    refetchInterval: pollMs,
  });

  if (isLoading) {
    return <p className="px-3 py-6 text-[13px] text-muted">Loading activity…</p>;
  }
  if (isError) {
    return <p className="px-3 py-6 text-[13px] text-red">Could not load the feed.</p>;
  }
  const items = data?.items ?? [];
  if (items.length === 0) {
    return (
      <p className="px-3 py-6 text-[13px] text-muted">
        No activity yet. Run a sync or wait for the next poll.
      </p>
    );
  }

  return (
    <ul className="flex flex-col">
      {items.map((e) => {
        const row = (
          <div className="flex h-10 items-center gap-3 rounded-md px-3 transition-colors hover:bg-white/[0.04]">
            <span
              className={cn(
                "h-1.5 w-1.5 shrink-0 rounded-full",
                IMPORTANCE_DOT[e.importance] ?? "bg-faint",
              )}
            />
            <span className="min-w-0 flex-1 truncate text-[13px] text-foreground">
              {e.summary ?? e.title}
            </span>
            <span className="hidden shrink-0 text-xs text-faint sm:block">
              {TYPE_LABEL[e.type] ?? e.type}
            </span>
            <span className="shrink-0 font-mono text-xs tabular-nums text-faint">
              {timeAgo(e.occurredAt)}
            </span>
            {e.entityUrl ? (
              <ArrowUpRight className="h-3.5 w-3.5 shrink-0 text-faint opacity-0 transition-opacity group-hover/row:opacity-100" />
            ) : (
              <span className="w-3.5 shrink-0" />
            )}
          </div>
        );
        return (
          <li key={e.id} className="group/row">
            {e.entityUrl ? (
              <a href={e.entityUrl} target="_blank" rel="noopener noreferrer">
                {row}
              </a>
            ) : (
              row
            )}
          </li>
        );
      })}
    </ul>
  );
}
