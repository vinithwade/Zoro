"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Boxes,
  MessagesSquare,
  Sparkles,
  CalendarClock,
  TrendingUp,
  Bot,
  ChevronRight,
  Activity,
  CircleCheck,
  Coins,
  Cpu,
  type LucideIcon,
} from "lucide-react";
import { PageHeader, EmptyState } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { StatTile } from "@/components/stat-tile";
import { BudgetBar } from "@/components/budget-bar";
import { cn, timeAgo } from "@/lib/utils";

type Run = {
  id: string;
  kind: string;
  status: string;
  model: string;
  startedAt: string;
  durationMs: number | null;
  promptTokens: number;
  completionTokens: number;
  cost: number;
  error: string | null;
  proposedActions: number;
  input: { question: string | null; eventCount: number | null; blockerCandidateCount: number | null };
  output: { blockers: number | null; suggestedActions: number | null; recommendations: number | null; answerPreview: string | null };
};

type Data = {
  stats: { total: number; last24h: number; successRate: number | null; failed: number; totalTokens: number; totalCost: number };
  runs: Run[];
};

const KIND: Record<string, { label: string; icon: LucideIcon }> = {
  engineering_session: { label: "Engineering analysis", icon: Boxes },
  communication_session: { label: "Communication analysis", icon: MessagesSquare },
  ask_zoro: { label: "Ask Zoro", icon: Sparkles },
  digest_standup: { label: "Daily standup digest", icon: CalendarClock },
  digest_investor: { label: "Investor update", icon: TrendingUp },
};

function kindMeta(kind: string) {
  return KIND[kind] ?? { label: kind, icon: Bot };
}
function fmtTokens(n: number) {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}
function fmtCost(n: number) {
  if (n === 0) return "$0";
  return n < 0.01 ? `$${n.toFixed(4)}` : `$${n.toFixed(2)}`;
}
function fmtDuration(ms: number | null) {
  if (ms == null) return "—";
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

const STATUS: Record<string, { variant: "green" | "red" | "yellow"; label: string }> = {
  succeeded: { variant: "green", label: "succeeded" },
  failed: { variant: "red", label: "failed" },
  running: { variant: "yellow", label: "running" },
};

export default function AgentsPage() {
  const { data, isLoading } = useQuery({
    queryKey: ["agents"],
    queryFn: async () => {
      const res = await fetch("/api/agents");
      return res.json() as Promise<Data>;
    },
    refetchInterval: 15_000,
  });

  const stats = data?.stats;
  const runs = data?.runs ?? [];

  return (
    <div>
      <PageHeader
        title="Agent Control Room"
        subtitle="Every AI run — what it read, what it produced, and what it cost."
      />
      <div className="space-y-6 px-8 py-6">
        <BudgetBar />
        {stats ? (
          <div className="grid grid-cols-2 divide-x divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface md:grid-cols-3 md:divide-y-0 lg:grid-cols-5">
            <StatTile label="Total runs" value={stats.total} icon={Activity} />
            <StatTile label="Last 24h" value={stats.last24h} icon={Cpu} />
            <StatTile label="Success rate" value={stats.successRate == null ? "—" : `${stats.successRate}%`} icon={CircleCheck} tone={stats.successRate != null && stats.successRate < 100 ? "yellow" : "default"} />
            <StatTile label="Tokens" value={fmtTokens(stats.totalTokens)} icon={Cpu} />
            <StatTile label="Est. cost" value={fmtCost(stats.totalCost)} icon={Coins} tone="accent" />
          </div>
        ) : null}

        {isLoading ? (
          <p className="text-sm text-muted">Loading runs…</p>
        ) : runs.length === 0 ? (
          <EmptyState
            title="No agent runs yet"
            description="When Zoro analyzes a session, answers a question, or posts a digest, each run is recorded here with its cost and output."
          />
        ) : (
          <div className="mx-auto max-w-3xl overflow-hidden rounded-lg border border-border bg-surface">
            {runs.map((r) => (
              <RunRow key={r.id} run={r} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function RunRow({ run }: { run: Run }) {
  const [open, setOpen] = useState(false);
  const meta = kindMeta(run.kind);
  const Icon = meta.icon;
  const status = STATUS[run.status] ?? { variant: "yellow" as const, label: run.status };
  const descriptor =
    run.input.question ??
    (run.input.eventCount != null ? `${run.input.eventCount} events read` : "");

  return (
    <div className="border-b border-border last:border-b-0">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-white/[0.03]"
      >
        <Icon className="h-4 w-4 shrink-0 text-faint" strokeWidth={1.75} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-[13px] font-medium">{meta.label}</span>
            <Badge variant={status.variant}>{status.label}</Badge>
          </div>
          {descriptor ? <p className="truncate text-xs text-muted">{descriptor}</p> : null}
        </div>
        <div className="hidden shrink-0 items-center gap-4 text-xs text-faint sm:flex">
          <span className="font-mono tabular-nums">{fmtTokens(run.promptTokens + run.completionTokens)} tok</span>
          <span className="font-mono tabular-nums text-muted">{fmtCost(run.cost)}</span>
          <span className="w-10 text-right">{timeAgo(run.startedAt)}</span>
        </div>
        <ChevronRight className={cn("h-3.5 w-3.5 shrink-0 text-faint transition-transform", open && "rotate-90")} />
      </button>

      {open ? (
        <div className="space-y-2 border-t border-border bg-background/40 px-4 py-3 text-xs">
          <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 sm:grid-cols-3">
            <Detail label="Model" value={run.model} mono />
            <Detail label="Duration" value={fmtDuration(run.durationMs)} />
            <Detail label="Cost" value={fmtCost(run.cost)} />
            <Detail label="Input tokens" value={fmtTokens(run.promptTokens)} mono />
            <Detail label="Output tokens" value={fmtTokens(run.completionTokens)} mono />
            {run.input.eventCount != null ? <Detail label="Events read" value={String(run.input.eventCount)} /> : null}
            {run.output.blockers != null ? <Detail label="Blockers found" value={String(run.output.blockers)} /> : null}
            {run.output.suggestedActions != null ? <Detail label="Actions proposed" value={String(run.output.suggestedActions)} /> : null}
            {run.proposedActions > 0 ? <Detail label="Approvals created" value={String(run.proposedActions)} /> : null}
          </div>
          {run.input.question ? (
            <div>
              <span className="text-faint">Question:</span>{" "}
              <span className="text-muted">{run.input.question}</span>
            </div>
          ) : null}
          {run.output.answerPreview ? (
            <div>
              <span className="text-faint">Answer:</span>{" "}
              <span className="text-muted">{run.output.answerPreview}…</span>
            </div>
          ) : null}
          {run.error ? (
            <div className="rounded-md border border-red/30 bg-red/10 px-2 py-1.5 text-red">{run.error}</div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function Detail({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-faint">{label}</span>
      <span className={cn("text-foreground", mono && "font-mono tabular-nums")}>{value}</span>
    </div>
  );
}
