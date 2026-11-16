import { useQuery } from "@tanstack/react-query";
import { db } from "@/db/client";
import type { Item } from "./useItems";

export type StockEntry = {
  item: Item;
  fisico: number;
  reservado: number;
  disponivel: number;
  em_compra: number;
  projetado: number;
  status: "OK" | "BAIXO" | "CRITICO";
  consumoDiario: number;
  cobertura: number | null;
  pontoPedido: number;
  /** Custo médio ponderado do item (fallback: custo_unitario). */
  custoMedio: number;
  /** Valor total do estoque físico (fisico × custoMedio). */
  valorTotalEstoque: number;
  /** Dias distintos com movimentação de consumo/saída no período analisado. */
  diasComMovimento: number;
  /** true quando temos < 3 dias com movimento — usar consumo com cautela. */
  baixaConfiabilidade: boolean;
};

export function useStock(periodoDias: number = 30, ativosFiltro: "ativos" | "inativos" | "todos" = "ativos") {
  return useQuery({
    queryKey: ["stock", periodoDias, ativosFiltro],
    queryFn: async () => {
      const dataInicio = new Date();
      dataInicio.setDate(dataInicio.getDate() - periodoDias);

      let itemsQuery = db.from("items").select("*").order("nome");
      if (ativosFiltro === "ativos") {
        itemsQuery = itemsQuery.eq("ativo", true).is("deleted_at", null);
      } else if (ativosFiltro === "inativos") {
        itemsQuery = itemsQuery.eq("ativo", false);
      }
      // "todos" não filtra

      const [itemsRes, movementsRes, reservationsRes, purchasesRes, consumoRes] = await Promise.all([
        itemsQuery,
        db.from("movements").select("item_id, quantidade"),
        db.from("reservations").select("item_id, quantidade"),
        db
          .from("purchase_orders")
          .select("item_id, quantidade, quantidade_recebida, status")
          .not("status", "in", "(RECEBIDO,RECEBIDO_COMPLETO,CANCELADO)"),
        db
          .from("movements")
          .select("item_id, quantidade, data")
          .in("tipo_movimentacao", ["CONSUMO", "SAIDA"])
          .gte("data", dataInicio.toISOString()),
      ]);

      if (itemsRes.error) throw itemsRes.error;
      if (movementsRes.error) throw movementsRes.error;
      if (reservationsRes.error) throw reservationsRes.error;
      if (purchasesRes.error) throw purchasesRes.error;
      if (consumoRes.error) throw consumoRes.error;

      const items = itemsRes.data as Item[];
      const movements = movementsRes.data;
      const reservations = reservationsRes.data;
      const purchases = purchasesRes.data;
      const consumoMovimentos = consumoRes.data;

      return items.map((item): StockEntry => {
        const fisico = movements
          .filter((m) => m.item_id === item.id)
          .reduce((sum, m) => sum + Number(m.quantidade), 0);
        const reservado = reservations
          .filter((r) => r.item_id === item.id)
          .reduce((sum, r) => sum + Number(r.quantidade), 0);
        const em_compra = purchases
          .filter((p: any) => p.item_id === item.id)
          .reduce((sum, p: any) => sum + Math.max(0, Number(p.quantidade) - Number(p.quantidade_recebida || 0)), 0);
        const disponivel = fisico - reservado;
        const projetado = disponivel + em_compra;

        // Consumo real: soma das quantidades absolutas de CONSUMO e SAIDA no período
        const consumoTotal = consumoMovimentos
          .filter((m) => m.item_id === item.id)
          .reduce((sum, m) => sum + Math.abs(Number(m.quantidade)), 0);
        const consumoDiario = consumoTotal / periodoDias;

        // Dias distintos com movimento (confiabilidade do consumo)
        const diasUnicos = new Set<string>();
        consumoMovimentos
          .filter((m) => m.item_id === item.id)
          .forEach((m) => diasUnicos.add(String(m.data).slice(0, 10)));
        const diasComMovimento = diasUnicos.size;
        const baixaConfiabilidade = diasComMovimento > 0 && diasComMovimento < 3;

        const pontoPedido = item.estoque_minimo + (consumoDiario * item.lead_time_dias) + reservado;
        const cobertura = consumoDiario > 0 ? Math.round((disponivel / consumoDiario) * 10) / 10 : null;

        let status: StockEntry["status"] = "OK";
        if (disponivel <= 0) status = "CRITICO";
        else if (disponivel <= item.estoque_minimo) status = "BAIXO";

        const custoMedio = Number((item as any).custo_medio ?? item.custo_unitario ?? 0);
        const valorTotalEstoque = fisico * custoMedio;

        return { item, fisico, reservado, disponivel, em_compra, projetado, status, consumoDiario, cobertura, pontoPedido, diasComMovimento, baixaConfiabilidade, custoMedio, valorTotalEstoque };
      });
    },
  });
}
