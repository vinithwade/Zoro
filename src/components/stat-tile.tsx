import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";

export function StatTile({
  label,
  value,
  icon: Icon,
  tone = "default",
  interactive = false,
}: {
  label: string;
  value: number | string;
  icon: LucideIcon;
  tone?: "default" | "red" | "yellow" | "accent";
  interactive?: boolean;
}) {
  const toneColor = {
    default: "text-foreground",
    red: "text-red",
    yellow: "text-yellow",
    accent: "text-accent",
  }[tone];

  const showTone = value !== 0 && tone !== "default";

  return (
    <div
      className={cn(
        "px-4 py-3.5 transition-colors",
        interactive && "hover:bg-white/[0.03]",
      )}
    >
      <div className="flex items-center gap-1.5 text-xs text-muted">
        <Icon className="h-3.5 w-3.5 text-faint" strokeWidth={1.75} />
        {label}
      </div>
      <div
        className={cn(
          "mt-1.5 text-xl font-medium tabular-nums",
          showTone ? toneColor : "text-foreground",
        )}
      >
        {value}
      </div>
    </div>
  );
}
