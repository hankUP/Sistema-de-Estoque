/**
 * Utilitários de custo unitário por item.
 *
 * Estratégia híbrida — prioridade:
 *   1. Preço do fornecedor principal/escolhido (CADASTRO)
 *   2. Último preço REAL praticado em compras (snapshot do histórico)  ← novo
 *   3. Custo médio ponderado (entradas reais)
 *   4. Custo de referência cadastrado no item (fallback)
 *
 * Isso garante que sempre exista um valor coerente, mesmo quando alguns dos
 * sinais ainda não foram preenchidos.
 *
 * IMPORTANTE — Unidade:
 *   - `preco_unitario` (vínculo) e `custo_unitario` (item) são por UNIDADE DE COMPRA
 *     (R$/embalagem, ex: R$/caixa).
 *   - `custo_medio` é por UNIDADE DE ESTOQUE (R$/unidade) porque o trigger de custo
 *     médio recebe os movimentos já convertidos.
 *   - `precoUltimaCompra` (histórico) já é por UNIDADE DE COMPRA da época do pedido.
 *   - Este resolver retorna sempre o custo POR UNIDADE DE ESTOQUE — divide preço de
 *     compra pelo fator de conversão efetivo.
 *
 * Use estas funções para estimativas de compra; os preços reais ficam no
 * histórico de compras e movimentações.
 */

export type ItemForCost = {
  id: string;
  custo_medio?: number | null;
  custo_unitario?: number | null;
  /** Padrão do item para conversão embalagem → unidade. */
  fator_conversao?: number | null;
};

export type ItemFornecedorForCost = {
  item_id: string;
  preco_unitario: number | null;
  principal: boolean;
  ativo: boolean;
  /** Override opcional do vínculo. NULL = usa o do item. */
  fator_conversao?: number | null;
};

/** Origem do custo retornado — útil para exibir "fonte" na UI. */
export type FonteCusto = "fornecedor" | "ultima_compra" | "custo_medio" | "referencia" | "indisponivel";

export type CustoResolvido = {
  /** Custo final por UNIDADE DE ESTOQUE. 0 quando indisponível. */
  valor: number;
  fonte: FonteCusto;
  /** Preço bruto e fator usados (para tooltip / debug). */
  precoCompra?: number;
  fator?: number;
};

function fatorEfetivo(item: ItemForCost | null | undefined, vinc?: ItemFornecedorForCost | null): number {
  const v = vinc?.fator_conversao;
  if (v != null && Number(v) > 0) return Number(v);
  const i = item?.fator_conversao;
  if (i != null && Number(i) > 0) return Number(i);
  return 1;
}

/**
 * Resolve o custo unitário POR UNIDADE DE ESTOQUE de UM item, considerando o
 * fator de conversão (preço de compra é por embalagem). Retorna 0 quando nenhuma
 * fonte estiver disponível.
 */
export function resolveItemUnitCost(
  item: ItemForCost | null | undefined,
  itemFornecedores: readonly ItemFornecedorForCost[] | null | undefined,
  /** Mapa opcional itemId → último preço real comprado (R$/embalagem). */
  ultimaCompraPorItem?: ReadonlyMap<string, number> | null,
): number {
  return resolveItemUnitCostDetailed(item, itemFornecedores, ultimaCompraPorItem).valor;
}

/**
 * Versão detalhada — devolve também a fonte usada. Útil para a UI mostrar
 * "fonte: fornecedor / última compra / médio / referência".
 */
export function resolveItemUnitCostDetailed(
  item: ItemForCost | null | undefined,
  itemFornecedores: readonly ItemFornecedorForCost[] | null | undefined,
  ultimaCompraPorItem?: ReadonlyMap<string, number> | null,
): CustoResolvido {
  if (!item) return { valor: 0, fonte: "indisponivel" };

  // 1) Fornecedor principal ativo com preço > 0 (preço por embalagem → divide pelo fator efetivo)
  const principal = (itemFornecedores || []).find(
    (f) => f.item_id === item.id && f.principal && f.ativo && (f.preco_unitario ?? 0) > 0,
  );
  if (principal && principal.preco_unitario && principal.preco_unitario > 0) {
    const f = fatorEfetivo(item, principal);
    return {
      valor: Number(principal.preco_unitario) / f,
      fonte: "fornecedor",
      precoCompra: Number(principal.preco_unitario),
      fator: f,
    };
  }

  // 2) Último preço real praticado em compras (já por embalagem) — só se houver mapa
  const ultima = ultimaCompraPorItem?.get(item.id);
  if (ultima != null && Number(ultima) > 0) {
    const f = fatorEfetivo(item, null);
    return {
      valor: Number(ultima) / f,
      fonte: "ultima_compra",
      precoCompra: Number(ultima),
      fator: f,
    };
  }

  // 3) Custo médio ponderado (calculado pelo trigger no banco — JÁ por unidade de estoque)
  const medio = Number(item.custo_medio ?? 0);
  if (medio > 0) {
    return { valor: medio, fonte: "custo_medio" };
  }

  // 4) Custo unitário de referência (por embalagem → divide pelo fator do item)
  const unit = Number(item.custo_unitario ?? 0);
  if (unit > 0) {
    const f = fatorEfetivo(item, null);
    return {
      valor: unit / f,
      fonte: "referencia",
      precoCompra: unit,
      fator: f,
    };
  }

  return { valor: 0, fonte: "indisponivel" };
}

/**
 * Cria um índice por item_id para resolução em lote (mais eficiente quando
 * iterando uma BOM grande).
 */
export function buildCostResolver(
  items: readonly ItemForCost[] | null | undefined,
  itemFornecedores: readonly ItemFornecedorForCost[] | null | undefined,
  ultimaCompraPorItem?: ReadonlyMap<string, number> | null,
) {
  const itemMap = new Map<string, ItemForCost>();
  (items || []).forEach((i) => itemMap.set(i.id, i));
  return (itemId: string): number => {
    const it = itemMap.get(itemId);
    return resolveItemUnitCost(it, itemFornecedores, ultimaCompraPorItem);
  };
}

/** Label amigável da fonte, usado em tooltips e textos de copiar/enviar. */
export function fonteCustoLabel(fonte: FonteCusto): string {
  switch (fonte) {
    case "fornecedor": return "preço do fornecedor";
    case "ultima_compra": return "última compra real";
    case "custo_medio": return "custo médio do estoque";
    case "referencia": return "custo de referência";
    case "indisponivel": return "sem preço cadastrado";
  }
}
