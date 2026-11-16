import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateProductionQueueAvailability, canStartOrder } from '../lib/queueAvailability.ts';

test('uma OP posterior não bloqueia a primeira OP da fila', () => {
  const bom = [{ item_pai_id: 'produto', item_componente_id: 'case-raspberry', quantidade: 1,
    item_componente: { nome: 'Case Raspberry' } }];
  const orders = [
    { id: 'op-1', status: 'PLANEJADA', ordem: 1, items: [{ item_id: 'produto', quantidade: 1 }] },
    { id: 'op-2', status: 'PLANEJADA', ordem: 2, items: [{ item_id: 'produto', quantidade: 10 }] },
  ];
  const stock = [{ item: { id: 'case-raspberry', nome: 'Case Raspberry' }, fisico: 9 }];
  const projected = calculateProductionQueueAvailability(orders, bom, stock);
  assert.equal(projected.get('op-2')?.can_start, false);
  const operational = canStartOrder('op-1', orders, bom, stock);
  assert.equal(operational.can_start, true);
  assert.deepEqual(operational.missing_components, []);
});
