/**
 * MODO INTELIGÊNCIA — Sugestão de compras baseada em RISCO DE FALTA.
 *
 * IMPORTANTE: este arquivo é totalmente independente do `reposicao.ts` (Modo Padrão).
 * Nenhuma regra é compartilhada — a escolha do modo na UI define qual função
 * será chamada. Isso evita que regras de um modo "vazem" para o outro.
 *
 * Regras (em ordem de prioridade):
 *  1. Estoque disponível <= 0 → SEMPRE sugerir compra (ignora consumo/política).
 *  2. Consumo > 0 → regra normal de cobertura + lead time.
 *  3. Consumo = 0 → avalia risco (mínimo, criticidade, ABC A, política mínimo).
 */

import type { Item } from "@/hooks/useItems";
import type { StockEntry } from "@/hooks/useStock";
import type { ClasseABC } from "@/hooks/useCurvaABC";

export type ConfiancaConsumo = "alta" | "media" | "baixa" | "sem_dados";

export type MotivoInteligente =
  | "ESTOQUE_ZERADO"
  | "ABAIXO_DO_MINIMO"
  | "ACABA_ANTES_LEAD_TIME"
  | "COBERTURA_INSUFICIENTE"
  | "ITEM_CRITICO_SEM_CONSUMO"
  | "ABC_A_SEM_CONSUMO"
  | "POLITICA_MINIMO"
  | "SEM_CONSUMO_RECENTE"
  | "ESTOQUE_SUFICIENTE"
  | "SEM_NECESSIDADE";

export type SugestaoInteligente = {
  /** Quantidade sugerida (já arredondada). 0 = não sugerir. */
  qtd_sugerida: number;
  /** Estoque-alvo usado no cálculo. */
  alvo: number;
  /** Motivo principal da sugestão (drives badge na UI). */
  motivo: MotivoInteligente;
  /** Texto humano do motivo (curto, para badge). */
  motivo_label: string;
  /** Explicação detalhada (para tooltip / "ver detalhes"). */
  explicacao: string;
  /** Origem do cálculo: por consumo ou por recomposição (estoque alvo). */
  origem: "consumo" | "recomposicao" | "emergencia" | "nenhuma";
  /** Confiança dos dados de consumo. */
  confianca_consumo: ConfiancaConsumo;
  /** Score de prioridade (menor = mais urgente). */
  prioridade: number;
  /** Flags úteis para UI. */
  flags: {
    estoque_zerado: boolean;
    abaixo_do_minimo: boolean;
    acaba_antes_lead_time: boolean;
    item_critico: boolean;
    abc_a: boolean;
    sem_consumo_recente: boolean;
    consumo_zerado_no_periodo: boolean;
    poucos_dados: boolean;
  };
};

/** Quantidade mínima para considerar a sugestão "significante". */
const QTD_MINIMA = 1;

export type ContextoInteligencia = {
  /** Classe ABC do item (se classificado). */
  classeAbc?: ClasseABC | null;
  /** Cobertura alvo global vinda da UI (sobrepõe item se > 0). */
  diasCoberturaOverride?: number;
  /** Quantidade já em compra que chega a tempo (descontada do alvo). */
  emCompraNoPrazo?: number;
};

/**
 * Calcula a sugestão no MODO INTELIGÊNCIA.
 */
export function getSugestaoInteligente(
  entry: StockEntry,
  consumoDiario: number,
  ctx: ContextoInteligencia = {},
): SugestaoInteligente {
  const item = entry.item as Item;
  const estoque_minimo = Number(item.estoque_minimo) || 0;
  const estoque_ideal = Number(item.estoque_ideal) || 0;
  const estoque_maximo = Number(item.estoque_maximo) || 0;
  const lead_time_dias = Number(item.lead_time_dias) || 0;
  const politica = item.politica_reposicao ?? null;
  const cobertura_desejada_item = Number(item.cobertura_desejada) || 0;
  const diasCoberturaOverride = ctx.diasCoberturaOverride ?? 0;
  const emCompraNoPrazo = ctx.emCompraNoPrazo ?? 0;
  const classeAbc = ctx.classeAbc ?? null;

  const confianca = classificarConfianca(entry);
  const itemCritico = entry.status === "CRITICO";
  const abcA = classeAbc === "A";

  const flagsBase = {
    estoque_zerado: entry.disponivel <= 0,
    abaixo_do_minimo: entry.disponivel <= estoque_minimo,
    acaba_antes_lead_time: false,
    item_critico: itemCritico,
    abc_a: abcA,
    sem_consumo_recente: !(consumoDiario > 0),
    consumo_zerado_no_periodo: !(entry.consumoDiario > 0),
    poucos_dados: entry.baixaConfiabilidade,
  };

  // ------------------------------------------------------------------
  // PRIORIDADE 1: Estoque <= 0 → SEMPRE sugerir
  // ------------------------------------------------------------------
  if (entry.disponivel <= 0) {
    const alvo = alvoRecomposicao(estoque_ideal, estoque_maximo, estoque_minimo);
    const qtd = Math.max(QTD_MINIMA, Math.ceil(alvo - entry.disponivel - emCompraNoPrazo));
    return {
      qtd_sugerida: qtd,
      alvo,
      motivo: "ESTOQUE_ZERADO",
      motivo_label: "Estoque zerado",
      explicacao: `Disponível ${entry.disponivel} ≤ 0. Recompor até o alvo ${alvo} (ideal/máximo/mínimo).`,
      origem: "emergencia",
      confianca_consumo: confianca,
      prioridade: 1,
      flags: { ...flagsBase, estoque_zerado: true },
    };
  }

  // ------------------------------------------------------------------
  // PRIORIDADE 2: Consumo > 0 → regra de cobertura + lead time
  // ------------------------------------------------------------------
  if (consumoDiario > 0) {
    const diasCoberturaAlvo =
      diasCoberturaOverride > 0
        ? diasCoberturaOverride
        : politica === "cobertura" && cobertura_desejada_item > 0
          ? cobertura_desejada_item
          : 0;

    // Alvo: se houver cobertura definida, usa cobertura + lead time
    // Senão, usa estoque_ideal (ou máximo, ou mínimo×2) — comportamento clássico
    const alvo =
      diasCoberturaAlvo > 0
        ? consumoDiario * (lead_time_dias + diasCoberturaAlvo)
        : alvoRecomposicao(estoque_ideal, estoque_maximo, estoque_minimo * 2);

    const ponto_pedido = estoque_minimo + consumoDiario * lead_time_dias + entry.reservado;
    const acabaAntesLeadTime = entry.disponivel < consumoDiario * lead_time_dias;
    const abaixoPontoPedido = entry.disponivel <= ponto_pedido;
    const abaixoMinimo = entry.disponivel <= estoque_minimo;

    const qtdBruta = alvo - entry.disponivel - emCompraNoPrazo;
    const qtd = Math.max(0, Math.ceil(qtdBruta));

    if (qtd < QTD_MINIMA) {
      return {
        qtd_sugerida: 0,
        alvo,
        motivo: "ESTOQUE_SUFICIENTE",
        motivo_label: "Sem compra: estoque suficiente",
        explicacao: `Alvo ${round(alvo)}; disponível ${entry.disponivel} + em compra no prazo ${emCompraNoPrazo} já atende.`,
        origem: "nenhuma",
        confianca_consumo: confianca,
        prioridade: 99,
        flags: { ...flagsBase, acaba_antes_lead_time: acabaAntesLeadTime, abaixo_do_minimo: abaixoMinimo },
      };
    }

    let motivo: MotivoInteligente = "COBERTURA_INSUFICIENTE";
    let motivo_label = "Cobertura insuficiente";
    let prioridade = 4;

    if (acabaAntesLeadTime) {
      motivo = "ACABA_ANTES_LEAD_TIME";
      motivo_label = "Acaba antes do lead time";
      prioridade = 2;
    } else if (abaixoMinimo) {
      motivo = "ABAIXO_DO_MINIMO";
      motivo_label = "Abaixo do estoque mínimo";
      prioridade = 3;
    } else if (abaixoPontoPedido) {
      motivo = "COBERTURA_INSUFICIENTE";
      motivo_label = "No ponto de pedido";
      prioridade = 4;
    }

    // Ajuste fino: itens A são levemente promovidos
    if (abcA && prioridade > 2) prioridade -= 0.5;

    return {
      qtd_sugerida: qtd,
      alvo,
      motivo,
      motivo_label,
      explicacao: explicarConsumo({
        consumoDiario, lead_time_dias, diasCoberturaAlvo, alvo, disponivel: entry.disponivel,
        emCompraNoPrazo, estoque_minimo, ponto_pedido,
      }),
      origem: "consumo",
      confianca_consumo: confianca,
      prioridade,
      flags: { ...flagsBase, acaba_antes_lead_time: acabaAntesLeadTime, abaixo_do_minimo: abaixoMinimo },
    };
  }

  // ------------------------------------------------------------------
  // PRIORIDADE 3: Consumo = 0 → avaliar RISCO
  // ------------------------------------------------------------------
  const abaixoMinimo = estoque_minimo > 0 && entry.disponivel <= estoque_minimo;
  const politicaMinimo = politica === "estoque_minimo";

  // 3.a) Política = estoque mínimo: funciona mesmo sem consumo
  if (politicaMinimo && abaixoMinimo) {
    const alvo = alvoRecomposicao(estoque_ideal, estoque_maximo, estoque_minimo);
    const qtd = Math.max(QTD_MINIMA, Math.ceil(alvo - entry.disponivel - emCompraNoPrazo));
    return {
      qtd_sugerida: qtd,
      alvo,
      motivo: "POLITICA_MINIMO",
      motivo_label: "Política: estoque mínimo",
      explicacao: `Política de estoque mínimo: disponível ${entry.disponivel} ≤ mínimo ${estoque_minimo}. Recompor até ${alvo}.`,
      origem: "recomposicao",
      confianca_consumo: confianca,
      prioridade: 3,
      flags: { ...flagsBase, abaixo_do_minimo: true },
    };
  }

  // 3.b) Abaixo do mínimo (sem consumo, sem política específica) → recompor
  if (abaixoMinimo) {
    const alvo = alvoRecomposicao(estoque_ideal, estoque_maximo, estoque_minimo);
    const qtd = Math.max(QTD_MINIMA, Math.ceil(alvo - entry.disponivel - emCompraNoPrazo));
    return {
      qtd_sugerida: qtd,
      alvo,
      motivo: "ABAIXO_DO_MINIMO",
      motivo_label: "Abaixo do estoque mínimo",
      explicacao: `Sem consumo recente, mas disponível ${entry.disponivel} ≤ mínimo ${estoque_minimo}. Recompor até ${alvo}.`,
      origem: "recomposicao",
      confianca_consumo: confianca,
      prioridade: 3,
      flags: { ...flagsBase, abaixo_do_minimo: true },
    };
  }

  // 3.c) Item crítico OU classe A com estoque baixo (mas acima do mínimo)
  //      Aqui consideramos "baixo" como disponível ≤ mínimo × 1.2 (folga pequena).
  if ((itemCritico || abcA) && estoque_minimo > 0 && entry.disponivel <= estoque_minimo * 1.2) {
    const alvo = alvoRecomposicao(estoque_ideal, estoque_maximo, estoque_minimo);
    const qtdBruta = alvo - entry.disponivel - emCompraNoPrazo;
    const qtd = Math.max(0, Math.ceil(qtdBruta));
    if (qtd >= QTD_MINIMA) {
      return {
        qtd_sugerida: qtd,
        alvo,
        motivo: itemCritico ? "ITEM_CRITICO_SEM_CONSUMO" : "ABC_A_SEM_CONSUMO",
        motivo_label: itemCritico ? "Item crítico sem consumo" : "Classe A sem consumo",
        explicacao: `${itemCritico ? "Item crítico" : "Classe ABC A"} sem consumo recente, mas estoque (${entry.disponivel}) próximo do mínimo (${estoque_minimo}). Recompor até ${alvo}.`,
        origem: "recomposicao",
        confianca_consumo: confianca,
        prioridade: 5,
        flags: { ...flagsBase },
      };
    }
  }

  // 3.d) Sem consumo e sem risco → não sugerir
  return {
    qtd_sugerida: 0,
    alvo: 0,
    motivo: "SEM_CONSUMO_RECENTE",
    motivo_label: "Sem consumo recente",
    explicacao: politica === "cobertura"
      ? "Política de cobertura requer consumo válido — sem consumo no período. Estoque acima do mínimo, sem ação necessária."
      : "Sem consumo recente e estoque acima do mínimo. Sem necessidade de compra.",
    origem: "nenhuma",
    confianca_consumo: confianca,
    prioridade: 100,
    flags: { ...flagsBase },
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function alvoRecomposicao(ideal: number, maximo: number, minimo: number): number {
  if (ideal > 0) return ideal;
  if (maximo > 0) return maximo;
  return Math.max(0, minimo);
}

function classificarConfianca(entry: StockEntry): ConfiancaConsumo {
  const dias = entry.diasComMovimento;
  if (dias === 0) return "sem_dados";
  if (dias < 3) return "baixa";
  if (dias < 7) return "media";
  return "alta";
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

function explicarConsumo(p: {
  consumoDiario: number;
  lead_time_dias: number;
  diasCoberturaAlvo: number;
  alvo: number;
  disponivel: number;
  emCompraNoPrazo: number;
  estoque_minimo: number;
  ponto_pedido: number;
}): string {
  const partes: string[] = [];
  partes.push(`Consumo ${p.consumoDiario}/dia, lead time ${p.lead_time_dias}d.`);
  if (p.diasCoberturaAlvo > 0) {
    partes.push(`Alvo cobertura: ${p.consumoDiario} × (${p.lead_time_dias} + ${p.diasCoberturaAlvo}) = ${round(p.alvo)}.`);
  } else {
    partes.push(`Alvo recomposição: ${round(p.alvo)}.`);
  }
  partes.push(`Disponível ${p.disponivel} + em compra no prazo ${p.emCompraNoPrazo}.`);
  partes.push(`Ponto de pedido: ${round(p.ponto_pedido)}.`);
  return partes.join(" ");
}

/** Label curto para badge de confiança. */
export function confiancaLabel(c: ConfiancaConsumo): string {
  switch (c) {
    case "alta": return "Confiança alta";
    case "media": return "Confiança média";
    case "baixa": return "Baixa confiança";
    case "sem_dados": return "Sem dados de consumo";
  }
}

/** Classes Tailwind para o badge de confiança. */
export function confiancaToneClasses(c: ConfiancaConsumo): string {
  switch (c) {
    case "alta": return "bg-success/12 text-success";
    case "media": return "bg-muted text-muted-foreground";
    case "baixa": return "bg-warning/12 text-warning";
    case "sem_dados": return "bg-muted text-muted-foreground";
  }
}
