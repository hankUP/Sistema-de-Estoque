import { useState, useMemo, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useStock } from "@/hooks/useStock";
import { type Item } from "@/hooks/useItems";
import { useCurvaABC, abcToneClasses } from "@/hooks/useCurvaABC";
import { EditItemDialog } from "@/components/EditItemDialog";
import { DeleteItemDialog } from "@/components/DeleteItemDialog";
import { LoadingSkeleton, EmptyState } from "@/components/LoadingAndEmpty";
import { PageHeader } from "@/components/PageHeader";
import { FilterBar, FilterSelect, FilterToggleGroup } from "@/components/FilterBar";
import { StatusBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent } from "@/components/ui/collapsible";
import {
  Pencil,
  Package,
  ChevronRight,
  ArrowRightLeft,
  ShoppingCart,
  Rows3,
  LayoutGrid,
  Trash2,
  ArrowUp,
  ArrowDown,
  ArrowUpDown,
} from "lucide-react";
import { formatQuantity } from "@/lib/quantity";
import { useAuth } from '@/auth';

type QuickFilter = "all" | "criticos" | "com_consumo" | "sem_movimento";
type ViewMode = "compact" | "detailed";
type AtivoFiltro = "ativos" | "inativos" | "todos";
type SortKey = "prioridade" | "nome" | "tipo" | "disponivel" | "fisico" | "consumo" | "em_compra" | "status" | "estoque_minimo";
type SortDirection = "asc" | "desc";

const sortOptions: { value: SortKey; label: string }[] = [
  { value: "prioridade", label: "Prioridade" },
  { value: "nome", label: "Nome" },
  { value: "tipo", label: "Tipo" },
  { value: "disponivel", label: "Disponível" },
  { value: "fisico", label: "Estoque físico" },
  { value: "consumo", label: "Consumo mensal" },
  { value: "em_compra", label: "Em compra" },
  { value: "status", label: "Status" },
  { value: "estoque_minimo", label: "Estoque mínimo" },
];

const statusOrder = { CRITICO: 0, BAIXO: 1, OK: 2 } as const;
const tipoLabel = { MP: "Matéria-prima", SUB: "Submontagem", PF: "Produto final" } as const;
const nameCollator = new Intl.Collator("pt-BR", { sensitivity: "base", numeric: true });

export default function StockPage() {
  const user = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [ativoFiltro, setAtivoFiltro] = useState<AtivoFiltro>("ativos");
  const { data: stock, isLoading } = useStock(30, ativoFiltro);
  const { data: abc } = useCurvaABC();
  const [search, setSearch] = useState("");
  const [tipoFilter, setTipoFilter] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [quickFilter, setQuickFilter] = useState<QuickFilter>("all");
  const [editingItem, setEditingItem] = useState<Item | null>(null);
  const [deletingItemId, setDeletingItemId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("compact");
  const [sortKey, setSortKey] = useState<SortKey>("prioridade");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const itemId = searchParams.get("item");
    if (!itemId || !stock) return;

    const match = stock.find((entry) => entry.item.id === itemId);
    if (match && (user.role === "ADMIN" || user.role === "COORDENADOR")) {
      setEditingItem(match.item);
    }

    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete("item");
    setSearchParams(nextParams, { replace: true });
  }, [searchParams, setSearchParams, stock, user.role]);

  const stockWithBase = useMemo(() => stock ?? [], [stock]);

  const filtered = useMemo(() => {
    if (!stockWithBase) return [];
    const list = stockWithBase.filter((s) => {
      const matchesSearch = s.item.nome.toLowerCase().includes(search.toLowerCase());
      const matchesTipo = !tipoFilter || s.item.tipo === tipoFilter;
      const matchesStatus = !statusFilter || s.status === statusFilter;
      const matchesQuick =
        quickFilter === "all" ||
        (quickFilter === "criticos" && s.status === "CRITICO") ||
        (quickFilter === "com_consumo" && s.consumoDiario > 0) ||
        (quickFilter === "sem_movimento" && s.consumoDiario === 0);
      return matchesSearch && matchesTipo && matchesStatus && matchesQuick;
    });
    return list.sort((a, b) => {
      let result = 0;
      switch (sortKey) {
        case "nome": result = nameCollator.compare(a.item.nome, b.item.nome); break;
        case "tipo": result = nameCollator.compare(tipoLabel[a.item.tipo], tipoLabel[b.item.tipo]); break;
        case "disponivel": result = a.disponivel - b.disponivel; break;
        case "fisico": result = a.fisico - b.fisico; break;
        case "consumo": result = a.consumoDiario - b.consumoDiario; break;
        case "em_compra": result = a.em_compra - b.em_compra; break;
        case "status": result = statusOrder[a.status] - statusOrder[b.status]; break;
        case "estoque_minimo": result = a.item.estoque_minimo - b.item.estoque_minimo; break;
        case "prioridade":
          result = statusOrder[a.status] - statusOrder[b.status];
          if (result === 0) result = a.disponivel - b.disponivel;
          break;
      }
      return (sortDirection === "asc" ? result : -result) || nameCollator.compare(a.item.nome, b.item.nome);
    });
  }, [stockWithBase, search, tipoFilter, statusFilter, quickFilter, sortKey, sortDirection]);

  // Contadores para filtros rápidos
  const counts = useMemo(() => {
    if (!stockWithBase) return { criticos: 0, comConsumo: 0, semMovimento: 0 };
    return stockWithBase.reduce(
      (acc, s) => {
        if (s.status === "CRITICO") acc.criticos++;
        if (s.consumoDiario > 0) acc.comConsumo++;
        else acc.semMovimento++;
        return acc;
      },
      { criticos: 0, comConsumo: 0, semMovimento: 0 }
    );
  }, [stockWithBase]);

  if (isLoading) return <LoadingSkeleton rows={5} />;

  const toggleExpand = (id: string) => setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));

  const irParaMovimentar = (itemId: string) => navigate(`/movimentacoes?item=${itemId}`);
  const irParaComprar = (itemId: string) => navigate(`/compras?item=${itemId}`);
  const selectSort = (key: SortKey) => {
    if (key === sortKey) setSortDirection((direction) => direction === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDirection("asc"); }
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Posição de Estoque"
        description="Lista compacta com expansão sob demanda. Compare e priorize itens rapidamente."
        actions={
          <div className="inline-flex rounded-md border border-border bg-muted/30 p-0.5">
            <button
              onClick={() => setViewMode("compact")}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                viewMode === "compact"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
              title="Modo compacto (tabela)"
            >
              <Rows3 className="h-3.5 w-3.5" /> Compacto
            </button>
            <button
              onClick={() => setViewMode("detailed")}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                viewMode === "detailed"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
              title="Modo detalhado (cards)"
            >
              <LayoutGrid className="h-3.5 w-3.5" /> Detalhado
            </button>
          </div>
        }
      />

      <FilterBar
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder="Buscar item..."
        actions={
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              Ordenar por
              <FilterSelect
                value={sortKey}
                onChange={(value) => { setSortKey(value as SortKey); setSortDirection("asc"); }}
                options={sortOptions}
              />
            </label>
            <Button
              type="button"
              size="icon"
              variant="outline"
              className="h-9 w-9 shrink-0"
              onClick={() => setSortDirection((direction) => direction === "asc" ? "desc" : "asc")}
              title={sortDirection === "asc" ? "Ordem crescente; clique para decrescente" : "Ordem decrescente; clique para crescente"}
              aria-label={sortDirection === "asc" ? "Alterar para ordem decrescente" : "Alterar para ordem crescente"}
            >
              {sortDirection === "asc" ? <ArrowUp className="h-4 w-4" /> : <ArrowDown className="h-4 w-4" />}
            </Button>
          </div>
        }
        meta={
          stock && stock.length > 0
            ? `${filtered.length} de ${stock.length} itens · Consumo nos últimos 30 dias`
            : null
        }
      >
        <FilterToggleGroup
          value={quickFilter}
          onChange={(v) => setQuickFilter(v ?? "all")}
          options={[
            { value: "all", label: "Todos os itens" },
            { value: "criticos", label: `Apenas críticos (${counts.criticos})` },
            { value: "com_consumo", label: `Com consumo (${counts.comConsumo})` },
            { value: "sem_movimento", label: `Sem movimentação (${counts.semMovimento})` },
          ]}
          variant={(v) =>
            v === "criticos" ? "destructive" : v === "com_consumo" ? "success" : "primary"
          }
        />
        <FilterToggleGroup
          value={tipoFilter as any}
          onChange={(v) => setTipoFilter(v)}
          options={[
            { value: null, label: "Todos os tipos" },
            { value: "MP", label: "Matéria-Prima" },
            { value: "SUB", label: "Submontagem" },
            { value: "PF", label: "Produto Final" },
          ]}
        />
        <FilterToggleGroup
          value={statusFilter as any}
          onChange={(v) => setStatusFilter(v)}
          options={[
            { value: null, label: "Qualquer status" },
            { value: "OK", label: "OK" },
            { value: "BAIXO", label: "Baixo" },
            { value: "CRITICO", label: "Crítico" },
          ]}
          variant={(v) =>
            v === "OK" ? "success" : v === "BAIXO" ? "warning" : v === "CRITICO" ? "destructive" : "primary"
          }
        />
        <FilterToggleGroup
          value={ativoFiltro}
          onChange={(v) => setAtivoFiltro((v as AtivoFiltro) ?? "ativos")}
          options={[
            { value: "ativos", label: "Itens ativos" },
            { value: "inativos", label: "Itens inativos" },
            { value: "todos", label: "Todos (ativos e inativos)" },
          ]}
          variant={(v) => (v === "inativos" ? "warning" : "primary")}
        />
      </FilterBar>

      {filtered.length === 0 ? (
        <EmptyState
          icon={Package}
          title={stock && stock.length > 0 ? "Nenhum item encontrado" : "Nenhum item cadastrado"}
          description={
            stock && stock.length > 0
              ? "Tente ajustar os filtros aplicados."
              : "Vá para a tela de Movimentações para cadastrar itens."
          }
        />
      ) : viewMode === "compact" ? (
        <CompactList
          rows={filtered}
          abc={abc}
          expanded={expanded}
          toggleExpand={toggleExpand}
          sortKey={sortKey}
          sortDirection={sortDirection}
          onSort={selectSort}
          onEdit={setEditingItem}
          onDelete={setDeletingItemId}
          onMovimentar={irParaMovimentar}
          onComprar={irParaComprar}
          canManage={user.role === 'ADMIN' || user.role === 'COORDENADOR'}
          canMove={user.role !== 'OPERACIONAL'}
        />
      ) : (
        <DetailedList
          rows={filtered}
          abc={abc}
          expanded={expanded}
          toggleExpand={toggleExpand}
          onEdit={setEditingItem}
          onDelete={setDeletingItemId}
          onMovimentar={irParaMovimentar}
          onComprar={irParaComprar}
          canManage={user.role === 'ADMIN' || user.role === 'COORDENADOR'}
          canMove={user.role !== 'OPERACIONAL'}
        />
      )}

      {(user.role === 'ADMIN' || user.role === 'COORDENADOR') && <EditItemDialog
        item={editingItem}
        open={!!editingItem}
        onOpenChange={(open) => { if (!open) setEditingItem(null); }}
      />}
      {(user.role === 'ADMIN' || user.role === 'COORDENADOR') && <DeleteItemDialog
        itemId={deletingItemId}
        open={!!deletingItemId}
        onOpenChange={(open) => { if (!open) setDeletingItemId(null); }}
      />}
    </div>
  );
}

// =====================================================================
// MODO COMPACTO — lista tipo tabela com linha expansível
// =====================================================================
function SortHeader({ label, field, active, direction, onSort, align = "left" }: {
  label: string;
  field: SortKey;
  active: SortKey;
  direction: SortDirection;
  onSort: (key: SortKey) => void;
  align?: "left" | "right";
}) {
  const selected = active === field;
  return (
    <div className={align === "right" ? "text-right" : ""}>
      <button
        type="button"
        onClick={() => onSort(field)}
        aria-pressed={selected}
        aria-label={`Ordenar por ${label}${selected ? `, ordem ${direction === "asc" ? "crescente" : "decrescente"}` : ""}`}
        className={`inline-flex items-center gap-1 hover:text-foreground transition-colors ${selected ? "text-foreground" : ""}`}
      >
        {label}
        {selected
          ? direction === "asc" ? <ArrowUp className="h-3 w-3 shrink-0" /> : <ArrowDown className="h-3 w-3 shrink-0" />
          : <ArrowUpDown className="h-3 w-3 shrink-0 opacity-50" />}
      </button>
    </div>
  );
}

function CompactList({
  rows,
  abc,
  expanded,
  toggleExpand,
  sortKey,
  sortDirection,
  onSort,
  onEdit,
  onDelete,
  onMovimentar,
  onComprar,
  canManage,
  canMove,
}: {
  rows: ReturnType<typeof useStock>["data"] extends infer D ? (D extends Array<infer R> ? R[] : never) : never;
  abc: ReturnType<typeof useCurvaABC>["data"];
  expanded: Record<string, boolean>;
  toggleExpand: (id: string) => void;
  sortKey: SortKey;
  sortDirection: SortDirection;
  onSort: (key: SortKey) => void;
  onEdit: (item: Item) => void;
  onDelete: (id: string) => void;
  onMovimentar: (id: string) => void;
  onComprar: (id: string) => void;
  canManage: boolean;
  canMove: boolean;
}) {
  // Grid layout: nome, tipo, disponível, consumo mensal, em compra, status e ações.
  // min-w-0 na primeira coluna permite que o nome quebre/use ellipsis sem empurrar as outras.
  const gridCols =
    "md:grid-cols-[minmax(0,1fr)_64px_88px_115px_88px_96px_176px]";

  return (
    <div className="glass-card overflow-hidden">
      {/* Header desktop */}
      <div className={`hidden md:grid ${gridCols} items-center gap-x-3 px-3 py-2 border-b border-border bg-muted/30 text-[10px] uppercase tracking-wide font-medium text-muted-foreground`}>
        <SortHeader label="Item" field="nome" active={sortKey} direction={sortDirection} onSort={onSort} />
        <SortHeader label="Tipo" field="tipo" active={sortKey} direction={sortDirection} onSort={onSort} />
        <SortHeader label="Disponível" field="disponivel" active={sortKey} direction={sortDirection} onSort={onSort} align="right" />
        <SortHeader label="Consumo/mês" field="consumo" active={sortKey} direction={sortDirection} onSort={onSort} align="right" />
        <SortHeader label="Em compra" field="em_compra" active={sortKey} direction={sortDirection} onSort={onSort} align="right" />
        <SortHeader label="Status" field="status" active={sortKey} direction={sortDirection} onSort={onSort} />
        <div className="text-right">Ações</div>
      </div>

      <div className="divide-y divide-border/40">
        {rows.map((s) => {
          const isOpen = !!expanded[s.item.id];
          const semConsumo = s.consumoDiario === 0;
          const unidade = s.item.unidade;
          const unidadeCompraInfo =
            s.item.unidade_compra && s.item.unidade_compra !== unidade
              ? { fator: Number(s.item.fator_conversao) > 0 ? Number(s.item.fator_conversao) : 1, unidadeEstoque: unidade }
              : undefined;
          const consumoTexto = semConsumo
            ? "—"
            : formatQuantity(s.consumoDiario * 30, unidade, { suffix: '/mês', pluralize: false });
          const dispTexto = formatQuantity(s.disponivel, unidade);
          const emCompraTexto = s.em_compra === 0
            ? formatQuantity(0, unidade)
            : formatQuantity(s.em_compra, s.item.unidade_compra || unidade, { conversao: unidadeCompraInfo });
          const rowBg =
            s.status === "CRITICO"
              ? "bg-destructive/5 hover:bg-destructive/10"
              : s.status === "BAIXO"
              ? "bg-warning/5 hover:bg-warning/10"
              : "hover:bg-accent/30";
          const abcRow = s.item.tipo === "MP" ? abc?.byItem.get(s.item.id) : null;

          return (
            <div key={s.item.id} className={`transition-colors ${rowBg}`}>
              {/* Linha principal */}
              <div
                onClick={() => toggleExpand(s.item.id)}
                className={`w-full text-left px-3 py-2 grid grid-cols-2 ${gridCols} items-center gap-x-3 gap-y-2 cursor-pointer`}
              >
                {/* Item */}
                <button
                  type="button"
                  aria-label={`${isOpen ? "Ocultar" : "Mostrar"} detalhes de ${s.item.nome}`}
                  aria-expanded={isOpen}
                  onClick={(event) => { event.stopPropagation(); toggleExpand(s.item.id); }}
                  className="flex items-start gap-2 min-w-0 col-span-2 md:col-span-1 text-left"
                >
                  <ChevronRight
                    className={`h-3.5 w-3.5 mt-0.5 text-muted-foreground shrink-0 transition-transform ${
                      isOpen ? "rotate-90" : ""
                    }`}
                  />
                  <div className="min-w-0 flex-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span
                      className={`font-medium text-sm break-words leading-snug ${semConsumo ? "text-muted-foreground" : "text-foreground"}`}
                      title={s.item.nome}
                    >
                      {s.item.nome}
                    </span>
                    {!s.item.ativo && (
                      <StatusBadge tone="muted" size="sm" className="shrink-0">
                        Inativo
                      </StatusBadge>
                    )}
                    {abcRow && (
                      <span
                        className={`hidden lg:inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold border ${abcToneClasses(abcRow.classe)}`}
                        title={`Curva ABC (90 dias): classe ${abcRow.classe} · ${abcRow.participacaoPct.toFixed(1)}% do valor de consumo · acumulado ${abcRow.acumuladoPct.toFixed(1)}%`}
                      >
                        ABC: {abcRow.classe}
                      </span>
                    )}
                  </div>
                </button>

                {/* Tipo */}
                <div className="hidden md:flex items-center">
                  <StatusBadge tone="default" size="sm">{s.item.tipo}</StatusBadge>
                </div>

                {/* Disponível */}
                <div
                  className={`hidden md:block text-right text-sm font-semibold tabular-nums ${s.disponivel < 0 ? "text-destructive" : s.disponivel === 0 ? "text-warning" : "text-foreground"}`}
                  title={s.disponivel < 0 ? "Estoque negativo — ajuste necessário" : undefined}
                >
                  {dispTexto}
                </div>

                {/* Consumo/mês */}
                <div className={`hidden md:block text-right text-sm tabular-nums ${semConsumo ? "text-muted-foreground/60" : "text-foreground"}`}>
                  {consumoTexto}
                </div>

                {/* Em compra */}
                <div className={`hidden md:block text-right text-sm tabular-nums ${s.em_compra === 0 ? "text-muted-foreground/60" : "text-foreground"}`}>
                  {emCompraTexto}
                </div>

                {/* Status */}
                <div className="hidden md:flex items-center">
                  <StatusBadge
                    tone={s.status === "OK" ? "success" : s.status === "BAIXO" ? "warning" : "destructive"}
                    size="sm"
                  >
                    {s.status === "OK" ? "OK" : s.status === "BAIXO" ? "Baixo" : "Crítico"}
                  </StatusBadge>
                </div>

                {/* Ações desktop */}
                <div className="hidden md:flex items-center justify-end gap-0.5" onClick={(e) => e.stopPropagation()}>
                  {canMove && <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7"
                    title="Movimentar"
                    onClick={() => onMovimentar(s.item.id)}
                  >
                    <ArrowRightLeft className="h-3.5 w-3.5" />
                  </Button>}
                  {canManage && s.item.compra_direta && (
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7"
                      title="Comprar"
                      onClick={() => onComprar(s.item.id)}
                    >
                      <ShoppingCart className="h-3.5 w-3.5" />
                    </Button>
                  )}
                  {canManage && <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7"
                    title="Editar item"
                    onClick={() => onEdit(s.item)}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>}
                  {canManage && s.item.ativo && (
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7 text-destructive hover:text-destructive"
                      title="Excluir ou desativar item"
                      aria-label={`Excluir ou desativar ${s.item.nome}`}
                      onClick={() => onDelete(s.item.id)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>

                {/* Resumo mobile */}
                <div className="md:hidden col-span-2 grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs pl-5">
                  <MobileMini label="Tipo" value={s.item.tipo} />
                  <MobileMini
                    label="Disponível"
                    value={dispTexto}
                    tone={s.disponivel < 0 ? "destructive" : undefined}
                  />
                  <MobileMini label="Consumo/mês" value={consumoTexto} />
                  <div className="col-span-2 flex justify-end">
                    <StatusBadge
                      tone={s.status === "OK" ? "success" : s.status === "BAIXO" ? "warning" : "destructive"}
                      size="sm"
                    >
                      {s.status === "OK" ? "OK" : s.status === "BAIXO" ? "Baixo" : "Crítico"}
                    </StatusBadge>
                  </div>
                </div>
              </div>

              {/* Detalhes expansíveis */}
              <Collapsible open={isOpen}>
                <CollapsibleContent>
                  <div className="px-3 pb-3 pt-1 md:pl-9">
                    <div className="rounded-md border border-border/50 bg-background/40 p-3 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-4 gap-y-2">
                      <Metric label="Estoque físico" value={formatQuantity(s.fisico, s.item.unidade)} negative={s.fisico < 0} />
                      <Metric label="Reservado" value={formatQuantity(s.reservado, s.item.unidade)} />
                      <Metric label="Projetado" value={formatQuantity(s.projetado, s.item.unidade)} />
                      <Metric label="Estoque mínimo" value={formatQuantity(s.item.estoque_minimo, s.item.unidade)} />
                      <Metric label="Ponto de pedido" value={formatQuantity(Math.round(s.pontoPedido * 100) / 100, s.item.unidade)} />
                      <Metric
                        label="Lead time"
                        value={s.item.lead_time_dias ? `${s.item.lead_time_dias} dias` : "—"}
                      />
                    </div>

                    {/* Ações mobile dentro da expansão */}
                    <div className="md:hidden mt-3 flex flex-wrap gap-2">
                      {canMove && <Button size="sm" variant="outline" onClick={() => onMovimentar(s.item.id)}>
                        <ArrowRightLeft className="h-3.5 w-3.5" /> Movimentar
                      </Button>}
                      {canManage && s.item.compra_direta && (
                        <Button size="sm" variant="outline" onClick={() => onComprar(s.item.id)}>
                          <ShoppingCart className="h-3.5 w-3.5" /> Comprar
                        </Button>
                      )}
                      {canManage && <Button size="sm" variant="outline" onClick={() => onEdit(s.item)}>
                        <Pencil className="h-3.5 w-3.5" /> Editar
                      </Button>}
                      {canManage && s.item.ativo && (
                        <Button size="sm" variant="outline" className="text-destructive" onClick={() => onDelete(s.item.id)}>
                          <Trash2 className="h-3.5 w-3.5" /> Excluir ou desativar
                        </Button>
                      )}
                    </div>
                  </div>
                </CollapsibleContent>
              </Collapsible>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// =====================================================================
// MODO DETALHADO — cards (visualização anterior, mais espaçada)
// =====================================================================
function DetailedList({
  rows,
  abc,
  expanded,
  toggleExpand,
  onEdit,
  onDelete,
  onMovimentar,
  onComprar,
  canManage,
  canMove,
}: {
  rows: ReturnType<typeof useStock>["data"] extends infer D ? (D extends Array<infer R> ? R[] : never) : never;
  abc: ReturnType<typeof useCurvaABC>["data"];
  expanded: Record<string, boolean>;
  toggleExpand: (id: string) => void;
  onEdit: (item: Item) => void;
  onDelete: (id: string) => void;
  onMovimentar: (id: string) => void;
  onComprar: (id: string) => void;
  canManage: boolean;
  canMove: boolean;
}) {
  return (
    <div className="space-y-2">
      {rows.map((s) => {
        const isOpen = !!expanded[s.item.id];
        const semConsumo = s.consumoDiario === 0;
        return (
          <div
            key={s.item.id}
            className={`glass-card px-4 py-3 transition-colors ${
              s.status === "CRITICO"
                ? "bg-destructive/5"
                : s.status === "BAIXO"
                ? "bg-warning/5"
                : "hover:bg-accent/20"
            }`}
          >
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-2 min-w-0">
                <span className={`font-medium text-sm truncate ${semConsumo ? "text-muted-foreground" : "text-foreground"}`}>
                  {s.item.nome}
                </span>
                {!s.item.ativo && (
                  <StatusBadge tone="muted" size="sm" className="shrink-0">Inativo</StatusBadge>
                )}
                <StatusBadge tone="default" size="sm">{s.item.tipo}</StatusBadge>
                {s.item.tipo === "MP" && abc?.byItem.get(s.item.id) && (() => {
                  const row = abc.byItem.get(s.item.id)!;
                  return (
                    <span
                      className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold border ${abcToneClasses(row.classe)}`}
                      title={`Curva ABC (90 dias): classe ${row.classe} · ${row.participacaoPct.toFixed(1)}% do valor de consumo · acumulado ${row.acumuladoPct.toFixed(1)}%`}
                    >
                      ABC: {row.classe}
                    </span>
                  );
                })()}
              </div>
              <div className="flex items-center gap-2">
                {canMove && <Button size="icon" variant="ghost" className="h-7 w-7" title="Movimentar" onClick={() => onMovimentar(s.item.id)}>
                  <ArrowRightLeft className="h-3.5 w-3.5" />
                </Button>}
                {canManage && s.item.compra_direta && (
                  <Button size="icon" variant="ghost" className="h-7 w-7" title="Comprar" onClick={() => onComprar(s.item.id)}>
                    <ShoppingCart className="h-3.5 w-3.5" />
                  </Button>
                )}
                {canManage && <Button size="icon" variant="ghost" className="h-7 w-7" title="Editar item" onClick={() => onEdit(s.item)}>
                  <Pencil className="h-3.5 w-3.5" />
                </Button>}
                {canManage && s.item.ativo && (
                  <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive hover:text-destructive" title="Excluir ou desativar item" aria-label={`Excluir ou desativar ${s.item.nome}`} onClick={() => onDelete(s.item.id)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                )}
                <StatusBadge
                  tone={s.status === "OK" ? "success" : s.status === "BAIXO" ? "warning" : "destructive"}
                >
                  {s.status === "OK" ? "OK" : s.status === "BAIXO" ? "Estoque Baixo" : "Estoque Crítico"}
                </StatusBadge>
              </div>
            </div>

            <div className="mt-2 grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1.5">
              <Metric label="Disponível" value={formatQuantity(s.disponivel, s.item.unidade)} negative={s.disponivel <= 0} highlight />
              <Metric
                label="Consumo por mês"
                value={semConsumo ? "—" : formatQuantity(s.consumoDiario * 30, s.item.unidade, { suffix: '/mês', pluralize: false })}
                muted={semConsumo}
              />
              <Metric label="Em compra" value={formatQuantity(s.em_compra, s.item.unidade)} muted={s.em_compra === 0} />
            </div>

            <Collapsible open={isOpen} onOpenChange={() => toggleExpand(s.item.id)}>
              <button
                type="button"
                onClick={() => toggleExpand(s.item.id)}
                className="mt-2 text-[11px] text-muted-foreground hover:text-foreground inline-flex items-center gap-1 transition-colors"
              >
                <ChevronRight className={`h-3 w-3 transition-transform ${isOpen ? "rotate-90" : ""}`} />
                {isOpen ? "Ocultar detalhes" : "Ver detalhes"}
              </button>
              <CollapsibleContent className="pt-2">
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-x-4 gap-y-1.5 pt-2 border-t border-border/40">
                  <Metric label="Estoque físico" value={formatQuantity(s.fisico, s.item.unidade)} negative={s.fisico < 0} />
                  <Metric label="Reservado" value={formatQuantity(s.reservado, s.item.unidade)} />
                  <Metric label="Projetado" value={formatQuantity(s.projetado, s.item.unidade)} />
                  <Metric label="Estoque mínimo" value={formatQuantity(s.item.estoque_minimo, s.item.unidade)} />
                  <Metric label="Ponto de pedido" value={formatQuantity(Math.round(s.pontoPedido * 100) / 100, s.item.unidade)} />
                  <Metric label="Lead time" value={s.item.lead_time_dias ? `${s.item.lead_time_dias} dias` : "—"} />
                </div>
              </CollapsibleContent>
            </Collapsible>
          </div>
        );
      })}
    </div>
  );
}

function MobileMini({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "destructive";
}) {
  return (
    <div className="flex flex-col min-w-0">
      <span className="text-[9px] uppercase tracking-wide text-muted-foreground truncate">{label}</span>
      <span className={`text-xs font-medium ${tone === "destructive" ? "text-destructive" : "text-foreground"}`}>
        {value}
      </span>
    </div>
  );
}

function Metric({
  label,
  value,
  negative,
  highlight,
  muted,
}: {
  label: string;
  value: number | string;
  negative?: boolean;
  highlight?: boolean;
  muted?: boolean;
}) {
  return (
    <div className="flex flex-col min-w-0">
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</span>
      <span
        className={`tabular-nums break-words ${highlight ? "text-base font-semibold" : "text-sm font-medium"} ${
          negative ? "text-destructive" : muted ? "text-muted-foreground" : "text-foreground"
        }`}
      >
        {value}
      </span>
    </div>
  );
}
