import { useState, useMemo, useRef, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { useMovements, useCreateMovement } from "@/hooks/useMovements";
import { useCostCenters } from "@/hooks/useCostCenters";
import { CostCenterSelect } from "@/components/CostCenterSelect";
import { useItems, type Item } from "@/hooks/useItems";
import { useFornecedores } from "@/hooks/useFornecedores";
import { useAllItemFornecedores } from "@/hooks/useItemFornecedores";
import { useStock } from "@/hooks/useStock";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FieldLabel } from "@/components/FieldLabel";
import { EditItemDialog } from "@/components/EditItemDialog";
import { CreateItemDialog } from "@/components/CreateItemDialog";
import { ImportItemsDialog } from "@/components/ImportItemsDialog";
import { LoadingSkeleton, EmptyState } from "@/components/LoadingAndEmpty";
import { PageHeader } from "@/components/PageHeader";
import { SectionCard } from "@/components/SectionCard";
import { FilterBar, FilterToggleGroup, FilterSelect } from "@/components/FilterBar";
import { DataTable, type Column } from "@/components/DataTable";
import { StatusBadge } from "@/components/StatusBadge";
import { ItemCombobox } from "@/components/ItemCombobox";
import { pushRecentItem } from "@/lib/recentItems";
import { toast } from "sonner";
import { Pencil, ArrowRightLeft, Plus, Package, ChevronDown, ChevronUp, Upload, Plus as PlusIcon, Minus as MinusIcon, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import { QuickMovementMode } from "@/components/QuickMovementMode";
import { Link } from "react-router-dom";
import { formatQuantity } from "@/lib/quantity";
import { useAuth } from '@/auth';

const MOVEMENT_TYPES = [
  { value: "INICIAL", label: "Estoque Inicial", sign: "+" },
  { value: "COMPRA", label: "Compra", sign: "+" },
  { value: "RETORNO", label: "Retorno ao Estoque", sign: "+" },
  { value: "CONSUMO", label: "Consumo", sign: "-" },
  { value: "PRODUCAO", label: "Produção", sign: "+" },
  { value: "SAIDA", label: "Saída/Venda", sign: "-" },
  { value: "AJUSTE", label: "Ajuste", sign: "±" },
] as const;

const MODE_KEY = "movements:mode"; // "padrao" | "rapido"

type ItemRow = Item;
type MovementRow = {
  id: string;
  data: string;
  item_id: string;
  tipo_movimentacao: string;
  quantidade: number;
  referencia: string | null;
  usuario_nome: string | null;
  centro_custo_id: string | null;
  centros_custo?: { nome: string; tipo: string } | null;
  /** Saldo do item após esta movimentação (calculado em ordem cronológica). */
  saldo_apos?: number;
};

export default function MovementsPage() {
  const user = useAuth();
  const canManageItems = user.role === 'ADMIN' || user.role === 'COORDENADOR';
  const { data: movements, isLoading } = useMovements();
  const { data: items } = useItems();
  const { data: fornecedores } = useFornecedores();
  const { data: allItemFornecedores } = useAllItemFornecedores();
  const createMovement = useCreateMovement();
  const { data: costCenters } = useCostCenters();
  const { data: stock } = useStock(30);

  const [createItemOpen, setCreateItemOpen] = useState(false);
  const [importItemsOpen, setImportItemsOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<Item | null>(null);
  const [showItems, setShowItems] = useState(false);

  // Modo da página: padrão (formulário completo) ou rápido (otimizado para mobile)
  const [mode, setMode] = useState<"padrao" | "rapido">(() => {
    try {
      const v = localStorage.getItem("movements:mode");
      return v === "rapido" ? "rapido" : "padrao";
    } catch {
      return "padrao";
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem("movements:mode", mode);
    } catch { /* ignore */ }
  }, [mode]);

  // Movement form
  const [itemId, setItemId] = useState("");
  const [tipo, setTipo] = useState<typeof MOVEMENT_TYPES[number]["value"]>("CONSUMO");
  const [qtd, setQtd] = useState("");
  const [ref, setRef] = useState("");
  const [centroCustoId, setCentroCustoId] = useState("");
  // Para AJUSTE: direção do ajuste (+ aumenta / - reduz)
  const [ajusteDirecao, setAjusteDirecao] = useState<"+" | "-">("+");
  // Para COMPRA manual: fornecedor + preço (na unidade de compra)
  const [compraFornecedorId, setCompraFornecedorId] = useState<string>("");
  const [compraPrecoCompra, setCompraPrecoCompra] = useState<string>("");
  const [filterItem, setFilterItem] = useState("");
  const [filterType, setFilterType] = useState("");
  const [filterSector, setFilterSector] = useState("");
  const [filterPerson, setFilterPerson] = useState("");

  const formRef = useRef<HTMLFormElement>(null);
  const qtdRef = useRef<HTMLInputElement>(null);

  // Pré-seleção via query param (?item=ID) — vindo da Posição de Estoque
  const [searchParams, setSearchParams] = useSearchParams();
  const [prefilledNome, setPrefilledNome] = useState<string | null>(null);
  const prefilledItem = useMemo(() => {
    const pid = searchParams.get("item");
    if (!pid || !items) return null;
    return items.find((i) => i.id === pid) || null;
  }, [searchParams, items]);

  useEffect(() => {
    if (!prefilledItem) return;
    setItemId(prefilledItem.id);
    setPrefilledNome(prefilledItem.nome);
    const next = new URLSearchParams(searchParams);
    next.delete("item");
    setSearchParams(next, { replace: true });
    setTimeout(() => qtdRef.current?.focus(), 50);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefilledItem?.id]);

  // Items list filters
  const [itemSearch, setItemSearch] = useState("");
  const [itemTypeFilter, setItemTypeFilter] = useState<string | null>(null);
  const [itemFornecedorFilter, setItemFornecedorFilter] = useState("");

  const filteredItems = useMemo(() => {
    if (!items) return [];
    return items.filter((i) => {
      if (itemSearch && !i.nome.toLowerCase().includes(itemSearch.toLowerCase())) return false;
      if (itemTypeFilter && i.tipo !== itemTypeFilter) return false;
      if (itemFornecedorFilter && allItemFornecedores) {
        const hasSupplier = allItemFornecedores.some(
          (r) => r.item_id === i.id && r.fornecedor_id === itemFornecedorFilter
        );
        if (!hasSupplier) return false;
      }
      return true;
    });
  }, [items, itemSearch, itemTypeFilter, itemFornecedorFilter, allItemFornecedores]);

  // Determina sinal final por tipo de movimentação
  const getSinalFinal = (): "+" | "-" => {
    if (tipo === "CONSUMO" || tipo === "SAIDA") return "-";
    if (tipo === "AJUSTE") return ajusteDirecao;
    return "+"; // INICIAL, COMPRA, RETORNO, PRODUCAO
  };

  const sinalAtual = getSinalFinal();
  const isEntrada = sinalAtual === "+";

  // Estoque atual do item selecionado (para alertas)
  const estoqueAtualSelecionado = useMemo(() => {
    if (!itemId || !stock) return null;
    const s = stock.find((s) => s.item.id === itemId);
    return s ? s.fisico : null;
  }, [itemId, stock]);

  // Item selecionado e seus fornecedores vinculados (para COMPRA manual)
  const itemSelecionado = useMemo(
    () => (itemId && items ? items.find((i) => i.id === itemId) || null : null),
    [itemId, items],
  );
  const fornecedoresDoItem = useMemo(() => {
    if (!itemId || !allItemFornecedores || !fornecedores) return [];
    const vinculos = allItemFornecedores.filter((v) => v.item_id === itemId && v.ativo);
    return vinculos
      .map((v) => {
        const f = fornecedores.find((f) => f.id === v.fornecedor_id);
        return f ? { vinculo: v, fornecedor: f } : null;
      })
      .filter((x): x is NonNullable<typeof x> => x !== null && x.fornecedor.ativo);
  }, [itemId, allItemFornecedores, fornecedores]);

  // Pré-seleciona fornecedor principal ao mudar item/tipo para COMPRA
  useEffect(() => {
    if (tipo !== "COMPRA") return;
    if (!compraFornecedorId && fornecedoresDoItem.length > 0) {
      const principal = fornecedoresDoItem.find((x) => x.vinculo.principal);
      const escolhido = principal || fornecedoresDoItem[0];
      setCompraFornecedorId(escolhido.fornecedor.id);
    }
  }, [tipo, fornecedoresDoItem, compraFornecedorId]);

  // Limpa campos de compra ao trocar tipo ou item
  useEffect(() => {
    setCompraFornecedorId("");
    setCompraPrecoCompra("");
  }, [itemId]);
  useEffect(() => {
    if (tipo !== "COMPRA") {
      setCompraFornecedorId("");
      setCompraPrecoCompra("");
    }
  }, [tipo]);

  // Vínculo (item-fornecedor) e dados derivados para COMPRA manual
  const vinculoCompra = useMemo(() => {
    if (tipo !== "COMPRA" || !compraFornecedorId) return null;
    return fornecedoresDoItem.find((x) => x.fornecedor.id === compraFornecedorId) || null;
  }, [tipo, compraFornecedorId, fornecedoresDoItem]);

  const unidadeCompraEfetiva =
    vinculoCompra?.vinculo.unidade_compra ||
    itemSelecionado?.unidade_compra ||
    itemSelecionado?.unidade ||
    "";
  const fatorConversaoEfetivo =
    Number(vinculoCompra?.vinculo.fator_conversao) > 0
      ? Number(vinculoCompra!.vinculo.fator_conversao)
      : Number(itemSelecionado?.fator_conversao) > 0
        ? Number(itemSelecionado!.fator_conversao)
        : 1;
  const unidadeEstoque = itemSelecionado?.unidade || "un";

  // Pré-preenche preço com último preço cadastrado do vínculo, se houver
  useEffect(() => {
    if (tipo !== "COMPRA") return;
    if (compraPrecoCompra) return;
    if (vinculoCompra?.vinculo.preco_unitario != null) {
      setCompraPrecoCompra(String(vinculoCompra.vinculo.preco_unitario));
    }
  }, [tipo, vinculoCompra, compraPrecoCompra]);

  const precoCompraNumero = Number(compraPrecoCompra);
  const precoUnitarioEstoque =
    precoCompraNumero > 0 && fatorConversaoEfetivo > 0
      ? precoCompraNumero / fatorConversaoEfetivo
      : 0;

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!itemId) { toast.error("Selecione um item"); return; }
    if (!centroCustoId) { toast.error("Selecione o centro de custo."); return; }
    const quantidade = Number(qtd);
    if (!quantidade || quantidade <= 0) {
      toast.error("Quantidade deve ser maior que zero");
      return;
    }

    // Validações específicas para COMPRA manual
    if (tipo === "COMPRA") {
      if (!compraFornecedorId) {
        toast.error("Selecione o fornecedor da compra");
        return;
      }
      if (!precoCompraNumero || precoCompraNumero <= 0) {
        toast.error("Informe o preço unitário (na unidade de compra)");
        return;
      }
      if (!ref.trim()) {
        toast.error("Informe a referência (ex: NF, recibo, OC)");
        return;
      }
      if (fatorConversaoEfetivo <= 0) {
        toast.error("Fator de conversão inválido. Revise o cadastro do item ou do fornecedor.");
        return;
      }
    }

    const finalQtd = sinalAtual === "-" ? -Math.abs(quantidade) : Math.abs(quantidade);

    // Aviso (não bloqueia) se reduzir abaixo de zero
    if (sinalAtual === "-" && estoqueAtualSelecionado != null && estoqueAtualSelecionado + finalQtd < 0) {
      toast.warning(
        `Atenção: estoque ficará negativo (${estoqueAtualSelecionado + finalQtd}).`
      );
    }

    try {
      await createMovement.mutateAsync({
        item_id: itemId,
        tipo_movimentacao: tipo,
        quantidade: finalQtd,
        referencia: ref || undefined,
        centro_custo_id: centroCustoId,
        // Campos extras para COMPRA manual
        ...(tipo === "COMPRA" && {
          preco_unitario: precoUnitarioEstoque,
          preco_unitario_compra: precoCompraNumero,
          fornecedor_id: compraFornecedorId,
        }),
      });
      pushRecentItem(itemId);
      toast.success(
        tipo === "COMPRA"
          ? "Compra registrada! Custo médio e histórico de preços atualizados."
          : "Movimentação registrada!",
      );
      // Limpar campos mantendo o tipo selecionado
      setItemId("");
      setPrefilledNome(null);
      setQtd("");
      setRef("");
      setCompraFornecedorId("");
      setCompraPrecoCompra("");
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  // Calcula saldo após cada movimentação respeitando ordem cronológica por item.
  // movements vem do hook em ordem descendente; processamos em ordem ascendente
  // (acumulando por item) e devolvemos no formato original.
  const movementsComSaldo = useMemo<MovementRow[]>(() => {
    if (!movements) return [];
    const asc = [...(movements as MovementRow[])].sort(
      (a, b) => new Date(a.data).getTime() - new Date(b.data).getTime(),
    );
    const saldosPorItem = new Map<string, number>();
    const saldoById = new Map<string, number>();
    for (const m of asc) {
      const prev = saldosPorItem.get(m.item_id) ?? 0;
      const next = prev + Number(m.quantidade);
      saldosPorItem.set(m.item_id, next);
      saldoById.set(m.id, next);
    }
    return (movements as MovementRow[]).map((m) => ({
      ...m,
      saldo_apos: saldoById.get(m.id),
    }));
  }, [movements]);

  const personOptions = useMemo(() => {
    const names = new Map<string, string>();
    for (const movement of movementsComSaldo) {
      const name = movement.usuario_nome?.trim();
      if (name) names.set(name.toLocaleLowerCase("pt-BR"), name);
    }
    return [...names.entries()]
      .sort((a, b) => a[1].localeCompare(b[1], "pt-BR"))
      .map(([value, label]) => ({ value, label }));
  }, [movementsComSaldo]);

  const sectorOptions = (costCenters || [])
    .filter((center) => center.tipo === "SETOR")
    .map((center) => ({ value: center.id, label: center.nome }));

  const filteredMovements = movementsComSaldo.filter((m) => {
    if (filterItem && m.item_id !== filterItem) return false;
    if (filterType && m.tipo_movimentacao !== filterType) return false;
    if (filterSector && m.centro_custo_id !== filterSector) return false;
    if (filterPerson && m.usuario_nome?.trim().toLocaleLowerCase("pt-BR") !== filterPerson) return false;
    return true;
  });

  // Mapa de estoque mínimo por item para colorir saldo "baixo"
  const minimoPorItem = useMemo(() => {
    const map = new Map<string, number>();
    (items || []).forEach((i) => map.set(i.id, Number(i.estoque_minimo) || 0));
    return map;
  }, [items]);

  // Items table columns
  const itemColumns: Column<ItemRow>[] = [
    {
      key: "nome",
      header: "Nome",
      mobilePrimary: true,
      cell: (i) => <span className="font-medium text-foreground">{i.nome}</span>,
    },
    {
      key: "tipo",
      header: "Tipo",
      mobileBadge: true,
      cell: (i) => <StatusBadge tone="default" size="sm">{i.tipo}</StatusBadge>,
    },
    {
      key: "unidade",
      header: "Unidade",
      hideBelow: "lg",
      cell: (i) => i.unidade,
    },
    {
      key: "lead",
      header: "Lead Time",
      mobileLabel: "Lead Time",
      cell: (i) => `${i.lead_time_dias} dias`,
    },
    {
      key: "min",
      header: "Estoque Mínimo",
      align: "right",
      mobileLabel: "Estoque Mínimo",
      cell: (i) => formatQuantity(i.estoque_minimo, i.unidade),
    },
  ];

  // Movements table columns
  const movementColumns: Column<MovementRow>[] = [
    {
      key: "data",
      header: "Data",
      mobileLabel: "Data",
      cell: (m) => new Date(m.data).toLocaleDateString("pt-BR"),
    },
    {
      key: "item",
      header: "Item",
      mobilePrimary: true,
      cell: (m) => <span className="font-medium text-foreground">{items?.find((i) => i.id === m.item_id)?.nome || m.item_id}</span>,
    },
    {
      key: "tipo",
      header: "Tipo",
      mobileBadge: true,
      cell: (m) => (
        <StatusBadge tone={m.quantidade > 0 ? "success" : "destructive"} size="sm">
          {MOVEMENT_TYPES.find((t) => t.value === m.tipo_movimentacao)?.label || m.tipo_movimentacao}
        </StatusBadge>
      ),
    },
    {
      key: "qtd",
      header: "Quantidade",
      align: "right",
      mobileLabel: "Quantidade",
      cell: (m) => {
        const item = items?.find((i) => i.id === m.item_id);
        const unidade = item?.unidade || "";
        const sinal = m.quantidade > 0 ? "+" : "";
        return (
          <span className={`font-medium tabular-nums ${m.quantidade >= 0 ? "text-success" : "text-destructive"}`}>
            {sinal}{formatQuantity(m.quantidade, unidade)}
          </span>
        );
      },
    },
    {
      key: "saldo",
      header: "Saldo após",
      align: "right",
      mobileLabel: "Saldo após",
      cell: (m) => {
        if (m.saldo_apos == null) return <span className="text-muted-foreground">—</span>;
        const minimo = minimoPorItem.get(m.item_id) ?? 0;
        const item = items?.find((i) => i.id === m.item_id);
        const unidade = item?.unidade || "";
        const tone =
          m.saldo_apos < 0
            ? "text-destructive"
            : minimo > 0 && m.saldo_apos <= minimo
            ? "text-warning"
            : "text-foreground";
        return (
          <span className={`font-semibold tabular-nums ${tone}`}>
            {formatQuantity(m.saldo_apos, unidade)}
          </span>
        );
      },
    },
    {
      key: "ref",
      header: "Referência",
      hideBelow: "lg",
      mobileLabel: "Referência",
      cell: (m) => m.referencia || <span className="text-muted-foreground">—</span>,
    },
    {
      key: "centro",
      header: "Centro de custo",
      mobileLabel: "Centro de custo",
      cell: (m) => m.centros_custo?.nome || <span className="text-muted-foreground">—</span>,
    },
    {
      key: "usuario",
      header: "Responsável",
      hideBelow: "lg",
      mobileLabel: "Usuário",
      cell: (m) =>
        m.usuario_nome ? (
          <span className="text-foreground">{m.usuario_nome}</span>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Movimentações e Itens"
        description="Cadastre itens, registre entradas e saídas de estoque, e consulte o histórico completo de movimentações."
        actions={
          <div className="inline-flex rounded-lg border border-border overflow-hidden">
            <button
              type="button"
              onClick={() => setMode("padrao")}
              aria-pressed={mode === "padrao"}
              className={cn(
                "px-3 h-9 text-xs font-medium inline-flex items-center gap-1.5 transition-colors",
                mode === "padrao"
                  ? "bg-primary text-primary-foreground"
                  : "bg-card text-muted-foreground hover:bg-accent",
              )}
            >
              Modo Padrão
            </button>
            <button
              type="button"
              onClick={() => setMode("rapido")}
              aria-pressed={mode === "rapido"}
              className={cn(
                "px-3 h-9 text-xs font-medium inline-flex items-center gap-1.5 border-l border-border transition-colors",
                mode === "rapido"
                  ? "bg-primary text-primary-foreground"
                  : "bg-card text-muted-foreground hover:bg-accent",
              )}
            >
              <Zap className="h-3.5 w-3.5" /> Modo Rápido
            </button>
          </div>
        }
      />

      {mode === "rapido" ? (
        <>
          <SectionCard
            title="Registro Rápido"
            description="Otimizado para uso em celular e tablet por técnicos. Registre uma movimentação em poucos toques."
            actions={
              <Button size="sm" variant="outline" asChild className="gap-1.5">
                <Link to="/movimentacoes/rapido">
                  <Zap className="h-3.5 w-3.5" /> Abrir em tela cheia
                </Link>
              </Button>
            }
          >
            <QuickMovementMode />
          </SectionCard>

          {/* Histórico continua disponível também no modo rápido */}
          <SectionCard
            title="Histórico de Movimentações"
            description={`${filteredMovements.length} movimentações`}
            noPadding
          >
            <div className="p-5 space-y-4">
              <FilterBar>
                <FilterSelect
                  value={filterItem}
                  onChange={setFilterItem}
                  placeholder="Todos os itens"
                  options={(items || []).map((i) => ({ value: i.id, label: i.nome }))}
                />
                <FilterSelect
                  value={filterType}
                  onChange={setFilterType}
                  placeholder="Todos os tipos"
                  options={MOVEMENT_TYPES.map((t) => ({ value: t.value, label: t.label }))}
                />
                <FilterSelect value={filterSector} onChange={setFilterSector} placeholder="Todos os setores" options={sectorOptions} />
                <FilterSelect value={filterPerson} onChange={setFilterPerson} placeholder="Todas as pessoas" options={personOptions} />
              </FilterBar>

              {isLoading ? (
                <LoadingSkeleton rows={3} />
              ) : (
                <DataTable<MovementRow>
                  columns={movementColumns}
                  rows={filteredMovements as MovementRow[]}
                  rowKey={(m) => m.id}
                  empty={
                    <EmptyState
                      icon={ArrowRightLeft}
                      title="Nenhuma movimentação registrada"
                      description="Registre a primeira movimentação no formulário acima."
                    />
                  }
                />
              )}
            </div>
          </SectionCard>

          {canManageItems && <CreateItemDialog open={createItemOpen} onOpenChange={setCreateItemOpen} />}
          {canManageItems && <ImportItemsDialog open={importItemsOpen} onOpenChange={setImportItemsOpen} />}
          {canManageItems && <EditItemDialog
            item={editingItem}
            open={!!editingItem}
            onOpenChange={(open) => { if (!open) setEditingItem(null); }}
          />}
        </>
      ) : (
        <></>
      )}

      {mode === "padrao" && (<>

      {/* Itens cadastrados */}
      <SectionCard
        title="Itens Cadastrados"
        description={showItems ? `${filteredItems.length} de ${items?.length || 0} itens` : `${items?.length || 0} itens cadastrados no sistema`}
        actions={
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => setShowItems((v) => !v)} className="gap-1.5">
              {showItems ? <><ChevronUp className="h-3.5 w-3.5" /> Ocultar Itens</> : <><ChevronDown className="h-3.5 w-3.5" /> Ver Itens</>}
            </Button>
            {canManageItems && <Button size="sm" onClick={() => setCreateItemOpen(true)} className="gap-1.5">
              <Plus className="h-3.5 w-3.5" /> Novo Item
            </Button>}
            {canManageItems && <Button size="sm" variant="outline" onClick={() => setImportItemsOpen(true)} className="gap-1.5">
              <Upload className="h-3.5 w-3.5" /> Importar Planilha
            </Button>}
          </div>
        }
        noPadding
      >
        {showItems && (
          <div className="p-5 space-y-4">
            <FilterBar
              search={itemSearch}
              onSearchChange={setItemSearch}
              searchPlaceholder="Buscar item..."
            >
              <FilterToggleGroup
                value={itemTypeFilter as any}
                onChange={(v) => setItemTypeFilter(v)}
                options={[
                  { value: null, label: "Todos os tipos" },
                  { value: "MP", label: "Matéria-Prima" },
                  { value: "SUB", label: "Submontagem" },
                  { value: "PF", label: "Produto Final" },
                ]}
              />
              <FilterSelect
                value={itemFornecedorFilter}
                onChange={setItemFornecedorFilter}
                placeholder="Todos os fornecedores"
                options={(fornecedores?.filter((f) => f.ativo) || []).map((f) => ({ value: f.id, label: f.nome }))}
              />
            </FilterBar>

            <DataTable<ItemRow>
              columns={itemColumns}
              rows={filteredItems}
              rowKey={(i) => i.id}
              rowActions={canManageItems ? (i) => (
                <Button variant="ghost" size="sm" onClick={() => setEditingItem(i)} className="gap-1">
                  <Pencil className="h-3.5 w-3.5" /> Editar
                </Button>
              ) : undefined}
              empty={
                <EmptyState
                  icon={Package}
                  title={items && items.length > 0 ? "Nenhum item encontrado" : "Nenhum item cadastrado"}
                  description={items && items.length > 0 ? "Tente ajustar os filtros." : "Clique em Novo Item para começar."}
                />
              }
            />
          </div>
        )}
      </SectionCard>

      {/* Nova movimentação */}
      <SectionCard
        title="Nova Movimentação"
        description="Registre uma entrada ou saída manualmente. Pressione Enter para registrar rapidamente."
      >
        <form ref={formRef} onSubmit={handleSubmit} className="space-y-3">
          {/* Indicador visual de tipo (entrada/saída) */}
          <div
            className={cn(
              "inline-flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-medium",
              isEntrada
                ? "bg-success/10 text-success border border-success/30"
                : "bg-destructive/10 text-destructive border border-destructive/30",
            )}
          >
            {isEntrada ? <PlusIcon className="h-3.5 w-3.5" /> : <MinusIcon className="h-3.5 w-3.5" />}
            {isEntrada ? "Entrada de estoque" : "Saída de estoque"}
            {tipo === "AJUSTE" && (
              <span className="opacity-70">— ajuste {ajusteDirecao === "+" ? "positivo" : "negativo"}</span>
            )}
          </div>

          {prefilledNome && itemId && items?.find((i) => i.id === itemId)?.nome === prefilledNome && (
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-medium bg-primary/10 text-primary border border-primary/30 ml-2">
              <Package className="h-3.5 w-3.5" />
              Item selecionado: <span className="font-semibold">{prefilledNome}</span>
              <button
                type="button"
                onClick={() => { setPrefilledNome(null); setItemId(""); }}
                className="ml-1 opacity-70 hover:opacity-100"
                title="Limpar pré-seleção"
              >
                ✕
              </button>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3">
            <div className="lg:col-span-2">
              <FieldLabel label="Item" required help="Digite parte do nome para buscar. Use as setas e Enter para selecionar." />
              <div className="flex gap-1">
                <ItemCombobox
                  items={items}
                  value={itemId}
                  onChange={setItemId}
                  autoFocus={!itemId}
                  className="flex-1"
                />
                {itemId && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="shrink-0 h-10 w-10"
                    onClick={() => setEditingItem(items?.find((i) => i.id === itemId) || null)}
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                )}
              </div>
              {itemId && estoqueAtualSelecionado != null && (
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Estoque atual: <span className="font-medium text-foreground">{estoqueAtualSelecionado}</span>
                </p>
              )}
            </div>

            <div>
              <FieldLabel
                label="Tipo de movimentação"
                required
                help="INICIAL (+): Primeira carga de estoque&#10;COMPRA (+): Material recebido&#10;CONSUMO (−): Peças usadas na produção&#10;PRODUÇÃO (+): Produto montado&#10;SAÍDA (−): Venda ou envio&#10;AJUSTE (±): Correção de inventário (escolha o sentido)"
              />
              <select
                className="bg-input border border-border rounded-lg px-3 h-10 text-sm text-foreground w-full"
                value={tipo}
                onChange={(e) => setTipo(e.target.value as any)}
              >
                {MOVEMENT_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label} ({t.sign})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <FieldLabel
                label="Quantidade"
                required
                help="Informe sempre um número positivo. O sistema ajusta o sinal automaticamente conforme o tipo (e a direção do ajuste)."
              />
              <div className="relative">
                <span
                  className={cn(
                    "absolute left-3 top-1/2 -translate-y-1/2 text-sm font-semibold pointer-events-none",
                    isEntrada ? "text-success" : "text-destructive",
                  )}
                >
                  {sinalAtual}
                </span>
                <Input
                  ref={qtdRef}
                  placeholder="100"
                  type="number"
                  min="0"
                  step="any"
                  value={qtd}
                  onChange={(e) => setQtd(e.target.value)}
                  className="h-10 pl-7"
                />
              </div>
              {tipo === "AJUSTE" && (
                <div className="mt-1.5 inline-flex rounded-md border border-border overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setAjusteDirecao("+")}
                    className={cn(
                      "px-2.5 py-1 text-xs font-medium inline-flex items-center gap-1",
                      ajusteDirecao === "+"
                        ? "bg-success/15 text-success"
                        : "bg-transparent text-muted-foreground hover:bg-muted",
                    )}
                  >
                    <PlusIcon className="h-3 w-3" /> Aumentar
                  </button>
                  <button
                    type="button"
                    onClick={() => setAjusteDirecao("-")}
                    className={cn(
                      "px-2.5 py-1 text-xs font-medium inline-flex items-center gap-1 border-l border-border",
                      ajusteDirecao === "-"
                        ? "bg-destructive/15 text-destructive"
                        : "bg-transparent text-muted-foreground hover:bg-muted",
                    )}
                  >
                    <MinusIcon className="h-3 w-3" /> Reduzir
                  </button>
                </div>
              )}
            </div>

            <div>
              <FieldLabel
                label="Referência"
                required={tipo === "COMPRA"}
                help={
                  tipo === "COMPRA"
                    ? "Obrigatório para compras manuais. Informe NF, recibo ou número da OC."
                    : "Campo livre para identificar a movimentação. Ex: NF 12345"
                }
              />
              <Input
                placeholder={tipo === "COMPRA" ? "Ex: NF 12345 (obrigatório)" : "Ex: NF 12345"}
                value={ref}
                onChange={(e) => setRef(e.target.value)}
                className="h-10"
              />
            </div>

            <div className="lg:col-span-2">
              <FieldLabel label="Centro de custo" required help="Setor ou pessoa ao qual esta movimentação será atribuída." />
              <CostCenterSelect value={centroCustoId} onChange={setCentroCustoId} />
            </div>
            <div className="lg:col-span-2">
              <FieldLabel label="Responsável" required help="Definido automaticamente pela conta conectada." />
              <Input value={user.displayName} readOnly aria-readonly="true" />
            </div>

            {/* Painel exclusivo para COMPRA manual: fornecedor + preço na unidade de compra */}
            {tipo === "COMPRA" && (
              <div className="lg:col-span-6 space-y-3 rounded-lg border border-warning/30 bg-warning/5 p-4">
                <div className="flex items-start gap-2 text-xs">
                  <div className="flex-1">
                    <p className="font-semibold text-foreground">
                      Compra manual — exige fornecedor e preço real
                    </p>
                    <p className="text-muted-foreground mt-0.5">
                      O fluxo recomendado para compras com nota fiscal é{" "}
                      <Link to="/pedidos" className="underline font-medium text-foreground hover:text-primary">
                        Pedidos de Compra
                      </Link>
                      , que registra fornecedor, preço, recebimento e snapshots automaticamente. Use este formulário
                      apenas para regularizações pontuais. O custo médio e o histórico de preços serão atualizados
                      com o preço informado abaixo.
                    </p>
                  </div>
                </div>

                {!itemSelecionado ? (
                  <p className="text-xs text-muted-foreground">Selecione um item para escolher o fornecedor.</p>
                ) : fornecedoresDoItem.length === 0 ? (
                  <p className="text-xs text-destructive">
                    Este item não possui fornecedores ativos cadastrados. Vincule um fornecedor no cadastro do item
                    antes de registrar a compra.
                  </p>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                    <div>
                      <FieldLabel
                        label="Fornecedor"
                        required
                        help="Apenas fornecedores ativos vinculados a este item são listados."
                      />
                      <select
                        className="bg-input border border-border rounded-lg px-3 h-10 text-sm text-foreground w-full"
                        value={compraFornecedorId}
                        onChange={(e) => setCompraFornecedorId(e.target.value)}
                      >
                        <option value="">Selecione...</option>
                        {fornecedoresDoItem.map((x) => (
                          <option key={x.fornecedor.id} value={x.fornecedor.id}>
                            {x.fornecedor.nome}
                            {x.vinculo.principal ? " (principal)" : ""}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <FieldLabel
                        label={`Preço unitário (por ${unidadeCompraEfetiva || "unidade de compra"})`}
                        required
                        help="Informe o preço pago por unidade de compra (ex: por caixa). O sistema converte para a unidade de estoque automaticamente."
                      />
                      <Input
                        type="number"
                        min="0"
                        step="any"
                        placeholder="0,00"
                        value={compraPrecoCompra}
                        onChange={(e) => setCompraPrecoCompra(e.target.value)}
                        className="h-10"
                      />
                    </div>

                    <div>
                      <FieldLabel
                        label="Fator de conversão"
                        help="Quantas unidades de estoque há em uma unidade de compra. Herdado do vínculo ou do item."
                      />
                      <div className="h-10 flex items-center px-3 rounded-lg bg-muted/30 border border-border text-sm text-foreground">
                        {fatorConversaoEfetivo}{" "}
                        <span className="text-muted-foreground ml-1">
                          {unidadeEstoque} / {unidadeCompraEfetiva || "un. compra"}
                        </span>
                      </div>
                    </div>

                    <div>
                      <FieldLabel
                        label={`Custo por ${unidadeEstoque} (calculado)`}
                        help="Preço de compra dividido pelo fator de conversão. Este é o valor que vai para o custo médio do estoque."
                      />
                      <div className="h-10 flex items-center px-3 rounded-lg bg-muted/30 border border-border text-sm font-medium text-foreground">
                        {precoUnitarioEstoque > 0
                          ? precoUnitarioEstoque.toLocaleString("pt-BR", {
                              style: "currency",
                              currency: "BRL",
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 6,
                            })
                          : "—"}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            <div className="flex items-end lg:col-span-6">
              <Button
                type="submit"
                disabled={createMovement.isPending}
                className="w-full h-10 sm:w-auto sm:min-w-[160px]"
              >
                {createMovement.isPending ? "Registrando..." : "Registrar"}
              </Button>
            </div>
          </div>
        </form>
      </SectionCard>

      {/* Histórico */}
      <SectionCard
        title="Histórico de Movimentações"
        description={`${filteredMovements.length} movimentações`}
        noPadding
      >
        <div className="p-5 space-y-4">
          <FilterBar>
            <FilterSelect
              value={filterItem}
              onChange={setFilterItem}
              placeholder="Todos os itens"
              options={(items || []).map((i) => ({ value: i.id, label: i.nome }))}
            />
            <FilterSelect
              value={filterType}
              onChange={setFilterType}
              placeholder="Todos os tipos"
              options={MOVEMENT_TYPES.map((t) => ({ value: t.value, label: t.label }))}
            />
            <FilterSelect value={filterSector} onChange={setFilterSector} placeholder="Todos os setores" options={sectorOptions} />
            <FilterSelect value={filterPerson} onChange={setFilterPerson} placeholder="Todas as pessoas" options={personOptions} />
          </FilterBar>

          {isLoading ? (
            <LoadingSkeleton rows={3} />
          ) : (
            <DataTable<MovementRow>
              columns={movementColumns}
              rows={filteredMovements as MovementRow[]}
              rowKey={(m) => m.id}
              empty={
                <EmptyState
                  icon={ArrowRightLeft}
                  title="Nenhuma movimentação registrada"
                  description="Registre a primeira movimentação no formulário acima."
                />
              }
            />
          )}
        </div>
      </SectionCard>

      {canManageItems && <CreateItemDialog open={createItemOpen} onOpenChange={setCreateItemOpen} />}
      {canManageItems && <ImportItemsDialog open={importItemsOpen} onOpenChange={setImportItemsOpen} />}
      {canManageItems && <EditItemDialog
        item={editingItem}
        open={!!editingItem}
        onOpenChange={(open) => { if (!open) setEditingItem(null); }}
      />}
      </>)}
    </div>
  );
}
