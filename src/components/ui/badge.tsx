import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap",
  {
    variants: {
      variant: {
        default: "border-transparent bg-white/[0.06] text-muted",
        accent: "border-transparent bg-accent/15 text-accent",
        green: "border-transparent bg-green/10 text-green",
        yellow: "border-transparent bg-yellow/10 text-yellow",
        red: "border-transparent bg-red/10 text-red",
        blue: "border-transparent bg-blue/10 text-blue",
        outline: "border-border text-muted",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

export function Badge({
  className,
  variant,
  ...props
}: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return (
    <span className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}
