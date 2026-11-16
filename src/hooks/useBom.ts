import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { db } from "@/db/client";

export type BomItem = {
  id: string;
  item_pai_id: string;
  item_componente_id: string;
  quantidade: number;
  sort_order: number;
  created_at: string;
  item_pai?: { nome: string };
  item_componente?: { nome: string };
};

export function useBom(itemPaiId?: string) {
  return useQuery({
    queryKey: ["bom", itemPaiId],
    queryFn: async () => {
      let query = db
        .from("bom_items")
        .select("*, item_pai:items!bom_items_item_pai_id_fkey(nome), item_componente:items!bom_items_item_componente_id_fkey(nome)")
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: true });
      if (itemPaiId) query = query.eq("item_pai_id", itemPaiId);
      const { data, error } = await query;
      if (error) throw error;
      return data as BomItem[];
    },
  });
}

async function getNextSortOrder(item_pai_id: string): Promise<number> {
  const { data, error } = await db
    .from("bom_items")
    .select("sort_order")
    .eq("item_pai_id", item_pai_id)
    .order("sort_order", { ascending: false })
    .limit(1);
  if (error) throw error;
  const max = data?.[0]?.sort_order ?? 0;
  return Number(max) + 1;
}

export function useCreateBomItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (bom: { item_pai_id: string; item_componente_id: string; quantidade: number; sort_order?: number }) => {
      const sort_order = bom.sort_order ?? (await getNextSortOrder(bom.item_pai_id));
      const { error } = await db.from("bom_items").insert({ ...bom, sort_order });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["bom"] }),
  });
}

export function useUpdateBomItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...updates }: { id: string; item_componente_id?: string; quantidade?: number; sort_order?: number }) => {
      const { error } = await db.from("bom_items").update(updates).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["bom"] }),
  });
}

export function useDeleteBomItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await db.from("bom_items").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["bom"] }),
  });
}

/**
 * Reordena dois itens trocando seus sort_orders (para botões subir/descer).
 */
export function useSwapBomOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (pair: { a: { id: string; sort_order: number }; b: { id: string; sort_order: number } }) => {
      // Usa um valor temporário para evitar conflito de unicidade caso exista índice único futuro
      const tmp = -Math.abs(pair.a.sort_order) - 1000000;
      const { error: e1 } = await db.from("bom_items").update({ sort_order: tmp }).eq("id", pair.a.id);
      if (e1) throw e1;
      const { error: e2 } = await db.from("bom_items").update({ sort_order: pair.a.sort_order }).eq("id", pair.b.id);
      if (e2) throw e2;
      const { error: e3 } = await db.from("bom_items").update({ sort_order: pair.b.sort_order }).eq("id", pair.a.id);
      if (e3) throw e3;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["bom"] }),
  });
}

/** Detecta ciclo: se algum componente da origem (recursivamente) for o destino. */
async function wouldCreateCycle(originId: string, destId: string): Promise<boolean> {
  if (originId === destId) return true;
  // BFS pelos componentes do destino — se chegarmos em destId entre os ancestrais de origem, há ciclo
  // Aqui o risco real: se destId aparece como componente (direto ou indireto) de qualquer item que será copiado.
  // Carrega toda a BOM uma vez e faz BFS.
  const { data, error } = await db.from("bom_items").select("item_pai_id, item_componente_id");
  if (error) throw error;
  const childrenOf = new Map<string, string[]>();
  (data || []).forEach((r: any) => {
    const arr = childrenOf.get(r.item_pai_id) || [];
    arr.push(r.item_componente_id);
    childrenOf.set(r.item_pai_id, arr);
  });
  // Componentes que vão ser inseridos em destId = filhos de originId.
  // Ciclo ocorre se destId aparece como descendente de algum desses componentes.
  const start = childrenOf.get(originId) || [];
  const stack = [...start];
  const seen = new Set<string>();
  while (stack.length) {
    const cur = stack.pop()!;
    if (cur === destId) return true;
    if (seen.has(cur)) continue;
    seen.add(cur);
    const next = childrenOf.get(cur) || [];
    stack.push(...next);
  }
  return false;
}

export type CopyBomMode = "REPLACE" | "MERGE";

export function useCopyBom() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ originId, destId, mode }: { originId: string; destId: string; mode: CopyBomMode }) => {
      if (originId === destId) throw new Error("Origem e destino não podem ser o mesmo produto");

      if (await wouldCreateCycle(originId, destId)) {
        throw new Error("Esta cópia criaria um ciclo na estrutura (produto se conteria indiretamente)");
      }

      const { data: originRows, error: e1 } = await db
        .from("bom_items")
        .select("item_componente_id, quantidade, sort_order")
        .eq("item_pai_id", originId)
        .order("sort_order", { ascending: true });
      if (e1) throw e1;
      if (!originRows || originRows.length === 0) throw new Error("Estrutura de origem está vazia");

      // Componente não pode ser igual ao próprio destino
      if (originRows.some((r: any) => r.item_componente_id === destId)) {
        throw new Error("A estrutura de origem contém o produto destino como componente");
      }

      if (mode === "REPLACE") {
        const { error: eDel } = await db.from("bom_items").delete().eq("item_pai_id", destId);
        if (eDel) throw eDel;
      }

      // Pega componentes existentes no destino (para MERGE: pular duplicados) e maior sort_order
      const { data: destRows, error: e2 } = await db
        .from("bom_items")
        .select("item_componente_id, sort_order")
        .eq("item_pai_id", destId)
        .order("sort_order", { ascending: false });
      if (e2) throw e2;

      const existing = new Set((destRows || []).map((r: any) => r.item_componente_id));
      let nextOrder = (destRows?.[0]?.sort_order ?? 0) + 1;

      const toInsert: any[] = [];
      let skipped = 0;
      for (const r of originRows as any[]) {
        if (existing.has(r.item_componente_id)) {
          skipped++;
          continue;
        }
        toInsert.push({
          item_pai_id: destId,
          item_componente_id: r.item_componente_id,
          quantidade: r.quantidade,
          sort_order: nextOrder++,
        });
      }

      if (toInsert.length > 0) {
        const { error: eIns } = await db.from("bom_items").insert(toInsert);
        if (eIns) throw eIns;
      }

      return { inserted: toInsert.length, skipped };
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["bom"] }),
  });
}
