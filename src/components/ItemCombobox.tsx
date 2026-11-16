import { useState, useMemo, useRef, useEffect } from "react";
import { Check, ChevronsUpDown, Search } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { cn } from "@/lib/utils";
import type { Item } from "@/hooks/useItems";
import { useStock } from "@/hooks/useStock";
import { formatBRL } from "@/lib/money";
import { getRecentItems } from "@/lib/recentItems";

interface ItemComboboxProps {
  items: Item[] | undefined;
  value: string;
  onChange: (id: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
  className?: string;
}

export function ItemCombobox({
  items,
  value,
  onChange,
  placeholder = "Buscar item...",
  autoFocus = false,
  className,
}: ItemComboboxProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const triggerRef = useRef<HTMLButtonElement>(null);
  const { data: stock } = useStock(30);

  // Relê os itens recentes (localStorage) sempre que a lista é aberta.
  const [recent, setRecent] = useState<string[]>(getRecentItems);
  useEffect(() => {
    if (open) setRecent(getRecentItems());
  }, [open]);

  const stockMap = useMemo(() => {
    const m = new Map<string, { fisico: number; custo: number }>();
    (stock || []).forEach((s) => {
      m.set(s.item.id, { fisico: s.fisico, custo: s.custoMedio });
    });
    return m;
  }, [stock]);

  const selectedItem = useMemo(
    () => items?.find((i) => i.id === value),
    [items, value],
  );

  const results = useMemo(() => {
    if (!items) return [];
    const q = query.trim().toLowerCase();
    let list = items;
    if (q) {
      list = items.filter((i) => i.nome.toLowerCase().includes(q));
    }
    // Ordenar: recentes primeiro (apenas quando sem busca)
    if (!q && recent.length) {
      const recentSet = new Set(recent);
      const recentItems = recent
        .map((id) => list.find((i) => i.id === id))
        .filter(Boolean) as Item[];
      const others = list.filter((i) => !recentSet.has(i.id));
      list = [...recentItems, ...others];
    }
    return list.slice(0, 10);
  }, [items, query, recent]);

  useEffect(() => {
    if (autoFocus && triggerRef.current) {
      triggerRef.current.focus();
    }
  }, [autoFocus]);

  const renderItemLabel = (item: Item) => {
    const s = stockMap.get(item.id);
    const parts: string[] = [`${item.nome} (${item.tipo})`];
    if (s) {
      parts.push(`Estoque: ${s.fisico} ${item.unidade}`);
      if (s.custo > 0) parts.push(formatBRL(s.custo));
    }
    return parts.join(" — ");
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          ref={triggerRef}
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn(
            "w-full h-10 justify-between font-normal bg-input border-border",
            !value && "text-muted-foreground",
            className,
          )}
        >
          <span className="truncate text-left">
            {selectedItem ? renderItemLabel(selectedItem) : placeholder}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="p-0 w-[var(--radix-popover-trigger-width)] min-w-[320px]"
        align="start"
      >
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Digite para buscar..."
            value={query}
            onValueChange={setQuery}
            autoFocus
          />
          <CommandList>
            <CommandEmpty>Nenhum item encontrado.</CommandEmpty>
            <CommandGroup
              heading={!query && recent.length ? "Recentes e itens" : undefined}
            >
              {results.map((item) => {
                const s = stockMap.get(item.id);
                const isRecent = !query && recent.includes(item.id);
                return (
                  <CommandItem
                    key={item.id}
                    value={item.id}
                    onSelect={() => {
                      onChange(item.id);
                      setOpen(false);
                      setQuery("");
                    }}
                    className="flex items-center gap-2"
                  >
                    <Check
                      className={cn(
                        "h-4 w-4 shrink-0",
                        value === item.id ? "opacity-100" : "opacity-0",
                      )}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium truncate">{item.nome}</span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground shrink-0">
                          {item.tipo}
                        </span>
                        {isRecent && (
                          <span className="text-[10px] text-primary shrink-0">recente</span>
                        )}
                      </div>
                      {s && (
                        <div className="text-xs text-muted-foreground">
                          Estoque: {s.fisico} {item.unidade}
                          {s.custo > 0 && ` · ${formatBRL(s.custo)}`}
                        </div>
                      )}
                    </div>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
