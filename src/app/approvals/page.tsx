"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ShieldCheck,
  Check,
  X,
  ExternalLink,
  RotateCw,
  MessageSquare,
  FilePlus2,
  ChevronDown,
} from "lucide-react";
import { PageHeader, EmptyState } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn, timeAgo } from "@/lib/utils";

type SourceEvent = {
  id: string;
  type: string;
  entityRef: string | null;
  entityUrl: string | null;
  summary: string | null;
};

type Action = {
  id: string;
  actionType: string;
  title: string;
  reasoning: string;
  payload: { repo: string; number?: number; title?: string; body: string };
  riskLevel: string;
  status: string;
  sourceEvents: SourceEvent[];
  externalResult: { htmlUrl?: string; ref?: number } | null;
  error: string | null;
  createdAt: string;
};

const ACTION_META: Record<string, { label: string; icon: typeof MessageSquare }> = {
  "github.comment_issue": { label: "Comment on issue", icon: MessageSquare },
  "github.comment_pr": { label: "Comment on PR", icon: MessageSquare },
  "github.create_issue": { label: "Create issue", icon: FilePlus2 },
};

export default function ApprovalsPage() {
  const [tab, setTab] = useState<"pending" | "history">("pending");

  return (
    <div>
      <PageHeader
        title="Approvals"
        subtitle="Actions the AI wants to take. Nothing runs without your approval."
      />
      <div className="p-8">
        <div className="mx-auto max-w-3xl">
          <div className="mb-5 flex w-fit gap-1">
            <TabButton active={tab === "pending"} onClick={() => setTab("pending")}>
              Pending
            </TabButton>
            <TabButton active={tab === "history"} onClick={() => setTab("history")}>
              History
            </TabButton>
          </div>
          <ActionList view={tab} />
        </div>
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "h-7 rounded-full px-3 text-[13px] font-medium transition-colors",
        active
          ? "bg-white/[0.06] text-foreground"
          : "text-muted hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

function ActionList({ view }: { view: "pending" | "history" }) {
  const { data, isLoading } = useQuery({
    queryKey: ["actions", view],
    queryFn: async () => {
      const res = await fetch(`/api/actions?status=${view}`);
      return res.json() as Promise<{ actions: Action[] }>;
    },
    refetchInterval: 15_000,
  });

  if (isLoading) return <p className="text-sm text-muted">Loading…</p>;
  const actions = data?.actions ?? [];
  if (actions.length === 0) {
    return (
      <EmptyState
        title={view === "pending" ? "No actions awaiting approval" : "No history yet"}
        description={
          view === "pending"
            ? "When Zoro's AI proposes an action, it will appear here for you to approve or reject."
            : "Approved, rejected, and executed actions will show up here."
        }
      />
    );
  }
  return (
    <div className="space-y-4">
      {actions.map((a) => (
        <ActionCard key={a.id} action={a} />
      ))}
    </div>
  );
}

function ActionCard({ action }: { action: Action }) {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState<null | "approve" | "reject" | "retry">(null);
  const [error, setError] = useState<string | null>(null);
  const [showSources, setShowSources] = useState(false);

  const meta = ACTION_META[action.actionType] ?? {
    label: action.actionType,
    icon: MessageSquare,
  };
  const Icon = meta.icon;
  const target =
    action.actionType === "github.create_issue"
      ? action.payload.repo
      : `${action.payload.repo}#${action.payload.number}`;

  async function act(kind: "approve" | "reject" | "retry") {
    setBusy(kind);
    setError(null);
    try {
      const res = await fetch(`/api/actions/${action.id}/${kind}`, { method: "POST" });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error ?? "Action failed");
      await queryClient.invalidateQueries({ queryKey: ["actions"] });
      await queryClient.invalidateQueries({ queryKey: ["pending-approvals"] });
      await queryClient.invalidateQueries({ queryKey: ["events"] });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(null);
    }
  }

  const isPending = action.status === "pending";

  return (
    <Card>
      <CardContent className="space-y-3 pt-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <Icon className="h-4 w-4 text-faint" />
            <span className="text-[13px] font-medium">{action.title}</span>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant={action.riskLevel === "medium" ? "yellow" : "blue"}>
              {action.riskLevel} risk
            </Badge>
            <StatusBadge status={action.status} />
          </div>
        </div>

        <p className="text-sm text-muted">{action.reasoning}</p>

        {/* Exact content preview — inset into the canvas color to read as "the artifact" */}
        <div className="overflow-hidden rounded-md border border-border bg-background">
          <div className="border-b border-border px-3 py-1.5 text-xs text-faint">
            {meta.label} → <span className="text-muted">{target}</span>
          </div>
          {action.actionType === "github.create_issue" && action.payload.title ? (
            <p className="px-3 pt-2.5 text-[13px] font-medium">{action.payload.title}</p>
          ) : null}
          <pre className="whitespace-pre-wrap px-3 py-2.5 font-mono text-xs leading-relaxed text-foreground">
            {action.payload.body}
          </pre>
        </div>

        {action.sourceEvents.length > 0 ? (
          <div>
            <button
              onClick={() => setShowSources((s) => !s)}
              className="flex items-center gap-1 text-xs text-faint hover:text-foreground"
            >
              <ChevronDown
                className={cn("h-3 w-3 transition-transform", showSources && "rotate-180")}
              />
              {action.sourceEvents.length} source event
              {action.sourceEvents.length === 1 ? "" : "s"}
            </button>
            {showSources ? (
              <ul className="mt-2 space-y-1">
                {action.sourceEvents.map((e) => (
                  <li key={e.id} className="text-xs text-muted">
                    · {e.summary ?? e.type}
                    {e.entityUrl ? (
                      <a
                        href={e.entityUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="ml-1 inline-flex items-center gap-0.5 text-faint hover:text-foreground"
                      >
                        {e.entityRef} <ExternalLink className="h-3 w-3" />
                      </a>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}

        {error ? <p className="text-xs text-red">{error}</p> : null}

        {action.status === "executed" && action.externalResult?.htmlUrl ? (
          <a
            href={action.externalResult.htmlUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-sm text-green hover:underline"
          >
            View on GitHub <ExternalLink className="h-3.5 w-3.5" />
          </a>
        ) : null}
        {action.status === "failed" && action.error ? (
          <p className="text-xs text-red">Failed: {action.error}</p>
        ) : null}

        {isPending ? (
          <div className="flex gap-2 pt-1">
            <Button variant="green" size="sm" onClick={() => act("approve")} disabled={!!busy}>
              <Check className="h-4 w-4" /> {busy === "approve" ? "Executing…" : "Approve"}
            </Button>
            <Button variant="danger" size="sm" onClick={() => act("reject")} disabled={!!busy}>
              <X className="h-4 w-4" /> Reject
            </Button>
          </div>
        ) : null}
        {action.status === "failed" ? (
          <Button variant="secondary" size="sm" onClick={() => act("retry")} disabled={!!busy}>
            <RotateCw className="h-4 w-4" /> {busy === "retry" ? "Retrying…" : "Retry"}
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { variant: "green" | "red" | "default" | "yellow"; label: string }> = {
    pending: { variant: "default", label: "pending" },
    executed: { variant: "green", label: "executed" },
    failed: { variant: "red", label: "failed" },
    rejected: { variant: "default", label: "rejected" },
    expired: { variant: "default", label: "expired" },
    executing: { variant: "yellow", label: "executing" },
  };
  const m = map[status] ?? { variant: "default" as const, label: status };
  if (status === "pending") return null;
  return <Badge variant={m.variant}>{m.label}</Badge>;
}
