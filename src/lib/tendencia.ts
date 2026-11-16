/**
 * Cálculo de tendência de preço a partir do histórico de pontos
 * (item_fornecedor_precos).
 *
 * Critério (90 dias por padrão):
 *   - variação > +5%  → "alta"
 *   - variação < -5%  → "baixa"
 *   - entre -5% e +5% → "estavel"
 *   - menos de 2 pontos → "sem_dados"
 *
 * "Variação" = (preço atual − média do período) / média do período × 100.
 * Quando "preço atual" não é fornecido, usa o último ponto do período.
 */

export type TendenciaDirecao = "alta" | "baixa" | "estavel" | "sem_dados";

export type TendenciaPreco = {
  direcao: TendenciaDirecao;
  /** Variação percentual (positiva = subindo). null quando sem dados. */
  variacaoPct: number | null;
  /** Média do período. null quando sem dados. */
  media: number | null;
  /** Último preço observado no período. null quando sem dados. */
  ultimoPreco: number | null;
  /** Quantidade de pontos válidos usados. */
  amostras: number;
};

export type PontoHistoricoMin = {
  item_id: string;
  fornecedor_id: string;
  preco_unitario: number | string;
  data_inicio: string;
};

const SEM_DADOS: TendenciaPreco = {
  direcao: "sem_dados",
  variacaoPct: null,
  media: null,
  ultimoPreco: null,
  amostras: 0,
};

/**
 * Calcula a tendência considerando todos os pontos válidos para o par
 * item-fornecedor. `precoAtualOverride` é usado quando você quer comparar
 * o preço cadastrado HOJE no vínculo com a média histórica (ainda não gravado).
 */
export function calcularTendencia(
  pontos: readonly PontoHistoricoMin[] | null | undefined,
  itemId: string,
  fornecedorId: string,
  precoAtualOverride?: number | null,
): TendenciaPreco {
  const filtrados = (pontos || [])
    .filter((p) => p.item_id === itemId && p.fornecedor_id === fornecedorId)
    .map((p) => ({ preco: Number(p.preco_unitario), data: new Date(p.data_inicio).getTime() }))
    .filter((p) => Number.isFinite(p.preco) && p.preco > 0 && Number.isFinite(p.data))
    .sort((a, b) => a.data - b.data);

  if (filtrados.length < 2) {
    // Mesmo com 1 ponto histórico, dá pra mostrar "ultimoPreco" — mas tendência fica indefinida.
    return {
      ...SEM_DADOS,
      ultimoPreco: filtrados.length === 1 ? filtrados[0].preco : null,
      amostras: filtrados.length,
    };
  }

  const soma = filtrados.reduce((acc, p) => acc + p.preco, 0);
  const media = soma / filtrados.length;
  const ultimoPreco = filtrados[filtrados.length - 1].preco;
  const referencia = precoAtualOverride != null && precoAtualOverride > 0 ? precoAtualOverride : ultimoPreco;

  if (media <= 0) return SEM_DADOS;
  const variacaoPct = ((referencia - media) / media) * 100;

  let direcao: TendenciaDirecao;
  if (variacaoPct > 5) direcao = "alta";
  else if (variacaoPct < -5) direcao = "baixa";
  else direcao = "estavel";

  return {
    direcao,
    variacaoPct: Math.round(variacaoPct * 10) / 10,
    media: Math.round(media * 100) / 100,
    ultimoPreco: Math.round(ultimoPreco * 100) / 100,
    amostras: filtrados.length,
  };
}

/**
 * Extrai um mapa item_id → último preço de compra REAL (origem PEDIDO)
 * a partir do histórico. Usado pelo resolver de custo para inserir
 * "última compra real" entre "fornecedor" e "custo médio".
 */
export function buildUltimaCompraMap(
  pontos: readonly PontoHistoricoMin[] | null | undefined,
  origemFiltro: ("PEDIDO" | "RECEBIMENTO_COMPRA")[] | null = ["PEDIDO"],
): Map<string, number> {
  const out = new Map<string, { preco: number; data: number }>();
  (pontos || []).forEach((p: any) => {
    if (origemFiltro && p.origem && !origemFiltro.includes(p.origem)) return;
    const preco = Number(p.preco_unitario);
    const data = new Date(p.data_inicio).getTime();
    if (!Number.isFinite(preco) || preco <= 0 || !Number.isFinite(data)) return;
    const cur = out.get(p.item_id);
    if (!cur || data > cur.data) out.set(p.item_id, { preco, data });
  });
  const final = new Map<string, number>();
  out.forEach((v, k) => final.set(k, v.preco));
  return final;
}

/** Label amigável + tom semântico para a UI. */
export function tendenciaLabel(t: TendenciaPreco): { label: string; tone: "destructive" | "success" | "muted" } {
  if (t.direcao === "sem_dados") return { label: "Sem dados suficientes", tone: "muted" };
  if (t.direcao === "estavel") return { label: "Estável", tone: "muted" };
  const sinal = t.variacaoPct! > 0 ? "+" : "";
  if (t.direcao === "alta") return { label: `Subindo (${sinal}${t.variacaoPct!.toFixed(1)}%)`, tone: "destructive" };
  return { label: `Caindo (${sinal}${t.variacaoPct!.toFixed(1)}%)`, tone: "success" };
}
