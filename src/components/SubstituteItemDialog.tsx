import { useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useStock, type StockEntry } from "@/hooks/useStock";
import {
  useProductionSubstitutions,
  useCreateSubstitution,
  useDeleteSubstitution,
  type ProductionSubstitution,
} from "@/hooks/useProductionSubstitutions";
import { useBom } from "@/hooks/useBom";
import { resolveItemUnitCost } from "@/lib/cost";
import { useAllItemFornecedores } from "@/hooks/useItemFornecedores";
import { formatQuantity } from "@/lib/quantity";
import { formatBRL } from "@/lib/money";
import { ArrowRightLeft, AlertTriangle, Trash2, Search } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/auth";

type Props = {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  /** OP onde a substituição será aplicada. */
  order: {
    id: string;
    item_id: string;
    quantidade: number;
    items?: { nome?: string };
  } | null;
};

/**
 * Dialog para substituir itens da BOM em uma OP específica.
 *
 * - Lista os componentes da BOM da OP
 * - Mostra substituições já aplicadas (com botão remover)
 * - Permite escolher um item substituto a partir do estoque (mesma unidade,
 *   estoque suficiente para a quantidade necessária)
 * - Não altera a BOM original
 */
export function SubstituteItemDialog({ open, onOpenChange, order }: Props) {
  const user = useAuth();
  const { data: bom } = useBom();
  const { data: stock } = useStock();
  const { data: substitutions } = useProductionSubstitutions(order?.id);
  const { data: itemFornecedores } = useAllItemFornecedores();
  const createSub = useCreateSubstitution();
  const deleteSub = useDeleteSubstitution();

  const [selectedComponentId, setSelectedComponentId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [motivo, setMotivo] = useState("");

  // Componentes da BOM desta OP
  const components = useMemo(() => {
    if (!order || !bom || !stock) return [];
    return bom
      .filter((b) => b.item_pai_id === order.item_id)
      .map((b) => {
        const necessario = Number(b.quantidade) * Number(order.quantidade);
        const stockEntry = stock.find((s: StockEntry) => s.item.id === b.item_componente_id);
        const sub = substitutions?.find((s) => s.item_original_id === b.item_componente_id);
        return {
          bomId: b.id,
          itemId: b.item_componente_id,
          nome: b.item_componente?.nome || stockEntry?.item.nome || "—",
          unidade: ((b.item_componente as any)?.unidade) || (stockEntry?.item as any)?.unidade || "",
          necessario,
          fisico: stockEntry?.fisico ?? 0,
          disponivel: stockEntry?.disponivel ?? 0,
          falta: Math.max(0, necessario - (stockEntry?.disponivel ?? 0)),
          sub,
        };
      });
  }, [order, bom, stock, substitutions]);

  const selectedComponent = components.find((c) => c.itemId === selectedComponentId);

  // Itens elegíveis para substituição:
  // - mesma unidade do original
  // - id diferente do original
  // - tem estoque disponível >= necessário
  // - ativo (já filtrado no useStock por padrão)
  const eligibleItems = useMemo(() => {
    if (!selectedComponent || !stock) return [];
    const term = search.trim().toLowerCase();
    return stock
      .filter((s: StockEntry) => {
        if (s.item.id === selectedComponent.itemId) return false;
        if ((s.item as any).unidade !== selectedComponent.unidade) return false;
        if (s.disponivel < selectedComponent.necessario) return false;
        if (term && !s.item.nome.toLowerCase().includes(term)) return false;
        return true;
      })
      .map((s: StockEntry) => {
        const custo = resolveItemUnitCost(
          s.item as any,
          (itemFornecedores || []) as any,
        );
        return { ...s, custoUnitario: custo };
      })
      .sort((a, b) => a.item.nome.localeCompare(b.item.nome));
  }, [selectedComponent, stock, search, itemFornecedores]);

  const handleSelectComponent = (itemId: string) => {
    setSelectedComponentId(itemId);
    setSearch("");
    setMotivo("");
  };

  const handleConfirmSubstitution = async (substituteItem: any) => {
    if (!order || !selectedComponent) return;
    const custoOriginal = (() => {
      const it = stock?.find((s: StockEntry) => s.item.id === selectedComponent.itemId);
      if (!it) return null;
      return resolveItemUnitCost(it.item as any, (itemFornecedores || []) as any);
    })();
    try {
      await createSub.mutateAsync({
        production_order_id: order.id,
        item_original_id: selectedComponent.itemId,
        item_substituto_id: substituteItem.item.id,
        quantidade: selectedComponent.necessario,
        custo_unitario_original: custoOriginal,
        custo_unitario_substituto: substituteItem.custoUnitario ?? null,
        motivo: motivo.trim() || null,
        usuario_nome: user.displayName,
      });
      toast.success(`"${substituteItem.item.nome}" substituirá "${selectedComponent.nome}" nesta OP.`);
      setSelectedComponentId(null);
      setSearch("");
      setMotivo("");
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const handleRemoveSubstitution = async (sub: ProductionSubstitution) => {
    if (!order) return;
    if (!window.confirm(`Remover a substituição de "${sub.item_original_nome || "componente"}" por "${sub.item_substituto_nome || "item substituto"}" desta ordem?`)) return;
    try {
      await deleteSub.mutateAsync({ id: sub.id, production_order_id: order.id });
      toast.success("Substituição removida.");
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  if (!order) return null;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) { setSelectedComponentId(null); setSearch(""); setMotivo(""); } onOpenChange(o); }}>
      <DialogContent className="max-w-3xl max-h-[90vh] flex flex-col p-0">
        <DialogHeader className="px-6 pt-5 pb-3 border-b border-border/50">
          <DialogTitle className="flex items-center gap-2 text-base">
            <ArrowRightLeft className="h-4 w-4 text-primary" />
            Substituir itens da BOM
          </DialogTitle>
          <DialogDescription className="text-xs">
            Produto: <span className="text-foreground font-medium">{order.items?.nome}</span> ·
            Quantidade: <span className="text-foreground font-medium">{order.quantidade}</span>
            <br />
            A BOM original não é alterada — apenas o consumo desta OP usará o item substituto.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-5">
          {!selectedComponent ? (
            <div>
              <h3 className="text-sm font-semibold text-foreground mb-2">Componentes da BOM</h3>
              <div className="space-y-2">
                {components.map((c) => (
                  <div
                    key={c.itemId}
                    className="rounded-lg border border-border/60 bg-card/40 p-3 flex items-start justify-between gap-3"
                  >
                    <div className="min-w-0">
                      <div className="font-medium text-foreground">{c.nome}</div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        Necessário: <span className="text-foreground tabular-nums">{formatQuantity(c.necessario, c.unidade)}</span>
                        {" · "}Disponível: <span className={c.falta > 0 ? "text-destructive tabular-nums" : "text-foreground tabular-nums"}>{formatQuantity(c.disponivel, c.unidade)}</span>
                        {c.falta > 0 && (
                          <span className="ml-2 inline-flex items-center gap-1 text-destructive">
                            <AlertTriangle className="h-3 w-3" /> faltam {formatQuantity(c.falta, c.unidade)}
                          </span>
                        )}
                      </div>
                      {c.sub && (
                        <div className="mt-2 text-xs rounded bg-primary/10 text-primary px-2 py-1 inline-flex items-center gap-1">
                          <ArrowRightLeft className="h-3 w-3" />
                          Substituído por <strong>{c.sub.item_substituto_nome ?? "item"}</strong>
                        </div>
                      )}
                    </div>
                    <div className="flex flex-col gap-1.5 shrink-0">
                      <Button
                        size="sm"
                        variant={c.sub ? "outline" : "default"}
                        onClick={() => handleSelectComponent(c.itemId)}
                      >
                        {c.sub ? "Trocar substituto" : "Substituir"}
                      </Button>
                      {c.sub && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => handleRemoveSubstitution(c.sub!)}
                          className="text-destructive hover:text-destructive"
                        >
                          <Trash2 className="h-3.5 w-3.5 mr-1" /> Remover
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
                {components.length === 0 && (
                  <div className="text-sm text-muted-foreground">Esta OP não tem componentes na BOM.</div>
                )}
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="rounded-lg border border-border/60 bg-card/40 p-3">
                <div className="text-xs text-muted-foreground">Substituindo</div>
                <div className="font-medium text-foreground">{selectedComponent.nome}</div>
                <div className="text-xs text-muted-foreground mt-1">
                  Necessário: <span className="text-foreground tabular-nums">{formatQuantity(selectedComponent.necessario, selectedComponent.unidade)}</span>
                </div>
              </div>

              <div>
                <Label htmlFor="sub-search" className="text-xs">Buscar item compatível</Label>
                <div className="relative mt-1">
                  <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                  <Input
                    id="sub-search"
                    placeholder="Digite o nome do item..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="pl-7 h-9 bg-secondary text-foreground"
                  />
                </div>
                <p className="text-[11px] text-muted-foreground mt-1.5">
                  Apenas itens com a mesma unidade de estoque (<strong>{selectedComponent.unidade || "—"}</strong>) e estoque disponível ≥ {formatQuantity(selectedComponent.necessario, selectedComponent.unidade)}.
                </p>
              </div>

              <div>
                <Label htmlFor="sub-motivo" className="text-xs">Motivo (opcional)</Label>
                <Input
                  id="sub-motivo"
                  value={motivo}
                  onChange={(e) => setMotivo(e.target.value)}
                  placeholder="Ex: ruptura de estoque, lote alternativo..."
                  className="mt-1 h-9 bg-secondary text-foreground"
                />
              </div>

              <div className="space-y-2 max-h-80 overflow-y-auto">
                {eligibleItems.length === 0 ? (
                  <div className="text-sm text-muted-foreground rounded border border-dashed border-border/60 p-4 text-center">
                    Nenhum item compatível com estoque suficiente.
                  </div>
                ) : (
                  eligibleItems.map((it: any) => (
                    <div
                      key={it.item.id}
                      className="rounded-lg border border-border/60 bg-card/40 p-3 flex items-center justify-between gap-3"
                    >
                      <div className="min-w-0">
                        <div className="font-medium text-foreground">{it.item.nome}</div>
                        <div className="text-xs text-muted-foreground mt-0.5">
                          Estoque: <span className="text-foreground tabular-nums">{formatQuantity(it.disponivel, (it.item as any).unidade || "")}</span>
                          {" · "}Custo: <span className="text-foreground tabular-nums">{formatBRL(it.custoUnitario)}/{(it.item as any).unidade || ""}</span>
                        </div>
                      </div>
                      <Button
                        size="sm"
                        onClick={() => handleConfirmSubstitution(it)}
                        disabled={createSub.isPending}
                      >
                        Usar este
                      </Button>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="px-6 py-3 border-t border-border/50 bg-card/30">
          {selectedComponent ? (
            <Button variant="ghost" onClick={() => setSelectedComponentId(null)}>
              Voltar
            </Button>
          ) : (
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Fechar
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
