import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import {
  usePurchaseOrders,
  useCreatePurchaseOrder,
  useReceivePurchaseOrder,
  useCancelPurchaseOrder,
  precoEfetivoUnitario,
  type PurchaseOrder,
} from "@/hooks/usePurchaseOrders";
import { useItems } from "@/hooks/useItems";
import { useAllItemFornecedores } from "@/hooks/useItemFornecedores";
import { useFornecedores } from "@/hooks/useFornecedores";
import { CostCenterSelect } from "@/components/CostCenterSelect";
import { useAuth } from "@/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { FieldLabel } from "@/components/FieldLabel";
import { LoadingSkeleton, EmptyState } from "@/components/LoadingAndEmpty";
import { StatusBadge } from "@/components/StatusBadge";
import { toast } from "sonner";
import {
  ShoppingCart,
  Sparkles,
  AlertTriangle,
  X,
  ChevronDown,
  Calendar,
  Package,
  Truck,
  CheckCircle2,
  PackageCheck,
  Plus,
  Maximize2,
  Minimize2,
} from "lucide-react";
import { MoneyInput } from "@/components/MoneyInput";
import { formatBRL } from "@/lib/money";
import { resolverUnidades, compraParaEstoque, precoCompraParaEstoque } from "@/lib/conversao";
import { formatQuantity } from "@/lib/quantity";
import { cn } from "@/lib/utils";

const STATUS_LABEL: Record<string, string> = {
  CRIADO: "Criado",
  RECEBIDO_PARCIAL: "Recebido parcial",
  RECEBIDO_COMPLETO: "Recebido completo",
  CANCELADO: "Cancelado",
  // Legados
  ABERTO: "Criado",
  PARCIAL: "Recebido parcial",
  RECEBIDO: "Recebido completo",
};

const statusTone = (status: string): "default" | "primary" | "success" | "warning" | "destructive" | "muted" => {
  switch (status) {
    case "RECEBIDO_COMPLETO":
    case "RECEBIDO":
      return "success";
    case "RECEBIDO_PARCIAL":
    case "PARCIAL":
      return "warning";
    case "CANCELADO":
      return "destructive";
    default:
      return "primary";
  }
};

const isFinalizado = (status: string) =>
  status === "RECEBIDO_COMPLETO" || status === "RECEBIDO" || status === "CANCELADO";

type PrefillState = {
  prefill?: {
    item_id: string;
    item_nome?: string;
    quantidade: number;
    data_prevista?: string;
    fornecedor_id?: string;
  };
};

const addDays = (base: Date, days: number) => {
  const d = new Date(base);
  d.setDate(d.getDate() + days);
  return d;
};
const toIsoDate = (d: Date) => d.toISOString().slice(0, 10);

export default function PurchasesPage() {
  const user = useAuth();
  const { data: orders, isLoading } = usePurchaseOrders();
  const { data: items } = useItems();
  const { data: itemFornecedores } = useAllItemFornecedores();
  const { data: fornecedores } = useFornecedores();
  const createOrder = useCreatePurchaseOrder();
  const receiveOrder = useReceivePurchaseOrder();
  const cancelOrder = useCancelPurchaseOrder();

  // Modal de novo pedido
  const [novoPedidoOpen, setNovoPedidoOpen] = useState(false);
  const [telaCheia, setTelaCheia] = useState(false);

  // Modal de recebimento parcial
  const [recebimentoOrder, setRecebimentoOrder] = useState<PurchaseOrder | null>(null);
  const [recebimentoQtd, setRecebimentoQtd] = useState("");
  const [recebimentoData, setRecebimentoData] = useState("");

  const location = useLocation();
  const navigate = useNavigate();
  const itemSelectRef = useRef<HTMLSelectElement | null>(null);
  const qtdRef = useRef<HTMLInputElement | null>(null);
  const prefill = (location.state as PrefillState | null)?.prefill;
  const [searchParams, setSearchParams] = useSearchParams();
  const [prefilledFromEstoque, setPrefilledFromEstoque] = useState<string | null>(null);

  const [itemId, setItemId] = useState("");
  const [fornecedorId, setFornecedorId] = useState("");
  const [centroCustoId, setCentroCustoId] = useState("");
  const [qtd, setQtd] = useState("");
  const [precoUnit, setPrecoUnit] = useState("");
  const [dataPrev, setDataPrev] = useState("");
  const [frete, setFrete] = useState("");
  const [impostos, setImpostos] = useState("");
  const [outrosCustos, setOutrosCustos] = useState("");
  const [precoEditadoManual, setPrecoEditadoManual] = useState(false);
  const [dataEditadaManual, setDataEditadaManual] = useState(false);
  const [prefilledFromSugestao, setPrefilledFromSugestao] = useState<string | null>(null);
  const [opcionaisAbertos, setOpcionaisAbertos] = useState(false);

  const itemSelecionado = useMemo(() => items?.find((i) => i.id === itemId) || null, [items, itemId]);

  // Vínculos do item (apenas ativos), com nome do fornecedor
  const vinculosDoItem = useMemo(() => {
    if (!itemId || !itemFornecedores || !fornecedores) return [];
    return itemFornecedores
      .filter((v: any) => v.item_id === itemId && v.ativo !== false)
      .map((v: any) => ({
        ...v,
        fornecedor_nome: fornecedores.find((f) => f.id === v.fornecedor_id)?.nome || "—",
      }));
  }, [itemId, itemFornecedores, fornecedores]);

  const vinculoSelecionado = useMemo(
    () => vinculosDoItem.find((v: any) => v.fornecedor_id === fornecedorId) || null,
    [vinculosDoItem, fornecedorId],
  );

  // Unidades efetivas (override do vínculo > padrão do item)
  const unidades = useMemo(
    () => resolverUnidades(itemSelecionado, vinculoSelecionado),
    [itemSelecionado, vinculoSelecionado],
  );
  const temEmbalagem = unidades.fator > 1 || unidades.unidadeCompra !== unidades.unidadeEstoque;

  // Auto-selecionar fornecedor principal quando o item muda
  useEffect(() => {
    if (!itemId) {
      setFornecedorId("");
      return;
    }
    const principal = vinculosDoItem.find((v: any) => v.principal);
    if (principal) {
      setFornecedorId(principal.fornecedor_id);
    } else if (vinculosDoItem.length === 1) {
      setFornecedorId(vinculosDoItem[0].fornecedor_id);
    } else {
      setFornecedorId("");
    }
    setPrecoEditadoManual(false);
    setDataEditadaManual(false);
  }, [itemId, vinculosDoItem]);

  // Auto-preencher preço e data prevista a partir do vínculo escolhido
  useEffect(() => {
    if (!itemSelecionado) return;
    const precoFallback = Number(itemSelecionado.custo_unitario || 0);
    const leadFallback = Number(itemSelecionado.lead_time_dias || 0);
    const preco = vinculoSelecionado?.preco_unitario != null
      ? Number(vinculoSelecionado.preco_unitario)
      : precoFallback;
    const lead = vinculoSelecionado?.lead_time_dias != null
      ? Number(vinculoSelecionado.lead_time_dias)
      : leadFallback;

    if (!precoEditadoManual) {
      setPrecoUnit(preco > 0 ? String(preco) : "");
    }
    if (!dataEditadaManual) {
      setDataPrev(lead > 0 ? toIsoDate(addDays(new Date(), lead)) : "");
    }
  }, [vinculoSelecionado, itemSelecionado, precoEditadoManual, dataEditadaManual]);

  // Pré-preenchimento vindo de "Sugestão de Compras" — abre modal automaticamente
  useEffect(() => {
    if (!prefill) return;
    setItemId(prefill.item_id);
    setQtd(String(prefill.quantidade));
    if (prefill.data_prevista) {
      setDataPrev(prefill.data_prevista);
      setDataEditadaManual(true);
    }
    if (prefill.fornecedor_id) {
      setFornecedorId(prefill.fornecedor_id);
    }
    setPrefilledFromSugestao(prefill.item_nome || null);
    setNovoPedidoOpen(true);
    navigate(location.pathname, { replace: true, state: null });
  }, [prefill, navigate, location.pathname]);

  // Pré-seleção via query param (?item=ID) — vindo da Posição de Estoque, abre modal
  useEffect(() => {
    const pid = searchParams.get("item");
    if (!pid || !items) return;
    const found = items.find((i) => i.id === pid);
    if (!found) {
      const next = new URLSearchParams(searchParams);
      next.delete("item");
      setSearchParams(next, { replace: true });
      return;
    }
    setItemId(found.id);
    setPrefilledFromEstoque(found.nome);
    setNovoPedidoOpen(true);
    const next = new URLSearchParams(searchParams);
    next.delete("item");
    setSearchParams(next, { replace: true });
    setTimeout(() => qtdRef.current?.focus(), 120);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items]);

  // Foco no campo "Item" quando o modal abre (a menos que já esteja pré-preenchido)
  useEffect(() => {
    if (!novoPedidoOpen) return;
    const t = setTimeout(() => {
      if (!itemId) {
        itemSelectRef.current?.focus();
      } else {
        qtdRef.current?.focus();
      }
    }, 120);
    return () => clearTimeout(t);
  }, [novoPedidoOpen, itemId]);

  // Validações de mínimo/múltiplo
  const qtdNum = Number(qtd) || 0;
  const minimoFornecedor = Number(vinculoSelecionado?.quantidade_minima_compra || 0);
  const multiploFornecedor = Number(vinculoSelecionado?.multiplo_compra || 0);
  const violaMinimo = minimoFornecedor > 0 && qtdNum > 0 && qtdNum < minimoFornecedor;
  const violaMultiplo = multiploFornecedor > 0 && qtdNum > 0 && qtdNum % multiploFornecedor !== 0;
  const sugestaoArredondamento = useMemo(() => {
    if (!violaMultiplo) return null;
    return Math.ceil(qtdNum / multiploFornecedor) * multiploFornecedor;
  }, [violaMultiplo, qtdNum, multiploFornecedor]);

  const freteNum = Number(frete) || 0;
  const impostosNum = Number(impostos) || 0;
  const outrosNum = Number(outrosCustos) || 0;
  const extrasTotal = freteNum + impostosNum + outrosNum;
  const subtotalProdutos = qtdNum > 0 && precoUnit ? qtdNum * Number(precoUnit) : 0;
  const custoEstimado = subtotalProdutos + extrasTotal;
  const precoEfetivoEstimado =
    qtdNum > 0 && precoUnit ? Number(precoUnit) + extrasTotal / qtdNum : 0;
  const temOpcionais = freteNum > 0 || impostosNum > 0 || outrosNum > 0;

  const resetForm = () => {
    setItemId("");
    setFornecedorId("");
    setCentroCustoId("");
    setQtd("");
    setPrecoUnit("");
    setDataPrev("");
    setFrete("");
    setImpostos("");
    setOutrosCustos("");
    setPrecoEditadoManual(false);
    setDataEditadaManual(false);
    setPrefilledFromSugestao(null);
    setPrefilledFromEstoque(null);
    setOpcionaisAbertos(false);
  };

  const handleCloseModal = (open: boolean) => {
    setNovoPedidoOpen(open);
    if (!open) {
      resetForm();
      setTelaCheia(false);
    }
  };

  const handleCreate = async () => {
    if (!itemId || !qtd) {
      toast.error("Preencha item e quantidade.");
      return;
    }
    if (!fornecedorId) {
      toast.error("Selecione um fornecedor para o pedido de compra.");
      return;
    }
    if (!centroCustoId) { toast.error("Selecione o centro de custo."); return; }
    if (violaMinimo) {
      toast.error(`Quantidade abaixo do mínimo do fornecedor (${minimoFornecedor}).`);
      return;
    }
    if (violaMultiplo) {
      toast.error(`Quantidade deve ser múltiplo de ${multiploFornecedor}. Sugestão: ${sugestaoArredondamento}.`);
      return;
    }
    try {
      await createOrder.mutateAsync({
        item_id: itemId,
        fornecedor_id: fornecedorId,
        centro_custo_id: centroCustoId,
        quantidade: qtdNum,
        preco_unitario: precoUnit ? Number(precoUnit) : null,
        data_prevista: dataPrev || undefined,
        frete: freteNum,
        impostos: impostosNum,
        outros_custos: outrosNum,
      });
      toast.success("Pedido de compra criado!");
      resetForm();
      setNovoPedidoOpen(false);
      setTelaCheia(false);
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const abrirRecebimento = (order: PurchaseOrder) => {
    const restante = Number(order.quantidade) - Number(order.quantidade_recebida || 0);
    setRecebimentoOrder(order);
    setRecebimentoQtd(String(restante));
    setRecebimentoData(toIsoDate(new Date()));
  };

  const confirmarRecebimento = async () => {
    if (!recebimentoOrder) return;
    const qtd = Number(recebimentoQtd);
    const restante = Number(recebimentoOrder.quantidade) - Number(recebimentoOrder.quantidade_recebida || 0);
    if (!recebimentoData) {
      toast.error("Informe a data real do recebimento.");
      return;
    }
    const itemDoPedido = items?.find((i) => i.id === recebimentoOrder.item_id) || null;
    const vincDoPedido = (itemFornecedores || []).find(
      (v: any) => v.item_id === recebimentoOrder.item_id && v.fornecedor_id === recebimentoOrder.fornecedor_id,
    ) || null;
    const { fator } = resolverUnidades(itemDoPedido as any, vincDoPedido as any);

    try {
      await receiveOrder.mutateAsync({
        order: recebimentoOrder,
        quantidadeAgora: qtd,
        dataReal: recebimentoData,
        fatorConversao: fator,
      });
      toast.success(
        qtd >= restante
          ? "Pedido totalmente recebido. Estoque atualizado."
          : "Recebimento parcial registrado. Estoque atualizado.",
      );
      setRecebimentoOrder(null);
      setRecebimentoQtd("");
      setRecebimentoData("");
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const handleCancel = async (order: PurchaseOrder) => {
    if (!confirm(`Cancelar o pedido de ${order.items?.nome || "item"}? Esta ação não impacta o estoque.`)) return;
    try {
      await cancelOrder.mutateAsync(order.id);
      toast.success("Pedido cancelado.");
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  return (
    <div className="space-y-5">
      {/* ===================== HEADER COM AÇÃO PRINCIPAL ===================== */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-page-title">Pedidos de Compra</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Registre novos pedidos e acompanhe o recebimento de cada compra.
          </p>
        </div>
        <Button
          onClick={() => setNovoPedidoOpen(true)}
          size="lg"
          className="shadow-md min-w-[180px]"
        >
          <Plus className="h-4 w-4" />
          Novo Pedido
        </Button>
      </div>

      {/* ===================== LISTA DE PEDIDOS (cards) ===================== */}
      {isLoading ? (
        <LoadingSkeleton rows={3} />
      ) : !orders || orders.length === 0 ? (
        <div className="glass-card">
          <EmptyState
            icon={ShoppingCart}
            title="Nenhum pedido de compra"
            description="Clique em 'Novo Pedido' para registrar a primeira compra."
          />
        </div>
      ) : (
        <div className="space-y-2">
          <div className="flex items-center justify-between px-1">
            <h2 className="text-section-title">Pedidos de compra</h2>
            <span className="text-xs text-muted-foreground tabular-nums">
              {orders.length} {orders.length === 1 ? "pedido" : "pedidos"}
            </span>
          </div>

          <div className="space-y-2">
            {orders.map((o) => {
              const total = o.preco_unitario != null ? Number(o.preco_unitario) * Number(o.quantidade) : null;
              const recebido = Number(o.quantidade_recebida || 0);
              const restante = Number(o.quantidade) - recebido;
              const finalizado = isFinalizado(o.status);
              const progresso = Number(o.quantidade) > 0 ? Math.min(100, Math.round((recebido / Number(o.quantidade)) * 100)) : 0;
              const tone = statusTone(o.status);

              return (
                <div
                  key={o.id}
                  className={`glass-card overflow-hidden transition-colors ${
                    finalizado ? "opacity-80" : "hover:border-primary/30"
                  }`}
                >
                  <div className="flex flex-col lg:flex-row lg:items-stretch">
                    {/* BLOCO 1 — Item / Fornecedor / Data */}
                    <div className="flex-1 min-w-0 px-4 py-3 lg:border-r border-border/40">
                      <div className="flex items-start justify-between gap-2 mb-1">
                        <h3 className="text-md font-semibold text-foreground leading-tight line-clamp-2">
                          {o.items?.nome}
                        </h3>
                        <StatusBadge tone={tone} className="shrink-0">
                          {STATUS_LABEL[o.status] || o.status}
                        </StatusBadge>
                      </div>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                        <span className="inline-flex items-center gap-1">
                          <Truck className="h-3 w-3" />
                          {o.fornecedores?.nome || "Sem fornecedor"}
                        </span>
                        <span className="inline-flex items-center gap-1">
                          <Calendar className="h-3 w-3" />
                          Criado em {new Date(o.created_at).toLocaleDateString("pt-BR")}
                        </span>
                        {o.data_prevista && (
                          <span className="inline-flex items-center gap-1">
                            <PackageCheck className="h-3 w-3" />
                            Previsão: {new Date(o.data_prevista).toLocaleDateString("pt-BR")}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* BLOCO 2 — Quantidade / Recebido */}
                    <div className="flex lg:flex-col lg:justify-center lg:items-start lg:w-[200px] px-4 py-3 lg:border-r border-t lg:border-t-0 border-border/40 bg-muted/10 gap-4 lg:gap-1">
                      <div>
                        <div className="text-meta uppercase text-muted-foreground">Quantidade</div>
                        <div className="text-md font-semibold text-foreground tabular-nums">
                          {(() => {
                            const it = (o as any).items;
                            const u = it?.unidade_compra || it?.unidade || "";
                            return (
                              <>
                                {formatQuantity(recebido, u)}{" "}
                                <span className="text-muted-foreground font-normal">/ {formatQuantity(Number(o.quantidade), u)}</span>
                              </>
                            );
                          })()}
                        </div>
                      </div>
                      {recebido > 0 && recebido < Number(o.quantidade) && (
                        <div className="flex-1 lg:w-full lg:max-w-[160px] flex items-center lg:items-start lg:flex-col gap-1 lg:mt-1">
                          <div className="w-full h-1.5 rounded-full bg-muted overflow-hidden">
                            <div className="h-full bg-warning" style={{ width: `${progresso}%` }} />
                          </div>
                          <span className="text-meta text-muted-foreground tabular-nums">{progresso}%</span>
                        </div>
                      )}
                    </div>

                    {/* BLOCO 3 — Valores */}
                    <div className="flex lg:flex-col lg:justify-center lg:items-start lg:w-[170px] px-4 py-3 lg:border-r border-t lg:border-t-0 border-border/40 gap-4 lg:gap-1">
                      <div>
                        <div className="text-meta uppercase text-muted-foreground">Preço unit.</div>
                        <div className="text-sm font-medium text-foreground tabular-nums">
                          {o.preco_unitario != null ? formatBRL(Number(o.preco_unitario)) : "—"}
                        </div>
                      </div>
                      <div>
                        <div className="text-meta uppercase text-muted-foreground">Total</div>
                        <div className="text-sm font-semibold text-foreground tabular-nums">
                          {total != null ? formatBRL(total) : "—"}
                        </div>
                      </div>
                    </div>

                    {/* BLOCO 4 — Ações */}
                    <div className="flex lg:flex-col lg:justify-center lg:items-stretch lg:w-[160px] px-4 py-3 border-t lg:border-t-0 gap-2">
                      {!finalizado && restante > 0 && (
                        <Button
                          variant="default"
                          size="sm"
                          onClick={() => abrirRecebimento(o)}
                          className="flex-1 lg:w-full shadow-sm"
                        >
                          <CheckCircle2 className="h-4 w-4" />
                          Receber
                        </Button>
                      )}
                      {!finalizado && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleCancel(o)}
                          title="Cancelar pedido"
                          className="text-muted-foreground hover:text-destructive lg:w-full"
                        >
                          <X className="h-4 w-4" />
                          <span className="lg:hidden">Cancelar</span>
                        </Button>
                      )}
                      {finalizado && (
                        <span className="text-xs text-muted-foreground text-center self-center w-full">
                          Sem ações disponíveis
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ===================== MODAL NOVO PEDIDO ===================== */}
      <Dialog open={novoPedidoOpen} onOpenChange={handleCloseModal}>
        <DialogContent
          className={cn(
            "p-0 gap-0 flex flex-col",
            telaCheia
              ? "max-w-none w-screen h-screen sm:rounded-none"
              : "max-w-3xl max-h-[90vh]",
          )}
        >
          <DialogHeader className="px-6 py-4 border-b border-border/60 shrink-0">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 min-w-0">
                <ShoppingCart className="h-4 w-4 text-primary shrink-0" />
                <DialogTitle className="truncate">Novo Pedido de Compra</DialogTitle>
                {prefilledFromSugestao && (
                  <StatusBadge tone="primary" className="gap-1 shrink-0">
                    <Sparkles className="h-3 w-3" />
                    Sugestão
                  </StatusBadge>
                )}
                {prefilledFromEstoque && !prefilledFromSugestao && (
                  <StatusBadge tone="primary" className="gap-1 shrink-0">
                    <Sparkles className="h-3 w-3" />
                    Da Posição de Estoque
                  </StatusBadge>
                )}
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setTelaCheia((v) => !v)}
                className="text-muted-foreground hover:text-foreground shrink-0"
                title={telaCheia ? "Sair da tela cheia" : "Abrir em tela cheia"}
              >
                {telaCheia ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
                <span className="hidden sm:inline">{telaCheia ? "Reduzir" : "Tela cheia"}</span>
              </Button>
            </div>
          </DialogHeader>

          {/* CORPO COM SCROLL INTERNO */}
          <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
            {/* BLOCO 1 — Produto e fornecedor */}
            <section>
              <div className="flex items-center gap-2 mb-2">
                <Package className="h-3.5 w-3.5 text-muted-foreground" />
                <h3 className="text-meta uppercase tracking-wide font-semibold text-muted-foreground">
                  Produto e fornecedor
                </h3>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                <div>
                  <FieldLabel label="Item para comprar" required help="Selecione o item que deseja comprar." />
                  <select
                    ref={itemSelectRef}
                    className="bg-input border border-border rounded-lg px-3 py-2 text-sm text-foreground w-full h-10"
                    value={itemId}
                    onChange={(e) => setItemId(e.target.value)}
                  >
                    <option value="">Selecione o item</option>
                    {items?.map((i) => (
                      <option key={i.id} value={i.id}>
                        {i.nome} ({i.tipo})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <FieldLabel
                    label="Fornecedor"
                    required
                    help="Fornecedor que atenderá esta compra. O preço e o lead time são pré-preenchidos a partir do vínculo cadastrado para este item."
                  />
                  <select
                    className="bg-input border border-border rounded-lg px-3 py-2 text-sm text-foreground w-full h-10"
                    value={fornecedorId}
                    onChange={(e) => {
                      setFornecedorId(e.target.value);
                      setPrecoEditadoManual(false);
                      setDataEditadaManual(false);
                    }}
                    disabled={!itemId}
                  >
                    <option value="">
                      {itemId
                        ? vinculosDoItem.length === 0
                          ? "Nenhum fornecedor vinculado"
                          : "Selecione o fornecedor"
                        : "Selecione um item primeiro"}
                    </option>
                    {vinculosDoItem.map((v: any) => (
                      <option key={v.fornecedor_id} value={v.fornecedor_id}>
                        {v.fornecedor_nome}
                        {v.principal ? " ★ principal" : ""}
                        {v.preco_unitario != null ? ` — ${formatBRL(Number(v.preco_unitario))}` : ""}
                      </option>
                    ))}
                  </select>
                  {itemId && vinculosDoItem.length === 0 && (
                    <p className="text-xs text-warning mt-1 inline-flex items-start gap-1">
                      <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
                      Este item ainda não tem fornecedores vinculados. Edite o item para adicionar.
                    </p>
                  )}
                </div>

                <div>
                  <FieldLabel
                    label={temEmbalagem ? `Quantidade (em ${unidades.unidadeCompra})` : "Quantidade"}
                    required
                    help={temEmbalagem
                      ? `Quantidade em ${unidades.unidadeCompra}. Cada ${unidades.unidadeCompra} contém ${unidades.fator} ${unidades.unidadeEstoque}.`
                      : "Quantidade a ser comprada."}
                  />
                  <Input
                    ref={qtdRef}
                    placeholder={temEmbalagem ? `Ex: 10 ${unidades.unidadeCompra}` : "Ex: 100"}
                    type="number"
                    min="1"
                    value={qtd}
                    onChange={(e) => setQtd(e.target.value)}
                  />
                  {temEmbalagem && qtdNum > 0 && (
                    <p className="text-xs text-muted-foreground mt-1">
                      Equivalente a <span className="text-foreground font-medium">{compraParaEstoque(qtdNum, unidades.fator)} {unidades.unidadeEstoque}</span> no estoque.
                    </p>
                  )}
                  {(violaMinimo || violaMultiplo) && (
                    <p className="text-xs text-warning mt-1 inline-flex items-start gap-1">
                      <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
                      {violaMinimo && `Mínimo: ${minimoFornecedor}.`}
                      {violaMultiplo && ` Deve ser múltiplo de ${multiploFornecedor}. Sugestão: ${sugestaoArredondamento}.`}
                    </p>
                  )}
                </div>
                <div>
                  <FieldLabel label="Centro de custo" required help="Setor ou pessoa responsável por esta compra e pela entrada no estoque." />
                  <CostCenterSelect value={centroCustoId} onChange={setCentroCustoId} />
                </div>
              </div>
            </section>

            {/* BLOCO 2 — Preço */}
            <section>
              <div className="flex items-center gap-2 mb-2">
                <span className="text-meta uppercase tracking-wide font-semibold text-muted-foreground">
                  Preço
                </span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                <div>
                  <FieldLabel
                    label={temEmbalagem ? `Preço por ${unidades.unidadeCompra} (R$)` : "Preço unitário (R$)"}
                    help={temEmbalagem
                      ? `Preço da UNIDADE DE COMPRA (ex: R$ por ${unidades.unidadeCompra}). O custo por ${unidades.unidadeEstoque} é calculado automaticamente dividindo pelo fator (${unidades.fator}).`
                      : "Pré-preenchido com o preço do fornecedor escolhido. Pode ser ajustado para refletir o preço real desta compra."}
                  />
                  <MoneyInput
                    placeholder={itemSelecionado ? `Referência: ${formatBRL(Number(itemSelecionado.custo_unitario || 0))}` : "0,00"}
                    value={precoUnit}
                    onChange={(v) => {
                      setPrecoUnit(v);
                      setPrecoEditadoManual(true);
                    }}
                  />
                  {temEmbalagem && Number(precoUnit) > 0 && (
                    <p className="text-xs text-muted-foreground mt-1">
                      Equivale a <span className="text-foreground font-medium">{formatBRL(precoCompraParaEstoque(Number(precoUnit), unidades.fator))} por {unidades.unidadeEstoque}</span>.
                    </p>
                  )}
                </div>

                <div className="md:col-span-2 flex items-end">
                  <div className="w-full rounded-lg border border-border/50 bg-muted/20 px-4 py-3">
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <div className="text-meta uppercase text-muted-foreground">Subtotal produtos</div>
                        <div className="text-md font-semibold text-foreground tabular-nums">
                          {subtotalProdutos > 0 ? formatBRL(subtotalProdutos) : "—"}
                        </div>
                      </div>
                      <div>
                        <div className="text-meta uppercase text-muted-foreground">Custo total da compra</div>
                        <div className="text-md font-semibold text-primary tabular-nums">
                          {custoEstimado > 0 ? formatBRL(custoEstimado) : "—"}
                        </div>
                      </div>
                    </div>
                    {extrasTotal > 0 && precoEfetivoEstimado > 0 && (
                      <div className="mt-2 pt-2 border-t border-border/40 text-xs text-muted-foreground">
                        Custo unitário efetivo (com rateio):{" "}
                        <span className="text-primary font-semibold tabular-nums">{formatBRL(precoEfetivoEstimado)}</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </section>

            {/* BLOCO 3 — Prazo */}
            <section>
              <div className="flex items-center gap-2 mb-2">
                <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-meta uppercase tracking-wide font-semibold text-muted-foreground">
                  Prazo
                </span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                <div>
                  <FieldLabel
                    label="Data prevista de entrega"
                    help="Calculada automaticamente a partir do lead time do fornecedor escolhido. Pode ser ajustada."
                  />
                  <Input
                    type="date"
                    value={dataPrev}
                    onChange={(e) => {
                      setDataPrev(e.target.value);
                      setDataEditadaManual(true);
                    }}
                  />
                </div>
              </div>
            </section>

            {/* BLOCO 4 — Custos adicionais (colapsável) */}
            <Collapsible open={opcionaisAbertos} onOpenChange={setOpcionaisAbertos}>
              <CollapsibleTrigger asChild>
                <button
                  type="button"
                  className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg border border-dashed border-border hover:border-primary/40 hover:bg-accent/30 transition-colors group"
                >
                  <span className="flex items-center gap-2 text-sm font-medium text-muted-foreground group-hover:text-foreground">
                    <Truck className="h-3.5 w-3.5" />
                    Custos adicionais do pedido
                    {temOpcionais && (
                      <StatusBadge tone="primary" size="sm">
                        Preenchido
                      </StatusBadge>
                    )}
                  </span>
                  <ChevronDown
                    className={`h-4 w-4 text-muted-foreground transition-transform ${opcionaisAbertos ? "rotate-180" : ""}`}
                  />
                </button>
              </CollapsibleTrigger>
              <CollapsibleContent className="pt-3">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  <div>
                    <FieldLabel
                      label="Frete (R$)"
                      help="Custo de frete do pedido inteiro. Será rateado proporcionalmente no custo unitário do item."
                    />
                    <MoneyInput value={frete} onChange={setFrete} />
                  </div>
                  <div>
                    <FieldLabel
                      label="Impostos (R$)"
                      help="Impostos não recuperáveis incidentes sobre o pedido. Somam ao custo total e são rateados no custo unitário."
                    />
                    <MoneyInput value={impostos} onChange={setImpostos} />
                  </div>
                  <div>
                    <FieldLabel
                      label="Outros custos (R$)"
                      help="Demais despesas vinculadas ao pedido (seguro, embalagem, etc.). Também são rateadas no custo unitário."
                    />
                    <MoneyInput value={outrosCustos} onChange={setOutrosCustos} />
                  </div>
                </div>
              </CollapsibleContent>
            </Collapsible>
          </div>

          {/* RODAPÉ FIXO COM AÇÕES */}
          <DialogFooter className="px-6 py-4 border-t border-border/60 shrink-0 sm:justify-between gap-3 flex-col-reverse sm:flex-row">
            <p className="text-xs text-muted-foreground sm:flex-1 text-center sm:text-left">
              {itemId && fornecedorId && qtdNum > 0
                ? "Tudo pronto para criar o pedido."
                : "Preencha item, fornecedor e quantidade para continuar."}
            </p>
            <div className="flex gap-2 justify-end">
              <Button variant="ghost" onClick={() => handleCloseModal(false)}>
                Cancelar
              </Button>
              <Button
                onClick={handleCreate}
                disabled={createOrder.isPending || !fornecedorId || !itemId || !qtd}
                size="lg"
                className="min-w-[180px] shadow-md"
              >
                <ShoppingCart className="h-4 w-4" />
                Criar Pedido
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ===================== MODAL RECEBIMENTO ===================== */}
      <Dialog open={!!recebimentoOrder} onOpenChange={(open) => { if (!open) { setRecebimentoOrder(null); setRecebimentoQtd(""); setRecebimentoData(""); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Registrar recebimento</DialogTitle>
          </DialogHeader>
          {recebimentoOrder && (() => {
            const recebido = Number(recebimentoOrder.quantidade_recebida || 0);
            const restante = Number(recebimentoOrder.quantidade) - recebido;
            const qtdNum = Number(recebimentoQtd) || 0;
            const precoEfetivo = recebimentoOrder.preco_unitario != null
              ? precoEfetivoUnitario(recebimentoOrder)
              : null;
            const valorEstimado = precoEfetivo != null ? precoEfetivo * qtdNum : null;
            const extras = Number(recebimentoOrder.frete || 0)
              + Number(recebimentoOrder.impostos || 0)
              + Number(recebimentoOrder.outros_custos || 0);
            const excede = qtdNum > restante;
            return (
              <div className="space-y-4">
                <div className="rounded-lg bg-muted/40 p-3 space-y-1 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Item</span>
                    <span className="font-medium text-foreground">{recebimentoOrder.items?.nome}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Fornecedor</span>
                    <span className="text-foreground">{recebimentoOrder.fornecedores?.nome || "—"}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Pedido</span>
                    <span className="text-foreground tabular-nums">{recebimentoOrder.quantidade}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Já recebido</span>
                    <span className="text-foreground tabular-nums">{recebido}</span>
                  </div>
                  <div className="flex justify-between font-medium">
                    <span className="text-muted-foreground">Restante</span>
                    <span className="text-foreground tabular-nums">{restante}</span>
                  </div>
                  {extras > 0 && (
                    <>
                      <div className="flex justify-between pt-1 border-t border-border/40 mt-1">
                        <span className="text-muted-foreground">Custos adicionais do pedido</span>
                        <span className="text-foreground tabular-nums">{formatBRL(extras)}</span>
                      </div>
                      {precoEfetivo != null && (
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Custo unitário efetivo (com rateio)</span>
                          <span className="font-semibold text-primary tabular-nums">{formatBRL(precoEfetivo)}</span>
                        </div>
                      )}
                    </>
                  )}
                </div>

                <div>
                  <FieldLabel
                    label="Quantidade recebida agora"
                    required
                    help="Pode ser parcial. O sistema gera uma movimentação de entrada com este valor (já com rateio dos custos adicionais) e atualiza o status do pedido automaticamente."
                  />
                  <Input
                    type="number"
                    min="0"
                    max={restante}
                    step="any"
                    value={recebimentoQtd}
                    onChange={(e) => setRecebimentoQtd(e.target.value)}
                    autoFocus
                  />
                  {excede && (
                    <p className="text-xs text-destructive mt-1 inline-flex items-start gap-1">
                      <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
                      Quantidade excede o restante do pedido ({restante}).
                    </p>
                  )}
                  {valorEstimado != null && qtdNum > 0 && !excede && (
                    <p className="text-xs text-muted-foreground mt-1">
                      Valor desta entrada: <span className="text-foreground font-medium">{formatBRL(valorEstimado)}</span>
                    </p>
                  )}
                </div>

                <div>
                  <FieldLabel
                    label="Data real do recebimento"
                    required
                    help="Data em que o material chegou de fato. É usada para calcular o lead time real do fornecedor."
                  />
                  <Input
                    type="date"
                    value={recebimentoData}
                    max={toIsoDate(new Date())}
                    onChange={(e) => setRecebimentoData(e.target.value)}
                  />
                  {recebimentoOrder && recebimentoData && (() => {
                    const dias = Math.round(
                      (new Date(`${recebimentoData}T12:00:00`).getTime() -
                        new Date(recebimentoOrder.created_at).getTime()) / (1000 * 60 * 60 * 24)
                    );
                    if (dias < 0) return null;
                    return (
                      <p className="text-xs text-muted-foreground mt-1">
                        Lead time desta entrega: <span className="text-foreground font-medium">{dias} dia(s)</span> desde a criação do pedido.
                      </p>
                    );
                  })()}
                </div>
                <div>
                  <FieldLabel label="Responsável pelo recebimento" />
                  <Input value={user.displayName} readOnly aria-readonly="true" />
                </div>
              </div>
            );
          })()}
          <DialogFooter>
            <Button variant="ghost" onClick={() => { setRecebimentoOrder(null); setRecebimentoQtd(""); setRecebimentoData(""); }}>
              Cancelar
            </Button>
            <Button
              onClick={confirmarRecebimento}
              disabled={
                receiveOrder.isPending
                || !recebimentoQtd
                || !recebimentoData
                || Number(recebimentoQtd) <= 0
                || (recebimentoOrder
                  ? Number(recebimentoQtd) > (Number(recebimentoOrder.quantidade) - Number(recebimentoOrder.quantidade_recebida || 0))
                  : true)
              }
            >
              <CheckCircle2 className="h-4 w-4" />
              Confirmar recebimento
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
