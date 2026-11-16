import test from 'node:test';
import assert from 'node:assert/strict';
import { newKitConfig, normalizeKitConfig, recommendedRelay, suggestedRows } from '../lib/kitRules.ts';

test('kit com três câmeras sugere relé de quatro canais e materiais por botão', () => {
  const config = newKitConfig();
  config.courts = [
    { id: 'quadra-1', cameras: 1, botoes: 1 },
    { id: 'quadra-2', cameras: 2, botoes: 2 },
  ];
  config.relay = recommendedRelay(3);
  const quantities = Object.fromEntries(suggestedRows(config).map(row => [row.key, row.quantity]));
  assert.equal(config.relay, 4);
  assert.equal(quantities.camera, 3);
  assert.equal(quantities.botao, 3);
  assert.equal(quantities.caixa, 3);
  assert.equal(quantities.placaPequena, 3);
  assert.equal(quantities.placaGrande, 2);
  assert.equal(quantities.papel, 1);
  assert.equal(Object.hasOwn(quantities, 'trilho'), false);
  assert.equal(Object.hasOwn(quantities, 'moduloBotao'), false);
});

test('rascunho antigo perde o trilho e mantém a quantidade de patch cords', () => {
  const old = newKitConfig();
  old.courts[0].nome = undefined;
  old.overrides.trilho = { item_id: 'trilho-antigo', quantidade: 1 };
  old.overrides.patch = { quantidade: 5 };
  const updated = normalizeKitConfig(old);
  assert.equal(updated.courts[0].nome, 'Quadra 1');
  assert.equal(updated.patchCords, 5);
  assert.equal(Object.hasOwn(updated.overrides, 'trilho'), false);
  assert.equal(suggestedRows(updated).find(row => row.key === 'patch').quantity, 5);
});
