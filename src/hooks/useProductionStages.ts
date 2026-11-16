import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { db } from "@/db/client";

export type StageStatus = "NAO_INICIADA" | "EM_ANDAMENTO" | "PAUSADA" | "CONCLUIDA";

export type ProductionOrderStage = {
  id: string;
  production_order_id: string;
  template_id: string | null;
  nome: string;
  ordem: number;
  status: StageStatus;
  started_at: string | null;
  completed_at: string | null;
  tempo_bruto_seg: number | null;
  tempo_pausado_seg: number;
  tempo_produtivo_seg: number | null;
  observacoes: string | null;
  montador_nome: string | null;
  quick_completed?: boolean | null;
};

export type StagePause = {
  id: string;
  stage_id: string;
  motivo: string | null;
  started_at: string;
  ended_at: string | null;
  duracao_seg: number | null;
};

export const PAUSE_REASONS = [
  "Banheiro / pausa pessoal",
  "Aguardando material",
  "Suporte técnico",
  "Interrupção externa",
  "Outro",
] as const;

/** Lista etapas de uma OP. */
export function useProductionStages(productionOrderId: string | undefined) {
  return useQuery({
    queryKey: ["production_order_stages", productionOrderId],
    enabled: !!productionOrderId,
    queryFn: async () => {
      const { data, error } = await db
        .from("production_order_stages" as any)
        .select("*")
        .eq("production_order_id", productionOrderId!)
        .order("ordem", { ascending: true });
      if (error) throw error;
      return (data || []) as unknown as ProductionOrderStage[];
    },
  });
}

/** Lista pausas de um conjunto de etapas. */
export function useStagePauses(stageIds: string[]) {
  return useQuery({
    queryKey: ["production_stage_pauses", stageIds.sort().join(",")],
    enabled: stageIds.length > 0,
    queryFn: async () => {
      const { data, error } = await db
        .from("production_stage_pauses" as any)
        .select("*")
        .in("stage_id", stageIds)
        .order("started_at", { ascending: true });
      if (error) throw error;
      return (data || []) as unknown as StagePause[];
    },
  });
}

/** Resumo de OPs (etapa atual e tempo total) — usado na lista. */
export function useStagesSummary() {
  return useQuery({
    queryKey: ["production_stages_summary"],
    queryFn: async () => {
      const { data, error } = await db
        .from("production_order_stages" as any)
        .select("production_order_id,nome,status,ordem")
        .order("ordem", { ascending: true });
      if (error) throw error;
      const map = new Map<string, { current: string | null; allCompleted: boolean; total: number; done: number }>();
      ((data || []) as any[]).forEach((s: any) => {
        const cur = map.get(s.production_order_id) || { current: null, allCompleted: true, total: 0, done: 0 };
        cur.total += 1;
        if (s.status === "CONCLUIDA") cur.done += 1;
        if (s.status !== "CONCLUIDA") cur.allCompleted = false;
        if (!cur.current && (s.status === "EM_ANDAMENTO" || s.status === "PAUSADA")) {
          cur.current = `${s.nome}${s.status === "PAUSADA" ? " (pausada)" : ""}`;
        }
        map.set(s.production_order_id, cur);
      });
      return map;
    },
  });
}

function invalidateAll(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ["production_order_stages"] });
  qc.invalidateQueries({ queryKey: ["production_stage_pauses"] });
  qc.invalidateQueries({ queryKey: ["production_stages_summary"] });
  qc.invalidateQueries({ queryKey: ["production_orders"] });
}


/** Pausa a etapa em andamento e abre uma pausa com motivo opcional. */
export function usePauseStage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ stage, motivo }: { stage: ProductionOrderStage; motivo?: string | null }) => {
      if (stage.status !== "EM_ANDAMENTO") throw new Error("Só é possível pausar etapas em andamento.");

      const { error: insErr } = await db
        .from("production_stage_pauses" as any)
        .insert({
          stage_id: stage.id,
          motivo: motivo || null,
        } as any);
      if (insErr) throw insErr;

      const { error } = await db
        .from("production_order_stages" as any)
        .update({ status: "PAUSADA" as StageStatus } as any)
        .eq("id", stage.id);
      if (error) throw error;
    },
    onSuccess: () => invalidateAll(qc),
  });
}

/** Retoma uma etapa pausada: fecha a pausa em aberto e atualiza tempo_pausado. */
export function useResumeStage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (stage: ProductionOrderStage) => {
      if (stage.status !== "PAUSADA") throw new Error("Só é possível retomar etapas pausadas.");

      // Busca pausa em aberto
      const { data: openPauses, error: e1 } = await db
        .from("production_stage_pauses" as any)
        .select("*")
        .eq("stage_id", stage.id)
        .is("ended_at", null);
      if (e1) throw e1;

      const now = new Date();
      let totalAdded = 0;
      for (const p of (openPauses || []) as any[]) {
        const dur = Math.max(0, Math.round((now.getTime() - new Date(p.started_at).getTime()) / 1000));
        totalAdded += dur;
        const { error } = await db
          .from("production_stage_pauses" as any)
          .update({ ended_at: now.toISOString(), duracao_seg: dur } as any)
          .eq("id", p.id);
        if (error) throw error;
      }

      const { error } = await db
        .from("production_order_stages" as any)
        .update({
          status: "EM_ANDAMENTO" as StageStatus,
          tempo_pausado_seg: (stage.tempo_pausado_seg || 0) + totalAdded,
        } as any)
        .eq("id", stage.id);
      if (error) throw error;
    },
    onSuccess: () => invalidateAll(qc),
  });
}


/**
 * Atualiza o modo de execução da OP. Só permitido enquanto nenhuma etapa
 * tiver sido concluída.
 */
export function useUpdateOrderModoExecucao() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      orderId,
      modo_execucao,
    }: {
      orderId: string;
      modo_execucao: "SIMPLIFICADO" | "DETALHADO";
    }) => {
      const { data: stages, error: eS } = await db
        .from("production_order_stages" as any)
        .select("status")
        .eq("production_order_id", orderId);
      if (eS) throw eS;
      if (((stages || []) as any[]).some((s: any) => s.status === "CONCLUIDA")) {
        throw new Error("Não é possível trocar o modo após a primeira etapa ser concluída.");
      }
      const { error } = await db
        .from("production_orders")
        .update({ modo_execucao } as any)
        .eq("id", orderId);
      if (error) throw error;
    },
    onSuccess: () => invalidateAll(qc),
  });
}

/** Garante que existam etapas para uma OP (cria a partir dos templates ativos se faltar). */
export async function ensureStagesForOrder(productionOrderId: string) {
  const { data: existing, error } = await db
    .from("production_order_stages" as any)
    .select("id")
    .eq("production_order_id", productionOrderId);
  if (error) throw error;
  if ((existing || []).length > 0) return;

  const { data: templates, error: e2 } = await db
    .from("production_stage_templates" as any)
    .select("*")
    .eq("ativo", true)
    .order("ordem", { ascending: true });
  if (e2) throw e2;

  const rows = (templates || []).map((t: any) => ({
    production_order_id: productionOrderId,
    template_id: t.id,
    nome: t.nome,
    ordem: t.ordem,
    status: "NAO_INICIADA" as StageStatus,
  }));
  if (rows.length > 0) {
    const { error: e3 } = await db
      .from("production_order_stages" as any)
      .insert(rows as any);
    if (e3) throw e3;
  }
}

/** Verifica se todas as etapas de uma OP estão concluídas. */
export async function checkAllStagesCompleted(productionOrderId: string): Promise<{ ok: boolean; pendentes: string[] }> {
  const { data, error } = await db
    .from("production_order_stages" as any)
    .select("nome,status,ordem")
    .eq("production_order_id", productionOrderId)
    .order("ordem", { ascending: true });
  if (error) throw error;
  const pendentes = ((data || []) as any[])
    .filter((s: any) => s.status !== "CONCLUIDA")
    .map((s: any) => s.nome);
  return { ok: pendentes.length === 0, pendentes };
}

/** Helpers de formatação. */
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null || seconds < 0) return "—";
  const s = Math.round(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m`;
  if (m > 0) return `${m}m ${String(sec).padStart(2, "0")}s`;
  return `${sec}s`;
}

/**
 * Formato compacto para leitura rápida em listas: "2d 3h", "5h 12min", "45min", "30s".
 * Usado no acompanhamento de tempo de fila/produção/total da OP.
 */
export function formatDurationCompact(seconds: number | null | undefined): string {
  if (seconds == null || seconds < 0) return "—";
  const s = Math.round(seconds);
  if (s < 60) return `${s}s`;
  const totalMin = Math.floor(s / 60);
  if (totalMin < 60) return `${totalMin}min`;
  const totalH = Math.floor(totalMin / 60);
  const remMin = totalMin % 60;
  if (totalH < 24) {
    return remMin > 0 ? `${totalH}h ${remMin}min` : `${totalH}h`;
  }
  const days = Math.floor(totalH / 24);
  const remH = totalH % 24;
  return remH > 0 ? `${days}d ${remH}h` : `${days}d`;
}

export function stageStatusLabel(s: StageStatus): string {
  return s === "NAO_INICIADA" ? "Não iniciada"
    : s === "EM_ANDAMENTO" ? "Em andamento"
    : s === "PAUSADA" ? "Pausada"
    : "Concluída";
}
