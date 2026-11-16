import { useState, useMemo, useEffect } from "react";
import { Link } from 'react-router-dom';
import { useProductionOrders } from "@/hooks/useProductionOrders";
import { useAllProductionOrderItemsMap } from "@/hooks/useProductionOrderItems";
import { useItems } from "@/hooks/useItems";
import { useStock } from "@/hooks/useStock";
import { useKitPlans, type KitPlan } from '@/hooks/useKitPlans';
import { useWorkQueueAvailability, useRefreshWorkQueue, type WorkQueueRow } from '@/hooks/useWorkQueueAvailability';
import { db } from "@/db/client";
import { getOrderDisplayName, type SubProductLite } from "@/lib/orderDisplay";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { toast } from "sonner";
import { GripVertical, Trash2, Package, AlertTriangle, CheckCircle2, ChevronDown, Clock, ChevronUp, ChevronsUp } from "lucide-react";
import { formatDurationCompact } from "@/hooks/useProductionStages";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { formatQuantity } from "@/lib/quantity";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useAuth } from '@/auth';

type ImpactoComponente = {
  itemId: string;
  nome: string;
  unidade: string;
  necessario: number;
  disponivelAntes: number;
  disponivelAposEsteAcumulado: number;
  faltando: number;
};

type OrderRow = {
  id: string;
  item_id: string;
  quantidade: number;
  status: string;
  destino: string;
  cliente: string | null;
  ordem: number;
  posicao: number;
  /** created_at da OP — usado como entrada na fila para cálculo de tempo de espera. */
  created_at: string;
  items?: { nome: string; unidade?: string };
  impactos: ImpactoComponente[];
  faltaInsumo: boolean;
  totalFaltando: number;
  /** Sub-produtos da OP (>=1). Usado para composições. */
  subProducts: SubProductLite[];
  /** Nome de exibição (conjunto ou simples). */
  displayName: string;
  /** True quando a OP tem mais de um sub-produto. */
  composta: boolean;
};

/**
 * Renderiza o conteúdo expandido com o impacto da OP nos componentes.
 * Reusado tanto na linha da tabela (desktop) quanto no card (mobile).
 */
function ImpactDetails({ order }: { order: OrderRow }) {
  return (
    <div>
      <div className="text-[11px] text-muted-foreground mb-2">
        Materiais desta ordem após kits e ordens anteriores na fila:
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {order.impactos.map((imp) => (
          <div
            key={imp.itemId}
            className={`px-3 py-2 rounded-md text-xs border ${
              imp.faltando > 0
                ? "bg-destructive/10 border-destructive/30"
                : "bg-card border-border/50"
            }`}
          >
            <div className="font-medium text-foreground break-words">{imp.nome}</div>
            <div className="text-muted-foreground mt-0.5">
              Usará: <span className="text-foreground font-medium">{formatQuantity(imp.necessario, imp.unidade)}</span>
              {" · "}Disponível antes: <span className="text-foreground font-medium">{formatQuantity(Math.max(0, imp.disponivelAntes), imp.unidade)}</span>
              {" · "}Restará: <span className={imp.faltando > 0 ? "text-destructive font-bold" : "text-foreground font-medium"}>
                {formatQuantity(imp.disponivelAposEsteAcumulado >= 0 ? imp.disponivelAposEsteAcumulado : 0, imp.unidade)}
              </span>
            </div>
            {imp.faltando > 0 && (
              <div className="text-destructive font-semibold mt-0.5">Faltam {formatQuantity(imp.faltando, imp.unidade)}</div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Badge de status combinado (insumo + fila/produção). Empilhado verticalmente. */
function StatusStack({
  order,
  expanded,
  onToggleExpand,
}: {
  order: OrderRow;
  expanded: boolean;
  onToggleExpand: () => void;
}) {
  return (
    <div className="flex flex-col items-start gap-1">
      {order.impactos.length === 0 ? (
        <span className="text-[11px] text-muted-foreground">Sem BOM</span>
      ) : order.faltaInsumo ? (
        <button
          onClick={onToggleExpand}
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-destructive/15 text-destructive hover:bg-destructive/25 transition-colors"
          title="Falta insumo para este pedido. Clique para ver detalhes."
        >
          <AlertTriangle className="h-3 w-3" /> Falta insumo
          <ChevronDown className={`h-3 w-3 transition-transform ${expanded ? "rotate-180" : ""}`} />
        </button>
      ) : (
        <button
          onClick={onToggleExpand}
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium bg-success/15 text-success hover:bg-success/25 transition-colors"
          title="Insumos suficientes para este pedido. Clique para ver detalhes."
        >
          <CheckCircle2 className="h-3 w-3" /> OK
          <ChevronDown className={`h-3 w-3 transition-transform ${expanded ? "rotate-180" : ""}`} />
        </button>
      )}
      <span className={`inline-block px-2 py-0.5 rounded text-[11px] font-medium ${
        order.status === "EM_PRODUCAO" ? "bg-warning/15 text-warning" :
        "bg-muted text-muted-foreground"
      }`}>{order.status === "PLANEJADA" ? "Na fila" : "Produzindo"}</span>
    </div>
  );
}

/** Bloco de produto reutilizado em desktop e celular. */
function ProductCell({ order }: { order: OrderRow }) {
  const titleText = order.displayName;
  const nameNode = order.impactos.length === 0 ? (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="block line-clamp-2 break-words leading-snug text-md font-semibold text-foreground">
          {titleText}
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-xs">
        {titleText}
      </TooltipContent>
    </Tooltip>
  ) : (
    <HoverCard openDelay={150} closeDelay={50}>
      <HoverCardTrigger asChild>
        <span
          className="block line-clamp-2 break-words leading-snug text-md font-semibold text-foreground cursor-help underline decoration-dotted decoration-muted-foreground/40 underline-offset-4"
          title={titleText}
        >
          {titleText}
        </span>
      </HoverCardTrigger>
      <HoverCardContent side="right" align="start" className="w-80">
        <div className="text-xs font-semibold text-foreground mb-1">
          Consumo deste pedido
        </div>
        <div className="text-[11px] text-muted-foreground mb-2 break-words">
          {order.composta
            ? "Conjunto com múltiplos produtos — componentes necessários:"
            : `${order.quantidade} × ${titleText} — componentes necessários:`}
        </div>
        <div className="space-y-1.5 max-h-64 overflow-y-auto">
          {order.impactos.map((imp) => (
            <div
              key={imp.itemId}
              className="flex items-center justify-between gap-2 text-xs border-b border-border/40 pb-1 last:border-b-0 last:pb-0"
            >
              <span className="text-foreground line-clamp-2 break-words leading-snug min-w-0" title={imp.nome}>{imp.nome}</span>
              <span className={imp.faltando > 0 ? "text-destructive font-semibold shrink-0" : "text-muted-foreground shrink-0"}>
                {formatQuantity(imp.necessario, imp.unidade)}
                {imp.faltando > 0 && <span className="ml-1">(faltam {formatQuantity(imp.faltando, imp.unidade)})</span>}
              </span>
            </div>
          ))}
        </div>
      </HoverCardContent>
    </HoverCard>
  );

  return (
    <div className="min-w-0">
      <span className="text-[10px] font-medium uppercase tracking-wide text-primary">Ordem com BOM</span>
      {nameNode}
      {order.composta && (
        <div className="mt-1 flex flex-wrap gap-1">
          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-primary/15 text-primary">
            Conjunto · {order.subProducts.length} produtos
          </span>
          {order.subProducts.map((sp, i) => (
            <span key={i} className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] bg-muted text-muted-foreground">
              {sp.quantidade}× {sp.item?.nome || sp.nome_snapshot || "—"}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/** Bloco compacto Destino + Cliente. */
function DestinoClienteCell({ order }: { order: OrderRow }) {
  return (
    <div className="flex flex-col gap-0.5 min-w-0">
      <span className={`inline-block self-start px-2 py-0.5 rounded text-[10px] font-medium ${
        order.destino === "ESTOQUE" ? "bg-primary/15 text-primary" : "bg-accent text-accent-foreground"
      }`}>
        {order.destino === "ESTOQUE" ? "Estoque" : "Cliente"}
      </span>
      {order.destino === "CLIENTE" && (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="text-xs text-foreground line-clamp-1 break-all" title={order.cliente || ""}>
              {order.cliente || <span className="text-muted-foreground">sem cliente</span>}
            </span>
          </TooltipTrigger>
          {order.cliente && (
            <TooltipContent side="top" className="max-w-xs">{order.cliente}</TooltipContent>
          )}
        </Tooltip>
      )}
    </div>
  );
}

/** Botões de ação (subir/topo/excluir) — usados na linha da tabela e no card. */
function ActionButtons({
  order,
  index,
  onMoveUp,
  onMoveTop,
  onRemove,
}: {
  order: OrderRow;
  index: number;
  onMoveUp: () => void;
  onMoveTop: () => void;
  onRemove: (id: string) => void;
}) {
  const podeSubir = order.status === "PLANEJADA" && index > 0;
  return (
    <div className="inline-flex items-center gap-0.5">
      {podeSubir && (
        <>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-muted-foreground hover:text-foreground"
                onClick={onMoveTop}
              >
                <ChevronsUp className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">Mover para o topo da fila</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-muted-foreground hover:text-foreground"
                onClick={onMoveUp}
              >
                <ChevronUp className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">Subir uma posição</TooltipContent>
          </Tooltip>
        </>
      )}
      {order.status === "PLANEJADA" && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => onRemove(order.id)}>
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top">Remover da fila</TooltipContent>
        </Tooltip>
      )}
    </div>
  );
}

/**
 * Card horizontal de uma OP na fila.
 * Layout em 4 blocos (esquerda → direita):
 *   1. Grip + posição
 *   2. Produto + destino/cliente (maior destaque)
 *   3. Quantidade + tempo na fila
 *   4. Status + ações
 *
 * Em telas pequenas o conteúdo se reorganiza naturalmente em coluna.
 */
function SortableQueueCard({
  order,
  onRemove,
  expanded,
  onToggleExpand,
  nowMs,
  index,
  onMoveUp,
  onMoveTop,
  canManageQueue,
}: {
  order: OrderRow;
  onRemove: (id: string) => void;
  expanded: boolean;
  onToggleExpand: () => void;
  nowMs: number;
  index: number;
  onMoveUp: () => void;
  onMoveTop: () => void;
  canManageQueue: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: order.id, disabled: !canManageQueue });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
  };

  const queueCreatedMs = order.created_at ? new Date(order.created_at).getTime() : null;
  const tempoFilaSeg = queueCreatedMs != null
    ? Math.max(0, Math.round((nowMs - queueCreatedMs) / 1000))
    : null;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`group rounded-lg border transition-colors ${
        order.faltaInsumo
          ? "border-destructive/30 bg-destructive/5 hover:bg-destructive/10"
          : "border-border/60 bg-card hover:bg-accent/40"
      }`}
    >
      {/* Linha principal — flex horizontal no desktop, empilha no mobile */}
      <div className="flex flex-col sm:flex-row sm:items-stretch">
        {/* BLOCO 1 — grip + posição */}
        <div className="flex sm:flex-col items-center justify-between sm:justify-center gap-1 px-3 py-2 sm:py-3 sm:w-12 border-b sm:border-b-0 sm:border-r border-border/40 bg-muted/20 rounded-t-lg sm:rounded-l-lg sm:rounded-tr-none">
          {canManageQueue && <button
            {...attributes}
            {...listeners}
            className="cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground"
            title="Arrastar para reordenar"
          >
            <GripVertical className="h-4 w-4" />
          </button>}
          <span className="text-xs font-semibold text-muted-foreground tabular-nums">#{order.posicao}</span>
        </div>

        {/* BLOCO 2 — produto + destino/cliente (maior destaque, ocupa espaço flex) */}
        <div className="flex-1 min-w-0 px-3 py-3 sm:border-r border-border/40">
          <ProductCell order={order} />
          <div className="mt-1.5">
            <DestinoClienteCell order={order} />
          </div>
        </div>

        {/* BLOCO 3 — quantidade + tempo */}
        <div className="flex sm:flex-col items-center sm:items-start justify-around sm:justify-center gap-3 sm:gap-2 px-3 py-2 sm:py-3 sm:w-[140px] border-t sm:border-t-0 sm:border-r border-border/40 bg-muted/10">
          <div className="flex flex-col items-center sm:items-start">
            <span className="text-meta uppercase tracking-wide">Qtd</span>
            {order.composta ? (
              <span className="text-sm font-semibold text-foreground leading-tight">
                {order.subProducts.reduce((s, sp) => s + Number(sp.quantidade), 0)} un
              </span>
            ) : (
              <span className="text-md font-semibold text-foreground tabular-nums leading-tight">
                {formatQuantity(order.quantidade, (order as any).items?.unidade || "")}
              </span>
            )}
          </div>
          {tempoFilaSeg != null && (
            <div className="flex flex-col items-center sm:items-start">
              <span className="text-meta uppercase tracking-wide flex items-center gap-1">
                <Clock className="h-3 w-3" /> Na fila
              </span>
              <span className="text-sm font-medium text-foreground tabular-nums leading-tight">
                {formatDurationCompact(tempoFilaSeg)}
              </span>
            </div>
          )}
        </div>

        {/* BLOCO 4 — status + ações */}
        <div className="flex sm:flex-col items-center sm:items-end justify-between gap-2 px-3 py-3 sm:w-[180px] border-t sm:border-t-0 border-border/40">
          <StatusStack order={order} expanded={expanded} onToggleExpand={onToggleExpand} />
          {canManageQueue && <ActionButtons order={order} index={index} onMoveUp={onMoveUp} onMoveTop={onMoveTop} onRemove={onRemove} />}
        </div>
      </div>

      {/* Detalhes expandidos (impacto nos componentes) */}
      {expanded && order.impactos.length > 0 && (
        <div className="border-t border-border/40 px-3 py-3 bg-muted/15 rounded-b-lg">
          <ImpactDetails order={order} />
        </div>
      )}
    </div>
  );
}

function SortableKitCard({ plan, row, index, onMoveUp, onMoveTop, canManageQueue }: {
  plan: KitPlan; row: WorkQueueRow; index: number; onMoveUp: () => void; onMoveTop: () => void; canManageQueue: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: row.id, disabled: !canManageQueue });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.6 : 1 };
  const missing = row.materials.filter(material => material.missing > 0);
  return <div ref={setNodeRef} style={style} className={`rounded-lg border p-3 space-y-3 ${missing.length ? 'border-destructive/30 bg-destructive/5' : 'border-border/60 bg-card'}`}>
    <div className="flex flex-wrap items-start gap-3">
      {canManageQueue && <button {...attributes} {...listeners} className="cursor-grab active:cursor-grabbing text-muted-foreground mt-1" title="Arrastar para reordenar"><GripVertical className="h-4 w-4" /></button>}
      <span className="text-sm font-semibold text-primary">#{row.position}</span>
      <div className="flex-1 min-w-0"><strong className="text-sm">{plan.nome}</strong><p className="text-xs text-muted-foreground">Kit anterior · {plan.destino} · {plan.status === 'EM_PRODUCAO' ? 'Em produção' : 'Na fila'}</p></div>
      <span className={`text-xs font-medium ${missing.length ? 'text-destructive' : 'text-success'}`}>{missing.length ? `${missing.length} material(is) em falta` : 'Materiais disponíveis'}</span>
      {canManageQueue && index > 0 && <div className="flex gap-1"><Button size="sm" variant="ghost" onClick={onMoveUp} title="Subir uma posição"><ChevronUp className="h-4 w-4" /></Button><Button size="sm" variant="ghost" onClick={onMoveTop} title="Mover para o topo"><ChevronsUp className="h-4 w-4" /></Button></div>}
    </div>
    <details className="text-xs"><summary className="cursor-pointer text-primary">Ver materiais ({row.materials.length})</summary>
      <div className="overflow-x-auto mt-2"><table className="w-full min-w-[560px] text-xs"><thead className="text-muted-foreground border-b border-border"><tr><th className="text-left py-1">Material</th><th className="text-right">Usará</th><th className="text-right">Disponível antes</th><th className="text-right">Restará</th><th className="text-right">Falta</th></tr></thead><tbody>
        {row.materials.map(material => <tr key={material.itemId} className={material.missing ? 'text-destructive border-b border-border/50' : 'border-b border-border/50'}><td className="py-1.5 pr-2">{material.nome}</td><td className="text-right whitespace-nowrap">{formatQuantity(material.needed, material.unidade)}</td><td className="text-right whitespace-nowrap">{formatQuantity(Math.max(0, material.availableBefore), material.unidade)}</td><td className="text-right whitespace-nowrap">{formatQuantity(Math.max(0, material.balanceAfter), material.unidade)}</td><td className="text-right font-semibold whitespace-nowrap">{material.missing ? formatQuantity(material.missing, material.unidade) : '—'}</td></tr>)}
      </tbody></table></div>
    </details>
    <div className="flex gap-2"><Button size="sm" variant="outline" asChild><Link to="/producao">Abrir produção</Link></Button></div>
  </div>;
}

export default function PedidosPage() {
  const user = useAuth();
  const canManageQueue = user.role === 'ADMIN' || user.role === 'COORDENADOR';
  const { data: allOrders, isLoading } = useProductionOrders();
  const { data: plans = [] } = useKitPlans();
  const { data: work = [], isLoading: workLoading } = useWorkQueueAvailability();
  const refreshWorkQueue = useRefreshWorkQueue();
  const { data: items } = useItems();
  const { data: stock } = useStock();
  const queryClient = useQueryClient();
  const { map: subProductsByOp } = useAllProductionOrderItemsMap();

  const [expandedRows, setExpandedRows] = useState<Record<string, boolean>>({});

  // Tick a cada 60s para atualizar contadores de "tempo na fila" sem refetch.
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  // Fila ativa, ordenada por "ordem", já com impacto incremental por pedido
  const queue = useMemo<OrderRow[]>(() => {
    if (!allOrders) return [];
    const ativos = allOrders
      .filter(o => o.status === "PLANEJADA" || o.status === "EM_PRODUCAO")
      .sort((a, b) => a.ordem - b.ordem);

    const itemsById = new Map((items || []).map((i) => [i.id, i] as const));

    return ativos.map((o, idx) => {
      const subs = subProductsByOp.get(o.id) || [];
      const subProducts: SubProductLite[] = subs.length > 0
        ? subs.map((s) => ({
            item_id: s.item_id,
            quantidade: Number(s.quantidade),
            nome_snapshot: s.nome_snapshot,
            item: s.item ? { nome: s.item.nome } : { nome: itemsById.get(s.item_id)?.nome || null },
          }))
        : [{
            item_id: o.item_id,
            quantidade: Number(o.quantidade),
            item: { nome: (o as any).items?.nome || itemsById.get(o.item_id)?.nome || null },
          }];

      const workRow = work.find(row => row.kind === 'OP' && row.id === o.id);
      const impactos: ImpactoComponente[] = (workRow?.materials ?? []).map(material => ({
        itemId: material.itemId, nome: material.nome, unidade: material.unidade,
        necessario: material.needed, disponivelAntes: material.availableBefore,
        disponivelAposEsteAcumulado: material.balanceAfter,
        faltando: material.missing,
      }));
      const totalFaltando = impactos.reduce((sum, i) => sum + i.faltando, 0);
      const composta = subProducts.length > 1;
      const displayName = getOrderDisplayName({
        nome_conjunto: (o as any).nome_conjunto,
        subs: subProducts,
        fallbackName: (o as any).items?.nome,
      });

      return {
        ...o,
        posicao: workRow?.position ?? idx + 1,
        created_at: o.created_at,
        impactos,
        faltaInsumo: totalFaltando > 0,
        totalFaltando,
        subProducts,
        displayName,
        composta,
      } as OrderRow;
    });
  }, [allOrders, items, subProductsByOp, work]);

  const mixedQueue = work.map(row => row.kind === 'KIT'
    ? { kind: 'KIT' as const, row, plan: plans.find(plan => plan.id === row.id) }
    : { kind: 'OP' as const, row, order: queue.find(order => order.id === row.id) })
    .filter(entry => entry.kind === 'KIT' ? !!entry.plan : !!entry.order);
  const totalPedidosComFalta = work.filter(row => !row.canStart).length;

  // Resumo de consumo expandido: separa o que é demanda total da fila do que
  // efetivamente é projetado para sair (apenas OPs atendíveis pelo cálculo
  // em cascata) e calcula o saldo projetado por componente.
  const consumptionSummary = useMemo(() => {
    if (!work.length) return [];
    type Row = {
      itemId: string;
      nome: string;
      unidade: string;
      estoqueAtual: number;
      consumoProjetado: number;
      demandaTotal: number;
    };
    const map: Record<string, Row> = {};

    for (const entry of work) {
      for (const material of entry.materials) {
          const id = material.itemId;
          if (!map[id]) {
            const s = stock?.find((x) => x.item.id === id);
            map[id] = {
              itemId: id,
              nome: material.nome,
              unidade: material.unidade,
              estoqueAtual: s?.fisico ?? 0,
              consumoProjetado: 0,
              demandaTotal: 0,
            };
          }
          const need = material.needed;
          map[id].demandaTotal += need;
          if (entry.canStart) {
            map[id].consumoProjetado += need;
          }
      }
    }

    return Object.values(map)
      .map((r) => {
        const saldoProjetado = r.estoqueAtual - r.consumoProjetado;
        const faltanteTotal = Math.max(0, r.demandaTotal - r.estoqueAtual);
        return { ...r, saldoProjetado, faltanteTotal };
      })
      .sort((a, b) => a.nome.localeCompare(b.nome));
  }, [work, stock]);

  const handleRemove = async (id: string) => {
    const entry = mixedQueue.find((row) => row.row.id === id);
    const nome = entry?.kind === 'OP' ? entry.order?.displayName : entry?.plan?.nome;
    if (!window.confirm(`Remover "${nome || "esta montagem"}" da fila?`)) return;
    try {
      const { error } = await db.from("production_orders").delete().eq("id", id);
      if (error) throw error;
      queryClient.invalidateQueries({ queryKey: ["production_orders"] });
      queryClient.invalidateQueries({ queryKey: ['work_queue_availability'] });
      toast.success("Pedido removido da fila.");
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = mixedQueue.findIndex(entry => entry.row.id === active.id);
    const newIndex = mixedQueue.findIndex(entry => entry.row.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    await persistReorder(arrayMove(mixedQueue.map(entry => entry.row), oldIndex, newIndex));
  };

  /**
   * Reordena a fila persistindo o novo `ordem` de cada OP.
   * Faz update otimista no cache antes de aguardar a rede para a UI
   * recalcular cascata na hora.
   */
  const persistReorder = async (reordered: WorkQueueRow[]) => {
    try {
      const { error } = await db.rpc('reorder_work_queue', {
        _entries: reordered.map(entry => ({ kind: entry.kind, id: entry.id })),
      });
      if (error) throw error;
      await refreshWorkQueue();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
      await refreshWorkQueue();
    }
  };

  /** Sobe uma posição na fila (índice 0-based). */
  const handleMoveUp = (index: number) => {
    if (index <= 0) return;
    void persistReorder(arrayMove(mixedQueue.map(entry => entry.row), index, index - 1));
  };

  /** Move para o topo da fila. */
  const handleMoveTop = (index: number) => {
    if (index <= 0) return;
    void persistReorder(arrayMove(mixedQueue.map(entry => entry.row), index, 0));
  };

  const getStockForItem = (itemId: string) => stock?.find(s => s.item.id === itemId);

  const toggleExpand = (id: string) => setExpandedRows((prev) => ({ ...prev, [id]: !prev[id] }));

  return (
    <div className="space-y-6">
      <div className="glass-card px-4 py-3 text-xs text-muted-foreground">
        {canManageQueue ? <>Cadastre a estrutura e envie o produto em <Link className="text-primary underline" to="/estrutura">Estruturas (BOM)</Link>. Arraste para mudar a prioridade e acompanhe a execução em </> : 'Acompanhe a fila de montagem e a execução em '}<Link className="text-primary underline" to="/producao">Produção</Link>.
      </div>
      {/* Alerta global de ruptura */}
      {totalPedidosComFalta > 0 && (
        <div className="glass-card border border-destructive/30 bg-destructive/5 px-4 py-3 flex items-start gap-3">
          <div className="flex items-center justify-center h-8 w-8 rounded-lg bg-destructive/15 shrink-0">
            <AlertTriangle className="h-4 w-4 text-destructive" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-destructive">
              {totalPedidosComFalta} {totalPedidosComFalta === 1 ? "montagem" : "montagens"} sem insumo suficiente para produzir
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Veja as faltas em cada montagem e o consumo total ao lado.
            </p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Queue */}
        <div className="lg:col-span-2">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2">
                <Package className="h-4 w-4" />
                Fila de Montagem ({mixedQueue.length} {mixedQueue.length === 1 ? "montagem" : "montagens"})
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4 pt-0">
              {isLoading || workLoading ? (
                <p className="p-4 text-muted-foreground text-sm">Carregando...</p>
              ) : mixedQueue.length === 0 ? (
                <p className="p-6 text-center text-muted-foreground text-sm">Nenhuma montagem na fila. Cadastre uma estrutura BOM e envie o produto.</p>
              ) : (
                <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={canManageQueue ? handleDragEnd : undefined}>
                  <SortableContext items={mixedQueue.map(entry => entry.row.id)} strategy={verticalListSortingStrategy}>
                    <div className="space-y-2.5">
                      {mixedQueue.map((entry, idx) => entry.kind === 'KIT' && entry.plan ?
                        <SortableKitCard key={entry.row.id} plan={entry.plan} row={entry.row} index={idx} canManageQueue={canManageQueue} onMoveUp={() => handleMoveUp(idx)} onMoveTop={() => handleMoveTop(idx)} />
                        : entry.kind === 'OP' && entry.order ? <SortableQueueCard
                          key={entry.row.id} order={entry.order} onRemove={handleRemove}
                          expanded={!!expandedRows[entry.row.id]}
                          onToggleExpand={() => toggleExpand(entry.row.id)} nowMs={nowMs} index={idx}
                          canManageQueue={canManageQueue} onMoveUp={() => handleMoveUp(idx)} onMoveTop={() => handleMoveTop(idx)} /> : null)}
                    </div>
                  </SortableContext>
                </DndContext>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Consumption Summary — visão expandida por componente:
            estoque atual / consumo projetado (apenas OPs atendíveis) /
            saldo após fila / faltante total. */}
        <div>
          <Card>
            <CardHeader className="pb-3">
              <CardTitle>Resumo de Consumo Total</CardTitle>
              <p className="text-meta mt-1 leading-relaxed">
                Soma do que toda a fila pediria. Status mostra se o estoque atual cobre a demanda total.
              </p>
            </CardHeader>
            <CardContent className="p-0">
              {consumptionSummary.length === 0 ? (
                <p className="p-4 text-center text-muted-foreground text-sm">Sem pedidos na fila.</p>
              ) : (
                <ul className="divide-y divide-border/50">
                  {consumptionSummary.map((c) => {
                    const semFalta = c.faltanteTotal === 0;
                    return (
                      <li
                        key={c.itemId}
                        className="px-3 py-2.5 flex items-start gap-3 hover:bg-accent/40"
                      >
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span
                              className="flex-1 min-w-0 text-sm text-foreground line-clamp-2 break-words leading-snug"
                              title={c.nome}
                            >
                              {c.nome}
                            </span>
                          </TooltipTrigger>
                          <TooltipContent side="top" className="max-w-xs">
                            {c.nome}
                          </TooltipContent>
                        </Tooltip>
                        <span className="text-xs tabular-nums text-muted-foreground shrink-0 whitespace-nowrap pt-0.5">
                          {formatQuantity(c.demandaTotal, c.unidade)} / {formatQuantity(c.estoqueAtual, c.unidade)}
                        </span>
                        <span className="shrink-0 w-20 flex justify-end pt-0.5">
                          {semFalta ? (
                            <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold bg-success/15 text-success">
                              OK
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-destructive/15 text-destructive whitespace-nowrap">
                              <AlertTriangle className="h-3 w-3" />
                              Falta {formatQuantity(Math.ceil(c.faltanteTotal), c.unidade)}
                            </span>
                          )}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
