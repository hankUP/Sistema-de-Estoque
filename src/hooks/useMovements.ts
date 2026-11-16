import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { db } from "@/db/client";

export type MovementType =
  | "INICIAL"
  | "COMPRA"
  | "CONSUMO"
  | "PRODUCAO"
  | "SAIDA"
  | "AJUSTE"
  | "RETORNO";

export type Movement = {
  id: string;
  data: string;
  item_id: string;
  tipo_movimentacao: MovementType;
  quantidade: number;
  referencia: string | null;
  user_id: string | null;
  usuario_nome: string | null;
  centro_custo_id: string | null;
  created_at: string;
};

export function useMovements(itemId?: string) {
  return useQuery({
    queryKey: ["movements", itemId],
    queryFn: async () => {
      let query = db
        .from("movements")
        .select("*, items(nome), centros_custo(nome,tipo)")
        .order("data", { ascending: false });
      if (itemId) query = query.eq("item_id", itemId);
      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
  });
}

export function useCreateMovement() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (mov: {
      item_id: string;
      tipo_movimentacao: MovementType;
      quantidade: number;
      referencia?: string;
      centro_custo_id: string;
      /** Preço unitário JÁ na unidade de estoque (após divisão pelo fator). Usado para custo médio. */
      preco_unitario?: number | null;
      /** Fornecedor associado à compra manual — usado para registrar histórico de preços. */
      fornecedor_id?: string | null;
      /** Preço informado na unidade de compra (apenas para registrar no histórico). */
      preco_unitario_compra?: number | null;
    }) => {
      if (!mov.centro_custo_id) throw new Error("Informe um centro de custo.");
      const { data: activeCenter, error: centerError } = await db
        .from("centros_custo")
        .select("id")
        .eq("id", mov.centro_custo_id)
        .eq("ativo", true)
        .single();
      if (centerError || !activeCenter) throw new Error("Selecione um centro de custo ativo.");
      const { fornecedor_id, preco_unitario_compra, ...movementFields } = mov;
      const payload: any = { ...movementFields };
      const { data, error } = await db
        .from("movements")
        .insert(payload)
        .select()
        .single();
      if (error) throw error;

      // Para compras manuais, registrar no histórico de preços do item-fornecedor (origem MANUAL).
      // O preço enviado ao histórico é por unidade de compra, mantendo consistência com Pedidos de Compra.
      if (
        mov.tipo_movimentacao === "COMPRA" &&
        fornecedor_id &&
        preco_unitario_compra != null &&
        preco_unitario_compra > 0
      ) {
        const { error: rpcError } = await db.rpc("registrar_preco_historico", {
          _item_id: mov.item_id,
          _fornecedor_id: fornecedor_id,
          _preco: preco_unitario_compra,
          _origem: "MANUAL",
        });
        if (rpcError) {
          // Não bloqueia a movimentação — apenas avisa via console
          console.warn("Falha ao registrar histórico de preço:", rpcError);
        }
      }

      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["movements"] });
      qc.invalidateQueries({ queryKey: ["stock"] });
      qc.invalidateQueries({ queryKey: ["preco_historico"] });
      qc.invalidateQueries({ queryKey: ["preco_historico_recente"] });
      qc.invalidateQueries({ queryKey: ["items"] });
    },
  });
}
