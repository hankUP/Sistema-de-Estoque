import { useEffect, type ReactNode } from "react";
import { Input } from "@/components/ui/input";
import { FieldLabel } from "@/components/FieldLabel";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ChevronDown, Settings2, Info } from "lucide-react";
import { MoneyInput } from "@/components/MoneyInput";
import { calcSuggestions } from "@/lib/estoqueSugestoes";

type ItemFormState = {
  nome: string;
  tipo: "MP" | "SUB" | "PF";
  unidade: string;
  consumoDiario: string;
  leadTime: string;
  estoqueMinimo: string;
  estoqueIdeal: string;
  estoqueMaximo: string;
  custoUnitario: string;
  /** Apenas para Produto Final. "JIT" | "ESTOQUE". */
  modoProducaoPadrao?: string;
  /** Unidade de compra (embalagem). Vazio = mesma da unidade. */
  unidadeCompra?: string;
  /** Fator de conversão. Vazio ou "1" = 1 (sem embalagem). */
  fatorConversao?: string;
};

type Props = {
  state: ItemFormState;
  onChange: (field: keyof ItemFormState, value: string) => void;
  layout?: "grid" | "dialog";
  /** Quando "auto", mostra toggle simples/avançado (padrão simples). "all" mostra tudo (modo legacy). */
  mode?: "auto" | "all";
  /** Controle externo do estado avançado (opcional). */
  advancedOpen?: boolean;
  onAdvancedOpenChange?: (open: boolean) => void;
  extraBasicFields?: ReactNode;
};

export function ItemFormFields({
  state,
  onChange,
  layout = "grid",
  mode = "auto",
  advancedOpen,
  onAdvancedOpenChange,
  extraBasicFields,
}: Props) {
  const gridClass = layout === "dialog" ? "grid grid-cols-2 gap-4" : "grid grid-cols-2 lg:grid-cols-4 gap-3";

  const cd = Number(state.consumoDiario);
  const lt = Number(state.leadTime);
  const hasSuggestion = cd > 0 && lt > 0;
  const suggestions = hasSuggestion ? calcSuggestions(cd, lt) : null;

  const showAll = mode === "all";

  // Comportamento por tipo
  const isPF = state.tipo === "PF";
  const isSUB = state.tipo === "SUB";
  const isMP = state.tipo === "MP";
  // Campos de compra (lead time fornecedor, consumo, estoque min/ideal/max) só fazem sentido para MP
  const showCompraReposicao = isMP;
  // Submontagem mostra estoque opcional, mas oculta lead time / consumo (não comprado)
  const showEstoqueBuffer = isSUB;

  // Microcopy por tipo
  const tipoMicrocopy = isPF
    ? "Produto Final é produzido internamente. Por padrão opera em modo Just in Time (sob demanda). Você poderá decidir, em cada ordem de produção, se o lote vai para Cliente ou para Estoque."
    : isSUB
    ? "Submontagem é produzida internamente e usada como componente em produtos finais. Pode manter buffer em estoque se desejar."
    : "Matéria-prima é comprada de fornecedores. Configure estoque mínimo, lead time e fornecedores para entrar na sugestão de compras.";

  // Campos básicos (modo simples) — sempre visíveis
  const basicFields = (
    <div className="space-y-3">
      <div className={gridClass}>
        <div>
          <FieldLabel label="Nome do item" required help="Nome descritivo do item. Ex: Raspberry Pi 4, Fonte 12V, Case Alumínio." />
          <Input placeholder="Ex: Raspberry Pi 4" value={state.nome} onChange={(e) => onChange("nome", e.target.value)} />
        </div>
        <div>
          <FieldLabel label="Tipo" required help="MP = Matéria-Prima (peças compradas)&#10;SUB = Submontagem (montagem intermediária)&#10;PF = Produto Final (kit completo para venda)" />
          <select
            className="bg-input border border-border rounded-md px-3 py-2 text-sm text-foreground w-full h-10"
            value={state.tipo}
            onChange={(e) => onChange("tipo", e.target.value)}
          >
            <option value="MP">Matéria-Prima</option>
            <option value="SUB">Submontagem</option>
            <option value="PF">Produto Final</option>
          </select>
        </div>
        <div>
          <FieldLabel label="Unidade de medida" required help="Como este item é contado.&#10;Exemplos: un (unidade), pç (peça), cx (caixa), m (metro), kg (quilo)." />
          <Input placeholder="Ex: un, pç, cx" value={state.unidade} onChange={(e) => onChange("unidade", e.target.value)} />
        </div>

        {extraBasicFields}

        {/* Modo de produção padrão — apenas Produto Final */}
        {isPF && (
          <div>
            <FieldLabel
              label="Modo padrão de produção"
              required
              help="JIT (Just in Time): produzido sob demanda, sem manter estoque por padrão.&#10;ESTOQUE: produzido para formar estoque do produto final.&#10;Esta é apenas a sugestão padrão — em cada ordem de produção você poderá escolher Cliente ou Estoque."
            />
            <select
              className="bg-input border border-border rounded-md px-3 py-2 text-sm text-foreground w-full h-10"
              value={state.modoProducaoPadrao || "JIT"}
              onChange={(e) => onChange("modoProducaoPadrao", e.target.value)}
            >
              <option value="JIT">Just in Time (sob demanda)</option>
              <option value="ESTOQUE">Para Estoque</option>
            </select>
          </div>
        )}

        {/* Estoque mínimo — só para MP (compras) */}
        {showCompraReposicao && (
          <div>
            <FieldLabel
              label="Estoque Mínimo"
              help="Quantidade mínima que deve ter em estoque. Abaixo desse valor, o sistema alerta e sugere compra."
            />
            <Input
              type="number"
              min="0"
              placeholder="Ex: 50"
              value={state.estoqueMinimo}
              onChange={(e) => onChange("estoqueMinimo", e.target.value)}
            />
          </div>
        )}

        {/* Lead time padrão — só para MP */}
        {showCompraReposicao && (
          <div>
            <FieldLabel
              label="Lead Time padrão (dias)"
              help="Lead time padrão usado quando não houver lead time específico cadastrado por fornecedor.&#10;Importante para o cálculo do ponto de pedido."
            />
            <Input
              type="number"
              min="0"
              placeholder="Ex: 7"
              value={state.leadTime}
              onChange={(e) => onChange("leadTime", e.target.value)}
            />
          </div>
        )}
      </div>

      {/* Microcopy explicativa por tipo */}
      <div className="flex items-start gap-2 px-3 py-2 rounded-md bg-muted/40 border border-border/50 text-xs text-muted-foreground">
        <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" />
        <span>{tipoMicrocopy}</span>
      </div>
    </div>
  );

  // Campos avançados — variam por tipo
  const advancedFields = (
    <div className="space-y-3 pt-2">
      <div className={gridClass}>
        {/* Consumo diário — só MP */}
        {showCompraReposicao && (
          <div>
            <FieldLabel
              label="Consumo Diário Estimado"
              help="Quantidade média consumida por dia. Se deixar 0, o sistema usará o consumo real calculado das movimentações."
            />
            <Input
              type="number"
              min="0"
              step="0.01"
              placeholder="Ex: 5"
              value={state.consumoDiario}
              onChange={(e) => onChange("consumoDiario", e.target.value)}
            />
          </div>
        )}
        {/* Estoque ideal/máximo — MP ou SUB (buffer) */}
        {(showCompraReposicao || showEstoqueBuffer) && (
          <div>
            <FieldLabel
              label="Estoque Ideal"
              help={`Quantidade ideal para operação confortável.\nFórmula: 2 × Consumo Diário × Lead Time\n${suggestions ? `Sugestão calculada: ${suggestions.ideal}` : "Preencha Consumo e Lead Time para sugestão automática."}`}
            />
            <Input
              type="number"
              min="0"
              placeholder={suggestions ? `Sugestão: ${suggestions.ideal}` : "Ex: 85"}
              value={state.estoqueIdeal}
              onChange={(e) => onChange("estoqueIdeal", e.target.value)}
            />
          </div>
        )}
        {(showCompraReposicao || showEstoqueBuffer) && (
          <div>
            <FieldLabel
              label="Estoque Máximo"
              help={`Quantidade máxima recomendada.\nFórmula: Estoque Ideal × 1.5\n${suggestions ? `Sugestão calculada: ${suggestions.max}` : "Preencha Consumo e Lead Time para sugestão automática."}`}
            />
            <Input
              type="number"
              min="0"
              placeholder={suggestions ? `Sugestão: ${suggestions.max}` : "Ex: 130"}
              value={state.estoqueMaximo}
              onChange={(e) => onChange("estoqueMaximo", e.target.value)}
            />
          </div>
        )}
        {/* Custo de referência — sempre disponível (PF/SUB precisam para custo de produção; MP para fallback) */}
        <div>
          <FieldLabel
            label={isMP ? "Preço de referência por embalagem (R$)" : "Custo de referência (R$)"}
            help={isMP
              ? "Preço de referência da UNIDADE DE COMPRA (ex: R$ por caixa). Se a embalagem não for diferente da unidade de estoque, é o preço por unidade. Usado como fallback quando não houver preço cadastrado por fornecedor."
              : "Custo de referência do item. Para produtos produzidos internamente, normalmente é calculado a partir do custo dos componentes (BOM)."}
          />
          <MoneyInput
            value={state.custoUnitario}
            onChange={(v) => onChange("custoUnitario", v)}
          />
        </div>
      </div>

      {/* Embalagem de compra — só MP */}
      {showCompraReposicao && (
        <div className="space-y-2 mt-2 pt-3 border-t border-border/50">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-foreground">Embalagem de compra</span>
            <span className="text-[11px] text-muted-foreground">(opcional — defina quando o item é comprado em lotes/caixas/pacotes)</span>
          </div>
          <div className={gridClass}>
            <div>
              <FieldLabel
                label="Unidade de compra"
                help={`Como este item é COMPRADO do fornecedor (ex: caixa, pacote, fardo).\nDeixe vazio se for igual à unidade de estoque (${state.unidade || "un"}).`}
              />
              <Input
                placeholder={`Ex: caixa (estoque: ${state.unidade || "un"})`}
                value={state.unidadeCompra || ""}
                onChange={(e) => onChange("unidadeCompra", e.target.value)}
              />
            </div>
            <div>
              <FieldLabel
                label="Fator de conversão"
                help={`Quantas unidades de estoque há em 1 unidade de compra.\nExemplo: 1 caixa = 100 unidades → fator = 100.\nDeixe vazio ou 1 quando não houver embalagem.`}
              />
              <Input
                type="number"
                min="1"
                step="any"
                placeholder="1"
                value={state.fatorConversao || ""}
                onChange={(e) => onChange("fatorConversao", e.target.value)}
              />
            </div>
            {Number(state.fatorConversao) > 1 && Number(state.custoUnitario) > 0 && (
              <div className="col-span-2 text-[11px] text-muted-foreground bg-muted/30 rounded px-3 py-1.5">
                <strong className="text-foreground">Equivalência:</strong>{" "}
                1 {state.unidadeCompra || "embalagem"} = {state.fatorConversao} {state.unidade || "un"} ·{" "}
                R$ {(Number(state.custoUnitario) / Number(state.fatorConversao)).toFixed(4)} por {state.unidade || "un"}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );

  // Modo "all" (legacy) — mostra tudo sem colapsar
  if (showAll) {
    return (
      <div className="space-y-3">
        {basicFields}
        {advancedFields}
      </div>
    );
  }

  // Texto do colapsável muda por tipo
  const advancedHint = isPF
    ? "(custo de referência)"
    : isSUB
    ? "(estoque ideal/máximo, custo)"
    : "(consumo, estoque ideal/máximo, custo)";

  return (
    <div className="space-y-3">
      {basicFields}
      <Collapsible open={advancedOpen} onOpenChange={onAdvancedOpenChange}>
        <CollapsibleTrigger className="flex items-center gap-2 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors group">
          <Settings2 className="h-3.5 w-3.5" />
          <span>Opções avançadas</span>
          <span className="text-[10px] text-muted-foreground/70">{advancedHint}</span>
          <ChevronDown className={`h-3.5 w-3.5 transition-transform ${advancedOpen ? "rotate-180" : ""}`} />
        </CollapsibleTrigger>
        <CollapsibleContent>{advancedFields}</CollapsibleContent>
      </Collapsible>
    </div>
  );
}

export type { ItemFormState };
