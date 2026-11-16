import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Check, Package, Search, Wrench, X, Zap } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useItems, type Item } from "@/hooks/useItems";
import { useStock } from "@/hooks/useStock";
import {
  useCreateMovement,
  type MovementType,
} from "@/hooks/useMovements";
import { pushRecentItem } from "@/lib/recentItems";
import { CostCenterSelect } from "@/components/CostCenterSelect";
import { useAuth } from "@/auth";

type QuickType = Extract<MovementType, "RETORNO" | "SAIDA" | "CONSUMO">;

const QUICK_TYPES: {
  value: QuickType;
  label: string;
  helper: string;
  sign: "+" | "-";
  Icon: typeof ArrowUp;
  toneClass: string;
  selectedClass: string;
}[] = [
  {
    value: "RETORNO",
    label: "Entrada",
    helper: "Retorno ao estoque",
    sign: "+",
    Icon: ArrowDown,
    toneClass: "text-success",
    selectedClass: "border-success bg-success/10 text-success",
  },
  {
    value: "SAIDA",
    label: "Saída",
    helper: "Retirada para cliente",
    sign: "-",
    Icon: ArrowUp,
    toneClass: "text-destructive",
    selectedClass: "border-destructive bg-destructive/10 text-destructive",
  },
  {
    value: "CONSUMO",
    label: "Consumo",
    helper: "Uso interno na produção",
    sign: "-",
    Icon: Wrench,
    toneClass: "text-destructive",
    selectedClass: "border-destructive bg-destructive/10 text-destructive",
  },
];

const RECENT_KEY = "movements:recent-items";

function getRecentIds(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function QuickMovementMode() {
  const user = useAuth();
  const { data: items } = useItems();
  const { data: stock } = useStock(30);
  const createMovement = useCreateMovement();

  const [tipo, setTipo] = useState<QuickType>("CONSUMO");
  const [itemId, setItemId] = useState("");
  const [search, setSearch] = useState("");
  const [qtd, setQtd] = useState("");
  const [centroCustoId, setCentroCustoId] = useState("");
  const [recentVersion, setRecentVersion] = useState(0);

  const searchRef = useRef<HTMLInputElement>(null);
  const qtdRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    searchRef.current?.focus();
  }, []);

  const selectedItem: Item | undefined = useMemo(
    () => items?.find((i) => i.id === itemId),
    [items, itemId],
  );

  const stockMap = useMemo(() => {
    const m = new Map<string, number>();
    (stock || []).forEach((s) => m.set(s.item.id, s.fisico));
    return m;
  }, [stock]);

  const recentItems = useMemo(() => {
    const ids = getRecentIds();
    if (!items) return [] as Item[];
    return ids
      .map((id) => items.find((i) => i.id === id))
      .filter(Boolean) as Item[];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, recentVersion]);

  const searchResults = useMemo(() => {
    if (!items) return [] as Item[];
    const q = search.trim().toLowerCase();
    if (!q) return [];
    return items
      .filter((i) => i.nome.toLowerCase().includes(q))
      .slice(0, 8);
  }, [items, search]);

  const estoqueAtual = selectedItem ? stockMap.get(selectedItem.id) ?? 0 : null;

  const tipoConfig = QUICK_TYPES.find((t) => t.value === tipo)!;
  const isEntrada = tipoConfig.sign === "+";

  const handlePickItem = (id: string) => {
    setItemId(id);
    setSearch("");
    setTimeout(() => qtdRef.current?.focus(), 30);
  };

  const handleClearItem = () => {
    setItemId("");
    setQtd("");
    setTimeout(() => searchRef.current?.focus(), 30);
  };

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!itemId) {
      toast.error("Selecione um item");
      searchRef.current?.focus();
      return;
    }
    if (!centroCustoId) {
      toast.error("Selecione o centro de custo.");
      return;
    }
    const quantidade = Number(qtd);
    if (!quantidade || quantidade <= 0) {
      toast.error("Quantidade deve ser maior que zero");
      qtdRef.current?.focus();
      return;
    }

    const finalQtd = isEntrada ? Math.abs(quantidade) : -Math.abs(quantidade);

    if (!isEntrada && estoqueAtual != null && estoqueAtual + finalQtd < 0) {
      toast.warning(
        `Atenção: estoque ficará negativo (${estoqueAtual + finalQtd}).`,
      );
    }

    try {
      await createMovement.mutateAsync({
        item_id: itemId,
        tipo_movimentacao: tipo,
        quantidade: finalQtd,
        centro_custo_id: centroCustoId,
      });
      pushRecentItem(itemId);
      setRecentVersion((v) => v + 1);

      const verbo =
        tipo === "RETORNO" ? "Entrada" : tipo === "SAIDA" ? "Saída" : "Consumo";
      toast.success(`${verbo} registrada com sucesso`);

      // Limpar para a próxima operação, mantendo o tipo
      setItemId("");
      setQtd("");
      setSearch("");
      setTimeout(() => searchRef.current?.focus(), 30);
    } catch (e: any) {
      toast.error(e.message || "Erro ao registrar movimentação");
    }
  };

  return (
    <div className="space-y-4 max-w-2xl mx-auto">
      {/* Cabeçalho compacto */}
      <div className="flex items-center gap-2 text-sm">
        <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-primary/10 text-primary text-xs font-medium">
          <Zap className="h-3.5 w-3.5" /> Modo Rápido
        </div>
        <span className="text-muted-foreground text-xs">
          Registre uma movimentação em poucos segundos.
        </span>
      </div>

      {/* Responsável obtido da conta conectada */}
      <div className="rounded-xl border border-border bg-card p-3">
        <label className="block text-[11px] font-medium uppercase tracking-wide text-muted-foreground mb-1.5">
          Responsável
        </label>
        <div className="h-10 flex items-center text-sm font-medium">{user.displayName}</div>
      </div>

      <div className="rounded-xl border border-border bg-card p-3">
        <label className="block text-[11px] font-medium uppercase tracking-wide text-muted-foreground mb-1.5">
          Centro de custo
        </label>
        <CostCenterSelect value={centroCustoId} onChange={setCentroCustoId} />
      </div>

      {/* Seleção de tipo — botões grandes */}
      <div className="grid grid-cols-3 gap-2">
        {QUICK_TYPES.map(({ value, label, helper, sign, Icon, selectedClass }) => {
          const isSelected = tipo === value;
          return (
            <button
              key={value}
              type="button"
              onClick={() => setTipo(value)}
              aria-pressed={isSelected}
              className={cn(
                "flex flex-col items-center justify-center gap-1.5 rounded-xl border-2 p-3 sm:p-4 transition-all min-h-[88px] sm:min-h-[100px] active:scale-[0.98]",
                isSelected
                  ? selectedClass
                  : "border-border bg-card text-foreground hover:bg-accent",
              )}
            >
              <div className="flex items-center gap-1.5">
                <Icon className="h-5 w-5" />
                <span className="text-base font-semibold leading-none">{label}</span>
                <span
                  className={cn(
                    "text-base font-bold leading-none",
                    isSelected ? "" : sign === "+" ? "text-success" : "text-destructive",
                  )}
                >
                  {sign}
                </span>
              </div>
              <span
                className={cn(
                  "text-[11px] leading-tight text-center",
                  isSelected ? "opacity-90" : "text-muted-foreground",
                )}
              >
                {helper}
              </span>
            </button>
          );
        })}
      </div>

      <form onSubmit={handleSubmit} className="space-y-3">
        {/* Item selecionado ou busca */}
        {selectedItem ? (
          <div
            className={cn(
              "rounded-xl border-2 p-4 flex items-center gap-3",
              isEntrada
                ? "border-success/40 bg-success/5"
                : "border-destructive/40 bg-destructive/5",
            )}
          >
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-background shrink-0">
              <Package className="h-5 w-5 text-foreground" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-semibold text-foreground truncate">
                {selectedItem.nome}
              </div>
              <div className="text-xs text-muted-foreground mt-0.5">
                Estoque atual:{" "}
                <span className="font-medium text-foreground">
                  {estoqueAtual ?? 0} {selectedItem.unidade}
                </span>
              </div>
            </div>
            <button
              type="button"
              onClick={handleClearItem}
              aria-label="Trocar item"
              className="p-2 rounded-lg hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
              <Input
                ref={searchRef}
                placeholder="Buscar item por nome..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-12 pl-10 text-base"
                autoComplete="off"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && searchResults.length > 0) {
                    e.preventDefault();
                    handlePickItem(searchResults[0].id);
                  }
                }}
              />
            </div>

            {/* Resultados da busca */}
            {search.trim() && (
              <div className="rounded-xl border border-border bg-card overflow-hidden">
                {searchResults.length === 0 ? (
                  <div className="p-4 text-sm text-muted-foreground text-center">
                    Nenhum item encontrado
                  </div>
                ) : (
                  <ul className="divide-y divide-border">
                    {searchResults.map((it) => {
                      const fisico = stockMap.get(it.id) ?? 0;
                      return (
                        <li key={it.id}>
                          <button
                            type="button"
                            onClick={() => handlePickItem(it.id)}
                            className="w-full flex items-center gap-3 p-3 text-left hover:bg-accent transition-colors"
                          >
                            <div className="flex-1 min-w-0">
                              <div className="font-medium text-foreground truncate">
                                {it.nome}
                              </div>
                              <div className="text-xs text-muted-foreground">
                                {fisico} {it.unidade} em estoque
                              </div>
                            </div>
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground shrink-0">
                              {it.tipo}
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            )}

            {/* Itens recentes (só quando não está buscando) */}
            {!search.trim() && recentItems.length > 0 && (
              <div className="space-y-1.5">
                <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground px-1">
                  Últimos itens movimentados
                </div>
                <div className="flex flex-wrap gap-2">
                  {recentItems.map((it) => {
                    const fisico = stockMap.get(it.id) ?? 0;
                    return (
                      <button
                        key={it.id}
                        type="button"
                        onClick={() => handlePickItem(it.id)}
                        className="inline-flex items-center gap-2 rounded-full border border-border bg-card hover:bg-accent transition-colors px-3 py-1.5 text-sm"
                      >
                        <Package className="h-3.5 w-3.5 text-muted-foreground" />
                        <span className="font-medium text-foreground">{it.nome}</span>
                        <span className="text-[11px] text-muted-foreground">
                          {fisico} {it.unidade}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Quantidade — somente quando há item escolhido */}
        {selectedItem && (
          <div>
            <label className="block text-[11px] font-medium uppercase tracking-wide text-muted-foreground mb-1.5 px-1">
              Quantidade ({selectedItem.unidade})
            </label>
            <div className="relative">
              <span
                className={cn(
                  "absolute left-4 top-1/2 -translate-y-1/2 text-2xl font-bold pointer-events-none",
                  isEntrada ? "text-success" : "text-destructive",
                )}
              >
                {tipoConfig.sign}
              </span>
              <Input
                ref={qtdRef}
                type="number"
                inputMode="decimal"
                min="0"
                step="any"
                placeholder="0"
                value={qtd}
                onChange={(e) => setQtd(e.target.value)}
                className="h-16 pl-12 pr-4 text-3xl font-semibold text-center"
                autoComplete="off"
              />
            </div>
          </div>
        )}

        {/* Botão de ação grande */}
        <Button
          type="submit"
          disabled={createMovement.isPending || !itemId || !qtd}
          className={cn(
            "w-full h-14 text-base font-semibold rounded-xl",
            isEntrada
              ? "bg-success text-success-foreground hover:bg-success/90"
              : "bg-destructive text-destructive-foreground hover:bg-destructive/90",
          )}
        >
          {createMovement.isPending ? (
            "Registrando..."
          ) : (
            <span className="inline-flex items-center gap-2">
              <Check className="h-5 w-5" />
              Registrar {tipoConfig.label.toLowerCase()}
            </span>
          )}
        </Button>
      </form>
    </div>
  );
}
