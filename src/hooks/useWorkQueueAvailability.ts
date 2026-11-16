import { useQuery, useQueryClient } from '@tanstack/react-query';
import { db } from '@/db/client';

export type WorkMaterial = {
  itemId: string;
  nome: string;
  unidade: string;
  needed: number;
  availableBefore: number;
  balanceAfter: number;
  missing: number;
};

export type WorkQueueRow = {
  kind: 'OP' | 'KIT';
  id: string;
  status: string;
  ordem: number;
  position: number;
  materials: WorkMaterial[];
  canStart: boolean;
};

export function useWorkQueueAvailability() {
  return useQuery({
    queryKey: ['work_queue_availability'],
    queryFn: async () => {
      const { data, error } = await db.rpc('work_queue_availability', {});
      if (error) throw error;
      return data as WorkQueueRow[];
    },
    refetchInterval: 15000,
  });
}

export function useRefreshWorkQueue() {
  const qc = useQueryClient();
  return () => Promise.all(['work_queue_availability', 'kit_plans', 'production_orders', 'stock', 'movements']
    .map(key => qc.invalidateQueries({ queryKey: [key] })));
}
