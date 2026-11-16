import { useQuery } from "@tanstack/react-query";
import { db } from "@/db/client";

export type PrecoHistoricoEntry = {
  id: string;
  item_id: string;
  fornecedor_id: string;
  preco_unitario: number;
  data_inicio: string;
  data_fim: string | null;
  origem: "CADASTRO" | "PEDIDO";
  purchase_order_id: string | null;
  observacao: string | null;
  created_at: string;
};

/** Histórico completo de um item-fornecedor, mais recente primeiro. */
export function usePrecoHistorico(itemId?: string, fornecedorId?: string) {
  return useQuery({
    queryKey: ["preco_historico", itemId, fornecedorId],
    enabled: !!itemId && !!fornecedorId,
    queryFn: async () => {
      const { data, error } = await db
        .from("item_fornecedor_precos" as any)
        .select("*")
        .eq("item_id", itemId!)
        .eq("fornecedor_id", fornecedorId!)
        .order("data_inicio", { ascending: false });
      if (error) throw error;
      return (data || []) as unknown as PrecoHistoricoEntry[];
    },
  });
}

/** Histórico recente de todos os fornecedores de um item (para tendência na sugestão). */
export function usePrecoHistoricoRecente(diasAtras = 90) {
  return useQuery({
    queryKey: ["preco_historico_recente", diasAtras],
    queryFn: async () => {
      const desde = new Date();
      desde.setDate(desde.getDate() - diasAtras);
      const { data, error } = await db
        .from("item_fornecedor_precos" as any)
        .select("item_id, fornecedor_id, preco_unitario, data_inicio, origem")
        .gte("data_inicio", desde.toISOString());
      if (error) throw error;
      return (data || []) as unknown as Pick<
        PrecoHistoricoEntry,
        "item_id" | "fornecedor_id" | "preco_unitario" | "data_inicio" | "origem"
      >[];
    },
  });
}
