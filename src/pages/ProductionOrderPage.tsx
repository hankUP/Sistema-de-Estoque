import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { db } from "@/db/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LoadingSkeleton } from "@/components/LoadingAndEmpty";
import { StatusBadge } from "@/components/StatusBadge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  getOrderDisplayStatus,
  getShippingStage,
  useCompleteProductionOrder,
  useSetShippingInfo,
  useMarkReceived,
  useRevertToPlanned,
  useSetOrderMontador,
  useStartProductionOrder,
} from "@/hooks/useProductionOrders";
import { toast } from "sonner";
import {
  ArrowLeft,
  CheckCircle2,
  Clock,
  Factory,
  User,
  Truck,
  PackageCheck,
  Play,
} from "lucide-react";
import { formatQuantity } from "@/lib/quantity";
import { useProductionOrderItems } from "@/hooks/useProductionOrderItems";
import { getOrderDisplayName } from "@/lib/orderDisplay";
import { formatDuration } from "@/hooks/useProductionStages";
import { StartProductionDialog } from "@/components/StartProductionDialog";
import { useAuth } from '@/auth';

function todayIso() {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function formatDateTime(date?: string | null) {
  return date ? new Date(date).toLocaleString("pt-BR") : "—";
}

function formatDate(date?: string | null) {
  return date ? new Date(date).toLocaleDateString("pt-BR") : "—";
}

export default function ProductionOrderPage() {
  const user = useAuth();
  const canManage = user.role === 'ADMIN' || user.role === 'COORDENADOR';
  const { id = "" } = useParams<{ id: string }>();

  const orderQuery = useQuery({
    queryKey: ["production_order", id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await db
        .from("production_orders")
        .select("*, items(nome, unidade)")
        .eq("id", id)
        .single();
      if (error) throw error;
      return data as any;
    },
  });

  const subProductsQuery = useProductionOrderItems(id);
  const subProducts = subProductsQuery.data || [];

  const completeOrder = useCompleteProductionOrder();
  const startOrder = useStartProductionOrder();
  const setShipping = useSetShippingInfo();
  const markReceived = useMarkReceived();
  const revertToPlanned = useRevertToPlanned();
  const setMontador = useSetOrderMontador();
  const { data: people = [] } = useQuery<{ id: string; displayName: string }[]>({
    queryKey: ["operators", "todos"],
    enabled: canManage,
    queryFn: async () => {
      const response = await fetch("/api/operators?todos=1", { credentials: "same-origin" });
      if (!response.ok) throw new Error("Não foi possível carregar os usuários.");
      return response.json();
    },
  });

  const handleMontadorChange = async (userId: string) => {
    if (!userId || !order) return;
    try {
      await setMontador.mutateAsync({ orderId: order.id, userId });
      toast.success("Montador corrigido.");
    } catch (e: any) {
      toast.error(e.message || "Não foi possível corrigir o montador.");
    }
  };

  const [startDialogOpen, setStartDialogOpen] = useState(false);
  const [shippingOpen, setShippingOpen] = useState(false);
  const [receivedOpen, setReceivedOpen] = useState(false);

  const [shippingDate, setShippingDate] = useState("");
  const [carrier, setCarrier] = useState("");
  const [tracking, setTracking] = useState("");
  const [receivedDate, setReceivedDate] = useState("");

  const order = orderQuery.data;
  const canExecute = user.role !== 'OPERACIONAL' || order?.assigned_user_id === user.id;

  useEffect(() => {
    if (order) {
      setShippingDate(order.shipping_date || todayIso());
      setCarrier(order.carrier_name || "");
      setTracking(order.tracking_code || "");
      setReceivedDate(order.received_date || todayIso());
    }
  }, [order]);

  if (orderQuery.isLoading) return <LoadingSkeleton rows={4} />;
  if (!order) return <div className="text-muted-foreground">Ordem não encontrada.</div>;

  const displayStatus = getOrderDisplayStatus(order);
  const shippingStage = getShippingStage(order);
  const now = Date.now();
  const montagemStartedMs = order.montagem_started_at
    ? new Date(order.montagem_started_at).getTime()
    : order.started_at ? new Date(order.started_at).getTime() : null;
  const montagemCompletedMs = order.montagem_completed_at
    ? new Date(order.montagem_completed_at).getTime()
    : order.completed_at ? new Date(order.completed_at).getTime() : null;
  const queueMs = order.created_at ? new Date(order.created_at).getTime() : null;

  const tempoFilaSeg = queueMs != null
    ? Math.max(0, Math.round(((montagemStartedMs ?? now) - queueMs) / 1000))
    : null;
  const tempoMontagemSeg = montagemStartedMs != null
    ? Math.max(0, Math.round(((montagemCompletedMs ?? now) - montagemStartedMs) / 1000))
    : null;
  const tempoTotalSeg = queueMs != null
    ? Math.max(0, Math.round(((montagemCompletedMs ?? now) - queueMs) / 1000))
    : null;


  const handleStartConfirm = async ({ montador_nome }: { montador_nome: string }) => {
    try {
      await startOrder.mutateAsync({ order, montador_nome });
      toast.success("Montagem iniciada.");
      setStartDialogOpen(false);
    } catch (e: any) {
      toast.error(e.message, { duration: 8000, style: { whiteSpace: "pre-line" } });
    }
  };

  const handleComplete = async () => {
    try {
      await completeOrder.mutateAsync(order);
      toast.success(order.destino === "ESTOQUE"
        ? "Montagem concluída. Produto adicionado ao estoque."
        : "Montagem concluída. Informe os dados de envio.");
    } catch (e: any) {
      toast.error(e.message, { duration: 8000, style: { whiteSpace: "pre-line" } });
    }
  };

  const handleSaveShipping = async () => {
    try {
      await setShipping.mutateAsync({
        orderId: order.id,
        shipping_date: shippingDate,
        carrier_name: carrier.trim() || null,
        tracking_code: tracking.trim() || null,
      });
      toast.success("Dados de envio salvos.");
      setShippingOpen(false);
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const handleMarkReceived = async () => {
    try {
      await markReceived.mutateAsync({ orderId: order.id, received_date: receivedDate });
      toast.success("Recebimento registrado. Ordem concluída.");
      setReceivedOpen(false);
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" asChild>
          <Link to="/producao">
            <ArrowLeft className="h-4 w-4 mr-1" /> Voltar para Produção
          </Link>
        </Button>
      </div>

      {/* Cabeçalho */}
      <div className="glass-card p-5 space-y-4">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Factory className="h-3.5 w-3.5" />
              Ordem de Produção
              {subProducts.length > 1 && (
                <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-primary/15 text-primary">
                  Conjunto · {subProducts.length} produtos
                </span>
              )}
            </div>
            <h1 className="text-2xl font-semibold text-foreground mt-1">
              {getOrderDisplayName({
                nome_conjunto: (order as any).nome_conjunto,
                subs: subProducts.map((s) => ({
                  item_id: s.item_id,
                  quantidade: Number(s.quantidade),
                  nome_snapshot: s.nome_snapshot,
                  item: s.item ? { nome: s.item.nome } : null,
                })),
                fallbackName: order.items?.nome,
              })}
            </h1>
            <div className="text-sm text-muted-foreground mt-1">
              {subProducts.length <= 1 && (
                <>
                  Quantidade: <span className="text-foreground font-medium">{formatQuantity(order.quantidade, (order.items as any)?.unidade || "")}</span>
                  {" · "}
                </>
              )}
              Destino: <span className="text-foreground font-medium">{order.destino === "ESTOQUE" ? "Estoque" : "Cliente"}</span>
              {order.cliente && <> {" · "}Cliente: <span className="text-foreground font-medium">{order.cliente}</span></>}
            </div>
          </div>

          <div className="text-right space-y-2">
            <StatusBadge tone={displayStatus.tone}>{displayStatus.label}</StatusBadge>
            {canManage && order.status !== "PLANEJADA" ? (
              <label className="text-sm text-muted-foreground flex items-center justify-end gap-1.5">
                <User className="h-3.5 w-3.5" />
                Montador:
                <select
                  aria-label="Corrigir montador"
                  title="Admin e Coordenador podem corrigir o montador"
                  className="rounded-md border border-input bg-background px-2 py-1 text-foreground font-medium focus:border-primary focus:outline-none"
                  value={people.find((p) => p.displayName === order.montador_nome)?.id ?? ""}
                  disabled={setMontador.isPending}
                  onChange={(e) => handleMontadorChange(e.target.value)}
                >
                  {!people.some((p) => p.displayName === order.montador_nome) && (
                    <option value="" disabled>{order.montador_nome || "Selecione"}</option>
                  )}
                  {people.map((p) => <option key={p.id} value={p.id}>{p.displayName}</option>)}
                </select>
              </label>
            ) : order.montador_nome && (
              <div className="text-sm text-muted-foreground flex items-center justify-end gap-1.5">
                <User className="h-3.5 w-3.5" />
                Montador: <span className="text-foreground font-medium">{order.montador_nome}</span>
              </div>
            )}
          </div>
        </div>

        {/* Sub-produtos */}
        {subProducts.length > 1 && (
          <div className="rounded-lg border border-border/60 bg-muted/15 p-3">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">
              Produtos vinculados ao conjunto
            </div>
            <ul className="space-y-1.5">
              {subProducts.map((sp) => (
                <li key={sp.id} className="flex items-center justify-between gap-3 text-sm">
                  <span className="text-foreground">{sp.item?.nome || sp.nome_snapshot || "—"}</span>
                  <span className="text-muted-foreground tabular-nums">
                    {formatQuantity(Number(sp.quantidade), sp.item?.unidade || "")}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Tempos */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-2 border-t border-border/50">
          <div className="rounded-lg border border-border/60 p-3">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Tempo na fila</p>
            <p className="mt-1 text-sm font-semibold text-foreground">{formatDuration(tempoFilaSeg)}</p>
          </div>
          <div className="rounded-lg border border-border/60 p-3">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Tempo de montagem</p>
            <p className="mt-1 text-sm font-semibold text-foreground">{formatDuration(tempoMontagemSeg)}</p>
          </div>
          <div className="rounded-lg border border-border/60 p-3">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Lead time total</p>
            <p className="mt-1 text-sm font-semibold text-foreground">{formatDuration(tempoTotalSeg)}</p>
          </div>
        </div>

        {/* Ações principais */}
        <div className="flex flex-wrap gap-2 pt-2">
          {canExecute && order.status === "PLANEJADA" && (
            <Button onClick={() => setStartDialogOpen(true)} className="gap-2">
              <Play className="h-4 w-4" /> Montar
            </Button>
          )}
          {canExecute && order.status === "EM_PRODUCAO" && (
            <>
              <Button onClick={handleComplete} disabled={completeOrder.isPending} className="gap-2">
                <CheckCircle2 className="h-4 w-4" /> Concluir montagem
              </Button>
              {canManage && <Button variant="ghost" onClick={async () => {
                try { await revertToPlanned.mutateAsync(order.id); toast.success("Voltou para Planejada."); }
                catch (e: any) { toast.error(e.message); }
              }}>
                Voltar para Planejada
              </Button>}
            </>
          )}
        </div>
      </div>

      {/* Envio */}
      {order.status === "CONCLUIDA" && order.destino === "CLIENTE" && (
        <div className="glass-card p-5 space-y-3">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <h2 className="text-base font-semibold text-foreground flex items-center gap-2">
                <Truck className="h-4 w-4 text-primary" /> Envio ao cliente
              </h2>
              <p className="text-xs text-muted-foreground mt-0.5">Informe os dados de envio e marque o recebimento.</p>
            </div>
            {canManage && <div className="flex gap-2">
              {shippingStage === "AGUARDANDO_ENVIO" && (
                <Button onClick={() => setShippingOpen(true)} className="gap-2">
                  <Truck className="h-4 w-4" /> Informar envio
                </Button>
              )}
              {shippingStage === "EM_ENVIO" && (
                <>
                  <Button variant="outline" onClick={() => setShippingOpen(true)} className="gap-2">
                    <Truck className="h-4 w-4" /> Editar envio
                  </Button>
                  <Button onClick={() => setReceivedOpen(true)} className="gap-2">
                    <PackageCheck className="h-4 w-4" /> Marcar recebido
                  </Button>
                </>
              )}
            </div>}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
            <div className="rounded-lg bg-muted/20 p-3">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Data de envio</p>
              <p className="mt-1 font-medium text-foreground">{formatDate(order.shipping_date)}</p>
            </div>
            <div className="rounded-lg bg-muted/20 p-3">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Data de recebimento</p>
              <p className="mt-1 font-medium text-foreground">{formatDate(order.received_date)}</p>
            </div>
            <div className="rounded-lg bg-muted/20 p-3">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Transportadora</p>
              <p className="mt-1 font-medium text-foreground">{order.carrier_name || "—"}</p>
            </div>
            <div className="rounded-lg bg-muted/20 p-3">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Rastreio</p>
              <p className="mt-1 font-medium text-foreground">{order.tracking_code || "—"}</p>
            </div>
          </div>
        </div>
      )}

      {/* Marcos */}
      <div className="glass-card p-5">
        <h2 className="text-base font-semibold text-foreground mb-3 flex items-center gap-2">
          <Clock className="h-4 w-4 text-muted-foreground" /> Marcos
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
          <div><span className="text-muted-foreground">Criada:</span> <span className="text-foreground">{formatDateTime(order.created_at)}</span></div>
          <div><span className="text-muted-foreground">Início da montagem:</span> <span className="text-foreground">{formatDateTime(order.montagem_started_at || order.started_at)}</span></div>
          <div><span className="text-muted-foreground">Conclusão da montagem:</span> <span className="text-foreground">{formatDateTime(order.montagem_completed_at || order.completed_at)}</span></div>
          {order.destino === "CLIENTE" && (
            <>
              <div><span className="text-muted-foreground">Envio:</span> <span className="text-foreground">{formatDate(order.shipping_date)}</span></div>
              <div><span className="text-muted-foreground">Recebimento:</span> <span className="text-foreground">{formatDate(order.received_date)}</span></div>
            </>
          )}
        </div>
      </div>

      <StartProductionDialog
        open={startDialogOpen}
        onOpenChange={setStartDialogOpen}
        produtoNome={order.items?.nome}
        isSubmitting={startOrder.isPending}
        fixedMontador={user.displayName}
        onConfirm={handleStartConfirm}
      />

      <Dialog open={shippingOpen} onOpenChange={setShippingOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Truck className="h-5 w-5 text-primary" /> Informar envio</DialogTitle>
            <DialogDescription>Registre os dados do envio ao cliente.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label htmlFor="ship-date">Data de envio</Label>
              <Input id="ship-date" type="date" value={shippingDate} onChange={(e) => setShippingDate(e.target.value)} className="mt-1.5" />
            </div>
            <div>
              <Label htmlFor="carrier">Transportadora</Label>
              <Input id="carrier" value={carrier} onChange={(e) => setCarrier(e.target.value)} placeholder="Ex: Correios" className="mt-1.5" />
            </div>
            <div>
              <Label htmlFor="tracking">Código de rastreio</Label>
              <Input id="tracking" value={tracking} onChange={(e) => setTracking(e.target.value)} placeholder="Ex: BR123456789" className="mt-1.5" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setShippingOpen(false)} disabled={setShipping.isPending}>Cancelar</Button>
            <Button onClick={handleSaveShipping} disabled={!shippingDate || setShipping.isPending}>Salvar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={receivedOpen} onOpenChange={setReceivedOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><PackageCheck className="h-5 w-5 text-primary" /> Marcar como recebido</DialogTitle>
            <DialogDescription>Informe a data em que o cliente recebeu o produto.</DialogDescription>
          </DialogHeader>
          <div>
            <Label htmlFor="recv-date">Data de recebimento</Label>
            <Input id="recv-date" type="date" value={receivedDate} onChange={(e) => setReceivedDate(e.target.value)} className="mt-1.5" />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setReceivedOpen(false)} disabled={markReceived.isPending}>Cancelar</Button>
            <Button onClick={handleMarkReceived} disabled={!receivedDate || markReceived.isPending}>Confirmar recebimento</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
