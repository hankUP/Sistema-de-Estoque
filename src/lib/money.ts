/**
 * Utilitários centrais para valores monetários em Real (BRL).
 *
 * Padrão de exibição: "R$ 1.234,56" (sempre com 2 casas decimais e vírgula).
 * Padrão de armazenamento em estado/DB: número com ponto decimal (ex: "1234.56").
 */

/** Formata um número como moeda brasileira: R$ 1.234,56 */
export function formatBRL(n: number | null | undefined): string {
  const v = Number(n ?? 0);
  if (!Number.isFinite(v)) return "R$ 0,00";
  return v.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/**
 * Converte uma string monetária digitada pelo usuário em número.
 * Aceita "1.234,56", "1234,56", "1234.56", "R$ 12,50", etc.
 */
export function parseBRL(input: string | number | null | undefined): number {
  if (input == null) return 0;
  if (typeof input === "number") return Number.isFinite(input) ? input : 0;
  const cleaned = input
    .toString()
    .replace(/[^\d,.-]/g, "")
    .replace(/\.(?=\d{3}(\D|$))/g, "") // remove separadores de milhar
    .replace(",", ".");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Converte um valor de estado (string com ponto decimal ou número) para o display
 * formatado em BRL com vírgula e separadores de milhar — sem o prefixo "R$".
 * Útil dentro de inputs com prefixo visual fixo.
 */
export function toBRLDisplay(value: string | number | null | undefined): string {
  const n = typeof value === "string" ? parseBRL(value) : Number(value ?? 0);
  if (!Number.isFinite(n)) return "0,00";
  return n.toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/**
 * Converte os dígitos digitados pelo usuário em um valor monetário.
 * O usuário digita apenas dígitos e a vírgula é preenchida automaticamente
 * pelas duas últimas casas (centavos).
 *
 * Ex: digitar "1250" → exibe "12,50" (valor numérico 12.50)
 *     digitar "5"    → exibe "0,05"
 *     digitar ""     → valor 0
 */
export function digitsToBRL(digits: string): { display: string; value: number } {
  const onlyDigits = (digits || "").replace(/\D/g, "").replace(/^0+(?=\d)/, "");
  if (!onlyDigits) return { display: "0,00", value: 0 };
  const padded = onlyDigits.padStart(3, "0");
  const intPart = padded.slice(0, -2);
  const decPart = padded.slice(-2);
  const intFmt = Number(intPart).toLocaleString("pt-BR");
  return {
    display: `${intFmt},${decPart}`,
    value: Number(`${intPart}.${decPart}`),
  };
}
