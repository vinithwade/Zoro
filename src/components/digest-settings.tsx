"use client";

import { useEffect, useState } from "react";
import { CalendarClock, TrendingUp, Send, Check, Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

type Kind = "standup" | "investor";
type Config = {
  enabled: boolean;
  cadence: string;
  channel: string;
  hour: number;
  minute: number;
  dayOfWeek: number;
  lastSentOn: string | null;
};

const META: Record<Kind, { title: string; icon: typeof CalendarClock; blurb: string }> = {
  standup: {
    title: "Daily standup digest",
    icon: CalendarClock,
    blurb: "A standup summary of the last 24h (code + comms), with blocker owners @-mentioned. Only posts when there's real activity.",
  },
  investor: {
    title: "Weekly investor update",
    icon: TrendingUp,
    blurb: "A weekly investor-style update — shipped, progress, challenges, and asks — drawn from the last 7 days.",
  },
};

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function hhmm(h: number, m: number) {
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function DigestSettings({ kind }: { kind: Kind }) {
  const [channels, setChannels] = useState<string[]>([]);
  const [cfg, setCfg] = useState<Config | null>(null);
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const meta = META[kind];
  const Icon = meta.icon;

  useEffect(() => {
    fetch("/api/digest")
      .then((r) => r.json())
      .then((d) => {
        setChannels(d.channels ?? []);
        setCfg(d.digests?.[kind] ?? null);
      })
      .catch(() => {});
  }, [kind]);

  if (!cfg) return null;

  async function save(next: Config) {
    setCfg(next);
    setSaving(true);
    setNote(null);
    try {
      await fetch("/api/digest", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind,
          enabled: next.enabled,
          channel: next.channel,
          hour: next.hour,
          minute: next.minute,
          dayOfWeek: next.dayOfWeek,
        }),
      });
    } finally {
      setSaving(false);
    }
  }

  async function sendNow() {
    setSending(true);
    setNote(null);
    try {
      const res = await fetch("/api/digest/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, channel: cfg!.channel }),
      });
      const data = await res.json();
      setNote(data.ok ? `Posted to #${cfg!.channel} ✓` : data.error ?? "Failed to send");
    } catch {
      setNote("Failed to send");
    } finally {
      setSending(false);
    }
  }

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <div className="flex items-center gap-2">
          <Icon className="h-4 w-4 text-muted" />
          <CardTitle>{meta.title}</CardTitle>
        </div>
        <label className="flex cursor-pointer items-center gap-2 text-[13px] text-muted">
          <input
            type="checkbox"
            checked={cfg.enabled}
            onChange={(e) => save({ ...cfg, enabled: e.target.checked })}
            className="accent-accent"
          />
          {cfg.enabled ? "On" : "Off"}
        </label>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-[13px] text-muted">{meta.blurb}</p>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 text-[13px]">
            <span className="text-muted">Channel</span>
            <select
              value={cfg.channel}
              onChange={(e) => save({ ...cfg, channel: e.target.value })}
              className="h-8 rounded-md border border-border bg-white/[0.03] px-2 text-[13px] outline-none focus:border-accent/60"
            >
              {channels.length === 0 ? <option value="">(no channels)</option> : null}
              {channels.map((c) => (
                <option key={c} value={c}>
                  #{c}
                </option>
              ))}
            </select>
          </div>

          {kind === "investor" ? (
            <div className="flex items-center gap-2 text-[13px]">
              <span className="text-muted">every</span>
              <select
                value={cfg.dayOfWeek}
                onChange={(e) => save({ ...cfg, dayOfWeek: Number(e.target.value) })}
                className="h-8 rounded-md border border-border bg-white/[0.03] px-2 text-[13px] outline-none focus:border-accent/60"
              >
                {DAYS.map((d, i) => (
                  <option key={i} value={i}>
                    {d}
                  </option>
                ))}
              </select>
            </div>
          ) : null}

          <div className="flex items-center gap-2 text-[13px]">
            <span className="text-muted">at</span>
            <input
              type="time"
              value={hhmm(cfg.hour, cfg.minute)}
              onChange={(e) => {
                const [h, m] = e.target.value.split(":").map(Number);
                save({ ...cfg, hour: h, minute: m });
              }}
              className="h-8 rounded-md border border-border bg-white/[0.03] px-2 text-[13px] outline-none focus:border-accent/60"
            />
            <span className="text-faint">local time</span>
          </div>
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin text-faint" /> : <Check className="h-3.5 w-3.5 text-green" />}
        </div>

        <div className="flex items-center gap-3 pt-1">
          <Button variant="secondary" size="sm" onClick={sendNow} disabled={sending || !cfg.channel}>
            {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
            Send test now
          </Button>
          {cfg.lastSentOn ? <Badge variant="default">last sent {cfg.lastSentOn}</Badge> : null}
          {note ? <span className="text-xs text-muted">{note}</span> : null}
        </div>
      </CardContent>
    </Card>
  );
}
