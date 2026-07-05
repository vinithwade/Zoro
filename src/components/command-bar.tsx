"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import {
  LayoutDashboard,
  Boxes,
  Inbox,
  ScrollText,
  Plug,
  RefreshCw,
  Sparkles,
  MessageCircleQuestion,
  Network,
  Bot,
  Rocket,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

type Command = {
  id: string;
  label: string;
  icon: LucideIcon;
  run: () => void | Promise<void>;
};

// Lightweight ⌘K palette — navigation + the two most common actions.
export function CommandBar() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
      if (e.key === "Escape") setOpen(false);
    };
    const onOpen = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("zoro:command", onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("zoro:command", onOpen);
    };
  }, []);

  useEffect(() => {
    if (!open) {
      setQuery("");
      setNote(null);
    }
  }, [open]);

  const commands: Command[] = useMemo(() => {
    const go = (href: string) => () => {
      setOpen(false);
      router.push(href);
    };
    return [
      { id: "ask", label: "Ask Zoro a question", icon: MessageCircleQuestion, run: go("/ask") },
      { id: "nav-ship", label: "Go to Ship Check", icon: Rocket, run: go("/ship-check") },
      { id: "nav-memory", label: "Go to Memory graph", icon: Network, run: go("/memory") },
      { id: "nav-dashboard", label: "Go to CEO Dashboard", icon: LayoutDashboard, run: go("/") },
      { id: "nav-eng", label: "Go to Engineering", icon: Boxes, run: go("/sessions/engineering") },
      { id: "nav-approvals", label: "Go to Approvals", icon: Inbox, run: go("/approvals") },
      { id: "nav-agents", label: "Go to Agent Control Room", icon: Bot, run: go("/agents") },
      { id: "nav-audit", label: "Go to Audit Log", icon: ScrollText, run: go("/audit") },
      { id: "nav-connect", label: "Go to Connect Tools", icon: Plug, run: go("/connect") },
      {
        id: "sync",
        label: "Sync now",
        icon: RefreshCw,
        run: async () => {
          setNote("Syncing…");
          const r = await fetch("/api/sync", { method: "POST" }).then((x) => x.json());
          await queryClient.invalidateQueries({ queryKey: ["events"] });
          setNote(r.ok ? `Synced — ${r.ingested ?? 0} new event(s)` : "Sync failed");
        },
      },
      {
        id: "refresh",
        label: "Refresh AI analysis",
        icon: Sparkles,
        run: async () => {
          setNote("Analyzing…");
          const r = await fetch("/api/sessions/engineering/refresh", { method: "POST" }).then((x) => x.json());
          await queryClient.invalidateQueries({ queryKey: ["engineering-analysis"] });
          await queryClient.invalidateQueries({ queryKey: ["actions"] });
          setNote(r.ok ? "Analysis refreshed" : r.reason ?? "Failed");
        },
      },
    ];
  }, [router, queryClient]);

  const filtered = commands.filter((c) =>
    c.label.toLowerCase().includes(query.toLowerCase()),
  );

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 pt-[15vh] backdrop-blur-[2px]"
      onClick={() => setOpen(false)}
    >
      <div
        className="w-full max-w-[560px] overflow-hidden rounded-lg border border-border bg-surface-2 shadow-[0_16px_70px_rgba(0,0,0,0.5)]"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Type a command…"
          className="h-12 w-full border-b border-border bg-transparent px-4 text-sm outline-none placeholder:text-faint"
        />
        <ul className="max-h-80 overflow-y-auto p-2">
          {filtered.length === 0 ? (
            <li className="px-3 py-6 text-center text-[13px] text-faint">No commands</li>
          ) : (
            filtered.map((c) => {
              const Icon = c.icon;
              return (
                <li key={c.id}>
                  <button
                    onClick={() => c.run()}
                    className="flex h-10 w-full items-center gap-3 rounded-md px-2 text-left text-[13px] text-muted transition-colors hover:bg-white/[0.06] hover:text-foreground"
                  >
                    <Icon className="h-4 w-4 text-faint" strokeWidth={1.75} />
                    {c.label}
                  </button>
                </li>
              );
            })
          )}
        </ul>
        <div className="flex items-center gap-2 border-t border-border px-4 py-2 text-xs text-faint">
          {note ? (
            <span>{note}</span>
          ) : (
            <>
              <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded border border-border-strong bg-white/[0.06] px-1 font-mono text-[10px] text-muted">
                ⌘K
              </kbd>
              <span>toggle</span>
              <kbd className="ml-1 inline-flex h-5 items-center justify-center rounded border border-border-strong bg-white/[0.06] px-1 font-mono text-[10px] text-muted">
                Esc
              </kbd>
              <span>close</span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
