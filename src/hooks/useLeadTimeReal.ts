import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { db } from "@/db/client";
import { usePurchaseOrders } from "./usePurchaseOrders";

export type RecebimentoEvento = {
  id: string;
  purchase_order_id: string;
  quantidade: number;
  data_real: string;
  observacao: string | null;
  created_at: string;
};

export function useRecebimentos() {
  return useQuery({
    queryKey: ["purchase_order_recebimentos"],
    queryFn: async () => {
      const { data, error } = await db
        .from("purchase_order_recebimentos" as any)
        .select("*")
        .order("data_real", { ascending: true });
      if (error) throw error;
      return (data || []) as unknown as RecebimentoEvento[];
    },
  });
}

const DIA_MS = 1000 * 60 * 60 * 24;

export type LeadTimeRealStats = {
  /** Lead time médio real em dias (criação do pedido → último recebimento). */
  mediaDias: number;
  /** Número de pedidos completos considerados. */
  amostras: number;
  /** Lead time real do pedido mais recente. */
  ultimoDias: number | null;
};

/**
 * Estatísticas de lead time real.
 * - Considera apenas pedidos com status "RECEBIDO_COMPLETO" (ou legado "RECEBIDO").
 * - Lead time real = (data do último recebimento) − (created_at do pedido), em dias.
 * - Pode ser filtrado por fornecedor e/ou item.
 */
export function useLeadTimeReal(opts?: { fornecedorId?: string | null; itemId?: string | null }) {
  const { data: orders } = usePurchaseOrders();
  const { data: recebimentos } = useRecebimentos();

  const porPedidoUltima = useMemo(() => {
    const m = new Map<string, string>();
    (recebimentos || []).forEach((r) => {
      const cur = m.get(r.purchase_order_id);
      if (!cur || new Date(r.data_real) > new Date(cur)) m.set(r.purchase_order_id, r.data_real);
    });
    return m;
  }, [recebimentos]);

  return useMemo<LeadTimeRealStats>(() => {
    if (!orders) return { mediaDias: 0, amostras: 0, ultimoDias: null };
    const completos = orders.filter(
      (o) =>
        (o.status === "RECEBIDO_COMPLETO" || o.status === "RECEBIDO") &&
        (!opts?.fornecedorId || o.fornecedor_id === opts.fornecedorId) &&
        (!opts?.itemId || o.item_id === opts.itemId),
    );

    const leads: { dias: number; data: string }[] = [];
    completos.forEach((o) => {
      const ultima = porPedidoUltima.get(o.id);
      if (!ultima) return;
      const diff = (new Date(ultima).getTime() - new Date(o.created_at).getTime()) / DIA_MS;
      if (diff >= 0 && Number.isFinite(diff)) leads.push({ dias: diff, data: ultima });
    });

    if (leads.length === 0) return { mediaDias: 0, amostras: 0, ultimoDias: null };
    const media = leads.reduce((a, b) => a + b.dias, 0) / leads.length;
    const ultimo = [...leads].sort((a, b) => new Date(b.data).getTime() - new Date(a.data).getTime())[0];
    return { mediaDias: media, amostras: leads.length, ultimoDias: ultimo.dias };
  }, [orders, porPedidoUltima, opts?.fornecedorId, opts?.itemId]);
}
