"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { timeAgo } from "@/lib/utils";

type GithubStatus = {
  connected: boolean;
  lastSyncedAt?: string | null;
};

export function SyncStatus() {
  const queryClient = useQueryClient();
  const [syncing, setSyncing] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const { data } = useQuery({
    queryKey: ["github-status"],
    queryFn: async () => {
      const res = await fetch("/api/integrations/github");
      return res.json() as Promise<GithubStatus>;
    },
    refetchInterval: 15_000,
  });

  async function syncNow() {
    setSyncing(true);
    setNote(null);
    try {
      const res = await fetch("/api/sync", { method: "POST" });
      const result = await res.json();
      if (result.skipped) setNote("A sync is already running.");
      else setNote(`${result.ingested} new`);
      await queryClient.invalidateQueries({ queryKey: ["events"] });
      await queryClient.invalidateQueries({ queryKey: ["github-status"] });
    } catch {
      setNote("Sync failed.");
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div className="flex h-8 items-center justify-between border-t border-border px-3 text-xs text-faint">
      <span className="flex items-center gap-1.5">
        <span className="h-1.5 w-1.5 rounded-full bg-green" />
        {data?.lastSyncedAt
          ? `Last synced ${timeAgo(data.lastSyncedAt)}`
          : "Not synced yet"}
        {note ? ` · ${note}` : ""}
      </span>
      <Button variant="ghost" size="sm" onClick={syncNow} disabled={syncing}>
        <RefreshCw className={`h-3.5 w-3.5 ${syncing ? "animate-spin" : ""}`} />
        Sync now
      </Button>
    </div>
  );
}
