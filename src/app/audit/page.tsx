"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Bot, User, Cog, ChevronRight } from "lucide-react";
import { PageHeader, EmptyState } from "@/components/page-header";
import { cn, timeAgo } from "@/lib/utils";

type Log = {
  id: string;
  actorType: string;
  actor: string;
  action: string;
  targetType: string | null;
  targetId: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
};

const ACTOR_ICON: Record<string, typeof Bot> = {
  ai: Bot,
  human: User,
  system: Cog,
};

const ACTION_LABEL: Record<string, string> = {
  "sync.completed": "Sync completed",
  "agent.run": "AI analysis run",
  "action.proposed": "Action proposed",
  "action.approved": "Action approved",
  "action.executed": "Action executed",
  "action.failed": "Action failed",
  "action.rejected": "Action rejected",
  "integration.connected": "Integration connected",
};

export default function AuditPage() {
  const { data, isLoading } = useQuery({
    queryKey: ["audit"],
    queryFn: async () => {
      const res = await fetch("/api/audit");
      return res.json() as Promise<{ logs: Log[] }>;
    },
    refetchInterval: 15_000,
  });

  const logs = data?.logs ?? [];

  return (
    <div>
      <PageHeader
        title="Audit Log"
        subtitle="Every AI, human, and system action — append-only and traceable."
      />
      <div className="p-8">
        <div className="mx-auto max-w-3xl">
          {isLoading ? (
            <p className="text-sm text-muted">Loading…</p>
          ) : logs.length === 0 ? (
            <EmptyState
              title="No activity logged yet"
              description="Syncs, AI runs, and approvals will be recorded here as they happen."
            />
          ) : (
            <div className="flex flex-col">
              {logs.map((log) => (
                <LogRow key={log.id} log={log} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function LogRow({ log }: { log: Log }) {
  const [open, setOpen] = useState(false);
  const Icon = ACTOR_ICON[log.actorType] ?? Cog;
  const hasMeta = log.metadata && Object.keys(log.metadata).length > 0;

  const tint =
    log.actorType === "ai"
      ? "text-accent"
      : log.actorType === "human"
        ? "text-green"
        : "text-muted";

  return (
    <div>
      <button
        onClick={() => hasMeta && setOpen((o) => !o)}
        className={cn(
          "flex h-10 w-full items-center gap-3 rounded-md px-3 text-left transition-colors",
          hasMeta && "cursor-pointer hover:bg-white/[0.04]",
        )}
      >
        <Icon className={cn("h-4 w-4 shrink-0", tint)} strokeWidth={1.75} />
        <div className="min-w-0 flex-1">
          <span className="text-[13px]">
            {ACTION_LABEL[log.action] ?? log.action}
          </span>
          <span className="ml-2 text-[13px] text-muted">{log.actor}</span>
        </div>
        <span className="shrink-0 font-mono text-xs tabular-nums text-faint">
          {timeAgo(log.createdAt)}
        </span>
        {hasMeta ? (
          <ChevronRight
            className={cn("h-3.5 w-3.5 shrink-0 text-faint transition-transform", open && "rotate-90")}
          />
        ) : (
          <span className="w-3.5" />
        )}
      </button>
      {open && hasMeta ? (
        <pre className="mx-3 mb-2 overflow-x-auto rounded-md border border-border bg-background p-3 font-mono text-[11px] leading-relaxed text-muted">
          {JSON.stringify(log.metadata, null, 2)}
        </pre>
      ) : null}
    </div>
  );
}
