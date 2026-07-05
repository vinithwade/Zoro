"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, Inbox, HelpCircle, AlertTriangle, Wallet, type LucideIcon } from "lucide-react";
import { cn, timeAgo } from "@/lib/utils";

type Notif = {
  id: string;
  type: string;
  title: string;
  body: string | null;
  href: string | null;
  read: boolean;
  createdAt: string;
};

const ICON: Record<string, LucideIcon> = {
  approval: Inbox,
  decision: HelpCircle,
  blocker: AlertTriangle,
  budget: Wallet,
};

export function NotificationBell() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);

  const { data } = useQuery({
    queryKey: ["notifications"],
    queryFn: async () => {
      const res = await fetch("/api/notifications");
      return res.json() as Promise<{ unread: number; items: Notif[] }>;
    },
    refetchInterval: 15_000,
  });
  const unread = data?.unread ?? 0;
  const items = data?.items ?? [];

  async function markRead(id?: string) {
    await fetch("/api/notifications/read", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(id ? { id } : {}),
    });
    queryClient.invalidateQueries({ queryKey: ["notifications"] });
  }

  function openItem(n: Notif) {
    setOpen(false);
    if (!n.read) markRead(n.id);
    if (n.href) router.push(n.href);
  }

  return (
    <>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label="Notifications"
        className="relative flex h-7 w-7 items-center justify-center rounded-md text-faint hover:bg-surface-2 hover:text-muted"
      >
        <Bell className="h-4 w-4" />
        {unread > 0 ? (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-semibold text-accent-fg">
            {unread > 9 ? "9+" : unread}
          </span>
        ) : null}
      </button>

      {open ? (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute left-2 top-12 z-50 w-80 overflow-hidden rounded-lg border border-border-strong bg-surface shadow-[0_16px_70px_rgba(0,0,0,0.5)]">
            <div className="flex items-center justify-between border-b border-border px-3 py-2">
              <span className="text-[13px] font-medium">Notifications</span>
              {unread > 0 ? (
                <button onClick={() => markRead()} className="text-xs text-accent hover:underline">
                  Mark all read
                </button>
              ) : null}
            </div>
            <ul className="max-h-96 overflow-y-auto">
              {items.length === 0 ? (
                <li className="px-3 py-8 text-center text-[13px] text-faint">You're all caught up.</li>
              ) : (
                items.map((n) => {
                  const Icon = ICON[n.type] ?? Bell;
                  return (
                    <li key={n.id}>
                      <button
                        onClick={() => openItem(n)}
                        className={cn(
                          "flex w-full items-start gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-white/[0.04]",
                          !n.read && "bg-accent/[0.06]",
                        )}
                      >
                        <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", n.read ? "text-faint" : "text-accent")} />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <span className="text-[13px] font-medium">{n.title}</span>
                            {!n.read ? <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" /> : null}
                          </div>
                          {n.body ? <p className="truncate text-xs text-muted">{n.body}</p> : null}
                          <p className="mt-0.5 text-[11px] text-faint">{timeAgo(n.createdAt)}</p>
                        </div>
                      </button>
                    </li>
                  );
                })
              )}
            </ul>
          </div>
        </>
      ) : null}
    </>
  );
}
