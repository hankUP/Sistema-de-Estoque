import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { db } from "@/db/client";
export type ProductionStatus =
  | "PLANEJADA"
  | "EM_PRODUCAO"
  | "CONCLUIDA";

export type ShippingStage =
  | "NAO_APLICAVEL"
  | "AGUARDANDO_ENVIO"
  | "EM_ENVIO"
  | "ENVIADO_RECEBIDO";

export type ProductionDestino = "ESTOQUE" | "CLIENTE";

export type ProductionOrder = {
  id: string;
  item_id: string;
  quantidade: number;
  status: ProductionStatus;
  current_completion_id?: string | null;
  data: string;
  created_at: string;
  ordem: number;
  cliente: string | null;
  centro_custo_id: string | null;
  concluida_em: string | null;
  destino: ProductionDestino;
  /** Quando a OP entrou na fila de produção (default = momento da criação). */
  queue_created_at?: string | null;
  /** Hora de início da produção (clique em Iniciar). */
  started_at?: string | null;
  /** Hora de conclusão da produção (clique em Concluir). */
  completed_at?: string | null;
  /** Tempo total bruto da produção em segundos. */
  tempo_total_seg?: number | null;
  /** Tempo produtivo total (soma das etapas) em segundos. */
  tempo_produtivo_total_seg?: number | null;
  /** Hora de início do envio ao cliente. */
  envio_started_at?: string | null;
  /** Hora em que o cliente recebeu o envio. */
  envio_completed_at?: string | null;
  /** Nome do montador principal da OP. */
  montador_nome?: string | null;
  assigned_user_id?: string | null;
  /** Modo de execução: SIMPLIFICADO (1 montador faz tudo) ou DETALHADO (montador por etapa). */
  modo_execucao?: "SIMPLIFICADO" | "DETALHADO" | null;
  /** Início da montagem (novo fluxo simplificado). */
  montagem_started_at?: string | null;
  /** Conclusão da montagem (novo fluxo simplificado). */
  montagem_completed_at?: string | null;
  /** Tempo total de montagem em segundos. */
  tempo_montagem_seg?: number | null;
  /** Envio (fluxo simplificado, destino = CLIENTE). */
  shipping_date?: string | null;
  carrier_name?: string | null;
  tracking_code?: string | null;
  received_date?: string | null;
  items?: { nome: string };
};

export function getShippingStage(order: Pick<ProductionOrder, "destino" | "completed_at" | "envio_started_at" | "envio_completed_at" | "shipping_date" | "received_date">): ShippingStage {
  if (order.destino !== "CLIENTE" || !order.completed_at) return "NAO_APLICAVEL";
  if (order.received_date || order.envio_completed_at) return "ENVIADO_RECEBIDO";
  if (order.shipping_date || order.envio_started_at) return "EM_ENVIO";
  return "AGUARDANDO_ENVIO";
}

export function getOrderDisplayStatus(order: Pick<ProductionOrder, "status" | "destino" | "completed_at" | "envio_started_at" | "envio_completed_at" | "shipping_date" | "received_date">) {
  const shippingStage = getShippingStage(order);

  if (order.status === "PLANEJADA") return { label: "Planejada", tone: "muted" as const };
  if (order.status === "EM_PRODUCAO") return { label: "Em montagem", tone: "warning" as const };

  if (shippingStage === "AGUARDANDO_ENVIO") return { label: "Aguardando envio", tone: "warning" as const };
  if (shippingStage === "EM_ENVIO") return { label: "Em transporte", tone: "primary" as const };
  if (shippingStage === "ENVIADO_RECEBIDO") return { label: "Recebido", tone: "success" as const };

  return { label: "Concluída", tone: "success" as const };
}

export function useProductionOrders() {
  return useQuery({
    queryKey: ["production_orders"],
    queryFn: async () => {
      const { data, error } = await db
        .from("production_orders")
        .select("*, items(nome, unidade)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as ProductionOrder[];
    },
  });
}

/**
 * Cria uma OP. Aceita:
 * - Forma simples: { item_id, quantidade, ... } — gera 1 sub-produto.
 * - Forma composta: { items: [{ item_id, quantidade }, ...], nome_conjunto?, ... }
 *   — gera N sub-produtos. O `item_id` da OP recebe o primeiro sub-produto
 *   (compatibilidade com código legado) e a `quantidade` recebe a soma.
 */
export type CreateProductionOrderInput = {
  cliente?: string | null;
  centro_custo_id: string;
  ordem?: number;
  destino?: ProductionDestino;
  nome_conjunto?: string | null;
} & (
  | { item_id: string; quantidade: number; items?: undefined }
  | { items: Array<{ item_id: string; quantidade: number }>; item_id?: undefined; quantidade?: undefined }
);

export function useCreateProductionOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (po: CreateProductionOrderInput) => {
      const subProducts = "items" in po && po.items
        ? po.items
        : [{ item_id: (po as any).item_id, quantidade: (po as any).quantidade }];

      if (subProducts.length === 0) {
        throw new Error("A OP precisa de ao menos um produto.");
      }

      const principal = subProducts[0];
      const totalQty = subProducts.reduce((s, p) => s + Number(p.quantidade), 0);

      const orderInsert: any = {
        cliente: po.cliente ?? null,
        centro_custo_id: po.centro_custo_id,
        ordem: po.ordem,
        destino: po.destino,
        nome_conjunto: po.nome_conjunto ?? null,
        item_id: principal.item_id,
        quantidade: totalQty,
      };
      Object.keys(orderInsert).forEach((k) => orderInsert[k] === undefined && delete orderInsert[k]);

      const { data: created, error } = await db
        .from("production_orders")
        .insert(orderInsert)
        .select("id")
        .single();
      if (error) throw error;

      // Carrega nomes para snapshot
      const ids = subProducts.map((p) => p.item_id);
      const { data: itemsData } = await db
        .from("items")
        .select("id,nome")
        .in("id", ids);
      const nameMap = new Map<string, string>();
      (itemsData || []).forEach((i: any) => nameMap.set(i.id, i.nome));

      // Remove a linha auto-criada pelo trigger e insere as linhas reais
      // (suporta OPs compostas com múltiplos sub-produtos).
      await db
        .from("production_order_items" as any)
        .delete()
        .eq("production_order_id", (created as any).id);

      const subRows = subProducts.map((p, idx) => ({
        production_order_id: (created as any).id,
        item_id: p.item_id,
        quantidade: p.quantidade,
        ordem: idx,
        nome_snapshot: nameMap.get(p.item_id) ?? null,
      }));
      const { error: subErr } = await db
        .from("production_order_items" as any)
        .insert(subRows as any);
      if (subErr) throw subErr;

      return (created as any).id as string;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["production_orders"] });
      qc.invalidateQueries({ queryKey: ['work_queue_availability'] });
      qc.invalidateQueries({ queryKey: ["production_order_items"] });
      qc.invalidateQueries({ queryKey: ["stock"] });
    },
  });
}

export type CompleteOrderArg = ProductionOrder | { order: ProductionOrder; quickComplete?: boolean };

export function useCompleteProductionOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (arg: CompleteOrderArg) => {
      const order = (arg as { order?: ProductionOrder }).order ?? arg as ProductionOrder;
      const { error } = await db.rpc('complete_production_order', { _id: order.id });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['production_orders'] });
      qc.invalidateQueries({ queryKey: ['work_queue_availability'] });
      qc.invalidateQueries({ queryKey: ['movements'] });
      qc.invalidateQueries({ queryKey: ['stock'] });
      qc.invalidateQueries({ queryKey: ['production_order_stages'] });
      qc.invalidateQueries({ queryKey: ['production_stages_summary'] });
    },
  });
}

export type StartProductionInput = {
  order: ProductionOrder;
  montador_nome: string;
  /** @deprecated não usado no fluxo simplificado. Mantido para compatibilidade. */
  modo_execucao?: "SIMPLIFICADO" | "DETALHADO";
};

export function useStartProductionOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ order, montador_nome, modo_execucao }: StartProductionInput) => {
      const { error } = await db.rpc('start_production_order', {
        _id: order.id, _responsavel: montador_nome, _modo_execucao: modo_execucao ?? null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['production_orders'] });
      qc.invalidateQueries({ queryKey: ['work_queue_availability'] });
      qc.invalidateQueries({ queryKey: ['production_order_stages'] });
      qc.invalidateQueries({ queryKey: ['production_stages_summary'] });
      qc.invalidateQueries({ queryKey: ['stock'] });
    },
  });
}

export function useDeleteProductionOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await db
        .from("production_orders")
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["production_orders"] });
      qc.invalidateQueries({ queryKey: ['work_queue_availability'] });
      qc.invalidateQueries({ queryKey: ["stock"] });
    },
  });
}

/**
 * Reverts a production order from EM_PRODUCAO back to PLANEJADA.
 * Used when the user mistakenly started production. Trigger will
 * recreate component reservations automatically.
 */
export function useRevertToPlanned() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await db
        .from("production_orders")
        .update({ status: "PLANEJADA" as const })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["production_orders"] });
      qc.invalidateQueries({ queryKey: ['work_queue_availability'] });
      qc.invalidateQueries({ queryKey: ["stock"] });
    },
  });
}

/** Reverte a conclusão e suas movimentações rastreadas em uma transação. */
export function useRevertCompletion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (order: ProductionOrder) => {
      const { error } = await db.rpc('revert_production_completion', { _id: order.id });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['production_orders'] });
      qc.invalidateQueries({ queryKey: ['work_queue_availability'] });
      qc.invalidateQueries({ queryKey: ['movements'] });
      qc.invalidateQueries({ queryKey: ['stock'] });
    },
  });
}

// ---------------------------------------------------------------------------
// Fluxo simplificado de envio (destino = CLIENTE)
// ---------------------------------------------------------------------------

/**
 * Salva dados de envio simplificados (data, transportadora, rastreio).
 * Não usa cronômetro. Apenas registra informações operacionais.
 */
export function useSetShippingInfo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      orderId,
      shipping_date,
      carrier_name,
      tracking_code,
    }: {
      orderId: string;
      shipping_date: string | null;
      carrier_name: string | null;
      tracking_code: string | null;
    }) => {
      const { error } = await db
        .from("production_orders")
        .update({ shipping_date, carrier_name, tracking_code } as any)
        .eq("id", orderId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["production_orders"] });
      qc.invalidateQueries({ queryKey: ["production_order"] });
    },
  });
}

/**
 * Marca a OP como recebida pelo cliente, encerrando o fluxo de envio.
 */
export function useMarkReceived() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      orderId,
      received_date,
    }: {
      orderId: string;
      received_date: string;
    }) => {
      const { error } = await db
        .from("production_orders")
        .update({ received_date, status: "CONCLUIDA" as const } as any)
        .eq("id", orderId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["production_orders"] });
      qc.invalidateQueries({ queryKey: ["production_order"] });
    },
  });
}
