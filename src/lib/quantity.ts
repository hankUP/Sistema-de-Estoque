/**
 * Utilitários centrais para exibição de QUANTIDADES com a unidade
 * cadastrada do item (ou unidade de compra, quando aplicável).
 *
 * Regra de ouro: nunca exibir um número de item sem a unidade ao lado.
 *
 * Exemplos:
 *   formatQuantity(5, "m")             → "5 m"
 *   formatQuantity(0.5, "m", { suffix: "/dia" })  → "0,5 m/dia"
 *   formatQuantity(1000, "un")         → "1.000 un"
 *   formatQuantity(2.5, "kg")          → "2,5 kg"
 *   formatQuantity(3, "caixa", { conversao: { fator: 50, unidadeEstoque: "un" } })
 *     → "3 caixas (150 un)"
 */

const fmtPtBR = (n: number, max = 2) =>
  n.toLocaleString("pt-BR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: max,
  });

/** Pluraliza unidades comuns em pt-BR. Conservador: só pluraliza palavras conhecidas. */
function pluralizeUnit(unit: string, value: number): string {
  const u = unit.trim();
  if (!u) return u;
  // singular se |valor| <= 1
  if (Math.abs(value) <= 1) return u;
  const lower = u.toLowerCase();
  // unidades abreviadas / símbolos não pluralizam
  const abrevs = new Set([
    "un", "und", "pc", "pç", "m", "cm", "mm", "km", "m²", "m2", "m³", "m3",
    "kg", "g", "mg", "t", "l", "ml", "h", "min", "s", "%",
  ]);
  if (abrevs.has(lower)) return u;
  // termina em vogal ou consoante específica → adiciona 's'
  if (/[aeiouáéíóú]$/i.test(u)) return u + "s";
  if (/(r|z|s)$/i.test(u)) return u + "es";
  // genérico
  return u + "s";
}

export type FormatQuantityOptions = {
  /** Sufixo após a unidade (ex: "/dia"). */
  suffix?: string;
  /** Casas decimais máximas (default 2; remove zeros à direita). */
  decimals?: number;
  /** Pluralizar palavra da unidade (default true). */
  pluralize?: boolean;
  /** Mostrar conversão entre parênteses (ex: "3 caixas (150 un)"). */
  conversao?: { fator: number; unidadeEstoque: string };
};

/**
 * Formata um valor numérico com a unidade cadastrada do item.
 * Se a unidade for vazia, retorna apenas o número formatado.
 */
export function formatQuantity(
  value: number | string | null | undefined,
  unit: string | null | undefined,
  opts: FormatQuantityOptions = {},
): string {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return "—";
  const decimals = opts.decimals ?? 2;
  const numStr = fmtPtBR(n, decimals);
  const u = (unit || "").trim();
  if (!u) return opts.suffix ? `${numStr}${opts.suffix}` : numStr;
  const unidadeFinal = opts.pluralize === false ? u : pluralizeUnit(u, n);
  let base = `${numStr} ${unidadeFinal}${opts.suffix ?? ""}`;
  if (opts.conversao && opts.conversao.fator > 1) {
    const equiv = n * opts.conversao.fator;
    const equivStr = fmtPtBR(equiv, decimals);
    const unidadeEquiv = pluralizeUnit(opts.conversao.unidadeEstoque, equiv);
    base += ` (${equivStr} ${unidadeEquiv})`;
  }
  return base;
}

/** Atalho: formata consumo diário ("0,5 m/dia"). */
export function formatConsumoDiario(
  value: number | null | undefined,
  unit: string | null | undefined,
  decimals = 2,
): string {
  return formatQuantity(value, unit, { suffix: "/dia", decimals, pluralize: false });
}

/** Atalho: número sem unidade (uso interno em colunas onde a unidade fica em outra coluna). */
export function formatNumber(value: number | null | undefined, decimals = 2): string {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return "—";
  return fmtPtBR(n, decimals);
}
