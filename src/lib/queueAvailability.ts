/**
 * Cálculo CENTRALIZADO de disponibilidade de insumos por OP, em cascata,
 * respeitando a ordem da fila de produção.
 *
 * A partir da introdução de OPs compostas, cada OP é tratada como um
 * conjunto de sub-produtos (production_order_items). O consumo total
 * é a soma da BOM de cada sub-produto × sua quantidade.
 *
 * Componentes iguais entre sub-produtos são agregados para o cálculo
 * (decisão única por componente, não por sub-produto).
 */
export type AvailabilityStatus = "ATENDIVEL" | "BLOQUEADA";

export type MissingComponent = {
  itemId: string;
  nome: string;
  necessario: number;
  disponivelAntes: number;
  faltando: number;
};

export type ProjectedConsumption = {
  itemId: string;
  nome: string;
  necessario: number;
  saldoApos: number;
};

export type QueueAvailabilityRow = {
  op_id: string;
  queue_position: number;
  can_start: boolean;
  availability_status: AvailabilityStatus;
  missing_components: MissingComponent[];
  projected_consumption: ProjectedConsumption[];
};

export type BomEntry = {
  item_pai_id: string;
  item_componente_id: string;
  quantidade: number;
  item_componente?: { nome?: string | null } | null;
};

export type StockEntry = {
  item: { id: string; nome?: string };
  fisico: number;
};

/**
 * Sub-produto da OP: um item produzido (BOM) com sua quantidade.
 * Para OPs simples, a lista terá 1 elemento.
 */
export type OrderItemForQueue = {
  item_id: string;
  quantidade: number;
};

export type OrderForQueue = {
  id: string;
  status: string;
  ordem: number;
  /** Sub-produtos (BOMs) que compõem a OP. Para OPs simples, 1 entrada. */
  items: OrderItemForQueue[];
};

/**
 * Substituições por OP: mapa op_id → (item_original_id → item_substituto_id).
 */
export type SubstitutionsByOrder = Map<string, Map<string, string>>;

function collectOrderNeeds(
  order: OrderForQueue,
  bom: BomEntry[],
  nomes: Record<string, string>,
  substitutionsByOrder?: SubstitutionsByOrder,
) {
  const subsForOp = substitutionsByOrder?.get(order.id);
  const needed = new Map<string, { qty: number; nome?: string }>();

  for (const sub of order.items) {
    const components = bom.filter((b) => b.item_pai_id === sub.item_id);
    for (const comp of components) {
      const necessario = Number(comp.quantidade) * Number(sub.quantidade);
      const effectiveItemId =
        subsForOp?.get(comp.item_componente_id) ?? comp.item_componente_id;
      const cur = needed.get(effectiveItemId) || { qty: 0 };
      cur.qty += necessario;
      cur.nome = cur.nome || nomes[effectiveItemId] || comp.item_componente?.nome || undefined;
      needed.set(effectiveItemId, cur);
    }
  }

  return needed;
}

export function calculateProductionQueueAvailability(
  orders: OrderForQueue[],
  bom: BomEntry[],
  stock: StockEntry[],
  substitutionsByOrder?: SubstitutionsByOrder,
): Map<string, QueueAvailabilityRow> {
  const ativos = orders
    .filter((o) => o.status === "PLANEJADA" || o.status === "EM_PRODUCAO")
    .sort((a, b) => a.ordem - b.ordem);

  const restante: Record<string, number> = {};
  const nomes: Record<string, string> = {};
  stock.forEach((s) => {
    restante[s.item.id] = s.fisico;
    if (s.item.nome) nomes[s.item.id] = s.item.nome;
  });
  bom.forEach((b) => {
    if (b.item_componente?.nome && !nomes[b.item_componente_id]) {
      nomes[b.item_componente_id] = b.item_componente.nome;
    }
  });

  const result = new Map<string, QueueAvailabilityRow>();

  ativos.forEach((order, idx) => {
    // 1) Agrega necessidade de componentes somando todos os sub-produtos
    //    da OP. Mesma chave (itemId efetivo após substituição) soma.
    const needed = collectOrderNeeds(order, bom, nomes, substitutionsByOrder);

    // 2) Aplica contra o saldo projetado e coleta faltas/consumo.
    const missing: MissingComponent[] = [];
    const consumption: ProjectedConsumption[] = [];

    for (const [itemId, info] of needed.entries()) {
      const necessario = info.qty;
      const disponivelAntes = restante[itemId] ?? 0;
      const saldoApos = disponivelAntes - necessario;
      const nome = info.nome || nomes[itemId] || "—";

      consumption.push({ itemId, nome, necessario, saldoApos });

      if (saldoApos < 0) {
        missing.push({
          itemId,
          nome,
          necessario,
          disponivelAntes: Math.max(0, disponivelAntes),
          faltando: Math.ceil(-saldoApos),
        });
      }

      restante[itemId] = saldoApos;
    }

    const status: AvailabilityStatus = missing.length > 0 ? "BLOQUEADA" : "ATENDIVEL";
    result.set(order.id, {
      op_id: order.id,
      queue_position: idx + 1,
      can_start: status === "ATENDIVEL",
      availability_status: status,
      missing_components: missing,
      projected_consumption: consumption,
    });
  });

  return result;
}

/**
 * Validação operacional de uma OP específica.
 * Considera estoque físico + consumo projetado das OPs acima e ignora totalmente OPs abaixo.
 */
export function canStartOrder(
  orderId: string,
  orders: OrderForQueue[],
  bom: BomEntry[],
  stock: StockEntry[],
  substitutionsByOrder?: SubstitutionsByOrder,
): QueueAvailabilityRow {
  const ativos = orders
    .filter((o) => o.status === "PLANEJADA" || o.status === "EM_PRODUCAO")
    .sort((a, b) => a.ordem - b.ordem);
  const orderIndex = ativos.findIndex((o) => o.id === orderId);

  if (orderIndex < 0) {
    throw new Error("Ordem de produção não encontrada na fila ativa.");
  }

  const restante: Record<string, number> = {};
  const nomes: Record<string, string> = {};
  stock.forEach((s) => {
    restante[s.item.id] = s.fisico;
    if (s.item.nome) nomes[s.item.id] = s.item.nome;
  });
  bom.forEach((b) => {
    if (b.item_componente?.nome && !nomes[b.item_componente_id]) {
      nomes[b.item_componente_id] = b.item_componente.nome;
    }
  });

  for (const priorOrder of ativos.slice(0, orderIndex)) {
    const priorNeeds = collectOrderNeeds(priorOrder, bom, nomes, substitutionsByOrder);
    for (const [itemId, info] of priorNeeds.entries()) {
      restante[itemId] = (restante[itemId] ?? 0) - info.qty;
    }
  }

  const currentOrder = ativos[orderIndex];
  const currentNeeds = collectOrderNeeds(currentOrder, bom, nomes, substitutionsByOrder);
  const missing: MissingComponent[] = [];
  const consumption: ProjectedConsumption[] = [];

  for (const [itemId, info] of currentNeeds.entries()) {
    const necessario = info.qty;
    const disponivelAntes = restante[itemId] ?? 0;
    const saldoApos = disponivelAntes - necessario;
    const nome = info.nome || nomes[itemId] || "—";

    consumption.push({ itemId, nome, necessario, saldoApos });

    if (saldoApos < 0) {
      missing.push({
        itemId,
        nome,
        necessario,
        disponivelAntes: Math.max(0, disponivelAntes),
        faltando: Math.ceil(-saldoApos),
      });
    }
  }

  const status: AvailabilityStatus = missing.length > 0 ? "BLOQUEADA" : "ATENDIVEL";
  return {
    op_id: currentOrder.id,
    queue_position: orderIndex + 1,
    can_start: status === "ATENDIVEL",
    availability_status: status,
    missing_components: missing,
    projected_consumption: consumption,
  };
}
