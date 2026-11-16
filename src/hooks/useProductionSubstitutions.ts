import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { db } from "@/db/client";

export type ProductionSubstitution = {
  id: string;
  production_order_id: string;
  item_original_id: string;
  item_substituto_id: string;
  quantidade: number;
  custo_unitario_original: number | null;
  custo_unitario_substituto: number | null;
  motivo: string | null;
  usuario_nome: string | null;
  created_at: string;
  /** Preenchido no cliente (não vem da query). */
  item_original_nome?: string;
  item_original_unidade?: string;
  item_substituto_nome?: string;
  item_substituto_unidade?: string;
};

/** Lista substituições de uma OP específica (ou todas, se orderId for omitido). */
export function useProductionSubstitutions(orderId?: string) {
  return useQuery({
    queryKey: ["production_order_substitutions", orderId ?? "all"],
    queryFn: async () => {
      let q = db
        .from("production_order_substitutions" as any)
        .select("*")
        .order("created_at", { ascending: false });
      if (orderId) q = q.eq("production_order_id", orderId);
      const { data, error } = await q;
      if (error) throw error;
      const rows = (data || []) as unknown as ProductionSubstitution[];

      // Hidrata nome/unidade dos itens
      const ids = new Set<string>();
      rows.forEach((r) => {
        ids.add(r.item_original_id);
        ids.add(r.item_substituto_id);
      });
      if (ids.size === 0) return rows;

      const { data: items } = await db
        .from("items")
        .select("id,nome,unidade")
        .in("id", Array.from(ids));
      const map = new Map<string, { nome: string; unidade: string }>();
      (items || []).forEach((i: any) => map.set(i.id, { nome: i.nome, unidade: i.unidade }));
      rows.forEach((r) => {
        const o = map.get(r.item_original_id);
        const s = map.get(r.item_substituto_id);
        if (o) {
          r.item_original_nome = o.nome;
          r.item_original_unidade = o.unidade;
        }
        if (s) {
          r.item_substituto_nome = s.nome;
          r.item_substituto_unidade = s.unidade;
        }
      });
      return rows;
    },
  });
}

export type CreateSubstitutionInput = {
  production_order_id: string;
  item_original_id: string;
  item_substituto_id: string;
  quantidade: number;
  custo_unitario_original?: number | null;
  custo_unitario_substituto?: number | null;
  motivo?: string | null;
  usuario_nome?: string | null;
};

export function useCreateSubstitution() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateSubstitutionInput) => {
      // Upsert por (production_order_id, item_original_id) — só uma substituição
      // por componente em cada OP.
      const { error } = await db
        .from("production_order_substitutions" as any)
        .upsert(input as any, { onConflict: "production_order_id,item_original_id" });
      if (error) throw error;
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ["production_order_substitutions"] });
      qc.invalidateQueries({ queryKey: ["production_order_substitutions", vars.production_order_id] });
      qc.invalidateQueries({ queryKey: ["production_orders"] });
      qc.invalidateQueries({ queryKey: ["stock"] });
      qc.invalidateQueries({ queryKey: ["queue_availability"] });
    },
  });
}

export function useDeleteSubstitution() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id }: { id: string; production_order_id: string }) => {
      const { error } = await db
        .from("production_order_substitutions" as any)
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ["production_order_substitutions"] });
      qc.invalidateQueries({ queryKey: ["production_order_substitutions", vars.production_order_id] });
      qc.invalidateQueries({ queryKey: ["production_orders"] });
      qc.invalidateQueries({ queryKey: ["stock"] });
      qc.invalidateQueries({ queryKey: ["queue_availability"] });
    },
  });
}

/** Mapa rápido itemOriginalId → substituição, para uma OP. */
export function buildSubstitutionMap(subs: ProductionSubstitution[] | undefined | null) {
  const map = new Map<string, ProductionSubstitution>();
  (subs || []).forEach((s) => map.set(s.item_original_id, s));
  return map;
}
