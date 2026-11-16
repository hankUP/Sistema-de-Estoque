import { ReactNode } from "react";

type PageHeaderProps = {
  title: string;
  description?: string;
  actions?: ReactNode;
};

/**
 * Cabeçalho padronizado para o topo de cada página.
 * Mantém título + descrição alinhados à esquerda e ações alinhadas à direita.
 */
export function PageHeader({ title, description, actions }: PageHeaderProps) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3 pb-1">
      <div className="min-w-0">
        <h2 className="text-page-title text-foreground truncate">{title}</h2>
        {description && (
          <p className="text-meta mt-0.5 leading-relaxed">{description}</p>
        )}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2 shrink-0">{actions}</div>}
    </div>
  );
}
