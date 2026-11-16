import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { FieldLabel } from "@/components/FieldLabel";
import {
  useItemFornecedores,
  useUpsertItemFornecedor,
  useDeleteItemFornecedor,
  type ItemFornecedor,
} from "@/hooks/useItemFornecedores";
import { useFornecedores } from "@/hooks/useFornecedores";
import { usePrecoHistorico, usePrecoHistoricoRecente } from "@/hooks/usePrecoHistorico";
import { useLeadTimeReal } from "@/hooks/useLeadTimeReal";
import { calcularTendencia, tendenciaLabel } from "@/lib/tendencia";
import { toast } from "sonner";
import { Star, Plus, Pencil, Trash2, History, TrendingUp, TrendingDown, Minus, Clock } from "lucide-react";
import { MoneyInput } from "@/components/MoneyInput";

type Props = {
  itemId?: string;
  /** Custo de referência do item (fallback exibido quando o vínculo não tem preço). */
  custoReferenciaItem?: number;
  /** Lead time padrão do item (fallback exibido quando o vínculo não tem lead time). */
  leadTimePadraoItem?: number;
  /** Mensagem opcional exibida quando ainda não existe um item (modo "criar"). */
  pendingItemHint?: string;
  /** Unidade de estoque do item (ex: "un"). */
  itemUnidadeEstoque?: string;
  /** Unidade de compra padrão do item (herdada quando vínculo não sobrescreve). */
  itemUnidadeCompra?: string | null;
  /** Fator de conversão padrão do item. */
  itemFatorConversao?: number | null;
};

type FormState = {
  id?: string;
  fornecedor_id: string;
  preco_unitario: string;
  lead_time_dias: string;
  quantidade_minima_compra: string;
  multiplo_compra: string;
  principal: boolean;
  ativo: boolean;
  observacoes: string;
  unidade_compra: string;
  fator_conversao: string;
};

const EMPTY: FormState = {
  fornecedor_id: "",
  preco_unitario: "",
  lead_time_dias: "",
  quantidade_minima_compra: "0",
  multiplo_compra: "0",
  principal: false,
  ativo: true,
  observacoes: "",
  unidade_compra: "",
  fator_conversao: "",
};

export function ItemFornecedoresEditor({
  itemId,
  custoReferenciaItem = 0,
  leadTimePadraoItem = 0,
  pendingItemHint,
  itemUnidadeEstoque = "un",
  itemUnidadeCompra = null,
  itemFatorConversao = 1,
}: Props) {
  const { data: vinculos } = useItemFornecedores(itemId);
  const { data: fornecedores } = useFornecedores();
  const { data: precoHistoricoRecente } = usePrecoHistoricoRecente(90);
  const upsert = useUpsertItemFornecedor();
  const remove = useDeleteItemFornecedor();

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [historicoFornecedorId, setHistoricoFornecedorId] = useState<string | null>(null);
  const [historicoFornecedorNome, setHistoricoFornecedorNome] = useState<string>("");

  const fornecedoresAtivos = (fornecedores || []).filter((f) => f.ativo);
  const idsJaVinculados = new Set((vinculos || []).map((v) => v.fornecedor_id));

  const fornecedoresDisponiveis = fornecedoresAtivos.filter(
    (f) => !idsJaVinculados.has(f.id) || f.id === form.fornecedor_id,
  );

  /**
   * Candidato recomendado a fornecedor principal: vínculo ativo com o menor preço efetivo
   * (preco_unitario do vínculo, ou custo_referencia do item como fallback).
   * Usado apenas como dica visual quando o candidato ainda NÃO é o principal atual.
   */
  const candidatoRecomendadoId = useMemo(() => {
    const ativos = (vinculos || []).filter((v) => v.ativo !== false);
    if (ativos.length < 2) return null;
    const comPreco = ativos
      .map((v) => ({
        id: v.id,
        precoEfetivo: v.preco_unitario != null ? Number(v.preco_unitario) : Number(custoReferenciaItem || 0),
      }))
      .filter((x) => x.precoEfetivo > 0);
    if (comPreco.length === 0) return null;
    const melhor = comPreco.reduce((a, b) => (b.precoEfetivo < a.precoEfetivo ? b : a));
    const principalAtual = ativos.find((v) => v.principal);
    if (principalAtual && principalAtual.id === melhor.id) return null; // já é o principal, sem dica
    return melhor.id;
  }, [vinculos, custoReferenciaItem]);

  const openCreate = () => {
    setForm({
      ...EMPTY,
      preco_unitario: custoReferenciaItem ? String(custoReferenciaItem) : "",
      lead_time_dias: leadTimePadraoItem ? String(leadTimePadraoItem) : "",
      principal: (vinculos || []).length === 0, // primeiro vínculo já vira principal
    });
    setOpen(true);
  };

  const openEdit = (v: ItemFornecedor) => {
    setForm({
      id: v.id,
      fornecedor_id: v.fornecedor_id,
      preco_unitario: v.preco_unitario != null ? String(v.preco_unitario) : "",
      lead_time_dias: v.lead_time_dias != null ? String(v.lead_time_dias) : "",
      quantidade_minima_compra: String(v.quantidade_minima_compra ?? 0),
      multiplo_compra: String(v.multiplo_compra ?? 0),
      principal: v.principal,
      ativo: v.ativo ?? true,
      observacoes: v.observacoes ?? "",
      unidade_compra: v.unidade_compra ?? "",
      fator_conversao: v.fator_conversao != null ? String(v.fator_conversao) : "",
    });
    setOpen(true);
  };

  const handleSave = async () => {
    if (!itemId) {
      toast.error("Salve o item antes de adicionar fornecedores.");
      return;
    }
    if (!form.fornecedor_id) {
      toast.error("Selecione um fornecedor.");
      return;
    }
    try {
      const fatorVinc = Number(form.fator_conversao);
      await upsert.mutateAsync({
        id: form.id,
        item_id: itemId,
        fornecedor_id: form.fornecedor_id,
        preco_unitario: form.preco_unitario === "" ? null : Number(form.preco_unitario),
        lead_time_dias: form.lead_time_dias === "" ? null : Number(form.lead_time_dias),
        quantidade_minima_compra: Number(form.quantidade_minima_compra) || 0,
        multiplo_compra: Number(form.multiplo_compra) || 0,
        principal: form.principal,
        ativo: form.ativo,
        observacoes: form.observacoes.trim() || null,
        unidade_compra: form.unidade_compra.trim() || null,
        fator_conversao: form.fator_conversao === "" || !Number.isFinite(fatorVinc) || fatorVinc <= 0 ? null : fatorVinc,
      });
      toast.success(form.id ? "Vínculo atualizado!" : "Fornecedor vinculado ao item!");
      setOpen(false);
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const handleRemove = async (v: ItemFornecedor) => {
    if (!confirm(`Remover este fornecedor do item?`)) return;
    try {
      await remove.mutateAsync(v.id);
      toast.success("Vínculo removido.");
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const setPrincipal = async (v: ItemFornecedor) => {
    if (v.principal || !itemId) return;
    try {
      await upsert.mutateAsync({
        id: v.id,
        item_id: itemId,
        fornecedor_id: v.fornecedor_id,
        preco_unitario: v.preco_unitario,
        lead_time_dias: v.lead_time_dias,
        quantidade_minima_compra: v.quantidade_minima_compra,
        multiplo_compra: v.multiplo_compra,
        principal: true,
        ativo: v.ativo,
        observacoes: v.observacoes,
        unidade_compra: v.unidade_compra ?? null,
        fator_conversao: v.fator_conversao ?? null,
      });
      toast.success("Fornecedor principal atualizado.");
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <FieldLabel
          label="Fornecedores do item"
          help="Cada vínculo guarda preço, lead time, quantidade mínima e múltiplo de compra deste fornecedor para este item. O fornecedor principal será sugerido automaticamente nos pedidos."
        />
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={openCreate}
          disabled={!itemId || fornecedoresAtivos.length === 0}
          className="gap-1.5"
        >
          <Plus className="h-3.5 w-3.5" /> Adicionar fornecedor ao item
        </Button>
      </div>

      {!itemId ? (
        <p className="text-xs text-muted-foreground italic">
          {pendingItemHint || "Salve o item para adicionar fornecedores com preço e condições comerciais."}
        </p>
      ) : fornecedoresAtivos.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhum fornecedor ativo cadastrado.</p>
      ) : !vinculos || vinculos.length === 0 ? (
        <div className="border border-dashed border-border rounded-md p-4 text-center">
          <p className="text-xs text-muted-foreground">
            Nenhum fornecedor vinculado ainda. Use "Adicionar fornecedor ao item" para começar.
          </p>
        </div>
      ) : (
        <div className="border border-border rounded-md overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-muted/40 text-muted-foreground">
                <th className="text-left px-2 py-2 font-medium">Fornecedor</th>
                <th className="text-right px-2 py-2 font-medium">Preço unitário</th>
                <th className="text-center px-2 py-2 font-medium">Tendência (90d)</th>
                <th className="text-right px-2 py-2 font-medium">Lead time cadastrado</th>
                <th className="text-right px-2 py-2 font-medium">Lead real médio</th>
                <th className="text-right px-2 py-2 font-medium">Quantidade mínima</th>
                <th className="text-right px-2 py-2 font-medium">Múltiplo</th>
                <th className="text-center px-2 py-2 font-medium">Principal</th>
                <th className="text-center px-2 py-2 font-medium">Status</th>
                <th className="text-right px-2 py-2 font-medium">Ações</th>
              </tr>
            </thead>
            <tbody>
              {vinculos.map((v: any) => {
                const fornecedorNome = v.fornecedores?.nome || "—";
                const usaFallbackPreco = v.preco_unitario == null;
                const usaFallbackLead = v.lead_time_dias == null;
                return (
                  <tr key={v.id} className="border-t border-border/50">
                    <td className="px-2 py-1.5 text-foreground">{fornecedorNome}</td>
                    <td className="px-2 py-1.5 text-right text-foreground">
                      {usaFallbackPreco ? (
                        <span className="text-muted-foreground italic" title="Usando custo de referência do item">
                          R$ {Number(custoReferenciaItem || 0).toFixed(2)} (referência)
                        </span>
                      ) : (
                        `R$ ${Number(v.preco_unitario).toFixed(2)}`
                      )}
                    </td>
                    <td className="px-2 py-1.5 text-center">
                      <TendenciaCellMini
                        pontos={precoHistoricoRecente}
                        itemId={itemId!}
                        fornecedorId={v.fornecedor_id}
                        precoAtual={v.preco_unitario != null ? Number(v.preco_unitario) : null}
                      />
                    </td>
                    <td className="px-2 py-1.5 text-right text-foreground">
                      {usaFallbackLead ? (
                        <span className="text-muted-foreground italic" title="Usando lead time padrão do item">
                          {leadTimePadraoItem || 0} dias (padrão)
                        </span>
                      ) : (
                        `${v.lead_time_dias} dias`
                      )}
                    </td>
                    <td className="px-2 py-1.5 text-right">
                      <LeadRealCellMini
                        itemId={itemId}
                        fornecedorId={v.fornecedor_id}
                        cadastrado={v.lead_time_dias ?? leadTimePadraoItem ?? 0}
                      />
                    </td>
                    <td className="px-2 py-1.5 text-right text-foreground">{v.quantidade_minima_compra || 0}</td>
                    <td className="px-2 py-1.5 text-right text-foreground">{v.multiplo_compra || 0}</td>
                    <td className="px-2 py-1.5 text-center">
                      {(() => {
                        const recomendado = candidatoRecomendadoId === v.id;
                        return (
                          <button
                            type="button"
                            onClick={() => setPrincipal(v)}
                            title={
                              v.principal
                                ? "Fornecedor principal"
                                : recomendado
                                  ? "Recomendado: tem o menor preço entre os fornecedores deste item. Clique para definir como principal."
                                  : "Definir como principal"
                            }
                            className="p-1 rounded hover:bg-accent inline-flex items-center gap-0.5"
                          >
                            <Star
                              className={`h-3.5 w-3.5 ${
                                v.principal
                                  ? "fill-warning text-warning"
                                  : recomendado
                                    ? "text-warning"
                                    : "text-muted-foreground"
                              }`}
                            />
                            {recomendado && !v.principal && (
                              <span className="text-[9px] font-semibold text-warning leading-none">menor preço</span>
                            )}
                          </button>
                        );
                      })()}
                    </td>
                    <td className="px-2 py-1.5 text-center">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                          v.ativo ? "bg-success/12 text-success" : "bg-muted text-muted-foreground"
                        }`}
                      >
                        {v.ativo ? "Ativo" : "Inativo"}
                      </span>
                    </td>
                    <td className="px-2 py-1.5 text-right">
                      <div className="inline-flex gap-1">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setHistoricoFornecedorId(v.fornecedor_id);
                            setHistoricoFornecedorNome(fornecedorNome);
                          }}
                          title="Ver histórico de preços"
                        >
                          <History className="h-3.5 w-3.5" />
                        </Button>
                        <Button type="button" variant="ghost" size="sm" onClick={() => openEdit(v)} title="Editar">
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button type="button" variant="ghost" size="sm" onClick={() => handleRemove(v)} title="Remover">
                          <Trash2 className="h-3.5 w-3.5 text-destructive" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{form.id ? "Editar vínculo de fornecedor" : "Adicionar fornecedor ao item"}</DialogTitle>
          </DialogHeader>

          <div className="space-y-3">
            <div>
              <FieldLabel label="Fornecedor" required help="Selecione o fornecedor que fornece este item." />
              <select
                className="bg-input border border-border rounded-md px-3 py-2 text-sm text-foreground w-full h-10"
                value={form.fornecedor_id}
                onChange={(e) => setForm((p) => ({ ...p, fornecedor_id: e.target.value }))}
                disabled={!!form.id}
              >
                <option value="">Selecione...</option>
                {fornecedoresDisponiveis.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.nome}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <FieldLabel
                  label="Preço por embalagem (R$)"
                  help={`Preço da UNIDADE DE COMPRA praticado por este fornecedor (ex: R$ por caixa). Se vazio, usa o preço de referência do item.\nUnidade de compra herdada: ${form.unidade_compra || itemUnidadeCompra || itemUnidadeEstoque}.`}
                />
                <MoneyInput
                  placeholder={custoReferenciaItem ? `Ref.: ${custoReferenciaItem}` : "0,00"}
                  value={form.preco_unitario}
                  onChange={(v) => setForm((p) => ({ ...p, preco_unitario: v }))}
                />
              </div>
              <div>
                <FieldLabel
                  label="Lead time (dias)"
                  help="Tempo entre o pedido e o recebimento por este fornecedor. Se vazio, usa o lead time padrão do item."
                />
                <Input
                  type="number"
                  min="0"
                  placeholder={leadTimePadraoItem ? `Padrão: ${leadTimePadraoItem}` : "Ex: 7"}
                  value={form.lead_time_dias}
                  onChange={(e) => setForm((p) => ({ ...p, lead_time_dias: e.target.value }))}
                />
              </div>
              <div>
                <FieldLabel
                  label="Quantidade mínima de compra"
                  help="Quantidade mínima exigida pelo fornecedor por pedido (em unidade de compra). 0 = sem mínimo."
                />
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.quantidade_minima_compra}
                  onChange={(e) => setForm((p) => ({ ...p, quantidade_minima_compra: e.target.value }))}
                />
              </div>
              <div>
                <FieldLabel
                  label="Múltiplo de compra"
                  help="Quantidade comprada deve ser múltiplo deste valor (em unidade de compra). 0 = livre."
                />
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.multiplo_compra}
                  onChange={(e) => setForm((p) => ({ ...p, multiplo_compra: e.target.value }))}
                />
              </div>
            </div>

            {/* Override de embalagem por fornecedor */}
            <div className="border border-border/50 rounded-md p-3 space-y-2 bg-muted/20">
              <div className="text-xs font-medium text-foreground">
                Embalagem deste fornecedor (opcional)
              </div>
              <p className="text-[11px] text-muted-foreground">
                Padrão herdado do item:{" "}
                <strong className="text-foreground">
                  {itemUnidadeCompra || itemUnidadeEstoque}
                </strong>{" "}
                · fator{" "}
                <strong className="text-foreground">{itemFatorConversao || 1}</strong>.
                Preencha apenas se este fornecedor embala diferente.
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <FieldLabel
                    label="Unidade de compra"
                    help={`Sobrescreve a unidade de compra do item para este fornecedor.\nDeixe vazio para herdar (${itemUnidadeCompra || itemUnidadeEstoque}).`}
                  />
                  <Input
                    placeholder={itemUnidadeCompra || itemUnidadeEstoque}
                    value={form.unidade_compra}
                    onChange={(e) => setForm((p) => ({ ...p, unidade_compra: e.target.value }))}
                  />
                </div>
                <div>
                  <FieldLabel
                    label="Fator de conversão"
                    help={`Quantas unidades de estoque há em 1 embalagem deste fornecedor.\nDeixe vazio para herdar (${itemFatorConversao || 1}).`}
                  />
                  <Input
                    type="number"
                    min="1"
                    step="any"
                    placeholder={String(itemFatorConversao || 1)}
                    value={form.fator_conversao}
                    onChange={(e) => setForm((p) => ({ ...p, fator_conversao: e.target.value }))}
                  />
                </div>
                {(() => {
                  const fEf = Number(form.fator_conversao) > 0
                    ? Number(form.fator_conversao)
                    : Number(itemFatorConversao || 1);
                  const preco = Number(form.preco_unitario);
                  if (fEf > 1 && preco > 0) {
                    return (
                      <div className="col-span-2 text-[11px] text-muted-foreground bg-background rounded px-2 py-1.5 border border-border/40">
                        <strong className="text-foreground">Equivalência:</strong>{" "}
                        R$ {(preco / fEf).toFixed(4)} por {itemUnidadeEstoque}
                      </div>
                    );
                  }
                  return null;
                })()}
              </div>
            </div>


            <div>
              <FieldLabel label="Observações" help="Anotações sobre o vínculo (opcional)." />
              <Input
                placeholder="Ex: Negociado em out/2025; pagamento à vista."
                value={form.observacoes}
                onChange={(e) => setForm((p) => ({ ...p, observacoes: e.target.value }))}
              />
            </div>

            <div className="flex items-center gap-4 pt-1">
              <label className="inline-flex items-center gap-2 text-sm text-foreground cursor-pointer">
                <Checkbox
                  checked={form.principal}
                  onCheckedChange={(v) => setForm((p) => ({ ...p, principal: !!v }))}
                />
                <span>Marcar como fornecedor principal</span>
              </label>
              <label className="inline-flex items-center gap-2 text-sm text-foreground cursor-pointer">
                <Checkbox
                  checked={form.ativo}
                  onCheckedChange={(v) => setForm((p) => ({ ...p, ativo: !!v }))}
                />
                <span>Vínculo ativo</span>
              </label>
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button type="button" onClick={handleSave} disabled={upsert.isPending}>
              {form.id ? "Salvar alterações" : "Adicionar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <PrecoHistoricoDialog
        itemId={itemId}
        fornecedorId={historicoFornecedorId}
        fornecedorNome={historicoFornecedorNome}
        onClose={() => setHistoricoFornecedorId(null)}
      />
    </div>
  );
}

function PrecoHistoricoDialog({
  itemId,
  fornecedorId,
  fornecedorNome,
  onClose,
}: {
  itemId?: string;
  fornecedorId: string | null;
  fornecedorNome: string;
  onClose: () => void;
}) {
  const { data: historico, isLoading } = usePrecoHistorico(itemId, fornecedorId || undefined);
  const fmtBRL = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  const fmtDate = (s: string) => new Date(s).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });

  // Variação entre o registro mais recente e o anterior (do mesmo tipo de origem) para o ícone topo.
  const cadastros = (historico || []).filter((h) => h.origem === "CADASTRO");
  const atual = cadastros[0];
  const anterior = cadastros[1];
  let variacao: { pct: number; up: boolean } | null = null;
  if (atual && anterior && Number(anterior.preco_unitario) > 0) {
    const diff = Number(atual.preco_unitario) - Number(anterior.preco_unitario);
    variacao = { pct: (diff / Number(anterior.preco_unitario)) * 100, up: diff > 0 };
  }

  return (
    <Dialog open={!!fornecedorId} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            Histórico de preços — {fornecedorNome}
            {variacao && (
              <span
                className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ${
                  variacao.up ? "bg-destructive/12 text-destructive" : "bg-success/12 text-success"
                }`}
              >
                {variacao.up ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                {variacao.up ? "+" : ""}{variacao.pct.toFixed(1)}% vs anterior
              </span>
            )}
          </DialogTitle>
        </DialogHeader>

        {isLoading ? (
          <p className="text-sm text-muted-foreground">Carregando histórico...</p>
        ) : !historico || historico.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Ainda não há registros de preço para este fornecedor. Cada alteração no preço cadastrado e cada pedido de
            compra criado gera um novo ponto histórico automaticamente.
          </p>
        ) : (
          <div className="border border-border rounded-md overflow-hidden max-h-96 overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="bg-muted/40 text-muted-foreground sticky top-0">
                <tr>
                  <th className="text-left px-3 py-2 font-medium">Data</th>
                  <th className="text-left px-3 py-2 font-medium">Origem</th>
                  <th className="text-right px-3 py-2 font-medium">Preço unitário</th>
                  <th className="text-right px-3 py-2 font-medium">Variação</th>
                  <th className="text-left px-3 py-2 font-medium">Vigência</th>
                </tr>
              </thead>
              <tbody>
                {historico.map((h, idx) => {
                  const proximoMesmaOrigem = historico.slice(idx + 1).find((x) => x.origem === h.origem);
                  let varEl: React.ReactNode = <Minus className="h-3 w-3 text-muted-foreground inline" />;
                  if (proximoMesmaOrigem && Number(proximoMesmaOrigem.preco_unitario) > 0) {
                    const diff = Number(h.preco_unitario) - Number(proximoMesmaOrigem.preco_unitario);
                    const pct = (diff / Number(proximoMesmaOrigem.preco_unitario)) * 100;
                    if (Math.abs(pct) < 0.01) {
                      varEl = <Minus className="h-3 w-3 text-muted-foreground inline" />;
                    } else {
                      const up = diff > 0;
                      varEl = (
                        <span className={`inline-flex items-center gap-0.5 ${up ? "text-destructive" : "text-success"}`}>
                          {up ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                          {up ? "+" : ""}{pct.toFixed(1)}%
                        </span>
                      );
                    }
                  }
                  return (
                    <tr key={h.id} className="border-t border-border/50">
                      <td className="px-3 py-1.5 text-foreground">{fmtDate(h.data_inicio)}</td>
                      <td className="px-3 py-1.5">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                            h.origem === "CADASTRO"
                              ? "bg-primary/12 text-primary"
                              : "bg-accent text-accent-foreground"
                          }`}
                        >
                          {h.origem === "CADASTRO" ? "Cadastro" : "Pedido"}
                        </span>
                      </td>
                      <td className="px-3 py-1.5 text-right text-foreground font-medium">
                        {fmtBRL(Number(h.preco_unitario))}
                      </td>
                      <td className="px-3 py-1.5 text-right">{varEl}</td>
                      <td className="px-3 py-1.5 text-muted-foreground">
                        {h.origem === "PEDIDO"
                          ? "evento"
                          : h.data_fim
                            ? `até ${fmtDate(h.data_fim)}`
                            : "vigente"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>Fechar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function LeadRealCellMini({
  itemId,
  fornecedorId,
  cadastrado,
}: {
  itemId?: string;
  fornecedorId: string;
  cadastrado: number;
}) {
  const stats = useLeadTimeReal({ itemId: itemId || null, fornecedorId });
  if (!itemId || stats.amostras === 0) {
    return <span className="text-muted-foreground italic text-[11px]">sem dados</span>;
  }
  const diff = stats.mediaDias - cadastrado;
  const cls = Math.abs(diff) < 1
    ? "text-foreground"
    : diff > 0
      ? "text-destructive"
      : "text-success";
  const sinal = diff > 0 ? "+" : "";
  return (
    <span className={`${cls} font-medium inline-flex items-center gap-1`} title={`${stats.amostras} pedido(s) recebido(s) completamente.`}>
      <Clock className="h-3 w-3" />
      {stats.mediaDias.toFixed(1)}d
      <span className="text-[10px] font-normal text-muted-foreground">({sinal}{diff.toFixed(1)})</span>
    </span>
  );
}

/**
 * Tendência 90d compacta para a tabela de vínculos.
 * Reusa os pontos de histórico já carregados pelo editor (sem queries por linha).
 */
function TendenciaCellMini({
  pontos,
  itemId,
  fornecedorId,
  precoAtual,
}: {
  pontos: any[] | undefined;
  itemId: string;
  fornecedorId: string;
  precoAtual: number | null;
}) {
  const t = calcularTendencia(pontos as any, itemId, fornecedorId, precoAtual);
  if (t.direcao === "sem_dados") {
    return (
      <span className="text-[11px] text-muted-foreground italic" title="Mínimo de 2 registros nos últimos 90 dias.">
        sem dados
      </span>
    );
  }
  const { label, tone } = tendenciaLabel(t);
  const cls =
    tone === "destructive" ? "text-destructive" : tone === "success" ? "text-success" : "text-muted-foreground";
  const Icon = t.direcao === "alta" ? TrendingUp : t.direcao === "baixa" ? TrendingDown : Minus;
  const tooltip = `Média 90d: R$ ${t.media?.toFixed(2)} · ${t.amostras} ponto(s) · último real: R$ ${t.ultimoPreco?.toFixed(2)}`;
  return (
    <span
      className={`inline-flex items-center gap-1 text-[11px] font-medium ${cls}`}
      title={tooltip}
    >
      <Icon className="h-3 w-3" />
      {label}
    </span>
  );
}
