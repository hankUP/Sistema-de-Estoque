import { ReactNode, useMemo } from "react";
import { cn } from "@/lib/utils";

export type Column<T> = {
  key: string;
  header: string;
  /** Render function — called for each row. */
  cell: (row: T, index: number) => ReactNode;
  /** Alinhamento da coluna. */
  align?: "left" | "right" | "center";
  /** Visibilidade responsiva: a coluna só aparece a partir desse breakpoint. */
  hideBelow?: "sm" | "md" | "lg" | "xl";
  /** Largura sugerida (Tailwind class, ex: "w-32"). */
  width?: string;
  /** Classe extra para a célula. */
  cellClassName?: string;
  /** Quando renderizado como card mobile, define se este campo aparece como linha label/valor. */
  mobileLabel?: string;
  /** Se true, esta coluna vira o título principal do card mobile (sem label). */
  mobilePrimary?: boolean;
  /** Se true, esta coluna vira o canto superior direito do card mobile (badge/status). */
  mobileBadge?: boolean;
};

type DataTableProps<T> = {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  /** Mostrado quando rows está vazio. */
  empty?: ReactNode;
  /** Ações por linha, renderizadas no final do card mobile e em coluna extra no desktop. */
  rowActions?: (row: T) => ReactNode;
  /** Classe da linha (ex: hover). */
  rowClassName?: (row: T) => string;
  /** Footer renderizado abaixo do tbody (ex: totais). */
  footer?: ReactNode;
};

const hideClass = {
  sm: "hidden sm:table-cell",
  md: "hidden md:table-cell",
  lg: "hidden lg:table-cell",
  xl: "hidden xl:table-cell",
} as const;

const alignClass = {
  left: "text-left",
  right: "text-right",
  center: "text-center",
} as const;

/**
 * Tabela responsiva: mostra como tabela em md+ e como cards empilhados em telas menores.
 * Colunas com hideBelow somem nas telas correspondentes.
 */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  empty,
  rowActions,
  rowClassName,
  footer,
}: DataTableProps<T>) {
  const mobileColumns = useMemo(() => {
    const primary = columns.find((c) => c.mobilePrimary);
    const badge = columns.find((c) => c.mobileBadge);
    const detail = columns.filter((c) => !c.mobilePrimary && !c.mobileBadge);
    return { primary, badge, detail };
  }, [columns]);

  if (rows.length === 0 && empty) {
    return <>{empty}</>;
  }

  return (
    <>
      {/* Desktop: tabela */}
      <div className="hidden md:block glass-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                {columns.map((c) => (
                  <th
                    key={c.key}
                    className={cn(
                      "px-4 py-2.5 text-muted-foreground font-medium text-xs uppercase tracking-wide",
                      alignClass[c.align ?? "left"],
                      c.hideBelow && hideClass[c.hideBelow],
                      c.width
                    )}
                  >
                    {c.header}
                  </th>
                ))}
                {rowActions && <th className="px-4 py-2.5 text-right w-1" />}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, idx) => (
                <tr
                  key={rowKey(row)}
                  className={cn(
                    "border-b border-border/30 hover:bg-accent/30 transition-colors last:border-0",
                    rowClassName?.(row)
                  )}
                >
                  {columns.map((c) => (
                    <td
                      key={c.key}
                      className={cn(
                        "px-4 py-2.5 text-foreground align-middle",
                        alignClass[c.align ?? "left"],
                        c.hideBelow && hideClass[c.hideBelow],
                        c.cellClassName
                      )}
                    >
                      {c.cell(row, idx)}
                    </td>
                  ))}
                  {rowActions && (
                    <td className="px-4 py-2.5 text-right whitespace-nowrap">
                      <div className="flex items-center justify-end gap-1">{rowActions(row)}</div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
            {footer && <tfoot>{footer}</tfoot>}
          </table>
        </div>
      </div>

      {/* Mobile: cards */}
      <div className="md:hidden space-y-2">
        {rows.map((row, idx) => (
          <div
            key={rowKey(row)}
            className={cn("glass-card p-3 space-y-2", rowClassName?.(row))}
          >
            {(mobileColumns.primary || mobileColumns.badge) && (
              <div className="flex items-start justify-between gap-2">
                {mobileColumns.primary && (
                  <div className="min-w-0 flex-1 font-medium text-sm text-foreground">
                    {mobileColumns.primary.cell(row, idx)}
                  </div>
                )}
                {mobileColumns.badge && (
                  <div className="shrink-0">{mobileColumns.badge.cell(row, idx)}</div>
                )}
              </div>
            )}
            {mobileColumns.detail.length > 0 && (
              <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
                {mobileColumns.detail.map((c) => (
                  <div key={c.key} className="min-w-0">
                    <dt className="text-muted-foreground text-[10px] uppercase tracking-wide truncate">
                      {c.mobileLabel ?? c.header}
                    </dt>
                    <dd className="text-foreground truncate">{c.cell(row, idx)}</dd>
                  </div>
                ))}
              </dl>
            )}
            {rowActions && (
              <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-border/40">
                {rowActions(row)}
              </div>
            )}
          </div>
        ))}
      </div>
    </>
  );
}
