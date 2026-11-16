import { cn } from "@/lib/utils";
import { LucideIcon, PackageOpen } from "lucide-react";

type LoadingSkeletonProps = {
  rows?: number;
  className?: string;
};

export function LoadingSkeleton({ rows = 4, className }: LoadingSkeletonProps) {
  return (
    <div className={cn("space-y-3", className)}>
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="glass-card p-4 space-y-2 animate-pulse"
          style={{ animationDelay: `${i * 80}ms` }}
        >
          <div className="flex items-center gap-3">
            <div className="h-4 w-32 bg-muted rounded" />
            <div className="h-4 w-12 bg-muted rounded" />
            <div className="ml-auto h-5 w-16 bg-muted rounded-full" />
          </div>
          <div className="flex gap-6">
            {Array.from({ length: 4 }).map((_, j) => (
              <div key={j} className="h-3 w-16 bg-muted/60 rounded" />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

type EmptyStateProps = {
  icon?: LucideIcon;
  title: string;
  description?: string;
  className?: string;
  children?: React.ReactNode;
};

export function EmptyState({ icon: Icon = PackageOpen, title, description, className, children }: EmptyStateProps) {
  return (
    <div className={cn("glass-card p-10 flex flex-col items-center justify-center text-center", className)}>
      <div className="flex items-center justify-center h-12 w-12 rounded-xl bg-muted/50 mb-4">
        <Icon className="h-6 w-6 text-muted-foreground/60" />
      </div>
      <p className="text-sm font-medium text-foreground/80 mb-1">{title}</p>
      {description && <p className="text-xs text-muted-foreground max-w-sm">{description}</p>}
      {children && <div className="mt-4">{children}</div>}
    </div>
  );
}
