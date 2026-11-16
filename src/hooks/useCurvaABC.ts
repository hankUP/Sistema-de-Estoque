import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { db } from "@/db/client";
import { useItems } from "@/hooks/useItems";

export type ClasseABC = "A" | "B" | "C";

export type AbcRow = {
  item_id: string;
  item_nome: string;
  consumoQtd: number;
  custoMedio: number;
  valorConsumo: number;
  participacaoPct: number;
  acumuladoPct: number;
  classe: ClasseABC;
};

export type CurvaABCResult = {
  byItem: Map<string, AbcRow>;
  rows: AbcRow[];
  totalValor: number;
  totals: { A: number; B: number; C: number };
  /** Itens MP ativos sem consumo na janela (não classificados). */
  semConsumo: number;
};

/** Janela fixa de 90 dias, escopo MP, base = consumo × custo_medio. */
export function useCurvaABC(): { data: CurvaABCResult | null; isLoading: boolean } {
  const { data: items, isLoading: loadingItems } = useItems({ includeInactive: true });

  const desde = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - 90);
    return d.toISOString();
  }, []);

  const { data: movs, isLoading: loadingMovs } = useQuery({
    queryKey: ["abc-consumo-90d", desde],
    queryFn: async () => {
      // Apenas saídas físicas representam "consumo" para fins de classificação.
      const { data, error } = await db
        .from("movements")
        .select("item_id, quantidade, tipo_movimentacao, data")
        .in("tipo_movimentacao", ["CONSUMO", "PRODUCAO", "SAIDA"])
        .gte("data", desde);
      if (error) throw error;
      return data || [];
    },
  });

  const data = useMemo<CurvaABCResult | null>(() => {
    if (!items || !movs) return null;

    // Apenas matéria-prima ativa entra na curva.
    const mpAtivos = items.filter((i) => i.tipo === "MP" && i.ativo);
    const consumoPorItem = new Map<string, number>();
    movs.forEach((m: any) => {
      const q = Math.abs(Number(m.quantidade) || 0);
      if (q <= 0) return;
      consumoPorItem.set(m.item_id, (consumoPorItem.get(m.item_id) || 0) + q);
    });

    const linhas = mpAtivos.map((i) => {
      const consumoQtd = consumoPorItem.get(i.id) || 0;
      const custoMedio = Number((i as any).custo_medio || 0) > 0
        ? Number((i as any).custo_medio)
        : Number((i as any).custo_unitario || 0);
      const valorConsumo = consumoQtd * custoMedio;
      return { item_id: i.id, item_nome: i.nome, consumoQtd, custoMedio, valorConsumo };
    });

    const comValor = linhas
      .filter((l) => l.valorConsumo > 0)
      .sort((a, b) => b.valorConsumo - a.valorConsumo);
    const semConsumo = linhas.length - comValor.length;
    const totalValor = comValor.reduce((s, l) => s + l.valorConsumo, 0);

    let acumulado = 0;
    const rows: AbcRow[] = comValor.map((l) => {
      acumulado += l.valorConsumo;
      const acumuladoPct = totalValor > 0 ? (acumulado / totalValor) * 100 : 0;
      const participacaoPct = totalValor > 0 ? (l.valorConsumo / totalValor) * 100 : 0;
      // Cortes 80/95: A até 80%, B até 95%, C resto. O primeiro item sempre é A
      // mesmo que sua participação isolada já passe de 80% (caso comum em poucos SKUs).
      let classe: ClasseABC;
      if (acumuladoPct <= 80) classe = "A";
      else if (acumuladoPct <= 95) classe = "B";
      else classe = "C";
      return { ...l, participacaoPct, acumuladoPct, classe };
    });

    // Garante pelo menos um A se houver dados.
    if (rows.length > 0 && !rows.some((r) => r.classe === "A")) rows[0].classe = "A";

    const totals = { A: 0, B: 0, C: 0 } as Record<ClasseABC, number>;
    rows.forEach((r) => { totals[r.classe] += 1; });

    const byItem = new Map<string, AbcRow>();
    rows.forEach((r) => byItem.set(r.item_id, r));

    return { byItem, rows, totalValor, totals, semConsumo };
  }, [items, movs]);

  return { data, isLoading: loadingItems || loadingMovs };
}

/** Cor semântica para cada classe ABC. */
export const abcToneClasses = (classe: ClasseABC): string => {
  switch (classe) {
    case "A": return "bg-destructive/15 text-destructive border-destructive/30";
    case "B": return "bg-warning/15 text-warning border-warning/30";
    case "C": return "bg-muted text-muted-foreground border-border";
  }
};
