"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Sparkles,
  RefreshCw,
  AlertTriangle,
  HelpCircle,
  Lightbulb,
  ExternalLink,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { timeAgo } from "@/lib/utils";

type CitedEvent = {
  id: string;
  type: string;
  entityRef: string | null;
  entityUrl: string | null;
  summary: string | null;
};

type Content = {
  summary: string;
  health: "green" | "yellow" | "red";
  blockers: { title: string; severity: string; explanation: string; eventIds: string[] }[];
  decisionsNeeded: { question: string; context: string; eventIds: string[] }[];
  recommendations: { text: string; eventIds: string[] }[];
};

type Analysis = {
  exists: boolean;
  createdAt?: string;
  content?: Content;
  events?: Record<string, CitedEvent>;
};

const HEALTH: Record<string, { label: string; variant: "green" | "yellow" | "red" }> = {
  green: { label: "Healthy", variant: "green" },
  yellow: { label: "Warning", variant: "yellow" },
  red: { label: "Blocked", variant: "red" },
};

const SEVERITY: Record<string, "red" | "yellow" | "blue"> = {
  high: "red",
  medium: "yellow",
  low: "blue",
};

export function SessionAnalysis({
  department = "engineering",
}: {
  department?: string;
}) {
  const queryClient = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const analysisKey = [`${department}-analysis`];

  const { data, isLoading } = useQuery({
    queryKey: analysisKey,
    queryFn: async () => {
      const res = await fetch(`/api/sessions/${department}`);
      return res.json() as Promise<Analysis>;
    },
    refetchInterval: 30_000,
  });

  async function refresh() {
    setRefreshing(true);
    setError(null);
    try {
      const res = await fetch(`/api/sessions/${department}/refresh`, {
        method: "POST",
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.reason ?? "Refresh failed");
      await queryClient.invalidateQueries({ queryKey: analysisKey });
      await queryClient.invalidateQueries({ queryKey: ["actions"] });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Refresh failed");
    } finally {
      setRefreshing(false);
    }
  }

  const events = data?.events ?? {};
  const content = data?.content;

  function SourceLinks({ ids }: { ids: string[] }) {
    const linked = ids.map((id) => events[id]).filter(Boolean);
    if (linked.length === 0) return null;
    return (
      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
        {linked.map((e) =>
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
    );
  }

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-accent" />
          <CardTitle>AI Analysis</CardTitle>
          {content ? (
            <Badge variant={HEALTH[content.health]?.variant ?? "default"}>
              {HEALTH[content.health]?.label ?? content.health}
            </Badge>
          ) : null}
        </div>
        <div className="flex flex-col items-end gap-1">
          <Button variant="secondary" size="sm" onClick={refresh} disabled={refreshing}>
            <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
            Refresh analysis
          </Button>
          {data?.createdAt ? (
            <span className="text-xs text-faint">
              generated {timeAgo(data.createdAt)}
            </span>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        {error ? (
          <p className="rounded-md border border-red/30 bg-red/10 px-3 py-2 text-sm text-red">
            {error}
          </p>
        ) : null}

        {isLoading ? (
          <p className="text-sm text-muted">Loading analysis…</p>
        ) : !content ? (
          <div className="space-y-3">
            <p className="text-sm text-muted">
              No analysis yet. Click{" "}
              <span className="text-foreground">Refresh analysis</span> to have
              Zoro read your events and surface blockers, decisions, and
              recommended actions.
            </p>
          </div>
        ) : (
          <>
            <p className="text-sm leading-relaxed">{content.summary}</p>

            <Section
              icon={<AlertTriangle className="h-4 w-4 text-red" />}
              title="Blockers"
              empty="No blockers detected."
              count={content.blockers.length}
            >
              {content.blockers.map((b, i) => (
                <div key={i} className="rounded-md bg-white/[0.02] px-3 py-2.5">
                  <div className="flex items-center gap-2.5">
                    <Badge
                      variant={SEVERITY[b.severity] ?? "default"}
                      className="w-16 shrink-0 justify-center"
                    >
                      {b.severity}
                    </Badge>
                    <span className="text-[13px] font-medium">{b.title}</span>
                  </div>
                  <p className="mt-1 text-sm text-muted">{b.explanation}</p>
                  <SourceLinks ids={b.eventIds} />
                </div>
              ))}
            </Section>

            <Section
              icon={<HelpCircle className="h-4 w-4 text-yellow" />}
              title="Decisions needed"
              empty="Nothing needs your decision right now."
              count={content.decisionsNeeded.length}
            >
              {content.decisionsNeeded.map((d, i) => (
                <div key={i} className="rounded-md bg-white/[0.02] px-3 py-2.5">
                  <p className="text-sm font-medium">{d.question}</p>
                  <p className="mt-1 text-sm text-muted">{d.context}</p>
                  <SourceLinks ids={d.eventIds} />
                </div>
              ))}
            </Section>

            <Section
              icon={<Lightbulb className="h-4 w-4 text-blue" />}
              title="Recommendations"
              empty="No recommendations."
              count={content.recommendations.length}
            >
              {content.recommendations.map((r, i) => (
                <div key={i} className="rounded-md bg-white/[0.02] px-3 py-2.5">
                  <p className="text-sm">{r.text}</p>
                  <SourceLinks ids={r.eventIds} />
                </div>
              ))}
            </Section>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function Section({
  icon,
  title,
  empty,
  count,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  empty: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-xs font-medium text-muted">
        {icon}
        <span>{title}</span>
        <span className="text-faint">{count}</span>
      </div>
      {count === 0 ? (
        <p className="text-[13px] text-faint">{empty}</p>
      ) : (
        <div className="space-y-1.5">{children}</div>
      )}
    </div>
  );
}
