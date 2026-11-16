import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { db } from "@/db/client";

export type ItemFornecedor = {
  id: string;
  item_id: string;
  fornecedor_id: string;
  principal: boolean;
  preco_unitario: number | null;
  lead_time_dias: number | null;
  quantidade_minima_compra: number;
  multiplo_compra: number;
  ativo: boolean;
  observacoes: string | null;
  created_at: string;
  updated_at?: string;
  /** Override opcional. NULL = usa unidade_compra do item. */
  unidade_compra?: string | null;
  /** Override opcional. NULL = usa fator_conversao do item. */
  fator_conversao?: number | null;
};

export type ItemFornecedorInput = {
  item_id: string;
  fornecedor_id: string;
  principal?: boolean;
  preco_unitario?: number | null;
  lead_time_dias?: number | null;
  quantidade_minima_compra?: number;
  multiplo_compra?: number;
  ativo?: boolean;
  observacoes?: string | null;
  unidade_compra?: string | null;
  fator_conversao?: number | null;
};

export function useItemFornecedores(itemId?: string) {
  return useQuery({
    queryKey: ["item_fornecedores", itemId],
    enabled: !!itemId,
    queryFn: async () => {
      const { data, error } = await db
        .from("item_fornecedores")
        .select("*, fornecedores(id, nome, ativo)")
        .eq("item_id", itemId!);
      if (error) throw error;
      return data as (ItemFornecedor & { fornecedores: { id: string; nome: string; ativo: boolean } | null })[];
    },
  });
}

export function useAllItemFornecedores() {
  return useQuery({
    queryKey: ["item_fornecedores"],
    queryFn: async () => {
      const { data, error } = await db
        .from("item_fornecedores")
        .select("*");
      if (error) throw error;
      return data as ItemFornecedor[];
    },
  });
}

/** Cria/atualiza um vínculo individual item-fornecedor com campos comerciais. */
export function useUpsertItemFornecedor() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: ItemFornecedorInput & { id?: string }) => {
      // Validações client-side
      if (input.preco_unitario != null && input.preco_unitario < 0) {
        throw new Error("Preço unitário não pode ser negativo.");
      }
      if ((input.quantidade_minima_compra ?? 0) < 0) {
        throw new Error("Quantidade mínima não pode ser negativa.");
      }
      if ((input.multiplo_compra ?? 0) < 0) {
        throw new Error("Múltiplo de compra não pode ser negativo.");
      }
      if (input.lead_time_dias != null && input.lead_time_dias < 0) {
        throw new Error("Lead time não pode ser negativo.");
      }

      // Se este vínculo está sendo marcado como principal, desmarca os outros do mesmo item
      if (input.principal) {
        const { error: clearError } = await db
          .from("item_fornecedores")
          .update({ principal: false })
          .eq("item_id", input.item_id)
          .neq("id", input.id || "00000000-0000-0000-0000-000000000000");
        if (clearError) throw clearError;
      }

      if (input.id) {
        const { id, ...updates } = input;
        const { error } = await db
          .from("item_fornecedores")
          .update(updates)
          .eq("id", id);
        if (error) throw error;
      } else {
        const { error } = await db
          .from("item_fornecedores")
          .insert(input);
        if (error) {
          // Tratar duplicata
          if (error.code === "23505") {
            throw new Error("Esse fornecedor já está vinculado a este item.");
          }
          throw error;
        }
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["item_fornecedores"] });
    },
  });
}

export function useDeleteItemFornecedor() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await db.from("item_fornecedores").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["item_fornecedores"] });
    },
  });
}

/**
 * Compatibilidade: substitui o conjunto de fornecedores de um item pelo array informado.
 * Mantém preço/lead time existentes quando o vínculo já existia; cria novos vínculos
 * apenas com fornecedor + principal (preço/lead time nulos = fallback no item).
 */
export function useSetItemFornecedores() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      itemId,
      fornecedorIds,
      principalId,
    }: {
      itemId: string;
      fornecedorIds: string[];
      principalId?: string;
    }) => {
      const { data: existentes, error: readError } = await db
        .from("item_fornecedores")
        .select("*")
        .eq("item_id", itemId);
      if (readError) throw readError;

      const existentesMap = new Map((existentes || []).map((r: any) => [r.fornecedor_id, r]));
      const desejados = new Set(fornecedorIds);

      // Remover os que não estão mais
      const paraRemover = (existentes || []).filter((r: any) => !desejados.has(r.fornecedor_id));
      if (paraRemover.length > 0) {
        const { error } = await db
          .from("item_fornecedores")
          .delete()
          .in("id", paraRemover.map((r: any) => r.id));
        if (error) throw error;
      }

      // Inserir os novos
      const novos = fornecedorIds
        .filter((fid) => !existentesMap.has(fid))
        .map((fid) => ({
          item_id: itemId,
          fornecedor_id: fid,
          principal: false,
        }));
      if (novos.length > 0) {
        const { error } = await db.from("item_fornecedores").insert(novos);
        if (error) throw error;
      }

      // Garantir apenas um principal: zera todos e marca o escolhido
      const { error: clearError } = await db
        .from("item_fornecedores")
        .update({ principal: false })
        .eq("item_id", itemId);
      if (clearError) throw clearError;

      if (principalId && desejados.has(principalId)) {
        const { error } = await db
          .from("item_fornecedores")
          .update({ principal: true })
          .eq("item_id", itemId)
          .eq("fornecedor_id", principalId);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["item_fornecedores"] });
    },
  });
}
