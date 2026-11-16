import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { db } from "@/db/client";

export type PurchaseStatus =
  | "CRIADO"
  | "RECEBIDO_PARCIAL"
  | "RECEBIDO_COMPLETO"
  | "CANCELADO"
  // legados — mantidos para compatibilidade caso algum registro antigo escape
  | "ABERTO"
  | "PARCIAL"
  | "RECEBIDO";

export type PurchaseOrder = {
  id: string;
  item_id: string;
  fornecedor_id: string | null;
  centro_custo_id: string | null;
  quantidade: number;
  quantidade_recebida: number;
  preco_unitario: number | null;
  /** Frete do pedido inteiro (R$). Padrão 0. */
  frete: number;
  /** Impostos do pedido inteiro (R$). Padrão 0. */
  impostos: number;
  /** Outros custos adicionais do pedido inteiro (R$). Padrão 0. */
  outros_custos: number;
  status: PurchaseStatus;
  data_prevista: string | null;
  /** Embalagem usada NO MOMENTO do pedido (snapshot histórico). */
  unidade_compra_snapshot?: string | null;
  /** Fator de conversão usado NO MOMENTO do pedido (snapshot). */
  fator_conversao_snapshot?: number | null;
  /** Custo por unidade de estoque calculado NO MOMENTO do pedido (snapshot). */
  custo_unitario_estoque_snapshot?: number | null;
  created_at: string;
  items?: { nome: string };
  fornecedores?: { nome: string } | null;
};

/**
 * Calcula o preço efetivo unitário considerando o rateio dos custos adicionais
 * (frete + impostos + outros) sobre a quantidade total do pedido.
 *
 * Como o modelo atual é "1 pedido = 1 item", o rateio proporcional ao valor
 * colapsa para 100% no único item. O extra é dividido pela quantidade total
 * planejada, não pela quantidade recebida agora — isso mantém o preço efetivo
 * unitário igual em recebimentos parciais e completos.
 */
export function precoEfetivoUnitario(order: Pick<PurchaseOrder, "preco_unitario" | "quantidade" | "frete" | "impostos" | "outros_custos">) {
  const preco = Number(order.preco_unitario || 0);
  const qtd = Number(order.quantidade || 0);
  if (qtd <= 0) return preco;
  const extras = Number(order.frete || 0) + Number(order.impostos || 0) + Number(order.outros_custos || 0);
  return preco + extras / qtd;
}

export function usePurchaseOrders() {
  return useQuery({
    queryKey: ["purchase_orders"],
    queryFn: async () => {
      const { data, error } = await db
        .from("purchase_orders")
        .select("*, items(nome, unidade, unidade_compra, fator_conversao), fornecedores(nome)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as PurchaseOrder[];
    },
  });
}

export function useCreatePurchaseOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (po: {
      item_id: string;
      fornecedor_id: string;
      centro_custo_id: string;
      quantidade: number;
      preco_unitario?: number | null;
      data_prevista?: string;
      frete?: number;
      impostos?: number;
      outros_custos?: number;
      /** Embalagem usada NO MOMENTO do pedido (snapshot). Se não informado, é resolvido server-side via item/vínculo. */
      unidade_compra_snapshot?: string | null;
      /** Fator de conversão usado NO MOMENTO do pedido (snapshot). Default = 1. */
      fator_conversao_snapshot?: number | null;
    }) => {
      if (!po.fornecedor_id) {
        throw new Error("Selecione um fornecedor para o pedido de compra.");
      }
      if (po.preco_unitario != null && po.preco_unitario < 0) {
        throw new Error("Preço unitário não pode ser negativo.");
      }
      for (const [k, v] of [["frete", po.frete], ["impostos", po.impostos], ["outros_custos", po.outros_custos]] as const) {
        if (v != null && v < 0) throw new Error(`O valor de ${k} não pode ser negativo.`);
      }

      // Calcula o custo unitário por unidade de estoque para snapshot histórico.
      const fatorSnap = po.fator_conversao_snapshot && po.fator_conversao_snapshot > 0 ? po.fator_conversao_snapshot : 1;
      const custoUnitEstoqueSnap = po.preco_unitario != null && po.preco_unitario > 0
        ? Number((po.preco_unitario / fatorSnap).toFixed(6))
        : null;

      const { error } = await db
        .from("purchase_orders")
        .insert({
          ...po,
          frete: po.frete ?? 0,
          impostos: po.impostos ?? 0,
          outros_custos: po.outros_custos ?? 0,
          unidade_compra_snapshot: po.unidade_compra_snapshot ?? null,
          fator_conversao_snapshot: fatorSnap,
          custo_unitario_estoque_snapshot: custoUnitEstoqueSnap,
          status: "CRIADO" as any,
        } as any);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["purchase_orders"] });
      qc.invalidateQueries({ queryKey: ["stock"] });
    },
  });
}

/**
 * Recebimento parcial ou completo. Gera 1 movimento de COMPRA com a quantidade
 * recebida agora; acumula em `quantidade_recebida`; status auto-avança:
 *   - se quantidade_recebida >= quantidade total → RECEBIDO_COMPLETO
 *   - senão → RECEBIDO_PARCIAL
 */
export function useReceivePurchaseOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      order,
      quantidadeAgora,
      dataReal,
      fatorConversao = 1,
    }: {
      order: PurchaseOrder;
      /** Quantidade recebida agora EM UNIDADE DE COMPRA (mesma unidade do pedido). */
      quantidadeAgora: number;
      /** Data real de recebimento informada pelo usuário (ISO yyyy-mm-dd ou ISO completo). */
      dataReal: string;
      /**
       * Fator de conversão efetivo (override do vínculo ou padrão do item).
       * Usado para converter qtd e preço para unidade de estoque ao gravar o movement.
       * Default 1 = comportamento legado (sem embalagem).
       */
      fatorConversao?: number;
    }) => {
      if (!quantidadeAgora || quantidadeAgora <= 0) {
        throw new Error("Informe uma quantidade maior que zero.");
      }
      if (!dataReal) {
        throw new Error("Informe a data real do recebimento.");
      }
      if (!order.centro_custo_id) throw new Error("O pedido precisa de um centro de custo para registrar a entrada.");
      const jaRecebido = Number(order.quantidade_recebida || 0);
      const restante = Number(order.quantidade) - jaRecebido;
      if (quantidadeAgora > restante) {
        throw new Error(`Quantidade excede o restante do pedido (${restante}).`);
      }

      // Normaliza para ISO timestamptz; se for só data, fixa meio-dia local para evitar drift de timezone.
      const dataIso = dataReal.length === 10 ? new Date(`${dataReal}T12:00:00`).toISOString() : new Date(dataReal).toISOString();

      // Preço efetivo POR EMBALAGEM = preço da embalagem + rateio dos extras (frete + impostos + outros)
      // sobre a quantidade total (em unidade de compra).
      const precoEfetivoCompra = order.preco_unitario != null
        ? precoEfetivoUnitario(order)
        : null;

      // Conversão para unidade de estoque (forma como o trigger de custo médio espera):
      const fator = fatorConversao > 0 ? fatorConversao : 1;
      const qtdMovEstoque = quantidadeAgora * fator;
      const precoMovEstoque = precoEfetivoCompra != null ? precoEfetivoCompra / fator : null;

      // O servidor grava a entrada no estoque, o recebimento (em unidade de compra,
      // para o lead time real) e o novo saldo do pedido numa única transação.
      const { error } = await db.rpc("receive_purchase_order" as any, {
        _order_id: order.id,
        _quantidade: quantidadeAgora,
        _fator: fator,
        _preco_unitario: precoMovEstoque,
        _data_real: dataIso,
      } as any);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["purchase_orders"] });
      qc.invalidateQueries({ queryKey: ["movements"] });
      qc.invalidateQueries({ queryKey: ["stock"] });
      qc.invalidateQueries({ queryKey: ["items"] });
    },
  });
}

export function useCancelPurchaseOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (orderId: string) => {
      const { error } = await db
        .from("purchase_orders")
        .update({ status: "CANCELADO" as any })
        .eq("id", orderId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["purchase_orders"] });
      qc.invalidateQueries({ queryKey: ["stock"] });
    },
  });
}
