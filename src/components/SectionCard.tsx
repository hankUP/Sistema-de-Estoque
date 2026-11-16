import { ReactNode } from "react";
import { cn } from "@/lib/utils";

type SectionCardProps = {
  title?: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  /** Remove padding interno (útil quando o conteúdo é uma tabela). */
  noPadding?: boolean;
};

/**
 * Card seccional com cabeçalho opcional. Usado para agrupar formulários,
 * tabelas e blocos de conteúdo em uma página.
 */
export function SectionCard({ title, description, actions, children, className, noPadding }: SectionCardProps) {
  const hasHeader = title || actions || description;
  return (
    <section className={cn("glass-card overflow-hidden", className)}>
      {hasHeader && (
        <header className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 px-5 py-3 border-b border-border/50 bg-card/40">
          <div className="min-w-0">
            {title && <h3 className="text-sm font-semibold text-foreground truncate">{title}</h3>}
            {description && <p className="text-xs text-muted-foreground mt-0.5">{description}</p>}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2 shrink-0">{actions}</div>}
        </header>
      )}
      <div className={cn(noPadding ? "" : "p-5")}>{children}</div>
    </section>
  );
}
