import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { db } from "@/db/client";

export type PoliticaReposicao = "estoque_minimo" | "cobertura" | null;
export type ModoProducao = "JIT" | "ESTOQUE" | null;

export type Item = {
  id: string;
  nome: string;
  tipo: "MP" | "SUB" | "PF";
  unidade: string;
  consumo_diario: number;
  estoque_minimo: number;
  estoque_ideal: number;
  estoque_maximo: number;
  lead_time_dias: number;
  custo_unitario: number;
  /** Custo médio ponderado, recalculado automaticamente nas entradas de estoque. */
  custo_medio?: number;
  fornecedor_id: string | null;
  ativo: boolean;
  created_at: string;
  updated_at: string;
  /** Política de reposição (novo, opcional). null = comportamento atual. */
  politica_reposicao?: PoliticaReposicao;
  /** Dias-alvo de cobertura (usado quando politica_reposicao = 'cobertura'). */
  cobertura_desejada?: number | null;
  /** Cache opcional de consumo calculado automaticamente. */
  consumo_diario_calculado?: number | null;
  /** Comportamento por tipo de item — diferencia MP / SUB / PF. */
  modo_producao_padrao?: ModoProducao;
  produzido_internamente?: boolean;
  gera_sugestao_compra?: boolean;
  compra_direta?: boolean;
  controla_estoque?: boolean;
  /** Unidade em que o item é COMPRADO (ex: "caixa"). NULL = mesma da unidade de estoque. */
  unidade_compra?: string | null;
  /** Quantas unidades de estoque há em 1 unidade de compra. Default 1. */
  fator_conversao?: number | null;
  /** Timestamp de desativação (soft-delete). NULL = item não desativado. */
  deleted_at?: string | null;
};

/** Defaults inteligentes de comportamento por tipo de item. */
export function defaultsForTipo(tipo: "MP" | "SUB" | "PF") {
  if (tipo === "MP") {
    return {
      produzido_internamente: false,
      gera_sugestao_compra: true,
      compra_direta: true,
      controla_estoque: true,
      modo_producao_padrao: null as ModoProducao,
    };
  }
  if (tipo === "SUB") {
    return {
      produzido_internamente: true,
      gera_sugestao_compra: false,
      compra_direta: false,
      controla_estoque: true,
      modo_producao_padrao: null as ModoProducao,
    };
  }
  // PF
  return {
    produzido_internamente: true,
    gera_sugestao_compra: false,
    compra_direta: false,
    controla_estoque: true,
    modo_producao_padrao: "JIT" as ModoProducao,
  };
}

/**
 * Hook de listagem de itens.
 * Por padrão retorna apenas itens ATIVOS e NÃO desativados (deleted_at IS NULL).
 * Use { includeInactive: true } para incluir itens inativos/desativados — útil em
 * consultas de histórico e na própria gestão de itens (filtro Ver inativos).
 */
export function useItems(opts?: { includeInactive?: boolean }) {
  const includeInactive = !!opts?.includeInactive;
  return useQuery({
    queryKey: ["items", includeInactive ? "all" : "active"],
    queryFn: async () => {
      let q = db.from("items").select("*").order("nome");
      if (!includeInactive) {
        q = q.eq("ativo", true).is("deleted_at", null);
      }
      const { data, error } = await q;
      if (error) throw error;
      return data as Item[];
    },
  });
}

export function useCreateItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (item: {
      nome: string;
      tipo: "MP" | "SUB" | "PF";
      unidade: string;
      consumo_diario?: number;
      estoque_minimo: number;
      estoque_ideal?: number;
      estoque_maximo?: number;
      lead_time_dias?: number;
      custo_unitario?: number;
      fornecedor_id?: string;
      modo_producao_padrao?: ModoProducao;
      produzido_internamente?: boolean;
      gera_sugestao_compra?: boolean;
      compra_direta?: boolean;
      controla_estoque?: boolean;
      unidade_compra?: string | null;
      fator_conversao?: number | null;
      initialStock?: { quantity: number; centerId?: string };
    }) => {
      const { initialStock, ...itemFields } = item;
      // Aplica defaults inteligentes baseados no tipo, mas respeita overrides explícitos
      const def = defaultsForTipo(item.tipo);
      const payload: any = {
        ...itemFields,
        produzido_internamente: item.produzido_internamente ?? def.produzido_internamente,
        gera_sugestao_compra: item.gera_sugestao_compra ?? def.gera_sugestao_compra,
        compra_direta: item.compra_direta ?? def.compra_direta,
        controla_estoque: item.controla_estoque ?? def.controla_estoque,
        modo_producao_padrao: item.modo_producao_padrao ?? def.modo_producao_padrao,
      };
      if (initialStock) {
        const { data, error } = await db.rpc("create_item_with_initial_stock", {
          _item: payload,
          _quantity: initialStock.quantity,
          _center_id: initialStock.centerId,
        });
        if (error) throw error;
        return data as Item;
      }
      const { data, error } = await db.from("items").insert(payload).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["items"] });
      qc.invalidateQueries({ queryKey: ["stock"] });
      qc.invalidateQueries({ queryKey: ["movements"] });
    },
  });
}

export function useUpdateItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, stockAdjustment, ...updates }: Partial<Item> & { id: string; stockAdjustment?: {
      expectedQuantity: number;
      targetQuantity: number;
      centerId?: string;
    } }) => {
      if (stockAdjustment) {
        const { error } = await db.rpc("update_item_with_stock_adjustment", {
          _item_id: id,
          _updates: updates,
          _expected_quantity: stockAdjustment.expectedQuantity,
          _target_quantity: stockAdjustment.targetQuantity,
          _center_id: stockAdjustment.centerId,
        });
        if (error) throw error;
        return;
      }
      const { error } = await db.from("items").update(updates).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["items"] });
      qc.invalidateQueries({ queryKey: ["stock"] });
      qc.invalidateQueries({ queryKey: ["movements"] });
    },
  });
}
