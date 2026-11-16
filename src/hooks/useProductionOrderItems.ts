import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { db } from "@/db/client";

export type ProductionOrderItem = {
  id: string;
  production_order_id: string;
  item_id: string;
  quantidade: number;
  ordem: number;
  nome_snapshot: string | null;
  custo_snapshot: number | null;
  created_at: string;
  /** Hidratado no cliente */
  item?: { id: string; nome: string; unidade: string } | null;
};

/**
 * Hook para obter um Map<op_id, ProductionOrderItem[]> com TODOS os sub-produtos.
 * Útil para listar conjuntos na fila e na página de produção.
 */
export function useAllProductionOrderItemsMap() {
  const q = useProductionOrderItems();
  const map = new Map<string, ProductionOrderItem[]>();
  (q.data || []).forEach((r) => {
    const arr = map.get(r.production_order_id) || [];
    arr.push(r);
    map.set(r.production_order_id, arr);
  });
  return { ...q, map };
}

/**
 * Lista as linhas de production_order_items.
 * Sem orderId → todas (útil para a fila/produção). Com orderId → só dessa OP.
 */
export function useProductionOrderItems(orderId?: string) {
  return useQuery({
    queryKey: ["production_order_items", orderId ?? "all"],
    queryFn: async () => {
      let q = db
        .from("production_order_items" as any)
        .select("*")
        .order("ordem", { ascending: true })
        .order("created_at", { ascending: true });
      if (orderId) q = q.eq("production_order_id", orderId);
      const { data, error } = await q;
      if (error) throw error;
      const rows = ((data || []) as unknown) as ProductionOrderItem[];
      if (rows.length === 0) return rows;
      const ids = Array.from(new Set(rows.map((r) => r.item_id)));
      const { data: items } = await db
        .from("items")
        .select("id,nome,unidade")
        .in("id", ids);
      const map = new Map<string, any>();
      (items || []).forEach((it: any) => map.set(it.id, it));
      rows.forEach((r) => {
        r.item = map.get(r.item_id) || null;
      });
      return rows;
    },
  });
}

/**
 * Carrega os sub-produtos (production_order_items) de uma OP de forma direta.
 * Use dentro de mutations/loaders. Sempre retorna >= 1 linha (graças ao backfill).
 */
export async function loadOrderSubProducts(orderId: string) {
  const { data, error } = await db
    .from("production_order_items" as any)
    .select("id,item_id,quantidade,ordem,nome_snapshot")
    .eq("production_order_id", orderId)
    .order("ordem", { ascending: true });
  if (error) throw error;
  return (((data || []) as unknown) as Array<{
    id: string;
    item_id: string;
    quantidade: number;
    ordem: number;
    nome_snapshot: string | null;
  }>);
}

/** Lista TODAS as linhas como mapa op_id → linhas[]. */
export async function loadAllOrderSubProductsMap() {
  const { data, error } = await db
    .from("production_order_items" as any)
    .select("id,production_order_id,item_id,quantidade,ordem")
    .order("ordem", { ascending: true });
  if (error) throw error;
  const map = new Map<string, Array<{ id: string; item_id: string; quantidade: number }>>();
  (((data || []) as unknown) as any[]).forEach((r) => {
    const arr = map.get(r.production_order_id) || [];
    arr.push({ id: r.id, item_id: r.item_id, quantidade: Number(r.quantidade) });
    map.set(r.production_order_id, arr);
  });
  return map;
}
