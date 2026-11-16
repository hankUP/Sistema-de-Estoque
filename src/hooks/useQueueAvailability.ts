import { useMemo } from 'react';
import { useWorkQueueAvailability } from './useWorkQueueAvailability';
import type { QueueAvailabilityRow } from '@/lib/queueAvailability';

export function useQueueAvailability(): Map<string, QueueAvailabilityRow> {
  const { data: work = [] } = useWorkQueueAvailability();
  return useMemo(() => new Map(work.filter(row => row.kind === 'OP').map(row => [row.id, {
    op_id: row.id,
    queue_position: row.position,
    can_start: row.canStart,
    availability_status: row.canStart ? 'ATENDIVEL' as const : 'BLOQUEADA' as const,
    missing_components: row.materials.filter(material => material.missing > 0).map(material => ({
      itemId: material.itemId, nome: material.nome, necessario: material.needed,
      disponivelAntes: Math.max(0, material.availableBefore), faltando: material.missing,
    })),
    projected_consumption: row.materials.map(material => ({
      itemId: material.itemId, nome: material.nome, necessario: material.needed,
      saldoApos: material.balanceAfter,
    })),
  }])), [work]);
}
