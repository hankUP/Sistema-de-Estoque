/**
 * Helpers de exibição para OPs (simples e compostas).
 *
 * Uma OP é composta quando tem mais de uma linha em production_order_items.
 * O nome de exibição é, por ordem de prioridade:
 *   1) order.nome_conjunto (definido pelo usuário)
 *   2) "Conjunto: A + B + C" (auto, gerado a partir dos sub-produtos)
 *   3) Nome do item principal (OP simples)
 */
export type SubProductLite = {
  item_id: string;
  quantidade: number;
  nome_snapshot?: string | null;
  item?: { nome?: string | null } | null;
};

export function getSubProductName(sp: SubProductLite, fallback?: string | null): string {
  return sp.item?.nome || sp.nome_snapshot || fallback || "—";
}

export function isCompositeOrder(subs: SubProductLite[] | undefined | null): boolean {
  return !!subs && subs.length > 1;
}

/**
 * Gera o nome automático de um conjunto a partir dos sub-produtos.
 * Ex.: ["Kit A", "Kit B"] → "Conjunto: Kit A + Kit B"
 */
export function buildAutoConjuntoName(subs: SubProductLite[]): string {
  const names = subs.map((s) => getSubProductName(s));
  if (names.length === 0) return "Conjunto vazio";
  if (names.length === 1) return names[0];
  return `Conjunto: ${names.join(" + ")}`;
}

/**
 * Nome final exibido para a OP (composta ou simples).
 */
export function getOrderDisplayName(opts: {
  nome_conjunto?: string | null;
  subs?: SubProductLite[] | null;
  fallbackName?: string | null;
}): string {
  const { nome_conjunto, subs, fallbackName } = opts;
  if (nome_conjunto && nome_conjunto.trim().length > 0) return nome_conjunto.trim();
  if (subs && subs.length > 0) {
    if (subs.length === 1) return getSubProductName(subs[0], fallbackName);
    return buildAutoConjuntoName(subs);
  }
  return fallbackName || "—";
}
