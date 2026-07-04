import * as React from "react";
import { cn } from "@/lib/utils";

export function Input({ className, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      className={cn(
        "h-8 w-full rounded-md border border-border bg-white/[0.03] px-2.5 text-[13px] text-foreground transition-colors placeholder:text-faint hover:border-border-strong focus-visible:border-accent/60 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/30",
        className,
      )}
      {...props}
    />
  );
}
