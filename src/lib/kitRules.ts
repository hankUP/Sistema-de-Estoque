import type { Item } from '@/hooks/useItems';

export type Court = { id: string; nome?: string; cameras: number; botoes: number };
export type SwitchChoice = 'SEM_POE_5' | 'POE_5' | 'POE_10' | 'MISTO';
export type KitRole = 'raspberry' | 'regua' | 'patch' | 'switch5' | 'switchPoe5' |
  'switchPoe10' | 'rele' | 'camera' | 'botao' | 'caixa' | 'placaPequena' | 'placaGrande' | 'papel';
export type KitRow = { key: string; label: string; item_id: string; quantidade: number };
export type KitConfig = {
  courts: Court[];
  switchChoice: SwitchChoice;
  relay: number;
  relayManual: boolean;
  patchCords: number;
  overrides: Record<string, { item_id?: string; quantidade?: number }>;
  extras: KitRow[];
  componentes: Array<{ item_id: string; quantidade: number }>;
};

export const newKitConfig = (): KitConfig => ({
  courts: [{ id: crypto.randomUUID(), nome: 'Quadra 1', cameras: 1, botoes: 1 }],
  switchChoice: 'SEM_POE_5', relay: 1, relayManual: false, patchCords: 1,
  overrides: {}, extras: [], componentes: [],
});

export function normalizeKitConfig(saved: KitConfig): KitConfig {
  const overrides = { ...(saved.overrides ?? {}) };
  delete overrides.trilho;
  const patchCords = overrides.patch?.quantidade ?? saved.patchCords;
  if (overrides.patch) overrides.patch = { item_id: overrides.patch.item_id };
  return {
    ...saved, patchCords, overrides,
    courts: saved.courts.map((court, index) => ({
      ...court, nome: court.nome || `Quadra ${index + 1}`,
    })),
  };
}

export const normalize = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

export function defaultItemForRole(items: Item[], role: KitRole, relay: number): Item | undefined {
  const names: Record<KitRole, string> = {
    raspberry: 'Raspberry Pi 4 Model B',
    regua: 'Filtro de linha 5 tomadas preto',
    patch: 'Patch cord UTP 4P CAT 5e 0,5m',
    switch5: 'Switch 5p 10/100/1000 LS 1005G TP-LINK',
    switchPoe5: 'Switch poe 5p 10/100 S1105F',
    switchPoe10: 'Switch poe 10p 10/100 S1110F - P',
    rele: `Modulo rele ${relay} ${relay === 1 ? 'canal' : 'canais'}`,
    camera: 'Camera IP dome 30m 2.8mm VIP 1230 D FC FULL',
    botao: 'Botão cogumelo normalmente aberto Metaltex (botao para fora)',
    caixa: 'Caixa botoeira 1 furo JNG',
    placaPequena: 'Placa PEQUENA do botão 10x15',
    placaGrande: 'Placa Grande A4',
    papel: 'Card informativo (1 unidade da impressao sao 4 cards)',
  };
  return items.find(item => normalize(item.nome) === normalize(names[role]));
}

export function suggestedRows(config: KitConfig): Array<{ key: KitRole; label: string; quantity: number }> {
  const cameras = config.courts.reduce((sum, court) => sum + court.cameras, 0);
  const botoes = config.courts.reduce((sum, court) => sum + court.botoes, 0);
  const rows: Array<{ key: KitRole; label: string; quantity: number }> = [
    { key: 'raspberry', label: 'Raspberry Pi 4 Model B', quantity: 1 },
    { key: 'regua', label: 'Régua de energia', quantity: 1 },
    { key: 'patch', label: 'Patch cord', quantity: config.patchCords },
    { key: 'rele', label: `Módulo de relé (${config.relay} canais)`, quantity: 1 },
    { key: 'camera', label: 'Câmera', quantity: cameras },
    { key: 'botao', label: 'Botão cogumelo', quantity: botoes },
    { key: 'caixa', label: 'Caixa botoeira 1 furo', quantity: botoes },
    { key: 'placaPequena', label: 'Placa pequena', quantity: botoes },
    { key: 'placaGrande', label: 'Placa grande', quantity: Math.ceil(botoes / 2) },
    { key: 'papel', label: 'Papel informativo', quantity: 1 },
  ];
  if (config.switchChoice === 'SEM_POE_5' || config.switchChoice === 'MISTO')
    rows.splice(3, 0, { key: 'switch5', label: 'Switch 5 portas sem PoE', quantity: 1 });
  if (config.switchChoice === 'POE_5' || config.switchChoice === 'MISTO')
    rows.splice(3, 0, { key: 'switchPoe5', label: 'Switch 5 portas PoE', quantity: 1 });
  if (config.switchChoice === 'POE_10')
    rows.splice(3, 0, { key: 'switchPoe10', label: 'Switch 10 portas PoE', quantity: 1 });
  return rows;
}

export function resolveKitRows(config: KitConfig, items: Item[]): KitRow[] {
  return [
    ...suggestedRows(config).map(row => ({
      key: row.key, label: row.label,
      item_id: config.overrides[row.key]?.item_id ?? defaultItemForRole(items, row.key, config.relay)?.id ?? '',
      quantidade: config.overrides[row.key]?.quantidade ?? row.quantity,
    })),
    ...config.extras,
  ];
}

export function recommendedRelay(cameraCount: number) {
  return [1, 2, 4, 6, 8].find(capacity => capacity >= cameraCount) ?? 8;
}
