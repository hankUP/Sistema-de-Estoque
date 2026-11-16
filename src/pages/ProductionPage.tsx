import { useEffect, useMemo, useState } from "react";
import {
  useProductionOrders,
  useCompleteProductionOrder,
  useStartProductionOrder,
  useRevertToPlanned,
  useRevertCompletion,
  useSetShippingInfo,
  useMarkReceived,
  getOrderDisplayStatus,
  getShippingStage,
} from "@/hooks/useProductionOrders";
import { useQueueAvailability } from "@/hooks/useQueueAvailability";
import { formatDurationCompact } from "@/hooks/useProductionStages";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LoadingSkeleton, EmptyState } from "@/components/LoadingAndEmpty";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { toast } from "sonner";
import {
  Factory,
  Undo2,
  Clock,
  AlertTriangle,
  CheckCircle2,
  Info,
  ArrowRightLeft,
  Truck,
  PackageCheck,
  ExternalLink,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Link } from "react-router-dom";
import { StartProductionDialog } from "@/components/StartProductionDialog";
import { SubstituteItemDialog } from "@/components/SubstituteItemDialog";
import { useProductionSubstitutions } from "@/hooks/useProductionSubstitutions";
import { formatQuantity } from "@/lib/quantity";
import { useAllProductionOrderItemsMap } from "@/hooks/useProductionOrderItems";
import { getOrderDisplayName } from "@/lib/orderDisplay";
import { KitWorkflowSection } from "@/components/KitWorkflowSection";
import { useAuth } from '@/auth';
import { db } from '@/db/client';
import { useQuery, useQueryClient } from '@tanstack/react-query';

function todayIso() {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export default function ProductionPage() {
  const user = useAuth();
  const canExecute = user.role !== 'OPERACIONAL';
  const canManage = user.role === 'ADMIN' || user.role === 'COORDENADOR';
  const queryClient = useQueryClient();
  const { data: operators = [] } = useQuery<{ id: string; displayName: string; role: string }[]>({
    queryKey: ['operators'], enabled: canManage,
    queryFn: async () => {
      const response = await fetch('/api/operators', { credentials: 'same-origin' });
      if (!response.ok) throw new Error('Não foi possível carregar responsáveis.');
      return response.json();
    },
  });
  const { data: orders, isLoading } = useProductionOrders();
  const availability = useQueueAvailability();
  const completeOrder = useCompleteProductionOrder();
  const startOrder = useStartProductionOrder();
  const revertToPlanned = useRevertToPlanned();
  const revertCompletion = useRevertCompletion();
  const setShipping = useSetShippingInfo();
  const markReceived = useMarkReceived();
  const { data: allSubstitutions } = useProductionSubstitutions();
  const { map: subProductsByOp } = useAllProductionOrderItemsMap();

  const [startDialog, setStartDialog] = useState<any | null>(null);
  const [substituteDialog, setSubstituteDialog] = useState<any | null>(null);
  const [shippingDialog, setShippingDialog] = useState<any | null>(null);
  const [receivedDialog, setReceivedDialog] = useState<any | null>(null);

  const [, setNowTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setNowTick((n) => n + 1), 60_000);
    return () => clearInterval(id);
  }, []);

  const visibleOrders = useMemo(() => {
    return (orders || [])
      .filter((o: any) => {
        const shippingStage = getShippingStage(o);
        return o.status === "PLANEJADA" || o.status === "EM_PRODUCAO" || (o.status === "CONCLUIDA" && shippingStage !== "ENVIADO_RECEBIDO");
      })
      .sort((a: any, b: any) => {
        const aActive = a.status === "PLANEJADA" || a.status === "EM_PRODUCAO";
        const bActive = b.status === "PLANEJADA" || b.status === "EM_PRODUCAO";
        if (aActive && !bActive) return -1;
        if (!aActive && bActive) return 1;
        if (aActive && bActive) return (a.ordem ?? 0) - (b.ordem ?? 0);
        return new Date(b.completed_at || b.created_at).getTime() - new Date(a.completed_at || a.created_at).getTime();
      });
  }, [orders]);

  const handleConfirmStart = async ({ montador_nome }: { montador_nome: string }) => {
    if (!startDialog) return;
    try {
      await startOrder.mutateAsync({ order: startDialog, montador_nome });
      toast.success("Montagem iniciada!");
      setStartDialog(null);
    } catch (e: any) {
      toast.error(e.message, { duration: 8000, style: { whiteSpace: "pre-line" } });
    }
  };

  const handleAssign = async (orderId: string, assignedUserId: string) => {
    const { error } = await db.from('production_orders')
      .update({ assigned_user_id: assignedUserId || null }).eq('id', orderId);
    if (error) { toast.error(error.message); return; }
    await queryClient.invalidateQueries({ queryKey: ['production_orders'] });
    toast.success('Responsável atualizado.');
  };

  const handleComplete = async (order: any) => {
    try {
      await completeOrder.mutateAsync(order);
      if (order.destino === "ESTOQUE") {
        toast.success("Montagem concluída! Produto adicionado ao estoque.");
      } else {
        toast.success("Montagem concluída! Informe os dados de envio.");
      }
    } catch (e: any) {
      toast.error(e.message, { duration: 8000, style: { whiteSpace: "pre-line" } });
    }
  };

  const handleRevertToPlanned = async (id: string) => {
    try {
      await revertToPlanned.mutateAsync(id);
      toast.success("Status revertido para Planejada. Reservas recriadas.");
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const handleRevertConcluida = async (order: any) => {
    if (!confirm(`Reverter para "Em montagem" irá DESFAZER as movimentações de estoque desta ordem. Continuar?`)) return;
    try {
      await revertCompletion.mutateAsync(order);
      toast.success("Ordem revertida. Estoque ajustado.");
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  return (
    <div className="space-y-5">
      <div className="glass-card p-4 text-xs text-muted-foreground space-y-1">
        <div>Produtos com estrutura BOM entram na <Link to="/pedidos" className="text-primary underline">fila de montagem</Link>. {canManage && <>Cadastre a estrutura e envie o produto em <Link to="/estrutura" className="text-primary underline">Estruturas (BOM)</Link>.</>}</div>
        <div className="flex items-start gap-1.5 pt-1">
          <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          <span>As ordens usam a prioridade da <Link to="/pedidos" className="text-primary underline">Fila de Montagem</Link> e disputam os mesmos componentes.</span>
        </div>
      </div>

      {canManage && <KitWorkflowSection mode="producao" />}

      <h2 className="text-sm font-semibold text-foreground">Ordens com BOM</h2>
      {isLoading ? <LoadingSkeleton rows={3} /> : (
        <div className="glass-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className="px-4 py-3 text-muted-foreground font-medium text-left">Fila</th>
                  <th className="px-4 py-3 text-muted-foreground font-medium text-left">Data Criação</th>
                  <th className="px-4 py-3 text-muted-foreground font-medium text-left">Produto</th>
                  <th className="px-4 py-3 text-muted-foreground font-medium text-left">Destino</th>
                  <th className="px-4 py-3 text-muted-foreground font-medium text-left">Cliente</th>
                  <th className="px-4 py-3 text-muted-foreground font-medium text-right">Quantidade</th>
                  <th className="px-4 py-3 text-muted-foreground font-medium text-left">Disponibilidade</th>
                  <th className="px-4 py-3 text-muted-foreground font-medium text-left">Montador</th>
                  <th className="px-4 py-3 text-muted-foreground font-medium text-left">Tempo</th>
                  <th className="px-4 py-3 text-muted-foreground font-medium text-center">Status</th>
                  <th className="px-4 py-3 text-muted-foreground font-medium text-right">Ações</th>
                </tr>
              </thead>
              <tbody>
                {visibleOrders.map((o: any) => {
                  const now = Date.now();
                  const avail = availability.get(o.id);
                  const isActive = o.status === "PLANEJADA" || o.status === "EM_PRODUCAO";

                  const queueCreatedAt = o.created_at ? new Date(o.created_at).getTime() : null;
                  const startedAt = o.montagem_started_at ? new Date(o.montagem_started_at).getTime() : (o.started_at ? new Date(o.started_at).getTime() : null);
                  const completedAt = o.montagem_completed_at ? new Date(o.montagem_completed_at).getTime() : (o.completed_at ? new Date(o.completed_at).getTime() : null);

                  const tempoFilaSeg = queueCreatedAt != null
                    ? Math.max(0, Math.round(((startedAt ?? now) - queueCreatedAt) / 1000))
                    : null;
                  const tempoMontagemSeg = startedAt != null
                    ? Math.max(0, Math.round(((completedAt ?? now) - startedAt) / 1000))
                    : null;
                  const tempoTotalSeg = queueCreatedAt != null
                    ? Math.max(0, Math.round(((completedAt ?? now) - queueCreatedAt) / 1000))
                    : null;

                  const displayStatus = getOrderDisplayStatus(o);
                  const shippingStage = getShippingStage(o);

                  return (
                  <tr key={o.id} className="border-b border-border/30 hover:bg-accent/30 transition-colors">
                    <td className="px-4 py-3 text-foreground">
                      {isActive && avail ? (
                        <span className="inline-flex items-center justify-center min-w-[28px] h-6 px-2 rounded bg-muted text-foreground text-xs font-semibold">
                          #{avail.queue_position}
                        </span>
                      ) : (
                        <span className="text-muted-foreground text-xs">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-foreground">{new Date(o.data).toLocaleDateString("pt-BR")}</td>
                    <td className="px-4 py-3 text-foreground font-medium">
                      {(() => {
                        const subs = subProductsByOp.get(o.id) || [];
                        const composta = subs.length > 1;
                        const displayName = getOrderDisplayName({
                          nome_conjunto: (o as any).nome_conjunto,
                          subs: subs.map((s) => ({
                            item_id: s.item_id,
                            quantidade: Number(s.quantidade),
                            nome_snapshot: s.nome_snapshot,
                            item: s.item ? { nome: s.item.nome } : null,
                          })),
                          fallbackName: o.items?.nome,
                        });
                        return (
                          <div className="space-y-1">
                            <div>{displayName}</div>
                            {composta && (
                              <div className="flex flex-wrap gap-1">
                                <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-primary/15 text-primary">
                                  Conjunto · {subs.length}
                                </span>
                                {subs.map((sp) => (
                                  <span key={sp.id} className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] bg-muted text-muted-foreground">
                                    {Number(sp.quantidade)}× {sp.item?.nome || sp.nome_snapshot || "—"}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })()}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-block px-2 py-0.5 rounded text-[10px] font-medium ${
                        o.destino === "ESTOQUE" ? "bg-primary/15 text-primary" : "bg-accent text-accent-foreground"
                      }`}>
                        {o.destino === "ESTOQUE" ? "Estoque" : "Cliente"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-foreground">{o.cliente || <span className="text-muted-foreground">—</span>}</td>
                    <td className="px-4 py-3 text-right text-foreground tabular-nums">{formatQuantity(o.quantidade, (o as any).items?.unidade || "")}</td>
                    <td className="px-4 py-3">
                      {(() => {
                        const subsForOp = (allSubstitutions || []).filter((s) => s.production_order_id === o.id);
                        return (
                          <div className="space-y-1">
                            {isActive && avail ? (
                              avail.can_start ? (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-success/12 text-success">
                                  <CheckCircle2 className="h-3 w-3" /> Pronta
                                </span>
                              ) : (
                                <TooltipProvider delayDuration={150}>
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-destructive/12 text-destructive cursor-help">
                                        <AlertTriangle className="h-3 w-3" /> Falta insumo
                                      </span>
                                    </TooltipTrigger>
                                    <TooltipContent side="top" className="max-w-xs">
                                      <ul className="text-xs space-y-0.5">
                                        {avail.missing_components.map((m) => (
                                          <li key={m.itemId}>• {m.nome}: faltam {m.faltando}</li>
                                        ))}
                                      </ul>
                                    </TooltipContent>
                                  </Tooltip>
                                </TooltipProvider>
                              )
                            ) : (
                              <span className="text-muted-foreground text-xs">—</span>
                            )}
                            {subsForOp.length > 0 && (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-primary/12 text-primary">
                                <ArrowRightLeft className="h-3 w-3" /> {subsForOp.length} substituição{subsForOp.length > 1 ? "ões" : ""}
                              </span>
                            )}
                          </div>
                        );
                      })()}
                    </td>
                    <td className="px-4 py-3 text-foreground text-xs">
                      {o.montador_nome || <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className="px-4 py-3 text-foreground text-xs">
                      {o.status === "PLANEJADA" && tempoFilaSeg != null ? (
                        <div className="flex items-center gap-1.5 text-muted-foreground">
                          <Clock className="h-3 w-3" />
                          <span>Na fila há <span className="text-foreground font-medium">{formatDurationCompact(tempoFilaSeg)}</span></span>
                        </div>
                      ) : (o.status === "EM_PRODUCAO" || o.status === "CONCLUIDA") && tempoTotalSeg != null ? (
                        <div className="space-y-0.5">
                          <div className="flex items-center gap-1.5 text-foreground font-medium">
                            <Clock className="h-3 w-3 text-muted-foreground" />
                            <span>Total: {formatDurationCompact(tempoTotalSeg)}</span>
                          </div>
                          <div className="text-[11px] text-muted-foreground pl-4">
                            Fila: {formatDurationCompact(tempoFilaSeg)} · Montagem: {formatDurationCompact(tempoMontagemSeg)}
                          </div>
                        </div>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-semibold ${
                        displayStatus.tone === "success" ? "bg-success/12 text-success" :
                        displayStatus.tone === "warning" ? "bg-warning/12 text-warning" :
                        displayStatus.tone === "primary" ? "bg-primary/12 text-primary" :
                        "bg-muted text-muted-foreground"
                      }`}>
                        {displayStatus.label}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right space-x-2 whitespace-nowrap">
                      {canManage && o.status === 'PLANEJADA' && (
                        <select aria-label={`Responsável pela ordem ${o.id}`} value={o.assigned_user_id || ''}
                          onChange={(event) => void handleAssign(o.id, event.target.value)}
                          className="max-w-40 rounded-md border border-border bg-background px-2 py-1.5 text-xs">
                          <option value="">Sem responsável</option>
                          {operators.map((operator) => <option key={operator.id} value={operator.id}>{operator.displayName}</option>)}
                        </select>
                      )}
                      {(canExecute || o.assigned_user_id === user.id) && o.status === "PLANEJADA" && (
                        <div className="inline-flex items-center gap-2">
                          <Button variant="default" size="sm" onClick={() => setStartDialog(o)}>Montar</Button>
                          {canExecute && <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setSubstituteDialog(o)}
                            title="Substituir componentes da BOM"
                          >
                            <ArrowRightLeft className="h-3.5 w-3.5" />
                          </Button>}
                        </div>
                      )}
                      {(canExecute || o.assigned_user_id === user.id) && o.status === "EM_PRODUCAO" && (
                        <>
                          <Button variant="default" size="sm" onClick={() => handleComplete(o)}>
                            <CheckCircle2 className="h-3.5 w-3.5 mr-1" /> Concluir montagem
                          </Button>
                          {canManage && <Button variant="ghost" size="sm" onClick={() => handleRevertToPlanned(o.id)} title="Voltar para Planejada">
                            <Undo2 className="h-3.5 w-3.5" />
                          </Button>}
                        </>
                      )}
                      {canManage && o.status === "CONCLUIDA" && shippingStage === "AGUARDANDO_ENVIO" && (
                        <>
                          <Button variant="default" size="sm" onClick={() => setShippingDialog(o)}>
                            <Truck className="h-3.5 w-3.5 mr-1" /> Informar envio
                          </Button>
                          <Button variant="ghost" size="sm" disabled={!o.current_completion_id} onClick={() => handleRevertConcluida(o)} title={o.current_completion_id ? 'Voltar para Em montagem' : 'Conclusão antiga: reversão manual necessária'}>
                            <Undo2 className="h-3.5 w-3.5" />
                          </Button>
                        </>
                      )}
                      {canManage && o.status === "CONCLUIDA" && shippingStage === "EM_ENVIO" && (
                        <>
                          <Button variant="default" size="sm" onClick={() => setReceivedDialog(o)}>
                            <PackageCheck className="h-3.5 w-3.5 mr-1" /> Marcar recebido
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => setShippingDialog(o)} title="Editar dados de envio">
                            <Truck className="h-3.5 w-3.5" />
                          </Button>
                        </>
                      )}
                      {canManage && o.status === "CONCLUIDA" && shippingStage === "NAO_APLICAVEL" && (
                        <Button variant="ghost" size="sm" disabled={!o.current_completion_id} onClick={() => handleRevertConcluida(o)} title={o.current_completion_id ? 'Voltar para Em montagem' : 'Conclusão antiga: reversão manual necessária'}>
                          <Undo2 className="h-3.5 w-3.5 mr-1" /> Voltar
                        </Button>
                      )}
                      <Button variant="ghost" size="sm" asChild>
                        <Link to={`/producao/${o.id}`} title="Abrir detalhes">
                          <ExternalLink className="h-3.5 w-3.5" />
                        </Link>
                      </Button>
                    </td>
                  </tr>
                  );
                })}
                {visibleOrders.length === 0 && (
                  <tr><td colSpan={11} className="p-0">
                    <EmptyState icon={Factory} title="Nenhuma ordem de produção" description="Crie uma nova ordem na Fila de Pedidos." />
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <StartProductionDialog
        open={!!startDialog}
        onOpenChange={(o) => !o && setStartDialog(null)}
        produtoNome={startDialog?.items?.nome}
        isSubmitting={startOrder.isPending}
        fixedMontador={user.displayName}
        onConfirm={handleConfirmStart}
      />

      <SubstituteItemDialog
        open={!!substituteDialog}
        onOpenChange={(o) => !o && setSubstituteDialog(null)}
        order={substituteDialog}
      />

      <ShippingInfoDialog
        order={shippingDialog}
        onClose={() => setShippingDialog(null)}
        onSave={async (data) => {
          if (!shippingDialog) return;
          try {
            await setShipping.mutateAsync({ orderId: shippingDialog.id, ...data });
            toast.success("Dados de envio salvos.");
            setShippingDialog(null);
          } catch (e: any) {
            toast.error(e.message);
          }
        }}
        isSubmitting={setShipping.isPending}
      />

      <ReceivedDialog
        order={receivedDialog}
        onClose={() => setReceivedDialog(null)}
        onSave={async (received_date) => {
          if (!receivedDialog) return;
          try {
            await markReceived.mutateAsync({ orderId: receivedDialog.id, received_date });
            toast.success("Recebimento registrado. Ordem concluída.");
            setReceivedDialog(null);
          } catch (e: any) {
            toast.error(e.message);
          }
        }}
        isSubmitting={markReceived.isPending}
      />
    </div>
  );
}

function ShippingInfoDialog({
  order,
  onClose,
  onSave,
  isSubmitting,
}: {
  order: any | null;
  onClose: () => void;
  onSave: (data: { shipping_date: string; carrier_name: string | null; tracking_code: string | null }) => Promise<void>;
  isSubmitting?: boolean;
}) {
  const [shippingDate, setShippingDate] = useState("");
  const [carrier, setCarrier] = useState("");
  const [tracking, setTracking] = useState("");

  useEffect(() => {
    if (order) {
      setShippingDate(order.shipping_date || todayIso());
      setCarrier(order.carrier_name || "");
      setTracking(order.tracking_code || "");
    }
  }, [order]);

  return (
    <Dialog open={!!order} onOpenChange={(o) => !o && onClose()}>
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
          <Button variant="ghost" onClick={onClose} disabled={isSubmitting}>Cancelar</Button>
          <Button
            onClick={() => onSave({ shipping_date: shippingDate, carrier_name: carrier.trim() || null, tracking_code: tracking.trim() || null })}
            disabled={!shippingDate || isSubmitting}
          >
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ReceivedDialog({
  order,
  onClose,
  onSave,
  isSubmitting,
}: {
  order: any | null;
  onClose: () => void;
  onSave: (received_date: string) => Promise<void>;
  isSubmitting?: boolean;
}) {
  const [receivedDate, setReceivedDate] = useState("");

  useEffect(() => {
    if (order) setReceivedDate(order.received_date || todayIso());
  }, [order]);

  return (
    <Dialog open={!!order} onOpenChange={(o) => !o && onClose()}>
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
          <Button variant="ghost" onClick={onClose} disabled={isSubmitting}>Cancelar</Button>
          <Button onClick={() => onSave(receivedDate)} disabled={!receivedDate || isSubmitting}>Confirmar recebimento</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
