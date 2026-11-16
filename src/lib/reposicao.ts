/**
 * Lógica central de reposição / sugestão de compras.
 *
 * Compatibilidade total com o sistema antigo:
 * - Quando `politica_reposicao` é null/undefined, usa exatamente a lógica
 *   atual (estoque ideal / máximo / mínimo*2).
 * - Novas políticas ("estoque_minimo" e "cobertura") são opt-in por item.
 * - Os campos antigos (estoque_minimo, estoque_ideal, estoque_maximo,
 *   lead_time_dias, consumo_diario) NUNCA são alterados ou renomeados.
 */

import type { Item } from "@/hooks/useItems";
import type { StockEntry } from "@/hooks/useStock";

export type SugestaoMotivo =
  | "OK"
  | "SEM_NECESSIDADE"
  | "CONSUMO_INVALIDO"
  | "COBERTURA_INVALIDA"
  | "QTD_INSIGNIFICANTE"
  | "DADOS_INSUFICIENTES";

export type SugestaoCalculo = {
  /** Quantidade a comprar (já arredondada e protegida). 0 = não sugerir. */
  qtd_sugerida: number;
  /** Estoque-alvo usado no cálculo. */
  alvo: number;
  /** Política efetivamente aplicada. */
  politica_usada: "padrao" | "estoque_minimo" | "cobertura";
  /** Consumo diário usado no cálculo. */
  consumo_usado: number;
  /** Motivo (útil pra UI mostrar "dados insuficientes" etc). */
  motivo: SugestaoMotivo;
  /** True quando o consumo tem baixa amostragem (<3 dias com movimento). */
  baixa_confiabilidade: boolean;
  /** Texto explicando como o cálculo foi feito (para tooltip/log). */
  explicacao: string;
};

/** Valor mínimo para considerar uma sugestão "significante". */
const QTD_MINIMA = 1;
/** Horizonte máximo (em dias) para alertar sobre cobertura exagerada. */
const HORIZONTE_MAX_DIAS = 365;

/**
 * Calcula a sugestão de compra para um item, respeitando a política configurada.
 *
 * @param entry  Estoque atual + métricas calculadas pelo useStock
 * @param consumoDiario  Consumo diário a usar (já decidido pelo chamador: real ou cadastrado)
 * @param emCompraNoPrazo  Quantidade já em compra que chega a tempo (pra descontar do alvo)
 * @param diasCoberturaOverride  Cobertura alvo global vinda da UI (sobrepõe item se >0)
 */
export function calcularSugestao(
  entry: StockEntry,
  consumoDiario: number,
  emCompraNoPrazo: number,
  diasCoberturaOverride: number = 0,
): SugestaoCalculo {
  const item = entry.item as Item;
  const estoque_minimo = Number(item.estoque_minimo) || 0;
  const estoque_ideal = Number(item.estoque_ideal) || 0;
  const estoque_maximo = Number(item.estoque_maximo) || 0;
  const lead_time_dias = Number(item.lead_time_dias) || 0;
  const politica = item.politica_reposicao ?? null;
  const baixa_confiabilidade = entry.baixaConfiabilidade;

  // ------------------------------------------------------------------
  // 1) Política COBERTURA (nova, isolada — só se explicitamente ativada
  //    OU quando o usuário definiu cobertura global na UI).
  // ------------------------------------------------------------------
  const coberturaItem = Number(item.cobertura_desejada) || 0;
  const usarCobertura =
    diasCoberturaOverride > 0 || politica === "cobertura";

  if (usarCobertura) {
    const diasAlvo =
      diasCoberturaOverride > 0 ? diasCoberturaOverride : coberturaItem;

    if (diasAlvo <= 0) {
      return naoSugerir("cobertura", consumoDiario, baixa_confiabilidade,
        "COBERTURA_INVALIDA", "Cobertura desejada não definida ou inválida.");
    }
    if (!(consumoDiario > 0)) {
      return naoSugerir("cobertura", consumoDiario, baixa_confiabilidade,
        "CONSUMO_INVALIDO", "Sem consumo diário válido para calcular cobertura.");
    }
    if (diasAlvo + lead_time_dias > HORIZONTE_MAX_DIAS) {
      // Não bloqueia, apenas registra na explicação.
    }

    const alvo = consumoDiario * (lead_time_dias + diasAlvo);
    const compraBruta = alvo - entry.disponivel - emCompraNoPrazo;
    const qtd = Math.max(0, Math.ceil(compraBruta));

    if (qtd <= 0) {
      return {
        qtd_sugerida: 0, alvo, politica_usada: "cobertura",
        consumo_usado: consumoDiario, motivo: "SEM_NECESSIDADE",
        baixa_confiabilidade,
        explicacao: `Alvo cobertura = consumo (${consumoDiario}) × (lead ${lead_time_dias} + cobertura ${diasAlvo}) = ${round(alvo)}; disponível ${entry.disponivel} + em compra no prazo ${emCompraNoPrazo} já atende.`,
      };
    }
    if (qtd < QTD_MINIMA) {
      return naoSugerir("cobertura", consumoDiario, baixa_confiabilidade,
        "QTD_INSIGNIFICANTE", `Necessidade calculada (${round(compraBruta)}) abaixo do mínimo (${QTD_MINIMA}).`);
    }
    return {
      qtd_sugerida: qtd, alvo, politica_usada: "cobertura",
      consumo_usado: consumoDiario, motivo: "OK",
      baixa_confiabilidade,
      explicacao: `Cobertura: alvo ${round(alvo)} = ${consumoDiario}/dia × (lead ${lead_time_dias} + cobertura ${diasAlvo}). Comprar ${qtd} para fechar a necessidade.`,
    };
  }

  // ------------------------------------------------------------------
  // 2) Política ESTOQUE MÍNIMO (nova, mas usa só campos antigos)
  // ------------------------------------------------------------------
  if (politica === "estoque_minimo") {
    if (entry.disponivel > estoque_minimo) {
      return {
        qtd_sugerida: 0, alvo: estoque_minimo, politica_usada: "estoque_minimo",
        consumo_usado: consumoDiario, motivo: "SEM_NECESSIDADE",
        baixa_confiabilidade,
        explicacao: `Disponível ${entry.disponivel} acima do mínimo ${estoque_minimo}.`,
      };
    }
    const alvo = estoque_maximo > 0 ? estoque_maximo : (estoque_ideal > 0 ? estoque_ideal : estoque_minimo);
    const compraBruta = alvo - entry.disponivel - emCompraNoPrazo;
    const qtd = Math.max(0, Math.ceil(compraBruta));
    if (qtd <= 0) {
      return {
        qtd_sugerida: 0, alvo, politica_usada: "estoque_minimo",
        consumo_usado: consumoDiario, motivo: "SEM_NECESSIDADE",
        baixa_confiabilidade,
        explicacao: `Alvo ${alvo}; já coberto por disponível + em compra no prazo.`,
      };
    }
    return {
      qtd_sugerida: qtd, alvo, politica_usada: "estoque_minimo",
      consumo_usado: consumoDiario, motivo: "OK",
      baixa_confiabilidade,
      explicacao: `Estoque mínimo: disponível ${entry.disponivel} ≤ mínimo ${estoque_minimo}; alvo ${alvo}; comprar ${qtd}.`,
    };
  }

  // ------------------------------------------------------------------
  // 3) Política PADRÃO (comportamento atual — NÃO alterar!)
  // ------------------------------------------------------------------
  const alvo = estoque_ideal > 0 ? estoque_ideal : (estoque_maximo > 0 ? estoque_maximo : estoque_minimo * 2);
  const compraBruta = consumoDiario > 0
    ? alvo - entry.disponivel - emCompraNoPrazo
    : alvo - entry.disponivel - entry.em_compra;
  const qtd = Math.max(0, Math.ceil(compraBruta));

  if (qtd <= 0) {
    return {
      qtd_sugerida: 0, alvo, politica_usada: "padrao",
      consumo_usado: consumoDiario, motivo: "SEM_NECESSIDADE",
      baixa_confiabilidade,
      explicacao: `Alvo ${alvo}; já coberto.`,
    };
  }
  return {
    qtd_sugerida: qtd, alvo, politica_usada: "padrao",
    consumo_usado: consumoDiario, motivo: "OK",
    baixa_confiabilidade,
    explicacao: `Padrão: alvo ${alvo} (ideal/máximo/mín×2); comprar ${qtd}.`,
  };
}

function naoSugerir(
  politica: SugestaoCalculo["politica_usada"],
  consumo: number,
  baixa: boolean,
  motivo: SugestaoMotivo,
  explicacao: string,
): SugestaoCalculo {
  return {
    qtd_sugerida: 0, alvo: 0, politica_usada: politica,
    consumo_usado: consumo, motivo, baixa_confiabilidade: baixa, explicacao,
  };
}

function round(n: number) {
  return Math.round(n * 100) / 100;
}

/** Log estruturado opcional (ativável com localStorage.debug_reposicao = "1"). */
export function logCalculo(itemNome: string, calc: SugestaoCalculo) {
  if (typeof window === "undefined") return;
  if (localStorage.getItem("debug_reposicao") !== "1") return;
  console.debug(`[reposicao] ${itemNome}`, calc);
}
