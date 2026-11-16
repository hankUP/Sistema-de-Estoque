import { useMemo, useState, useEffect, useRef } from "react";
import { useBom, useCreateBomItem, useDeleteBomItem, useUpdateBomItem, useSwapBomOrder, useCopyBom, type CopyBomMode } from "@/hooks/useBom";
import { useItems } from "@/hooks/useItems";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { LoadingSkeleton, EmptyState } from "@/components/LoadingAndEmpty";
import { PageHeader } from "@/components/PageHeader";
import { SectionCard } from "@/components/SectionCard";
import { BomOrderDialog } from "@/components/BomOrderDialog";
import { StatusBadge } from "@/components/StatusBadge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { FormDialog } from "@/components/FormDialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Trash2, Settings2, Plus, Check, ChevronsUpDown, Loader2, ArrowUp, ArrowDown, Copy } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

type ItemLite = { id: string; nome: string; tipo: string };

type DraftRow = {
  // either an existing bom item id or a temp local id
  id: string;
  isNew: boolean;
  item_componente_id: string;
  quantidade: string; // string to allow controlled editing
  sort_order?: number;
  saving?: boolean;
};

function ComponentCombobox({
  value,
  onChange,
  options,
  disabledIds,
  placeholder = "Selecione o componente",
  autoFocus,
}: {
  value: string;
  onChange: (id: string) => void;
  options: ItemLite[];
  disabledIds?: Set<string>;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const selected = options.find((o) => o.id === value);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          autoFocus={autoFocus}
          className="h-9 w-full justify-between bg-input border-border font-normal text-sm"
        >
          <span className={cn("truncate", !selected && "text-muted-foreground")}>
            {selected ? `${selected.nome} (${selected.tipo})` : placeholder}
          </span>
          <ChevronsUpDown className="ml-2 h-3.5 w-3.5 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="p-0 w-[--radix-popover-trigger-width] min-w-[280px]" align="start">
        <Command>
          <CommandInput placeholder="Buscar componente..." className="h-9" />
          <CommandList>
            <CommandEmpty>Nenhum componente encontrado.</CommandEmpty>
            <CommandGroup>
              {options.map((opt) => {
                const isDisabled = disabledIds?.has(opt.id) && opt.id !== value;
                return (
                  <CommandItem
                    key={opt.id}
                    value={`${opt.nome} ${opt.tipo}`}
                    disabled={isDisabled}
                    onSelect={() => {
                      if (isDisabled) return;
                      onChange(opt.id);
                      setOpen(false);
                    }}
                    className={cn(isDisabled && "opacity-50 cursor-not-allowed")}
                  >
                    <Check className={cn("mr-2 h-4 w-4", value === opt.id ? "opacity-100" : "opacity-0")} />
                    <span className="flex-1 truncate">{opt.nome}</span>
                    <StatusBadge tone="default" size="sm" className="ml-2">
                      {opt.tipo}
                    </StatusBadge>
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

export default function BomPage() {
  const { data: items } = useItems();
  const { data: bomItems, isLoading } = useBom();
  const createBom = useCreateBomItem();
  const updateBom = useUpdateBomItem();
  const deleteBom = useDeleteBomItem();
  const swapOrder = useSwapBomOrder();
  const copyBom = useCopyBom();

  const parentItems = useMemo(
    () => (items?.filter((i) => i.tipo === "PF" || i.tipo === "SUB") || []) as ItemLite[],
    [items],
  );
  const componentItems = useMemo(
    () => (items?.filter((i) => i.tipo === "MP" || i.tipo === "SUB") || []) as ItemLite[],
    [items],
  );

  const itemsById = useMemo(() => {
    const m = new Map<string, any>();
    (items || []).forEach((i: any) => m.set(i.id, i));
    return m;
  }, [items]);
  // Produto pai sendo editado
  const [paiId, setPaiId] = useState<string>("");
  const [orderOpen, setOrderOpen] = useState(false);

  // Auto-seleciona o primeiro pai com BOM ou o primeiro pai disponível
  useEffect(() => {
    if (paiId || !items) return;
    const firstWithBom = bomItems?.[0]?.item_pai_id as string | undefined;
    if (firstWithBom) setPaiId(firstWithBom);
    else if (parentItems.length > 0) setPaiId(parentItems[0].id);
  }, [items, bomItems, parentItems, paiId]);

  // Linhas existentes do produto selecionado
  const existingRows: DraftRow[] = useMemo(() => {
    if (!paiId || !bomItems) return [];
    return bomItems
      .filter((b) => b.item_pai_id === paiId)
      .slice()
      .sort((a: any, b: any) => {
        const sa = Number(a.sort_order ?? 0);
        const sb = Number(b.sort_order ?? 0);
        if (sa !== sb) return sa - sb;
        return String(a.created_at).localeCompare(String(b.created_at));
      })
      .map((b: any) => ({
        id: b.id,
        isNew: false,
        item_componente_id: b.item_componente_id,
        quantidade: String(b.quantidade),
        sort_order: Number(b.sort_order ?? 0),
      }));
  }, [bomItems, paiId]);

  // Linhas em rascunho (novas, ainda não persistidas)
  const [drafts, setDrafts] = useState<DraftRow[]>([]);

  // Reseta drafts ao trocar de pai
  useEffect(() => {
    setDrafts([{ id: `tmp-${Date.now()}`, isNew: true, item_componente_id: "", quantidade: "1" }]);
  }, [paiId]);

  const usedComponentIds = useMemo(() => {
    const s = new Set<string>();
    [...existingRows, ...drafts].forEach((r) => {
      if (r.item_componente_id) s.add(r.item_componente_id);
    });
    return s;
  }, [existingRows, drafts]);

  const parent = parentItems.find((p) => p.id === paiId);

  // ---------- Mutations ----------
  const updateExistingField = async (
    row: DraftRow,
    patch: { item_componente_id?: string; quantidade?: number },
  ) => {
    try {
      await updateBom.mutateAsync({ id: row.id, ...patch });
    } catch (e: any) {
      toast.error(e.message || "Erro ao atualizar componente");
    }
  };

  const handleExistingComponentChange = (row: DraftRow, newCompId: string) => {
    if (newCompId === row.item_componente_id) return;
    if (newCompId === paiId) {
      toast.error("Componente não pode ser igual ao produto pai");
      return;
    }
    if (existingRows.some((r) => r.id !== row.id && r.item_componente_id === newCompId)) {
      toast.error("Este componente já está na estrutura");
      return;
    }
    updateExistingField(row, { item_componente_id: newCompId });
  };

  const handleExistingQtyBlur = (row: DraftRow, raw: string) => {
    const n = Number(raw.replace(",", "."));
    if (!(n > 0)) {
      toast.error("Quantidade deve ser maior que zero");
      return;
    }
    if (n === Number(existingRows.find((r) => r.id === row.id)?.quantidade)) return;
    updateExistingField(row, { quantidade: n });
  };

  const handleDelete = async (id: string) => {
    const row = existingRows.find((entry) => entry.id === id);
    const componente = row ? itemsById.get(row.item_componente_id)?.nome || "este componente" : "este componente";
    const produto = itemsById.get(paiId)?.nome || "este produto";
    if (!window.confirm(`Remover "${componente}" da estrutura de "${produto}"?`)) return;
    try {
      await deleteBom.mutateAsync(id);
      toast.success("Componente removido");
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const handleMove = async (index: number, dir: -1 | 1) => {
    const target = index + dir;
    if (target < 0 || target >= existingRows.length) return;
    const a = existingRows[index];
    const b = existingRows[target];
    if (a.sort_order == null || b.sort_order == null) return;
    try {
      await swapOrder.mutateAsync({
        a: { id: a.id, sort_order: a.sort_order },
        b: { id: b.id, sort_order: b.sort_order },
      });
    } catch (e: any) {
      toast.error(e.message || "Erro ao reordenar");
    }
  };

  // ---------- Copiar estrutura ----------
  const [copyOpen, setCopyOpen] = useState(false);
  const [copyDestId, setCopyDestId] = useState<string>("");
  const [copyMode, setCopyMode] = useState<CopyBomMode>("MERGE");

  const openCopy = () => {
    setCopyDestId("");
    setCopyMode("MERGE");
    setCopyOpen(true);
  };

  const handleConfirmCopy = async () => {
    if (!paiId || !copyDestId) {
      toast.error("Selecione o produto de destino");
      return;
    }
    try {
      const res = await copyBom.mutateAsync({ originId: paiId, destId: copyDestId, mode: copyMode });
      const skippedMsg = res.skipped > 0 ? ` (${res.skipped} duplicado(s) ignorado(s))` : "";
      toast.success(`Estrutura copiada com sucesso. ${res.inserted} componente(s) adicionado(s)${skippedMsg}.`);
      setCopyOpen(false);
      setPaiId(copyDestId);
    } catch (e: any) {
      toast.error(e.message || "Erro ao copiar estrutura");
    }
  };

  // ---------- Drafts ----------
  const updateDraft = (id: string, patch: Partial<DraftRow>) => {
    setDrafts((prev) => prev.map((d) => (d.id === id ? { ...d, ...patch } : d)));
  };

  const removeDraft = (id: string) => {
    const draft = drafts.find((entry) => entry.id === id);
    if (draft && (draft.item_componente_id || draft.quantidade !== "1")
      && !window.confirm("Descartar esta linha? Os dados ainda não salvos serão perdidos.")) return;
    setDrafts((prev) => {
      const next = prev.filter((d) => d.id !== id);
      // Sempre manter ao menos uma linha em branco
      if (next.length === 0) {
        return [{ id: `tmp-${Date.now()}`, isNew: true, item_componente_id: "", quantidade: "1" }];
      }
      return next;
    });
  };

  const addEmptyDraft = () => {
    setDrafts((prev) => [
      ...prev,
      { id: `tmp-${Date.now()}-${Math.random()}`, isNew: true, item_componente_id: "", quantidade: "1" },
    ]);
  };

  const persistDraft = async (draft: DraftRow): Promise<boolean> => {
    if (!paiId) return false;
    if (!draft.item_componente_id) return false;
    const qtd = Number(String(draft.quantidade).replace(",", "."));
    if (!(qtd > 0)) {
      toast.error("Quantidade deve ser maior que zero");
      return false;
    }
    if (draft.item_componente_id === paiId) {
      toast.error("Componente não pode ser igual ao produto pai");
      return false;
    }
    if (
      existingRows.some((r) => r.item_componente_id === draft.item_componente_id) ||
      drafts.some((d) => d.id !== draft.id && d.item_componente_id === draft.item_componente_id)
    ) {
      toast.error("Este componente já está na estrutura");
      return false;
    }
    try {
      updateDraft(draft.id, { saving: true });
      await createBom.mutateAsync({
        item_pai_id: paiId,
        item_componente_id: draft.item_componente_id,
        quantidade: qtd,
      });
      // Remove o rascunho persistido (existingRows vai refletir após invalidate)
      setDrafts((prev) => prev.filter((d) => d.id !== draft.id));
      return true;
    } catch (e: any) {
      updateDraft(draft.id, { saving: false });
      toast.error(e.message || "Erro ao adicionar componente");
      return false;
    }
  };

  const handleDraftComponentChange = async (draft: DraftRow, newCompId: string) => {
    updateDraft(draft.id, { item_componente_id: newCompId });
    // Se já temos quantidade válida, persiste imediatamente e cria nova linha
    const qtd = Number(String(draft.quantidade).replace(",", "."));
    if (newCompId && qtd > 0) {
      const ok = await persistDraft({ ...draft, item_componente_id: newCompId });
      if (ok) {
        // Se era a última linha, adiciona uma nova vazia
        setDrafts((prev) => {
          if (prev.length === 0) {
            return [{ id: `tmp-${Date.now()}`, isNew: true, item_componente_id: "", quantidade: "1" }];
          }
          return prev;
        });
        // Garante linha vazia ao final
        setTimeout(() => {
          setDrafts((prev) => {
            const hasEmpty = prev.some((d) => !d.item_componente_id);
            return hasEmpty
              ? prev
              : [...prev, { id: `tmp-${Date.now()}`, isNew: true, item_componente_id: "", quantidade: "1" }];
          });
        }, 0);
      }
    }
  };

  const handleDraftQtyKeyDown = async (e: React.KeyboardEvent<HTMLInputElement>, draft: DraftRow) => {
    if (e.key === "Enter") {
      e.preventDefault();
      const ok = await persistDraft(draft);
      if (ok) {
        setTimeout(() => {
          setDrafts((prev) => {
            const hasEmpty = prev.some((d) => !d.item_componente_id);
            return hasEmpty
              ? prev
              : [...prev, { id: `tmp-${Date.now()}`, isNew: true, item_componente_id: "", quantidade: "1" }];
          });
        }, 0);
      }
    }
  };

  // ---------- Resumo de produtos com BOM (sidebar) ----------
  const groupedSummary = useMemo(() => {
    const map = new Map<string, number>();
    (bomItems || []).forEach((b: any) => {
      map.set(b.item_pai_id, (map.get(b.item_pai_id) || 0) + 1);
    });
    return map;
  }, [bomItems]);

  if (isLoading) {
    return (
      <div className="space-y-5">
        <PageHeader title="Estrutura de Produtos (BOM)" description="Carregando..." />
        <LoadingSkeleton rows={3} />
      </div>
    );
  }

  if (parentItems.length === 0) {
    return (
      <div className="space-y-5">
        <PageHeader
          title="Estrutura de Produtos (BOM)"
          description="Cadastre os componentes do produto e envie a montagem para a fila nesta página."
        />
        <EmptyState
          icon={Settings2}
          title="Nenhum produto cadastrado"
          description="Cadastre primeiro itens do tipo Produto Final (PF) ou Submontagem (SUB) para montar a estrutura."
        />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Estrutura de Produtos (BOM)"
        description="Selecione um produto, defina seus componentes e envie a ordem para a fila. Uma BOM em uso por ordem ativa não pode ser alterada."
      />

      <div className="grid grid-cols-1 lg:grid-cols-[280px,1fr] gap-4">
        {/* Lista de produtos (pai) */}
        <SectionCard title="Produtos / Submontagens" noPadding>
          <div className="max-h-[70vh] overflow-y-auto py-1">
            {parentItems.map((p) => {
              const count = groupedSummary.get(p.id) || 0;
              const active = p.id === paiId;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setPaiId(p.id)}
                  className={cn(
                    "w-full text-left px-4 py-2.5 border-l-2 transition-colors flex items-center justify-between gap-2 hover:bg-muted/40",
                    active
                      ? "border-primary bg-primary/5"
                      : "border-transparent",
                  )}
                >
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-foreground truncate">{p.nome}</div>
                    <div className="text-[11px] text-muted-foreground mt-0.5 flex items-center gap-1.5">
                      <StatusBadge tone="default" size="sm">{p.tipo}</StatusBadge>
                      <span>{count} {count === 1 ? "componente" : "componentes"}</span>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </SectionCard>

        {/* Tabela de componentes */}
        <SectionCard
          title={parent ? `Componentes de ${parent.nome}` : "Selecione um produto"}
          actions={
            parent && (
              <div className="flex items-center gap-2">
                <StatusBadge tone="primary" size="sm">{parent.tipo}</StatusBadge>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={openCopy}
                  disabled={existingRows.length === 0}
                  className="gap-1.5 h-8"
                  title={existingRows.length === 0 ? "Adicione componentes para poder copiar" : "Copiar esta estrutura para outro produto"}
                >
                  <Copy className="h-3.5 w-3.5" /> Copiar estrutura
                </Button>
                <Button size="sm" variant="outline" onClick={addEmptyDraft} className="gap-1.5 h-8">
                  <Plus className="h-3.5 w-3.5" /> Adicionar linha
                </Button>
                <Button size="sm" onClick={() => setOrderOpen(true)} disabled={existingRows.length === 0} className="h-8" title={existingRows.length === 0 ? "Adicione ao menos um componente antes de enviar" : "Criar ordem com este produto"}>
                  Enviar à fila
                </Button>
              </div>
            )
          }
          noPadding
        >
          {!parent ? (
            <div className="p-8 text-center text-sm text-muted-foreground">
              Selecione um produto na lista ao lado para editar sua estrutura.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border/50 bg-muted/20">
                    <th className="text-left font-medium text-muted-foreground px-4 py-2.5 w-[50%]">Componente</th>
                    <th className="text-left font-medium text-muted-foreground px-4 py-2.5 w-[10%]">Tipo</th>
                    <th className="text-right font-medium text-muted-foreground px-4 py-2.5 w-[14%]">Quantidade por unidade</th>
                    <th className="text-right font-medium text-muted-foreground px-4 py-2.5 w-[16%]">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {existingRows.map((row, idx) => {
                    const comp = componentItems.find((c) => c.id === row.item_componente_id);
                    const isFirst = idx === 0;
                    const isLast = idx === existingRows.length - 1;
                    return (
                      <tr key={row.id} className="border-b border-border/40 hover:bg-muted/20">
                        <td className="px-4 py-2 align-middle">
                          <ComponentCombobox
                            value={row.item_componente_id}
                            onChange={(id) => handleExistingComponentChange(row, id)}
                            options={componentItems}
                            disabledIds={usedComponentIds}
                          />
                        </td>
                        <td className="px-4 py-2 align-middle">
                          {comp && <StatusBadge tone="default" size="sm">{comp.tipo}</StatusBadge>}
                        </td>
                        <td className="px-4 py-2 align-middle">
                          <div className="flex items-center justify-end gap-2">
                            <Input
                              type="number"
                              inputMode="decimal"
                              min="0.0001"
                              step="any"
                              defaultValue={row.quantidade}
                              key={row.quantidade}
                              placeholder="0"
                              onBlur={(e) => handleExistingQtyBlur(row, e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                              }}
                              className="h-9 w-20 min-w-[5rem] text-right tabular-nums bg-secondary text-foreground placeholder:text-muted-foreground/60 focus-visible:ring-1 focus-visible:ring-ring"
                            />
                            <span className="text-xs text-muted-foreground min-w-[2.5rem] text-left">
                              {(itemsById.get(row.item_componente_id) as any)?.unidade || ""}
                            </span>
                          </div>
                        </td>
                        <td className="px-4 py-2 align-middle text-right">
                          <div className="flex items-center justify-end gap-0.5">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleMove(idx, -1)}
                              disabled={isFirst || swapOrder.isPending}
                              className="h-8 w-8 p-0"
                              title="Mover para cima"
                            >
                              <ArrowUp className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleMove(idx, 1)}
                              disabled={isLast || swapOrder.isPending}
                              className="h-8 w-8 p-0"
                              title="Mover para baixo"
                            >
                              <ArrowDown className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleDelete(row.id)}
                              className="gap-1 text-destructive hover:text-destructive h-8"
                            >
                              <Trash2 className="h-3.5 w-3.5" /> Remover
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}

                  {drafts.map((draft) => {
                    const comp = componentItems.find((c) => c.id === draft.item_componente_id);
                    return (
                      <tr key={draft.id} className="border-b border-border/40 bg-primary/[0.02]">
                        <td className="px-4 py-2 align-middle">
                          <ComponentCombobox
                            value={draft.item_componente_id}
                            onChange={(id) => handleDraftComponentChange(draft, id)}
                            options={componentItems}
                            disabledIds={usedComponentIds}
                            placeholder="Buscar componente para adicionar..."
                          />
                        </td>
                        <td className="px-4 py-2 align-middle">
                          {comp && <StatusBadge tone="default" size="sm">{comp.tipo}</StatusBadge>}
                        </td>
                        <td className="px-4 py-2 align-middle">
                          <div className="flex items-center justify-end gap-2">
                            <Input
                              type="number"
                              inputMode="decimal"
                              min="0.0001"
                              step="any"
                              value={draft.quantidade}
                              onChange={(e) => updateDraft(draft.id, { quantidade: e.target.value })}
                              onKeyDown={(e) => handleDraftQtyKeyDown(e, draft)}
                              placeholder="0"
                              className="h-9 w-20 min-w-[5rem] text-right tabular-nums bg-secondary text-foreground placeholder:text-muted-foreground/60 focus-visible:ring-1 focus-visible:ring-ring"
                            />
                            <span className="text-xs text-muted-foreground min-w-[2.5rem] text-left">
                              {(itemsById.get(draft.item_componente_id) as any)?.unidade || ""}
                            </span>
                          </div>
                        </td>
                        <td className="px-4 py-2 align-middle text-right">
                          <div className="flex items-center justify-end gap-1">
                            {draft.saving && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => persistDraft(draft)}
                              disabled={!draft.item_componente_id || !draft.quantidade || draft.saving}
                              className="gap-1 h-8"
                            >
                              <Check className="h-3.5 w-3.5" /> Salvar
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => removeDraft(draft.id)}
                              className="gap-1 text-muted-foreground hover:text-destructive h-8"
                              title="Descartar linha"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}

                  {existingRows.length === 0 && drafts.length === 0 && (
                    <tr>
                      <td colSpan={4} className="px-4 py-10 text-center text-sm text-muted-foreground">
                        Nenhum componente cadastrado. Clique em "Adicionar linha" para começar.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}

          {parent && (
            <div className="px-4 py-2.5 border-t border-border/50 bg-muted/10 text-xs text-muted-foreground flex items-center gap-3 flex-wrap">
              <span><kbd className="px-1.5 py-0.5 rounded bg-muted/60 text-foreground/80 text-[10px]">Enter</kbd> para salvar a linha em edição</span>
              <span>•</span>
              <span>Ao escolher componente + quantidade, a linha é salva automaticamente</span>
              <span>•</span>
              <span>Componentes já usados ficam desabilitados na busca</span>
            </div>
          )}
        </SectionCard>
      </div>

      <BomOrderDialog
        open={orderOpen}
        onOpenChange={setOrderOpen}
        product={parent ? { ...parent, modo_producao_padrao: itemsById.get(parent.id)?.modo_producao_padrao } : null}
      />

      <FormDialog
        open={copyOpen}
        onOpenChange={setCopyOpen}
        title="Copiar estrutura"
        description={parent ? `Copiar componentes de "${parent.nome}" para outro produto.` : undefined}
        size="md"
        submitLabel={copyMode === "REPLACE" ? "Substituir e copiar" : "Copiar"}
        onSubmit={handleConfirmCopy}
        loading={copyBom.isPending}
        submitDisabled={!copyDestId}
      >
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Produto de destino</Label>
            <ComponentCombobox
              value={copyDestId}
              onChange={setCopyDestId}
              options={parentItems.filter((p) => p.id !== paiId)}
              placeholder="Selecione o produto de destino"
            />
          </div>

          {copyDestId && (groupedSummary.get(copyDestId) || 0) > 0 && (
            <div className="rounded-md border border-warning/40 bg-warning/10 p-3 text-xs text-foreground">
              O produto de destino já possui {groupedSummary.get(copyDestId)} componente(s) cadastrado(s).
              Escolha o que fazer:
            </div>
          )}

          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Comportamento</Label>
            <RadioGroup value={copyMode} onValueChange={(v) => setCopyMode(v as CopyBomMode)} className="space-y-2">
              <div className="flex items-start gap-2">
                <RadioGroupItem value="MERGE" id="copy-merge" className="mt-0.5" />
                <Label htmlFor="copy-merge" className="font-normal cursor-pointer">
                  <div className="text-sm">Adicionar aos componentes existentes</div>
                  <div className="text-xs text-muted-foreground">Componentes já presentes no destino serão ignorados (sem duplicar).</div>
                </Label>
              </div>
              <div className="flex items-start gap-2">
                <RadioGroupItem value="REPLACE" id="copy-replace" className="mt-0.5" />
                <Label htmlFor="copy-replace" className="font-normal cursor-pointer">
                  <div className="text-sm">Substituir estrutura atual</div>
                  <div className="text-xs text-muted-foreground">Remove todos os componentes do destino antes de copiar.</div>
                </Label>
              </div>
            </RadioGroup>
          </div>
        </div>
      </FormDialog>
    </div>
  );
}

