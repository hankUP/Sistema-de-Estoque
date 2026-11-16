import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useStock } from "@/hooks/useStock";
import { useFornecedores } from "@/hooks/useFornecedores";
import { useAllItemFornecedores, useUpsertItemFornecedor } from "@/hooks/useItemFornecedores";
import { usePurchaseOrders } from "@/hooks/usePurchaseOrders";
import { usePrecoHistoricoRecente } from "@/hooks/usePrecoHistorico";
import { useRecebimentos } from "@/hooks/useLeadTimeReal";
import { useCurvaABC, abcToneClasses } from "@/hooks/useCurvaABC";
import { calcularSugestao, logCalculo, type SugestaoCalculo } from "@/lib/reposicao";
import {
  getSugestaoInteligente,
  confiancaLabel,
  confiancaToneClasses,
  type SugestaoInteligente,
  type ConfiancaConsumo,
} from "@/lib/reposicao-inteligente";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { toast } from "sonner";
import { Copy, Send, AlertTriangle, AlertCircle, Info, ChevronDown, ShoppingCart, Clock, CheckCircle2, TrendingUp, TrendingDown, Minus, Brain, Settings2, Sparkles, Eye, CalendarClock } from "lucide-react";

type ModoSugestao = "padrao" | "inteligencia";
const MODO_STORAGE_KEY = "sugestao_compras_modo";

const PERIODO_OPTIONS = [7, 15, 30, 60] as const;
const DAY_MS = 24 * 60 * 60 * 1000;

const startOfToday = () => {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date;
};

const addDays = (date: Date, days: number) => new Date(date.getTime() + days * DAY_MS);

const formatDate = (date: Date | null) => (date ? date.toLocaleDateString("pt-BR") : "-");
const toIsoDate = (date: Date | null) => (date ? date.toISOString().slice(0, 10) : "");
const formatBRL = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

type FornecedorOpcao = {
  fornecedor_id: string;
  fornecedor_nome: string;
  preco_unitario: number | null;
  lead_time_dias: number | null;
  principal: boolean;
};

type SugestaoItem = {
  item_id: string;
  item_nome: string;
  unidade: string;
  fisico: number;
  reservado: number;
  disponivel: number;
  em_compra: number;
  em_compra_no_prazo: number;
  em_compra_fora_prazo: number;
  em_compra_sem_data: number;
  estoque_minimo: number;
  estoque_ideal: number;
  estoque_maximo: number;
  ponto_pedido: number;
  lead_time_dias: number;
  qtd_sugerida: number;
  /** Fornecedor inicialmente sugerido (principal, ou único, ou nenhum). */
  fornecedor_id: string | null;
  fornecedor_nome: string;
  /** Todos os fornecedores disponíveis para o item (para o usuário escolher outro). */
  fornecedores_disponiveis: FornecedorOpcao[];
  /** Custo de referência do item (fallback). */
  custo_referencia: number;
  /** Lead time padrão do item (fallback). */
  lead_time_padrao: number;
  consumoDiario: number;
  cobertura: number | null;
  data_limite_pedido: Date | null;
  data_necessidade: Date | null;
  urgencia: "COMPRAR_AGORA" | "PROGRAMAR_COMPRA" | "SEM_PRAZO_CALCULAVEL";
  urgencia_ordem: number;
  mensagem_compra: string;
  observacao_prazo: string | null;
  baixa_confiabilidade: boolean;
  dias_com_movimento: number;
  politica_usada: SugestaoCalculo["politica_usada"];
  explicacao: string;
  /** Campos extras populados apenas no Modo Inteligência. */
  inteligencia?: SugestaoInteligente;
  classe_abc?: "A" | "B" | "C" | null;
};

export default function SugestaoComprasPage() {
  const navigate = useNavigate();
  const [periodoDias, setPeriodoDias] = useState<number>(30);
  const [consumoBase, setConsumoBase] = useState<"real" | "manual">("real");
  const [diasCobertura, setDiasCobertura] = useState<string>("");
  const [expandedItems, setExpandedItems] = useState<Record<string, boolean>>({});
  const [modo, setModo] = useState<ModoSugestao>(() => {
    if (typeof window === "undefined") return "padrao";
    const saved = window.localStorage.getItem(MODO_STORAGE_KEY);
    return saved === "inteligencia" ? "inteligencia" : "padrao";
  });
  // Persiste a escolha do modo
  if (typeof window !== "undefined") {
    try { window.localStorage.setItem(MODO_STORAGE_KEY, modo); } catch { /* ignore */ }
  }
  /** Override do fornecedor escolhido por item (chave = item_id). */
  const [fornecedorOverride, setFornecedorOverride] = useState<Record<string, string>>({});

  const { data: stock } = useStock(periodoDias);
  const { data: fornecedores } = useFornecedores();
  const { data: itemFornecedores } = useAllItemFornecedores();
  const salvarFornecedor = useUpsertItemFornecedor();
  const { data: purchaseOrders } = usePurchaseOrders();
  const { data: precoHistorico } = usePrecoHistoricoRecente(90);
  const { data: recebimentos } = useRecebimentos();
  const { data: abc } = useCurvaABC();

  /** Mapa "itemId|fornecedorId" → { mediaDias, amostras } baseado em pedidos completos. */
  const leadRealMap = useMemo(() => {
    const out = new Map<string, { mediaDias: number; amostras: number }>();
    if (!purchaseOrders || !recebimentos) return out;
    // última data_real por pedido
    const ultimaPorPedido = new Map<string, string>();
    recebimentos.forEach((r) => {
      const cur = ultimaPorPedido.get(r.purchase_order_id);
      if (!cur || new Date(r.data_real) > new Date(cur)) ultimaPorPedido.set(r.purchase_order_id, r.data_real);
    });
    const acc = new Map<string, { soma: number; n: number }>();
    purchaseOrders.forEach((o) => {
      if (o.status !== "RECEBIDO_COMPLETO" && o.status !== "RECEBIDO") return;
      if (!o.fornecedor_id) return;
      const ultima = ultimaPorPedido.get(o.id);
      if (!ultima) return;
      const dias = (new Date(ultima).getTime() - new Date(o.created_at).getTime()) / (1000 * 60 * 60 * 24);
      if (!Number.isFinite(dias) || dias < 0) return;
      const k = `${o.item_id}|${o.fornecedor_id}`;
      const cur = acc.get(k) || { soma: 0, n: 0 };
      cur.soma += dias;
      cur.n += 1;
      acc.set(k, cur);
    });
    acc.forEach((v, k) => out.set(k, { mediaDias: v.soma / v.n, amostras: v.n }));
    return out;
  }, [purchaseOrders, recebimentos]);

  /** Mapa "itemId|fornecedorId" → média 90d (apenas pontos com preço > 0). */
  const mediaHistorica = useMemo(() => {
    const acc = new Map<string, { soma: number; n: number }>();
    (precoHistorico || []).forEach((p) => {
      const preco = Number(p.preco_unitario);
      if (!preco || preco <= 0) return;
      const k = `${p.item_id}|${p.fornecedor_id}`;
      const cur = acc.get(k) || { soma: 0, n: 0 };
      cur.soma += preco;
      cur.n += 1;
      acc.set(k, cur);
    });
    const out = new Map<string, number>();
    acc.forEach((v, k) => out.set(k, v.soma / v.n));
    return out;
  }, [precoHistorico]);

  /** Tendência do preço atual vs média 90d. Retorna null se sem histórico significativo. */
  const tendenciaDe = (itemId: string, fornecedorId: string | null | undefined, precoAtual: number | null) => {
    if (!fornecedorId || precoAtual == null || precoAtual <= 0) return null;
    const media = mediaHistorica.get(`${itemId}|${fornecedorId}`);
    if (!media || media <= 0) return null;
    const pct = ((precoAtual - media) / media) * 100;
    if (Math.abs(pct) < 1) return { pct, direcao: "estavel" as const, media };
    return { pct, direcao: pct > 0 ? ("alta" as const) : ("baixa" as const), media };
  };

  const sugestoes = useMemo(() => {
    if (!stock) return [];

    const hoje = startOfToday();
    const diasCoberturaNum = Number(diasCobertura) || 0;
    const pedidosEmAberto = (purchaseOrders || []).filter(
      (pedido) => !["RECEBIDO", "RECEBIDO_COMPLETO", "CANCELADO"].includes(pedido.status as string),
    );

    return stock
      .filter((s) => {
        // Sugestão de compras só considera itens explicitamente compráveis.
        // Itens novos sem flag (legado) caem no comportamento antigo: incluir.
        const item = s.item as any;
        if (item.gera_sugestao_compra === false) return false;
        return true;
      })
      .map((s): SugestaoItem | null => {
        const item = s.item as any;
        const estoque_minimo = Number(item.estoque_minimo) || 0;
        const estoque_ideal = Number(item.estoque_ideal) || 0;
        const estoque_maximo = Number(item.estoque_maximo) || 0;
        const lead_time_dias = Number(item.lead_time_dias) || 0;
        const custo_referencia = Number(item.custo_unitario) || 0;

        // Todos os vínculos ativos deste item
        const vinculosItem = (itemFornecedores || []).filter(
          (v: any) => v.item_id === item.id && v.ativo !== false,
        );
        const fornecedoresDisp: FornecedorOpcao[] = vinculosItem
          .map((v: any) => {
            const f = fornecedores?.find((x) => x.id === v.fornecedor_id);
            if (!f) return null;
            return {
              fornecedor_id: v.fornecedor_id,
              fornecedor_nome: f.nome,
              preco_unitario: v.preco_unitario != null ? Number(v.preco_unitario) : null,
              lead_time_dias: v.lead_time_dias != null ? Number(v.lead_time_dias) : null,
              principal: !!v.principal,
            };
          })
          .filter(Boolean) as FornecedorOpcao[];

        // Fornecedor sugerido inicialmente: principal > único > legado item.fornecedor_id > nenhum
        const principal = fornecedoresDisp.find((f) => f.principal);
        const inicial = principal
          || (fornecedoresDisp.length === 1 ? fornecedoresDisp[0] : null);
        const fornecedor_id = inicial?.fornecedor_id
          || item.fornecedor_id
          || null;
        const fornecedor_nome = inicial?.fornecedor_nome
          || fornecedores?.find((f) => f.id === item.fornecedor_id)?.nome
          || "Sem fornecedor";

        const consumoDiario = consumoBase === "manual" ? Number(item.consumo_diario || 0) : s.consumoDiario;
        const ponto_pedido = estoque_minimo + (consumoDiario * lead_time_dias) + s.reservado;
        const cobertura = consumoDiario > 0 ? Math.round((s.disponivel / consumoDiario) * 10) / 10 : null;

        const estoqueSeguranca = estoque_minimo + s.reservado;
        const diasParaPedirBruto = consumoDiario > 0 ? (s.disponivel - ponto_pedido) / consumoDiario : null;
        const diasParaNecessidadeBruto = consumoDiario > 0 ? (s.disponivel - estoqueSeguranca) / consumoDiario : null;
        const diasParaPedir = diasParaPedirBruto !== null ? Math.max(0, Math.floor(diasParaPedirBruto)) : null;
        const diasParaNecessidade = diasParaNecessidadeBruto !== null ? Math.max(0, Math.floor(diasParaNecessidadeBruto)) : null;
        const data_limite_pedido = diasParaPedir !== null ? addDays(hoje, diasParaPedir) : null;
        const data_necessidade = diasParaNecessidade !== null ? addDays(hoje, diasParaNecessidade) : null;

        const pedidosDoItem = pedidosEmAberto.filter((pedido) => pedido.item_id === s.item.id);
        const em_compra_no_prazo = data_necessidade
          ? pedidosDoItem
              .filter((pedido) => {
                const prevista = pedido.data_prevista ? new Date(`${pedido.data_prevista}T12:00:00`) : null;
                return prevista && prevista.getTime() <= data_necessidade.getTime();
              })
              .reduce((sum, pedido) => sum + Number(pedido.quantidade), 0)
          : 0;
        const em_compra_fora_prazo = data_necessidade
          ? pedidosDoItem
              .filter((pedido) => {
                const prevista = pedido.data_prevista ? new Date(`${pedido.data_prevista}T12:00:00`) : null;
                return prevista && prevista.getTime() > data_necessidade.getTime();
              })
              .reduce((sum, pedido) => sum + Number(pedido.quantidade), 0)
          : 0;
        const em_compra_sem_data = pedidosDoItem
          .filter((pedido) => !pedido.data_prevista)
          .reduce((sum, pedido) => sum + Number(pedido.quantidade), 0);

        // ============================================================
        // BIFURCAÇÃO DE MODO — separação total entre Padrão e Inteligência
        // ============================================================
        const classeAbc = abc?.byItem.get(s.item.id)?.classe ?? null;
        const calc = calcularSugestao(s, consumoDiario, em_compra_no_prazo, diasCoberturaNum);
        logCalculo(item.nome, calc);

        let qtd_sugerida: number;
        let politica_usada: SugestaoCalculo["politica_usada"];
        let explicacao: string;
        let baixa_confiabilidade: boolean;
        let inteligencia: SugestaoInteligente | undefined;

        if (modo === "inteligencia") {
          inteligencia = getSugestaoInteligente(s, consumoDiario, {
            classeAbc,
            diasCoberturaOverride: diasCoberturaNum,
            emCompraNoPrazo: em_compra_no_prazo,
          });
          qtd_sugerida = inteligencia.qtd_sugerida;
          politica_usada = "padrao";
          explicacao = inteligencia.explicacao;
          baixa_confiabilidade =
            inteligencia.confianca_consumo === "baixa" || inteligencia.confianca_consumo === "sem_dados";
        } else {
          qtd_sugerida = calc.qtd_sugerida;
          politica_usada = calc.politica_usada;
          explicacao = calc.explicacao;
          baixa_confiabilidade = calc.baixa_confiabilidade;
        }

        if (qtd_sugerida <= 0) return null;

        const observacoes: string[] = [];
        if (em_compra_no_prazo > 0) observacoes.push(`${em_compra_no_prazo} já está em compra com chegada a tempo.`);
        if (em_compra_fora_prazo > 0) observacoes.push(`${em_compra_fora_prazo} já está em compra, mas chega após a data necessária.`);
        if (em_compra_sem_data > 0) observacoes.push(`${em_compra_sem_data} já está em compra sem data prevista de entrega.`);
        if (baixa_confiabilidade && consumoDiario > 0) observacoes.push(`Consumo baseado em apenas ${s.diasComMovimento} dia(s) com movimento — baixa confiabilidade.`);
        if (modo === "inteligencia" && consumoBase === "real" && s.consumoDiario === 0) {
          observacoes.push("Consumo real zerado no período — considere usar consumo cadastrado.");
        }

        // Urgência: no Modo Inteligência, mapeada a partir do motivo;
        // no Modo Padrão, mantém a regra original (ponto de pedido).
        let urgencia: SugestaoItem["urgencia"] = "SEM_PRAZO_CALCULAVEL";
        let urgencia_ordem = 3;
        let mensagem_compra = "Defina consumo para calcular até quando comprar";

        if (modo === "inteligencia" && inteligencia) {
          if (inteligencia.prioridade <= 2) {
            urgencia = "COMPRAR_AGORA";
            urgencia_ordem = 1;
            mensagem_compra = "Comprar agora";
          } else if (inteligencia.prioridade <= 5) {
            urgencia = "PROGRAMAR_COMPRA";
            urgencia_ordem = 2;
            mensagem_compra = data_limite_pedido
              ? `Comprar até ${formatDate(data_limite_pedido)}`
              : "Programar compra";
          } else {
            urgencia = "SEM_PRAZO_CALCULAVEL";
            urgencia_ordem = 3;
            mensagem_compra = inteligencia.motivo_label;
          }
        } else if (consumoDiario > 0) {
          const precisaComprarAgora = s.disponivel <= ponto_pedido || (diasParaPedirBruto !== null && diasParaPedirBruto <= 0);
          urgencia = precisaComprarAgora ? "COMPRAR_AGORA" : "PROGRAMAR_COMPRA";
          urgencia_ordem = precisaComprarAgora ? 1 : 2;
          mensagem_compra = precisaComprarAgora
            ? "Comprar agora"
            : `Comprar até ${formatDate(data_limite_pedido)}`;
        }

        return {
          item_id: s.item.id,
          item_nome: s.item.nome,
          unidade: s.item.unidade,
          fisico: s.fisico,
          reservado: s.reservado,
          disponivel: s.disponivel,
          em_compra: s.em_compra,
          em_compra_no_prazo,
          em_compra_fora_prazo,
          em_compra_sem_data,
          estoque_minimo,
          estoque_ideal,
          estoque_maximo,
          ponto_pedido: Math.round(ponto_pedido * 100) / 100,
          lead_time_dias,
          qtd_sugerida,
          fornecedor_id,
          fornecedor_nome,
          fornecedores_disponiveis: fornecedoresDisp,
          custo_referencia,
          lead_time_padrao: lead_time_dias,
          consumoDiario: Math.round(consumoDiario * 100) / 100,
          cobertura,
          data_limite_pedido,
          data_necessidade,
          urgencia,
          urgencia_ordem,
          mensagem_compra,
          observacao_prazo: observacoes.length > 0 ? observacoes.join(" ") : null,
          baixa_confiabilidade,
          dias_com_movimento: s.diasComMovimento,
          politica_usada,
          explicacao,
          inteligencia,
          classe_abc: classeAbc,
        };
      })
      .filter(Boolean)
      .sort((a, b) => {
        const aItem = a as SugestaoItem;
        const bItem = b as SugestaoItem;
        // Modo Inteligência usa o score de prioridade direto
        if (modo === "inteligencia" && aItem.inteligencia && bItem.inteligencia) {
          return (
            aItem.inteligencia.prioridade - bItem.inteligencia.prioridade ||
            aItem.item_nome.localeCompare(bItem.item_nome)
          );
        }
        // Modo Padrão: ordem original (urgência → ABC → data → nome)
        const abcRank = (id: string) => {
          const c = abc?.byItem.get(id)?.classe;
          return c === "A" ? 0 : c === "B" ? 1 : c === "C" ? 2 : 3;
        };
        return (
          aItem.urgencia_ordem - bItem.urgencia_ordem ||
          abcRank(aItem.item_id) - abcRank(bItem.item_id) ||
          (aItem.data_limite_pedido?.getTime() ?? Number.MAX_SAFE_INTEGER) - (bItem.data_limite_pedido?.getTime() ?? Number.MAX_SAFE_INTEGER) ||
          aItem.item_nome.localeCompare(bItem.item_nome)
        );
      }) as SugestaoItem[];
  }, [stock, fornecedores, itemFornecedores, purchaseOrders, consumoBase, diasCobertura, abc, modo]);

  /** Resolve o fornecedor efetivamente escolhido para uma sugestão, considerando override do usuário. */
  const fornecedorEscolhidoDe = (s: SugestaoItem): FornecedorOpcao | null => {
    const overrideId = fornecedorOverride[s.item_id];
    if (overrideId) {
      const o = s.fornecedores_disponiveis.find((f) => f.fornecedor_id === overrideId);
      if (o) return o;
    }
    if (s.fornecedor_id) {
      const inicial = s.fornecedores_disponiveis.find((f) => f.fornecedor_id === s.fornecedor_id);
      if (inicial) return inicial;
    }
    return null;
  };

  /** Mapa item_id → último preço real comprado (R$/embalagem). Construído uma vez. */
  const ultimaCompraPorItem = useMemo(() => {
    const map = new Map<string, { preco: number; data: number }>();
    (precoHistorico || []).forEach((p: any) => {
      if (p.origem !== "PEDIDO") return;
      const preco = Number(p.preco_unitario);
      const data = new Date(p.data_inicio).getTime();
      if (!Number.isFinite(preco) || preco <= 0 || !Number.isFinite(data)) return;
      const cur = map.get(p.item_id);
      if (!cur || data > cur.data) map.set(p.item_id, { preco, data });
    });
    const out = new Map<string, number>();
    map.forEach((v, k) => out.set(k, v.preco));
    return out;
  }, [precoHistorico]);

  /**
   * Preço unitário efetivo POR UNIDADE DE COMPRA, com prioridade:
   *   1) preço do vínculo escolhido (fornecedor)
   *   2) última compra real deste item (do histórico de pedidos)
   *   3) custo médio do estoque (já por unidade de estoque — convertido aqui de volta para embalagem)
   *   4) custo de referência do item
   */
  const precoEfetivoDe = (
    s: SugestaoItem,
  ): { valor: number | null; origem: "vinculo" | "ultima_compra" | "custo_medio" | "referencia" | "indisponivel" } => {
    const f = fornecedorEscolhidoDe(s);
    if (f && f.preco_unitario != null && f.preco_unitario > 0) {
      return { valor: f.preco_unitario, origem: "vinculo" };
    }
    const ultima = ultimaCompraPorItem.get(s.item_id);
    if (ultima != null && ultima > 0) return { valor: ultima, origem: "ultima_compra" };
    const item = (stock || []).find((x) => x.item.id === s.item_id)?.item as any;
    const fator = Number(item?.fator_conversao) > 0 ? Number(item.fator_conversao) : 1;
    const medio = Number(item?.custo_medio || 0);
    if (medio > 0) return { valor: medio * fator, origem: "custo_medio" };
    if (s.custo_referencia > 0) return { valor: s.custo_referencia, origem: "referencia" };
    return { valor: null, origem: "indisponivel" };
  };

  /** Lead time efetivo (vínculo escolhido > lead time padrão do item). */
  const leadTimeEfetivoDe = (s: SugestaoItem): number => {
    const f = fornecedorEscolhidoDe(s);
    if (f && f.lead_time_dias != null) return f.lead_time_dias;
    return s.lead_time_padrao;
  };

  /** Recalcula data prevista de entrega = hoje + lead time efetivo. */
  const dataPrevistaEntregaDe = (s: SugestaoItem): Date | null => {
    const lead = leadTimeEfetivoDe(s);
    return lead > 0 ? addDays(startOfToday(), lead) : s.data_necessidade;
  };

  // Agrupamento por urgência: 3 blocos claros
  // - comprarAgora: estoque zerado / acaba antes do lead time / urgência crítica
  // - comprarEmBreve: abaixo do mínimo / programadas
  // - monitorar: demais (sem urgência clara)
  const { comprarAgora, comprarEmBreve, monitorar } = useMemo(() => {
    const comprarAgora: SugestaoItem[] = [];
    const comprarEmBreve: SugestaoItem[] = [];
    const monitorar: SugestaoItem[] = [];
    sugestoes.forEach((s) => {
      // Modo Inteligência: usar prioridade + flags
      if (s.inteligencia) {
        const f = s.inteligencia.flags;
        if (f.estoque_zerado || f.acaba_antes_lead_time || s.inteligencia.prioridade <= 2) {
          comprarAgora.push(s);
        } else if (f.abaixo_do_minimo || s.inteligencia.prioridade <= 4) {
          comprarEmBreve.push(s);
        } else {
          monitorar.push(s);
        }
        return;
      }
      // Modo Padrão: mesma regra do selo de prazo (prazoCompra), para grupo e selo nunca divergirem.
      // Estoque zerado ou abaixo do mínimo conta mesmo sem consumo registrado.
      const acabaAntesLeadTime = s.consumoDiario > 0 && s.disponivel < s.consumoDiario * s.lead_time_dias;
      if (s.disponivel <= 0 || acabaAntesLeadTime) {
        comprarAgora.push(s);
      } else if (s.disponivel <= s.estoque_minimo || s.urgencia === "COMPRAR_AGORA" || s.urgencia === "PROGRAMAR_COMPRA") {
        comprarEmBreve.push(s);
      } else {
        monitorar.push(s);
      }
    });
    return { comprarAgora, comprarEmBreve, monitorar };
  }, [sugestoes]);

  const irParaCompras = (s: SugestaoItem) => {
    const f = fornecedorEscolhidoDe(s);
    navigate("/compras", {
      state: {
        prefill: {
          item_id: s.item_id,
          item_nome: s.item_nome,
          quantidade: s.qtd_sugerida,
          data_prevista: toIsoDate(dataPrevistaEntregaDe(s)),
          fornecedor_id: f?.fornecedor_id,
        },
      },
    });
  };

  const agruparPorFornecedor = (items: SugestaoItem[]) => {
    const groups: Record<string, { fornecedor_nome: string; fornecedor_id: string | null; items: SugestaoItem[] }> = {};
    items.forEach((s) => {
      const f = fornecedorEscolhidoDe(s);
      const id = f?.fornecedor_id || s.fornecedor_id || "sem";
      const nome = f?.fornecedor_nome || s.fornecedor_nome;
      if (!groups[id]) groups[id] = { fornecedor_nome: nome, fornecedor_id: f?.fornecedor_id || s.fornecedor_id, items: [] };
      groups[id].items.push(s);
    });
    return Object.values(groups);
  };

  const totalEstimadoGrupo = (items: SugestaoItem[]) => {
    let total = 0;
    let temIndisponivel = false;
    items.forEach((s) => {
      const { valor } = precoEfetivoDe(s);
      if (valor == null) temIndisponivel = true;
      else total += valor * s.qtd_sugerida;
    });
    return { total, temIndisponivel };
  };

  const gerarTexto = (grupo: { fornecedor_nome: string; items: SugestaoItem[] }) => {
    const { total, temIndisponivel } = totalEstimadoGrupo(grupo.items);
    const linhas = [
      `📦 *Ação de Compra*`,
      `Fornecedor: ${grupo.fornecedor_nome}`,
      `Data: ${new Date().toLocaleDateString("pt-BR")}`,
      ``,
      `Itens:`,
      ...grupo.items.map((i, idx) => {
        const { valor, origem } = precoEfetivoDe(i);
        const prazo = i.data_limite_pedido ? ` · Pedir até ${formatDate(i.data_limite_pedido)}` : "";
        const precoStr = valor != null
          ? ` · ${formatBRL(valor)}/un${origem === "referencia" ? " (referência)" : ""} · Total ${formatBRL(valor * i.qtd_sugerida)}`
          : ` · Sem preço cadastrado`;
        return `${idx + 1}. ${i.item_nome} — Comprar ${i.qtd_sugerida} ${i.unidade} — ${i.mensagem_compra}${prazo}${precoStr}`;
      }),
      ``,
      `Total de itens: ${grupo.items.length}`,
      `Custo estimado: ${formatBRL(total)}${temIndisponivel ? " (parcial — alguns itens sem preço)" : ""}`,
    ];
    return linhas.join("\n");
  };

  const copiar = (grupo: { fornecedor_nome: string; items: SugestaoItem[] }) => {
    navigator.clipboard.writeText(gerarTexto(grupo));
    toast.success("Texto copiado para a área de transferência!");
  };

  const enviarWhatsApp = (grupo: { fornecedor_id: string | null; fornecedor_nome: string; items: SugestaoItem[] }) => {
    const fornecedor = fornecedores?.find((f) => f.id === grupo.fornecedor_id);
    const texto = encodeURIComponent(gerarTexto(grupo));
    const numero = fornecedor?.whatsapp?.replace(/\D/g, "") || "";
    const url = numero ? `https://wa.me/${numero}?text=${texto}` : `https://wa.me/?text=${texto}`;
    window.open(url, "_blank");
  };

  const enviarEmail = (grupo: { fornecedor_id: string | null; fornecedor_nome: string; items: SugestaoItem[] }) => {
    const fornecedor = fornecedores?.find((f) => f.id === grupo.fornecedor_id);
    const assunto = encodeURIComponent(`Ação de Compra - ${new Date().toLocaleDateString("pt-BR")}`);
    const corpo = encodeURIComponent(gerarTexto(grupo));
    const email = fornecedor?.email || "";
    window.open(`mailto:${email}?subject=${assunto}&body=${corpo}`);
  };

  const toggleExpand = (id: string) => setExpandedItems((prev) => ({ ...prev, [id]: !prev[id] }));

  const definirFornecedor = async (itemId: string, fornecedorId: string) => {
    if (!fornecedorId) return;
    const existente = itemFornecedores?.find(
      (v) => v.item_id === itemId && v.fornecedor_id === fornecedorId,
    );
    try {
      await salvarFornecedor.mutateAsync({
        ...(existente ? { id: existente.id } : {}),
        item_id: itemId,
        fornecedor_id: fornecedorId,
        principal: true,
        ativo: true,
      });
      setFornecedorOverride((prev) => ({ ...prev, [itemId]: fornecedorId }));
      toast.success("Fornecedor definido para este item.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível definir o fornecedor.");
    }
  };

  /** Texto curto do motivo principal — sempre visível, sem precisar expandir. */
  const motivoPrincipal = (i: SugestaoItem): { texto: string; tone: "destructive" | "warning" | "muted" } => {
    if (i.inteligencia) {
      const f = i.inteligencia.flags;
      if (f.estoque_zerado) return { texto: "Estoque zerado", tone: "destructive" };
      if (f.acaba_antes_lead_time && i.consumoDiario > 0) {
        const dias = Math.max(0, Math.floor(i.disponivel / i.consumoDiario));
        return { texto: `Acaba em ${dias} ${dias === 1 ? "dia" : "dias"} (lead time: ${i.lead_time_dias}d)`, tone: "destructive" };
      }
      if (f.abaixo_do_minimo) return { texto: `Abaixo do estoque mínimo (${i.estoque_minimo})`, tone: "warning" };
      if (i.inteligencia.motivo === "ITEM_CRITICO_SEM_CONSUMO") return { texto: "Item crítico sem consumo recente", tone: "warning" };
      if (i.inteligencia.motivo === "ABC_A_SEM_CONSUMO") return { texto: "Classe ABC A sem consumo recente", tone: "warning" };
      if (i.inteligencia.motivo === "POLITICA_MINIMO") return { texto: "Política de estoque mínimo", tone: "warning" };
      return { texto: i.inteligencia.motivo_label, tone: "muted" };
    }
    // Modo Padrão
    if (i.disponivel <= 0) return { texto: "Estoque zerado", tone: "destructive" };
    if (i.consumoDiario > 0 && i.disponivel < i.consumoDiario * i.lead_time_dias) {
      const dias = Math.max(0, Math.floor(i.disponivel / i.consumoDiario));
      return { texto: `Acaba em ${dias} ${dias === 1 ? "dia" : "dias"} (lead time: ${i.lead_time_dias}d)`, tone: "destructive" };
    }
    if (i.disponivel <= i.estoque_minimo) return { texto: `Abaixo do estoque mínimo (${i.estoque_minimo})`, tone: "warning" };
    if (i.urgencia === "COMPRAR_AGORA") return { texto: "No ponto de pedido", tone: "warning" };
    return { texto: i.mensagem_compra, tone: "muted" };
  };

  /**
   * Prazo de compra — UMA única mensagem clara, mutuamente exclusiva.
   * Não exibir simultaneamente lead time, data de entrega e prazo de compra.
   *
   *  1. Crítico (estoque ≤ 0): "Comprar hoje" / "Atrasado em X dias"
   *  2. Risco (acaba antes do lead time / abaixo do mínimo): "Comprar até DD/MM para não faltar"
   *  3. Tranquilo (cobertura ok): "Acaba em X dias"
   *  4. Sem dados: null (não exibir nada)
   */
  const prazoCompra = (
    i: SugestaoItem,
  ): { texto: string; tone: "destructive" | "warning" | "muted"; icon: typeof Clock } | null => {
    // 1. CRÍTICO — estoque zerado ou negativo
    if (i.disponivel <= 0) {
      // Tenta calcular "atrasado em X dias" se houver consumo
      if (i.consumoDiario > 0) {
        const atrasoDias = Math.max(0, Math.ceil(Math.abs(i.disponivel) / i.consumoDiario));
        if (atrasoDias > 0) {
          return {
            texto: `Atrasado em ${atrasoDias} ${atrasoDias === 1 ? "dia" : "dias"}`,
            tone: "destructive",
            icon: AlertCircle,
          };
        }
      }
      return { texto: "Comprar hoje", tone: "destructive", icon: AlertCircle };
    }

    // 2. RISCO — vai acabar antes do lead time chegar OU abaixo do mínimo COM consumo
    const acabaAntesLeadTime = i.consumoDiario > 0 && i.disponivel < i.consumoDiario * i.lead_time_dias;
    const abaixoMinimo = i.disponivel <= i.estoque_minimo;

    if (acabaAntesLeadTime) {
      // Já não dá mais para comprar a tempo — comprar HOJE
      return { texto: "Comprar hoje (acaba antes do lead time)", tone: "destructive", icon: AlertCircle };
    }

    if (abaixoMinimo || i.urgencia === "COMPRAR_AGORA") {
      if (i.data_limite_pedido) {
        const hoje = startOfToday();
        const diasAteLimite = Math.floor((i.data_limite_pedido.getTime() - hoje.getTime()) / DAY_MS);
        if (diasAteLimite <= 0) {
          return { texto: "Comprar hoje para não faltar", tone: "warning", icon: CalendarClock };
        }
        return {
          texto: `Comprar até ${formatDate(i.data_limite_pedido)} para não faltar`,
          tone: "warning",
          icon: CalendarClock,
        };
      }
      return { texto: "Comprar em breve", tone: "warning", icon: CalendarClock };
    }

    // 3. TRANQUILO — tem cobertura, mostra "acaba em X dias"
    if (i.consumoDiario > 0) {
      const diasRestantes = Math.floor(i.disponivel / i.consumoDiario);
      return {
        texto: `Acaba em ${diasRestantes} ${diasRestantes === 1 ? "dia" : "dias"}`,
        tone: "muted",
        icon: Clock,
      };
    }

    // 4. SEM CONSUMO — sem como calcular prazo
    return null;
  };

  /** Botão contextual conforme urgência. */
  const labelBotaoCompra = (i: SugestaoItem): string => {
    if (i.urgencia === "COMPRAR_AGORA") return "Comprar agora";
    if (i.urgencia === "PROGRAMAR_COMPRA") return "Planejar compra";
    return "Adicionar ao pedido";
  };

  const renderItem = (i: SugestaoItem) => {
    const isExpanded = !!expandedItems[i.item_id];
    const fornecedorEscolhido = fornecedorEscolhidoDe(i);
    const { valor: precoUnit, origem: precoOrigem } = precoEfetivoDe(i);
    const custoEstimado = precoUnit != null ? precoUnit * i.qtd_sugerida : null;
    const leadEfetivo = leadTimeEfetivoDe(i);
    const dataEntrega = dataPrevistaEntregaDe(i);
    const temMaisDeUmFornecedor = i.fornecedores_disponiveis.length > 1;
    const semFornecedor = !fornecedorEscolhido && !i.fornecedor_id;
    const motivo = motivoPrincipal(i);
    const motivoToneCls = {
      destructive: "text-destructive",
      warning: "text-warning",
      muted: "text-muted-foreground",
    }[motivo.tone];

    // Badges: máx 2 (1 motivo principal + 1 qualidade do dado).
    // Modo Padrão: só urgência. Modo Inteligência: motivo + confiança.
    const badgePrincipal = (() => {
      if (modo === "padrao") {
        if (i.urgencia === "COMPRAR_AGORA") return { label: "Crítico", cls: "bg-destructive/15 text-destructive" };
        if (i.urgencia === "PROGRAMAR_COMPRA") return { label: "Atenção", cls: "bg-warning/15 text-warning" };
        return null;
      }
      if (!i.inteligencia) return null;
      const f = i.inteligencia.flags;
      if (f.estoque_zerado) return { label: "Estoque zerado", cls: "bg-destructive/15 text-destructive" };
      if (f.abaixo_do_minimo) return { label: "Abaixo do mínimo", cls: "bg-warning/15 text-warning" };
      if (f.acaba_antes_lead_time) return { label: "Acaba antes do lead time", cls: "bg-destructive/15 text-destructive" };
      if (f.item_critico) return { label: "Crítico", cls: "bg-destructive/15 text-destructive" };
      if (f.abc_a) return { label: "ABC A", cls: "bg-primary/15 text-primary" };
      return null;
    })();

    const BadgeSecundarioIcon = AlertTriangle;
    const showBadgeConfianca = modo === "inteligencia" && i.baixa_confiabilidade;

    return (
      <div key={i.item_id} className="px-4 py-4 hover:bg-accent/30 transition-colors">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          {/* Coluna principal: nome (destaque) → motivo → contexto → fornecedor */}
          <div className="min-w-0 flex-1 space-y-2">
            {/* Nome + badges (máx 2) */}
            <div className="flex flex-wrap items-center gap-2">
              <h4 className="font-semibold text-foreground text-base leading-tight">{i.item_nome}</h4>
              {badgePrincipal && (
                <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold ${badgePrincipal.cls}`}>
                  {badgePrincipal.label}
                </span>
              )}
              {showBadgeConfianca && (
                <span
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-warning/12 text-warning"
                  title={`Consumo calculado a partir de apenas ${i.dias_com_movimento} dia(s) com movimentação no período.`}
                >
                  <BadgeSecundarioIcon className="h-3 w-3" />
                  Baixa confiança
                </span>
              )}
            </div>

            {/* Motivo principal — sempre visível, sem expandir */}
            <p className={`text-sm font-medium ${motivoToneCls}`}>{motivo.texto}</p>

            {/* Prazo de compra — UMA única mensagem clara, logo abaixo do motivo */}
            {(() => {
              const prazo = prazoCompra(i);
              if (!prazo) return null;
              const PrazoIcon = prazo.icon;
              const prazoToneCls = {
                destructive: "bg-destructive/10 text-destructive border-destructive/30",
                warning: "bg-warning/10 text-warning border-warning/30",
                muted: "bg-muted/40 text-muted-foreground border-border",
              }[prazo.tone];
              return (
                <div
                  className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-md border text-xs font-medium ${prazoToneCls}`}
                >
                  <PrazoIcon className="h-3.5 w-3.5 shrink-0" />
                  {prazo.texto}
                </div>
              );
            })()}

            {/* Contexto secundário — apenas consumo (sem datas/lead time, já comunicados pelo prazo acima) */}
            {i.consumoDiario > 0 && (
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                <span>Consumo: {i.consumoDiario}/dia</span>
              </div>
            )}

            {/* Fornecedor — alerta visível se não houver */}
            {semFornecedor ? (
              <div className="flex flex-wrap items-center gap-2 text-xs bg-warning/10 border border-warning/30 rounded-md px-2 py-1.5">
                <span className="text-warning font-medium">Defina o fornecedor:</span>
                <select
                  className="bg-input border border-border rounded-md px-2 py-1 text-xs text-foreground min-w-48"
                  value={fornecedorOverride[i.item_id] || ""}
                  disabled={salvarFornecedor.isPending}
                  onChange={(e) => void definirFornecedor(i.item_id, e.target.value)}
                >
                  <option value="">Selecione um fornecedor</option>
                  {(fornecedores || []).filter((f) => f.ativo).map((f) => (
                    <option key={f.id} value={f.id}>{f.nome}</option>
                  ))}
                </select>
                {(!fornecedores || fornecedores.filter((f) => f.ativo).length === 0) && (
                  <span className="text-muted-foreground">Cadastre um fornecedor primeiro.</span>
                )}
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="text-muted-foreground">Fornecedor:</span>
                {temMaisDeUmFornecedor ? (
                  <select
                    className="bg-input border border-border rounded-md px-2 py-1 text-xs text-foreground"
                    value={fornecedorEscolhido?.fornecedor_id || ""}
                    onChange={(e) =>
                      setFornecedorOverride((prev) => ({ ...prev, [i.item_id]: e.target.value }))
                    }
                  >
                    {i.fornecedores_disponiveis.map((f) => (
                      <option key={f.fornecedor_id} value={f.fornecedor_id}>
                        {f.fornecedor_nome}
                        {f.principal ? " ★" : ""}
                        {f.preco_unitario != null ? ` — ${formatBRL(f.preco_unitario)}/un` : " — sem preço"}
                        {f.lead_time_dias != null ? ` · ${f.lead_time_dias}d` : ""}
                      </option>
                    ))}
                  </select>
                ) : (
                  <span className="font-medium text-foreground">
                    {fornecedorEscolhido?.fornecedor_nome || i.fornecedor_nome}
                    {fornecedorEscolhido?.principal && <span className="text-warning ml-1">★</span>}
                  </span>
                )}
                {precoUnit != null && (
                  <span className="text-muted-foreground">
                    · {formatBRL(precoUnit)}/un
                    {precoOrigem === "referencia" && " (referência)"}
                  </span>
                )}
              </div>
            )}

            {/* Detalhes do cálculo: badges secundários + métricas + tendência */}
            <Collapsible open={isExpanded} onOpenChange={() => toggleExpand(i.item_id)}>
              <CollapsibleTrigger className="text-[11px] text-muted-foreground hover:text-foreground inline-flex items-center gap-1 transition-colors">
                <Eye className="h-3 w-3" />
                {isExpanded ? "Ocultar detalhes do cálculo" : "Ver detalhes do cálculo"}
                <ChevronDown className={`h-3 w-3 transition-transform ${isExpanded ? "rotate-180" : ""}`} />
              </CollapsibleTrigger>
              <CollapsibleContent className="pt-2 space-y-2">
                <p className="text-[11px] text-muted-foreground/90 bg-muted/40 rounded-md px-2 py-1.5">
                  Baseado no consumo médio dos últimos {periodoDias} dias + lead time de entrega
                  {diasCobertura && Number(diasCobertura) > 0 ? ` + cobertura alvo de ${diasCobertura} dias` : ""}.
                </p>
                <p className="text-[11px] text-muted-foreground/90">{i.explicacao}</p>
                <div className="flex flex-wrap gap-2">
                  {abc?.byItem.get(i.item_id) && (() => {
                    const row = abc.byItem.get(i.item_id)!;
                    return (
                      <span
                        className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold border ${abcToneClasses(row.classe)}`}
                        title={`Curva ABC (90 dias): classe ${row.classe} · ${row.participacaoPct.toFixed(1)}% do valor de consumo`}
                      >
                        ABC: {row.classe}
                      </span>
                    );
                  })()}
                  {i.politica_usada !== "padrao" && (
                    <span
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-primary/10 text-primary"
                    >
                      <Info className="h-3 w-3" />
                      {i.politica_usada === "cobertura" ? "Política: cobertura" : "Política: estoque mínimo"}
                    </span>
                  )}
                  {modo === "inteligencia" && i.inteligencia && (
                    <span
                      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium ${confiancaToneClasses(i.inteligencia.confianca_consumo)}`}
                      title={`Calculado a partir de ${i.dias_com_movimento} dia(s) com movimentação no período.`}
                    >
                      <Sparkles className="h-3 w-3" />
                      {confiancaLabel(i.inteligencia.confianca_consumo)}
                    </span>
                  )}
                  {(() => {
                    const tend = tendenciaDe(i.item_id, fornecedorEscolhido?.fornecedor_id, precoUnit);
                    if (!tend) return null;
                    const Icon = tend.direcao === "alta" ? TrendingUp : tend.direcao === "baixa" ? TrendingDown : Minus;
                    const cls = tend.direcao === "alta"
                      ? "bg-destructive/12 text-destructive"
                      : tend.direcao === "baixa"
                        ? "bg-success/12 text-success"
                        : "bg-muted text-muted-foreground";
                    const label = tend.direcao === "estavel"
                      ? "estável vs média 90d"
                      : `${tend.pct > 0 ? "+" : ""}${tend.pct.toFixed(1)}% vs média 90d`;
                    return (
                      <span
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium ${cls}`}
                        title={`Média 90d: ${formatBRL(tend.media)} · Atual: ${formatBRL(precoUnit!)}`}
                      >
                        <Icon className="h-3 w-3" />
                        {label}
                      </span>
                    );
                  })()}
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-x-4 gap-y-2 text-xs pt-1">
                  <Metric label="Estoque físico" value={i.fisico} negative={i.fisico <= 0} />
                  <Metric label="Estoque reservado" value={i.reservado} />
                  <Metric label="Estoque disponível" value={i.disponivel} negative={i.disponivel <= 0} />
                  <Metric label="Em compra" value={i.em_compra} />
                  {i.em_compra_no_prazo > 0 && <Metric label="Em compra no prazo" value={i.em_compra_no_prazo} />}
                  {i.em_compra_fora_prazo > 0 && <Metric label="Em compra fora do prazo" value={i.em_compra_fora_prazo} />}
                  {i.em_compra_sem_data > 0 && <Metric label="Em compra sem data" value={i.em_compra_sem_data} />}
                  <Metric label="Estoque mínimo" value={i.estoque_minimo} />
                  <Metric label="Ponto de pedido" value={i.ponto_pedido} />
                  <Metric label="Pedir até" value={formatDate(i.data_limite_pedido)} />
                </div>
                {i.observacao_prazo && (
                  <p className="text-xs text-muted-foreground italic">{i.observacao_prazo}</p>
                )}
              </CollapsibleContent>
            </Collapsible>
          </div>

          {/* Coluna direita: quantidade GRANDE + custo + ação contextual */}
          <div className="flex flex-col gap-2 lg:items-end shrink-0 lg:min-w-[180px]">
            <div className="text-left lg:text-right">
              <div className="text-primary font-bold text-2xl leading-none">
                {i.qtd_sugerida}
                <span className="text-sm font-medium text-muted-foreground ml-1">{i.unidade}</span>
              </div>
              <div className="text-[11px] text-muted-foreground mt-0.5">Comprar</div>
            </div>
            {custoEstimado != null ? (
              <div className="text-left lg:text-right">
                <div className="text-sm font-semibold text-foreground">{formatBRL(custoEstimado)}</div>
                <div className="text-[10px] text-muted-foreground">
                  Custo estimado · fonte: {
                    precoOrigem === "vinculo" ? "fornecedor" :
                    precoOrigem === "ultima_compra" ? "última compra real" :
                    precoOrigem === "custo_medio" ? "custo médio do estoque" :
                    precoOrigem === "referencia" ? "custo de referência" : "indisponível"
                  }
                </div>
              </div>
            ) : (
              <div className="text-[10px] text-warning inline-flex items-center gap-1">
                <AlertTriangle className="h-3 w-3" /> Sem preço
              </div>
            )}
            <Button
              size="sm"
              variant={i.urgencia === "COMPRAR_AGORA" ? "default" : "outline"}
              onClick={() => irParaCompras(i)}
              className="w-full lg:w-auto"
              disabled={semFornecedor}
              title={semFornecedor ? "Defina um fornecedor para criar o pedido" : ""}
            >
              <ShoppingCart className="h-3.5 w-3.5 mr-1.5" />
              {labelBotaoCompra(i)}
            </Button>
          </div>
        </div>
      </div>
    );
  };


  const renderGrupoUrgencia = (
    titulo: string,
    descricao: string,
    items: SugestaoItem[],
    tone: "destructive" | "warning" | "muted",
    icone: typeof AlertTriangle,
  ) => {
    if (items.length === 0) return null;
    const Icon = icone;
    const grupos = agruparPorFornecedor(items);
    const toneClasses = {
      destructive: "border-destructive/30 bg-destructive/5",
      warning: "border-warning/30 bg-warning/5",
      muted: "border-border bg-muted/20",
    }[tone];
    const iconClasses = {
      destructive: "text-destructive",
      warning: "text-warning",
      muted: "text-muted-foreground",
    }[tone];

    return (
      <div className={`glass-card border ${toneClasses} overflow-hidden`}>
        <div className="px-4 py-3 border-b border-border/50">
          <div className="flex items-center gap-2">
            <Icon className={`h-4 w-4 ${iconClasses}`} />
            <h3 className="text-sm font-semibold text-foreground">{titulo}</h3>
            <span className="text-xs text-muted-foreground">({items.length} {items.length === 1 ? "item" : "itens"})</span>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">{descricao}</p>
        </div>
        {grupos.map((grupo, gi) => {
          const { total, temIndisponivel } = totalEstimadoGrupo(grupo.items);
          return (
            <div key={gi}>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between px-4 py-2 border-b border-border/40 bg-accent/20">
                <div className="text-xs text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span>
                    Fornecedor: <span className="font-medium text-foreground">{grupo.fornecedor_nome}</span>
                  </span>
                  <span>
                    Custo estimado do grupo:{" "}
                    <span className="font-semibold text-foreground">{formatBRL(total)}</span>
                    {temIndisponivel && (
                      <span className="text-warning ml-1" title="Alguns itens deste grupo não têm preço cadastrado">
                        (parcial)
                      </span>
                    )}
                  </span>
                </div>
                <div className="flex gap-1.5 flex-wrap">
                  <Button variant="outline" size="sm" onClick={() => copiar(grupo)} title="Copiar lista">
                    <Copy className="h-3.5 w-3.5 mr-1" /> Copiar
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => enviarWhatsApp(grupo)} title="Enviar por WhatsApp">
                    <Send className="h-3.5 w-3.5 mr-1" /> WhatsApp
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => enviarEmail(grupo)} title="Enviar por email">
                    <Send className="h-3.5 w-3.5 mr-1" /> Email
                  </Button>
                </div>
              </div>
              <div className="divide-y divide-border/40">
                {grupo.items.map(renderItem)}
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  // ---------------------------------------------------------------------
  // Resumo global no topo: total de itens, urgentes e custo estimado.
  // ---------------------------------------------------------------------
  // Calculado a cada renderização: depende de preços e vínculos que chegam depois das sugestões.
  const resumoGlobal = (() => {
    let custoTotal = 0;
    let custoIndisponivel = false;
    sugestoes.forEach((s) => {
      const { valor } = precoEfetivoDe(s);
      if (valor == null) custoIndisponivel = true;
      else custoTotal += valor * s.qtd_sugerida;
    });
    return {
      totalItens: sugestoes.length,
      urgentes: comprarAgora.length,
      emBreve: comprarEmBreve.length,
      monitorar: monitorar.length,
      custoTotal,
      custoIndisponivel,
    };
  })();

  return (
    <div className="space-y-4">
      {/* Header + seletor de modo (Inteligência destaca-se com ring) */}
      <div className={`glass-card p-4 ${modo === "inteligencia" ? "ring-1 ring-primary/30" : ""}`}>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <h2 className="text-sm font-semibold text-foreground">Sugestão de Compras</h2>
              {modo === "inteligencia" && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-primary/15 text-primary">
                  <Brain className="h-3 w-3" />
                  Inteligência
                </span>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              {modo === "inteligencia"
                ? "Análise por risco de falta — considera estoque, mínimo, criticidade, classe ABC, política de reposição e lead time."
                : "Cálculo simples por consumo (real ou cadastrado) e cobertura. Itens ordenados por urgência."}
            </p>
          </div>
          <div className="flex items-center gap-0.5 rounded-lg border border-border bg-card/60 p-0.5 self-start shrink-0">
            <button
              onClick={() => setModo("padrao")}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                modo === "padrao" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
              title="Cálculo simples baseado em consumo e cobertura"
            >
              <Settings2 className="h-3.5 w-3.5" />
              Modo Padrão
            </button>
            <button
              onClick={() => setModo("inteligencia")}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                modo === "inteligencia" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
              title="Análise por risco — considera mínimo, criticidade, ABC e política"
            >
              <Brain className="h-3.5 w-3.5" />
              Modo Inteligência
            </button>
          </div>
        </div>
      </div>

      {/* RESUMO GLOBAL — visão de 3 segundos */}
      {sugestoes.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="glass-card p-4 border-l-4 border-l-destructive">
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium">Comprar agora</div>
                <div className="text-2xl font-bold text-destructive mt-1">{resumoGlobal.urgentes}</div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  {resumoGlobal.urgentes === 1 ? "item urgente" : "itens urgentes"}
                </div>
              </div>
              <AlertTriangle className="h-5 w-5 text-destructive shrink-0" />
            </div>
          </div>
          <div className="glass-card p-4 border-l-4 border-l-warning">
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium">Comprar em breve</div>
                <div className="text-2xl font-bold text-warning mt-1">{resumoGlobal.emBreve}</div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  {resumoGlobal.emBreve === 1 ? "item para programar" : "itens para programar"}
                </div>
              </div>
              <CalendarClock className="h-5 w-5 text-warning shrink-0" />
            </div>
          </div>
          <div className="glass-card p-4 border-l-4 border-l-primary/60">
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium">Custo estimado total</div>
                <div className="text-2xl font-bold text-foreground mt-1">{formatBRL(resumoGlobal.custoTotal)}</div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  {resumoGlobal.totalItens} {resumoGlobal.totalItens === 1 ? "item no total" : "itens no total"}
                  {resumoGlobal.custoIndisponivel && (
                    <span className="text-warning ml-1" title="Alguns itens não têm preço cadastrado">(parcial)</span>
                  )}
                </div>
              </div>
              <ShoppingCart className="h-5 w-5 text-primary shrink-0" />
            </div>
          </div>
        </div>
      )}

      {/* Filtros de cálculo */}
      <div className="flex flex-col sm:flex-row gap-2 flex-wrap">
        <div className="flex items-center gap-0.5 rounded-lg border border-border bg-card/60 p-0.5">
          <button
            onClick={() => setConsumoBase("real")}
            className={`px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors ${consumoBase === "real" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
          >
            Consumo Real
          </button>
          <button
            onClick={() => setConsumoBase("manual")}
            className={`px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors ${consumoBase === "manual" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
          >
            Consumo Cadastrado
          </button>
        </div>
        {consumoBase === "real" && (
          <div className="flex items-center gap-0.5 rounded-lg border border-border bg-card/60 p-0.5">
            {PERIODO_OPTIONS.map((p) => (
              <button
                key={p}
                onClick={() => setPeriodoDias(p)}
                className={`px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors ${periodoDias === p ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
              >
                {p}d
              </button>
            ))}
          </div>
        )}
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground whitespace-nowrap">Cobertura alvo:</span>
          <Input
            type="number"
            min="0"
            placeholder="dias"
            value={diasCobertura}
            onChange={(e) => setDiasCobertura(e.target.value)}
            className="w-20 h-8 text-xs"
          />
          <span className="text-xs text-muted-foreground">dias</span>
          {diasCobertura && Number(diasCobertura) > 0 && (
            <button onClick={() => setDiasCobertura("")} className="text-xs text-muted-foreground hover:text-foreground underline">
              limpar
            </button>
          )}
        </div>
      </div>

      {sugestoes.length === 0 && (
        <div className="glass-card p-8 text-center">
          <CheckCircle2 className="h-10 w-10 text-success mx-auto mb-2" />
          <p className="text-sm font-medium text-foreground">Tudo em ordem!</p>
          <p className="text-xs text-muted-foreground mt-1">Nenhuma compra necessária no momento.</p>
        </div>
      )}

      {/* 3 blocos por urgência */}
      {renderGrupoUrgencia(
        "🔴 Comprar agora",
        "Itens com estoque zerado ou risco imediato de ruptura. Atrasar pode parar a operação.",
        comprarAgora,
        "destructive",
        AlertTriangle,
      )}

      {renderGrupoUrgencia(
        "🟡 Comprar em breve",
        "Itens abaixo do mínimo ou que vão acabar antes do lead time. Programe na próxima leva de pedidos.",
        comprarEmBreve,
        "warning",
        CalendarClock,
      )}

      {renderGrupoUrgencia(
        "⚪ Monitorar",
        "Itens sem urgência imediata. Considere agrupar com outros pedidos para economizar frete.",
        monitorar,
        "muted",
        Eye,
      )}
    </div>
  );
}

function Metric({ label, value, negative }: { label: string; value: string | number; negative?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-muted-foreground">{label}</span>
      <span className={negative ? "text-destructive font-medium" : "text-foreground font-medium"}>{value}</span>
    </div>
  );
}
