"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Wallet, Check, Loader2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type BudgetData = {
  slackConnected: boolean;
  channels: string[];
  todaySpend: number;
  config: { dailyUsd: number; alertSlack: boolean; channel: string };
};

function fmt(n: number) {
  return n < 0.01 && n > 0 ? `$${n.toFixed(4)}` : `$${n.toFixed(2)}`;
}

export function BudgetBar() {
  const { data, refetch } = useQuery({
    queryKey: ["budget"],
    queryFn: async () => {
      const res = await fetch("/api/budget");
      return res.json() as Promise<BudgetData>;
    },
    refetchInterval: 20_000,
  });

  const [dailyStr, setDailyStr] = useState<string>("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (data) setDailyStr(String(data.config.dailyUsd));
  }, [data?.config.dailyUsd]);

  if (!data) return null;
  const { todaySpend, config, channels, slackConnected } = data;
  const budget = config.dailyUsd;
  const ratio = budget > 0 ? todaySpend / budget : 0;
  const pct = Math.min(100, Math.round(ratio * 100));
  const over = ratio >= 1;
  const barColor = over ? "bg-red" : ratio >= 0.75 ? "bg-yellow" : "bg-green";

  async function save(next: Partial<BudgetData["config"]>) {
    setSaving(true);
    try {
      await fetch("/api/budget", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dailyUsd: next.dailyUsd ?? config.dailyUsd,
          alertSlack: next.alertSlack ?? config.alertSlack,
          channel: next.channel ?? config.channel,
        }),
      });
      await refetch();
    } finally {
      setSaving(false);
    }
  }

  function commitDaily() {
    const v = parseFloat(dailyStr);
    if (!isNaN(v) && v >= 0 && v !== config.dailyUsd) save({ dailyUsd: v });
  }

  return (
    <Card className={cn(over && "border-red/40")}>
      <CardContent className="space-y-3 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Wallet className="h-4 w-4 text-muted" />
            <span className="text-[13px] font-medium">Daily AI budget</span>
            {over ? <Badge variant="red">Over budget</Badge> : null}
          </div>
          <div className="text-[13px] tabular-nums">
            <span className={cn("font-medium", over ? "text-red" : "text-foreground")}>{fmt(todaySpend)}</span>
            <span className="text-faint"> / {fmt(budget)} today</span>
          </div>
        </div>

        <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
          <div className={cn("h-full rounded-full transition-all", barColor)} style={{ width: `${pct}%` }} />
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 pt-1 text-[13px]">
          <div className="flex items-center gap-2">
            <span className="text-muted">Budget</span>
            <span className="flex items-center rounded-md border border-border bg-white/[0.03] pl-2">
              <span className="text-faint">$</span>
              <input
                value={dailyStr}
                onChange={(e) => setDailyStr(e.target.value)}
                onBlur={commitDaily}
                onKeyDown={(e) => e.key === "Enter" && commitDaily()}
                inputMode="decimal"
                className="h-7 w-16 bg-transparent px-1 text-[13px] outline-none"
              />
            </span>
            <span className="text-faint">/ day</span>
          </div>

          <label className="flex cursor-pointer items-center gap-2 text-muted">
            <input
              type="checkbox"
              checked={config.alertSlack}
              disabled={!slackConnected}
              onChange={(e) => save({ alertSlack: e.target.checked })}
              className="accent-accent"
            />
            Alert in Slack
          </label>
          {config.alertSlack ? (
            <select
              value={config.channel}
              onChange={(e) => save({ channel: e.target.value })}
              className="h-7 rounded-md border border-border bg-white/[0.03] px-2 text-[13px] outline-none focus:border-accent/60"
            >
              {channels.length === 0 ? <option value="">(no channels)</option> : null}
              {channels.map((c) => (
                <option key={c} value={c}>#{c}</option>
              ))}
            </select>
          ) : null}
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin text-faint" /> : <Check className="h-3.5 w-3.5 text-green" />}
        </div>
      </CardContent>
    </Card>
  );
}
