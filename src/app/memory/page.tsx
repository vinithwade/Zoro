"use client";

import { useQuery } from "@tanstack/react-query";
import { PageHeader, EmptyState } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { MemoryGraph, type GraphNode } from "@/components/memory-graph";

type GraphData = {
  nodes: GraphNode[];
  links: { source: string; target: string; kind: string }[];
  stats: { people: number; repos: number; entities: number; conversations: number };
};

export default function MemoryPage() {
  const { data, isLoading } = useQuery({
    queryKey: ["memory-graph"],
    queryFn: async () => {
      const res = await fetch("/api/memory/graph");
      return res.json() as Promise<GraphData>;
    },
    refetchInterval: 30_000,
  });

  const stats = data?.stats;

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Memory"
        subtitle="Your company's knowledge graph — people, work, and conversations, connected."
        actions={
          stats ? (
            <div className="flex items-center gap-1.5">
              <Badge variant="accent">{stats.repos} repos</Badge>
              <Badge variant="green">{stats.people} people</Badge>
              <Badge variant="blue">{stats.entities} items</Badge>
              <Badge variant="default">{stats.conversations} chats</Badge>
            </div>
          ) : undefined
        }
      />
      <div className="min-h-0 flex-1">
        {isLoading ? (
          <div className="flex h-full items-center justify-center text-[13px] text-muted">
            Building your memory graph…
          </div>
        ) : !data || data.nodes.length === 0 ? (
          <div className="p-8">
            <EmptyState
              title="No memory yet"
              description="Connect GitHub and sync some activity — then people, repos, PRs, issues, and your Ask Zoro conversations will appear here as a connected graph."
            />
          </div>
        ) : (
          <MemoryGraph nodes={data.nodes} links={data.links} />
        )}
      </div>
    </div>
  );
}
