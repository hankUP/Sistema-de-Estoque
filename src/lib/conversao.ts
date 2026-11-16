/**
 * Utilitários de conversão entre unidade de compra (embalagem) e unidade de estoque
 * (controle interno).
 *
 * Regra:
 *   1 unidade_compra = fator_conversao × unidade_estoque
 *
 * Exemplo:
 *   - unidade_estoque = "un"
 *   - unidade_compra = "caixa"
 *   - fator_conversao = 100
 *   - 10 caixas = 1000 unidades
 *   - R$ 100 / caixa = R$ 1 / unidade
 *
 * Override: o vínculo item-fornecedor pode definir sua própria unidade_compra e
 * fator_conversao (cada fornecedor pode embalar diferente). Quando NULL, herda do item.
 *
 * Compatibilidade: itens/vínculos sem fator definido assumem fator = 1
 * (preço já por unidade de estoque, comportamento anterior).
 */

export type ItemUnidadeInfo = {
  unidade?: string | null;
  unidade_compra?: string | null;
  fator_conversao?: number | null;
};

export type VinculoUnidadeOverride = {
  unidade_compra?: string | null;
  fator_conversao?: number | null;
};

/**
 * Resolve a unidade de compra e o fator efetivos considerando override do vínculo.
 * Retorna sempre valores normalizados (fator >= 1, unidades não-vazias).
 */
export function resolverUnidades(
  item: ItemUnidadeInfo | null | undefined,
  vinculo?: VinculoUnidadeOverride | null,
): { unidadeEstoque: string; unidadeCompra: string; fator: number } {
  const unidadeEstoque = (item?.unidade || "un").trim() || "un";

  const fatorVinculo = vinculo?.fator_conversao;
  const fatorItem = item?.fator_conversao;
  const fatorBruto =
    fatorVinculo != null && Number(fatorVinculo) > 0
      ? Number(fatorVinculo)
      : fatorItem != null && Number(fatorItem) > 0
        ? Number(fatorItem)
        : 1;
  const fator = fatorBruto > 0 ? fatorBruto : 1;

  const unidadeCompraVinculo = vinculo?.unidade_compra?.trim();
  const unidadeCompraItem = item?.unidade_compra?.trim();
  const unidadeCompra =
    unidadeCompraVinculo ||
    unidadeCompraItem ||
    unidadeEstoque; // sem campo definido = mesma da unidade de estoque

  return { unidadeEstoque, unidadeCompra, fator };
}

/** Converte quantidade em unidade de compra para quantidade em unidade de estoque. */
export function compraParaEstoque(qtdCompra: number, fator: number): number {
  const f = fator > 0 ? fator : 1;
  return qtdCompra * f;
}

/** Converte quantidade em unidade de estoque para quantidade em unidade de compra. */
export function estoqueParaCompra(qtdEstoque: number, fator: number): number {
  const f = fator > 0 ? fator : 1;
  return qtdEstoque / f;
}

/** Converte preço por unidade de compra (R$/embalagem) em preço por unidade de estoque (R$/un). */
export function precoCompraParaEstoque(precoCompra: number, fator: number): number {
  const f = fator > 0 ? fator : 1;
  return precoCompra / f;
}

/** Converte preço por unidade de estoque em preço por unidade de compra. */
export function precoEstoqueParaCompra(precoEstoque: number, fator: number): number {
  const f = fator > 0 ? fator : 1;
  return precoEstoque * f;
}

/**
 * Verdadeiro quando o item tem embalagem distinta da unidade de estoque
 * (fator > 1 ou unidade_compra explicitamente diferente).
 */
export function temEmbalagem(item: ItemUnidadeInfo | null | undefined, vinculo?: VinculoUnidadeOverride | null): boolean {
  const { unidadeEstoque, unidadeCompra, fator } = resolverUnidades(item, vinculo);
  return fator > 1 || unidadeCompra !== unidadeEstoque;
}

/**
 * Formata um preço com a indicação dual: "R$ X por embalagem (R$ Y por unidade)".
 * Quando não há embalagem distinta, retorna apenas "R$ X por unidade".
 */
export function formatPrecoDual(
  precoCompra: number,
  fator: number,
  unidadeCompra: string,
  unidadeEstoque: string,
  formatBRL: (v: number) => string,
): string {
  if (fator <= 1 && unidadeCompra === unidadeEstoque) {
    return `${formatBRL(precoCompra)} / ${unidadeEstoque}`;
  }
  const precoEstoque = precoCompraParaEstoque(precoCompra, fator);
  return `${formatBRL(precoCompra)} / ${unidadeCompra} (${formatBRL(precoEstoque)} / ${unidadeEstoque})`;
}

/**
 * Formata uma quantidade com a indicação dual: "10 caixas (1000 un)".
 * Quando não há embalagem distinta, retorna apenas a unidade simples.
 */
export function formatQtdDual(
  qtdCompra: number,
  fator: number,
  unidadeCompra: string,
  unidadeEstoque: string,
): string {
  if (fator <= 1 && unidadeCompra === unidadeEstoque) {
    return `${qtdCompra} ${unidadeEstoque}`;
  }
  const qtdEstoque = compraParaEstoque(qtdCompra, fator);
  // Mostra inteiro quando possível
  const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2));
  return `${fmt(qtdCompra)} ${unidadeCompra} (${fmt(qtdEstoque)} ${unidadeEstoque})`;
}
