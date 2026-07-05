"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Boxes,
  Inbox,
  ScrollText,
  Plug,
  Search,
  SquarePen,
  ChevronDown,
  Sparkles,
  Network,
  MessagesSquare,
  Bot,
  Rocket,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  match: (path: string) => boolean;
  badge?: number;
};

function openCommandBar() {
  window.dispatchEvent(new Event("zoro:command"));
}

export function Sidebar({ pendingApprovals }: { pendingApprovals?: number }) {
  const pathname = usePathname();

  const pinned: NavItem[] = [
    { href: "/", label: "Dashboard", icon: LayoutDashboard, match: (p) => p === "/" },
    { href: "/ask", label: "Ask Zoro", icon: Sparkles, match: (p) => p.startsWith("/ask") },
    { href: "/ship-check", label: "Ship Check", icon: Rocket, match: (p) => p.startsWith("/ship-check") },
    { href: "/memory", label: "Memory", icon: Network, match: (p) => p.startsWith("/memory") },
  ];
  const sessions: NavItem[] = [
    {
      href: "/sessions/engineering",
      label: "Engineering",
      icon: Boxes,
      match: (p) => p.startsWith("/sessions/engineering"),
    },
    {
      href: "/sessions/communication",
      label: "Communication",
      icon: MessagesSquare,
      match: (p) => p.startsWith("/sessions/communication"),
    },
  ];
  const governance: NavItem[] = [
    {
      href: "/approvals",
      label: "Approvals",
      icon: Inbox,
      match: (p) => p.startsWith("/approvals"),
      badge: pendingApprovals,
    },
    {
      href: "/agents",
      label: "Agent Runs",
      icon: Bot,
      match: (p) => p.startsWith("/agents"),
    },
    {
      href: "/audit",
      label: "Audit Log",
      icon: ScrollText,
      match: (p) => p.startsWith("/audit"),
    },
  ];
  const setup: NavItem[] = [
    { href: "/connect", label: "Connect Tools", icon: Plug, match: (p) => p.startsWith("/connect") },
  ];

  return (
    <aside className="flex w-[220px] shrink-0 flex-col border-r border-border bg-surface px-2 py-2.5">
      {/* Workspace switcher */}
      <div className="mb-3 flex items-center gap-1 px-1">
        <button className="flex flex-1 items-center gap-2 rounded-md px-1.5 py-1 text-left hover:bg-surface-2">
          <span className="flex h-5 w-5 items-center justify-center rounded bg-accent text-[11px] font-semibold text-accent-fg">
            Z
          </span>
          <span className="text-[13px] font-medium">Zoro</span>
          <ChevronDown className="h-3.5 w-3.5 text-faint" />
        </button>
        <button
          onClick={openCommandBar}
          aria-label="Search / commands"
          className="flex h-7 w-7 items-center justify-center rounded-md text-faint hover:bg-surface-2 hover:text-muted"
        >
          <Search className="h-4 w-4" />
        </button>
        <button
          onClick={openCommandBar}
          aria-label="Commands"
          className="flex h-7 w-7 items-center justify-center rounded-md text-faint hover:bg-surface-2 hover:text-muted"
        >
          <SquarePen className="h-4 w-4" />
        </button>
      </div>

      <nav className="flex flex-col gap-0.5">
        {pinned.map((item) => (
          <NavRow key={item.href} item={item} active={item.match(pathname)} />
        ))}
      </nav>

      <NavSection label="Sessions">
        {sessions.map((item) => (
          <NavRow key={item.href} item={item} active={item.match(pathname)} />
        ))}
      </NavSection>

      <NavSection label="Governance">
        {governance.map((item) => (
          <NavRow key={item.href} item={item} active={item.match(pathname)} />
        ))}
      </NavSection>

      <NavSection label="Setup">
        {setup.map((item) => (
          <NavRow key={item.href} item={item} active={item.match(pathname)} />
        ))}
      </NavSection>

      <div className="mt-auto flex items-center gap-1.5 px-2 pt-4 text-[11px] text-faint">
        <span>Press</span>
        <kbd className="rounded border border-border-strong bg-surface-2 px-1 py-px font-mono text-[10px]">
          ⌘K
        </kbd>
        <span>for commands</span>
      </div>
    </aside>
  );
}

function NavSection({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mt-4">
      <div className="mb-1 flex h-6 items-center px-2 text-xs font-medium text-faint">
        {label}
      </div>
      <div className="flex flex-col gap-0.5">{children}</div>
    </div>
  );
}

function NavRow({ item, active }: { item: NavItem; active: boolean }) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      className={cn(
        "flex h-7 items-center gap-2.5 rounded-md px-2 text-[13px] transition-colors",
        active
          ? "bg-white/[0.06] font-medium text-foreground"
          : "text-muted hover:bg-white/[0.04] hover:text-foreground",
      )}
    >
      <Icon
        className={cn(
          "h-4 w-4 shrink-0",
          active ? "text-muted" : "text-faint",
        )}
        strokeWidth={1.75}
      />
      <span className="flex-1 truncate">{item.label}</span>
      {item.badge && item.badge > 0 ? (
        <span className="flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-accent px-1 text-[10px] font-semibold text-accent-fg">
          {item.badge}
        </span>
      ) : null}
    </Link>
  );
}
