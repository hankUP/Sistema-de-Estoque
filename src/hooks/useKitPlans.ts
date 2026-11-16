import { useQuery, useQueryClient } from '@tanstack/react-query';
import { db } from '@/db/client';
import type { KitConfig } from '@/lib/kitRules';

export type KitPlan = {
  id: string;
  nome: string;
  configuracao: KitConfig;
  status: 'RASCUNHO' | 'NA_FILA' | 'EM_PRODUCAO' | 'CONCLUIDO';
  ordem: number | null;
  destino: string | null;
  centro_custo_id: string | null;
  responsavel: string | null;
  enfileirado_em: string | null;
  iniciado_em: string | null;
  concluido_em: string | null;
};

export function useKitPlans() {
  return useQuery({ queryKey: ['kit_plans'], queryFn: async () => {
    const { data, error } = await db.from('kit_plans').select('*').order('updated_at', { ascending: false });
    if (error) throw error;
    return data as KitPlan[];
  } });
}

export function useRefreshKitPlans() {
  const qc = useQueryClient();
  return () => Promise.all(['kit_plans', 'work_queue_availability', 'stock', 'movements'].map(key => qc.invalidateQueries({ queryKey: [key] })));
}

export async function kitAction(name: string, args: Record<string, unknown>) {
  const { data, error } = await db.rpc(name, args);
  if (error) throw error;
  return data;
}
