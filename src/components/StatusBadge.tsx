import { cn } from "@/lib/utils";
import { ReactNode } from "react";

type Tone = "default" | "primary" | "success" | "warning" | "destructive" | "muted";

type Props = {
  tone?: Tone;
  children: ReactNode;
  className?: string;
  size?: "sm" | "md";
};

/**
 * Badge padronizado para status, tipos e categorias.
 * Usa apenas tokens semânticos do design system.
 */
export function StatusBadge({ tone = "default", children, className, size = "md" }: Props) {
  const toneCls = {
    default: "bg-accent text-accent-foreground",
    primary: "bg-primary/15 text-primary",
    success: "bg-success/15 text-success",
    warning: "bg-warning/15 text-warning",
    destructive: "bg-destructive/15 text-destructive",
    muted: "bg-muted text-muted-foreground",
  }[tone];
  const sizeCls = size === "sm"
    ? "px-1.5 py-0.5 text-[10px]"
    : "px-2 py-0.5 text-[11px]";
  return (
    <span className={cn("inline-flex items-center rounded-full font-semibold whitespace-nowrap", toneCls, sizeCls, className)}>
      {children}
    </span>
  );
}
