import { ReactNode } from "react";
import { Input } from "@/components/ui/input";
import { Search, X } from "lucide-react";

type FilterBarProps = {
  search?: string;
  onSearchChange?: (v: string) => void;
  searchPlaceholder?: string;
  /** Filtros (toggles, selects). Renderizados após o campo de busca. */
  children?: ReactNode;
  /** Ações alinhadas à direita (botões primários, exportar etc). */
  actions?: ReactNode;
  /** Texto pequeno abaixo da barra (ex: "12 de 50 itens"). */
  meta?: ReactNode;
};

/**
 * Barra padronizada de busca + filtros + ações.
 * Layout único: busca à esquerda (flexível), filtros no meio, ações à direita.
 * Em telas pequenas tudo se empilha em coluna.
 */
export function FilterBar({
  search,
  onSearchChange,
  searchPlaceholder = "Buscar...",
  children,
  actions,
  meta,
}: FilterBarProps) {
  const hasSearch = onSearchChange !== undefined;
  return (
    <div className="space-y-2">
      <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
        {hasSearch && (
          <div className="relative w-full lg:w-72 lg:shrink-0">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
            <Input
              placeholder={searchPlaceholder}
              value={search ?? ""}
              onChange={(e) => onSearchChange?.(e.target.value)}
              className="pl-9 pr-9 bg-card/60 border-border/60 h-9"
            />
            {search && (
              <button
                onClick={() => onSearchChange?.("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
                aria-label="Limpar busca"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        )}
        {children && (
          <div className="flex flex-wrap items-center gap-2 lg:flex-1 min-w-0">
            {children}
          </div>
        )}
        {actions && (
          <div className="flex flex-wrap items-center gap-2 lg:ml-auto lg:shrink-0">
            {actions}
          </div>
        )}
      </div>
      {meta && <div className="text-xs text-muted-foreground">{meta}</div>}
    </div>
  );
}

type FilterToggleGroupProps<T extends string | number | null> = {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  /** Coloração customizada por opção quando ativa (semantic tokens). */
  variant?: (value: T) => "primary" | "success" | "warning" | "destructive";
};

/**
 * Grupo de botões pill estilo segmented control.
 */
export function FilterToggleGroup<T extends string | number | null>({
  options,
  value,
  onChange,
  variant,
}: FilterToggleGroupProps<T>) {
  return (
    <div className="inline-flex items-center gap-0.5 rounded-lg border border-border bg-card/60 p-0.5 h-9">
      {options.map((opt) => {
        const active = value === opt.value;
        const v = variant?.(opt.value) ?? "primary";
        const activeCls =
          v === "success" ? "bg-success text-success-foreground" :
          v === "warning" ? "bg-warning text-warning-foreground" :
          v === "destructive" ? "bg-destructive text-destructive-foreground" :
          "bg-primary text-primary-foreground";
        return (
          <button
            key={String(opt.value)}
            type="button"
            onClick={() => onChange(opt.value)}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all whitespace-nowrap ${
              active ? `${activeCls} shadow-sm` : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

type FilterSelectProps = {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  placeholder?: string;
};

export function FilterSelect({ value, onChange, options, placeholder }: FilterSelectProps) {
  return (
    <select
      className="bg-card/60 border border-border rounded-lg px-3 h-9 text-xs text-foreground min-w-0 max-w-[12rem] truncate"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      {placeholder && <option value="">{placeholder}</option>}
      {options.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  );
}
