import { useState, useMemo } from "react";
import { useFornecedores, useCreateFornecedor, useUpdateFornecedor } from "@/hooks/useFornecedores";
import { useItems } from "@/hooks/useItems";
import { useAllItemFornecedores } from "@/hooks/useItemFornecedores";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FieldLabel } from "@/components/FieldLabel";
import { StarRating } from "@/components/StarRating";
import { LoadingSkeleton, EmptyState } from "@/components/LoadingAndEmpty";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useLeadTimeReal } from "@/hooks/useLeadTimeReal";
import { toast } from "sonner";
import { Search, Truck, Plus, ChevronDown, Star, Clock } from "lucide-react";

const formatBRL = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

type ItemPorFornecedor = {
  item_id: string;
  item_nome: string;
  item_unidade: string;
  preco_unitario: number | null;
  custo_referencia: number;
  lead_time_dias: number | null;
  lead_time_padrao: number;
  quantidade_minima_compra: number;
  multiplo_compra: number;
  principal: boolean;
  ativo: boolean;
};

export default function FornecedoresPage() {
  const { data: fornecedores, isLoading } = useFornecedores();
  const { data: items } = useItems({ includeInactive: true });
  const { data: itemFornecedores } = useAllItemFornecedores();
  const createFornecedor = useCreateFornecedor();
  const updateFornecedor = useUpdateFornecedor();

  const [showForm, setShowForm] = useState(false);
  const [nome, setNome] = useState("");
  const [telefone, setTelefone] = useState("");
  const [email, setEmail] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [observacoes, setObservacoes] = useState("");

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"todos" | "ativo" | "inativo">("todos");
  const [ratingFilter, setRatingFilter] = useState<number | null>(null);
  const [itemFilter, setItemFilter] = useState("");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  /** Mapa fornecedor_id -> lista detalhada de itens fornecidos. */
  const itensPorFornecedor = useMemo(() => {
    const map = new Map<string, ItemPorFornecedor[]>();
    if (!itemFornecedores || !items) return map;
    for (const rel of itemFornecedores as any[]) {
      const item = items.find((i) => i.id === rel.item_id);
      if (!item) continue;
      const lista = map.get(rel.fornecedor_id) || [];
      lista.push({
        item_id: item.id,
        item_nome: item.nome,
        item_unidade: item.unidade,
        preco_unitario: rel.preco_unitario != null ? Number(rel.preco_unitario) : null,
        custo_referencia: Number(item.custo_unitario || 0),
        lead_time_dias: rel.lead_time_dias != null ? Number(rel.lead_time_dias) : null,
        lead_time_padrao: Number(item.lead_time_dias || 0),
        quantidade_minima_compra: Number(rel.quantidade_minima_compra || 0),
        multiplo_compra: Number(rel.multiplo_compra || 0),
        principal: !!rel.principal,
        ativo: rel.ativo !== false,
      });
      map.set(rel.fornecedor_id, lista);
    }
    // Ordena cada lista pelo nome do item
    for (const [k, v] of map) {
      v.sort((a, b) => a.item_nome.localeCompare(b.item_nome));
      map.set(k, v);
    }
    return map;
  }, [itemFornecedores, items]);

  const fornecedorIdsForItem = useMemo(() => {
    if (!itemFilter || !itemFornecedores) return null;
    return new Set(
      itemFornecedores.filter((r: any) => r.item_id === itemFilter).map((r: any) => r.fornecedor_id),
    );
  }, [itemFilter, itemFornecedores]);

  const filtered = useMemo(() => {
    if (!fornecedores) return [];
    return fornecedores.filter((f) => {
      if (search && !f.nome.toLowerCase().includes(search.toLowerCase())) return false;
      if (statusFilter === "ativo" && !f.ativo) return false;
      if (statusFilter === "inativo" && f.ativo) return false;
      if (ratingFilter !== null && (f.avaliacao || 0) < ratingFilter) return false;
      if (fornecedorIdsForItem && !fornecedorIdsForItem.has(f.id)) return false;
      return true;
    });
  }, [fornecedores, search, statusFilter, ratingFilter, fornecedorIdsForItem]);

  const handleCreate = async () => {
    if (!nome.trim()) { toast.error("Nome é obrigatório"); return; }
    try {
      await createFornecedor.mutateAsync({
        nome: nome.trim(),
        telefone: telefone || undefined,
        email: email || undefined,
        whatsapp: whatsapp || undefined,
        observacoes: observacoes || undefined,
      });
      toast.success("Fornecedor cadastrado!");
      setNome(""); setTelefone(""); setEmail(""); setWhatsapp(""); setObservacoes("");
      setShowForm(false);
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const toggleAtivo = async (f: any) => {
    try {
      await updateFornecedor.mutateAsync({ id: f.id, ativo: !f.ativo });
      toast.success(f.ativo ? "Fornecedor desativado" : "Fornecedor ativado");
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const handleRating = async (f: any, rating: number) => {
    try {
      await updateFornecedor.mutateAsync({ id: f.id, avaliacao: rating || null });
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const toggleExpand = (id: string) => setExpanded((p) => ({ ...p, [id]: !p[id] }));

  return (
    <div className="space-y-4">
      {/* Create form */}
      <div className="glass-card p-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-foreground">Cadastro de Fornecedores</h2>
          <Button variant="outline" size="sm" onClick={() => setShowForm(!showForm)} className="gap-1.5">
            {showForm ? "Cancelar" : <><Plus className="h-3.5 w-3.5" /> Novo Fornecedor</>}
          </Button>
        </div>
        {showForm && (
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 pt-3 border-t border-border/50">
            <div>
              <FieldLabel label="Nome / Razão Social" required help="Nome da empresa ou pessoa fornecedora." />
              <Input placeholder="Ex: Eletrônicos ABC Ltda" value={nome} onChange={e => setNome(e.target.value)} />
            </div>
            <div>
              <FieldLabel label="Telefone" help="Telefone fixo ou celular." />
              <Input placeholder="Ex: (11) 3456-7890" value={telefone} onChange={e => setTelefone(e.target.value)} />
            </div>
            <div>
              <FieldLabel label="Email" help="Email para pedidos de compra." />
              <Input placeholder="Ex: vendas@abc.com.br" type="email" value={email} onChange={e => setEmail(e.target.value)} />
            </div>
            <div>
              <FieldLabel label="WhatsApp" help="Número com DDD e código do país. Ex: 5511987654321" />
              <Input placeholder="Ex: 5511987654321" value={whatsapp} onChange={e => setWhatsapp(e.target.value)} />
            </div>
            <div>
              <FieldLabel label="Observações" help="Anotações gerais." />
              <Input placeholder="Ex: Entrega às terças" value={observacoes} onChange={e => setObservacoes(e.target.value)} />
            </div>
            <div className="flex items-end">
              <Button onClick={handleCreate} disabled={createFornecedor.isPending} className="w-full">Salvar Fornecedor</Button>
            </div>
          </div>
        )}
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Buscar fornecedor..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9 bg-card/60" />
        </div>
        <div className="flex gap-2 flex-wrap">
          <div className="flex items-center gap-0.5 rounded-lg border border-border bg-card/60 p-0.5">
            {(["todos", "ativo", "inativo"] as const).map((s) => (
              <button key={s} onClick={() => setStatusFilter(s)}
                className={`px-2.5 py-1.5 rounded-md text-xs font-medium transition-all ${statusFilter === s ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>
                {s === "todos" ? "Todos" : s === "ativo" ? "Ativos" : "Inativos"}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-0.5 rounded-lg border border-border bg-card/60 p-0.5">
            <button onClick={() => setRatingFilter(null)} className={`px-2.5 py-1.5 rounded-md text-xs font-medium transition-all ${ratingFilter === null ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>Todas</button>
            {[3, 4, 5].map((r) => (
              <button key={r} onClick={() => setRatingFilter(ratingFilter === r ? null : r)}
                className={`px-2.5 py-1.5 rounded-md text-xs font-medium transition-all ${ratingFilter === r ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>
                ≥{r}★
              </button>
            ))}
          </div>
          <select className="bg-input border border-border rounded-lg px-3 py-1.5 text-xs text-foreground" value={itemFilter} onChange={(e) => setItemFilter(e.target.value)}>
            <option value="">Todos os itens</option>
            {items?.map((i) => <option key={i.id} value={i.id}>{i.nome}</option>)}
          </select>
        </div>
      </div>

      {fornecedores && fornecedores.length > 0 && (
        <p className="text-xs text-muted-foreground">{filtered.length} de {fornecedores.length} fornecedores</p>
      )}

      {isLoading ? <LoadingSkeleton rows={3} /> : (
        <div className="space-y-2">
          {filtered.map((f) => {
            const itensFornecidos = itensPorFornecedor.get(f.id) || [];
            const isExpanded = !!expanded[f.id];
            return (
              <div key={f.id} className="glass-card overflow-hidden">
                <div className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <div className="flex-1 min-w-[200px]">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-foreground">{f.nome}</span>
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                        f.ativo ? "bg-success/12 text-success" : "bg-muted text-muted-foreground"
                      }`}>
                        {f.ativo ? "Ativo" : "Inativo"}
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground mt-1">
                      {f.telefone && <span>Tel: {f.telefone}</span>}
                      {f.email && <span>{f.email}</span>}
                      {f.whatsapp && <span>WhatsApp: {f.whatsapp}</span>}
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <StarRating value={f.avaliacao} onChange={(v) => handleRating(f, v)} />
                  </div>

                  <LeadTimeRealBadge fornecedorId={f.id} />

                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">
                      {itensFornecidos.length} {itensFornecidos.length === 1 ? "item" : "itens"} fornecido{itensFornecidos.length === 1 ? "" : "s"}
                    </span>
                    <Button variant="ghost" size="sm" onClick={() => toggleAtivo(f)}>
                      {f.ativo ? "Desativar" : "Ativar"}
                    </Button>
                  </div>
                </div>

                {itensFornecidos.length > 0 && (
                  <Collapsible open={isExpanded} onOpenChange={() => toggleExpand(f.id)}>
                    <CollapsibleTrigger className="w-full px-4 py-2 bg-muted/30 border-t border-border/50 text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center justify-between">
                      <span className="inline-flex items-center gap-1">
                        <ChevronDown className={`h-3 w-3 transition-transform ${isExpanded ? "rotate-180" : ""}`} />
                        {isExpanded ? "Ocultar itens fornecidos" : "Ver preços e condições por item"}
                      </span>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="bg-muted/20 text-muted-foreground border-t border-border/40">
                              <th className="text-left px-4 py-2 font-medium">Item</th>
                              <th className="text-right px-4 py-2 font-medium">Preço unitário</th>
                              <th className="text-right px-4 py-2 font-medium">Lead time cadastrado</th>
                              <th className="text-right px-4 py-2 font-medium">Lead time real médio</th>
                              <th className="text-right px-4 py-2 font-medium">Qtd. mínima</th>
                              <th className="text-right px-4 py-2 font-medium">Múltiplo</th>
                              <th className="text-center px-4 py-2 font-medium">Principal</th>
                              <th className="text-center px-4 py-2 font-medium">Status</th>
                            </tr>
                          </thead>
                          <tbody>
                            {itensFornecidos.map((it) => {
                              const usaFallbackPreco = it.preco_unitario == null;
                              const usaFallbackLead = it.lead_time_dias == null;
                              return (
                                <tr key={it.item_id} className="border-t border-border/30">
                                  <td className="px-4 py-2 text-foreground">
                                    {it.item_nome} <span className="text-muted-foreground">({it.item_unidade})</span>
                                  </td>
                                  <td className="px-4 py-2 text-right">
                                    {usaFallbackPreco ? (
                                      <span className="text-muted-foreground italic" title="Sem preço cadastrado para este vínculo. Usando custo de referência do item.">
                                        {formatBRL(it.custo_referencia)} (referência)
                                      </span>
                                    ) : (
                                      <span className="text-foreground font-medium">{formatBRL(it.preco_unitario!)}</span>
                                    )}
                                  </td>
                                  <td className="px-4 py-2 text-right">
                                    {usaFallbackLead ? (
                                      <span className="text-muted-foreground italic" title="Sem lead time específico. Usando lead time padrão do item.">
                                        {it.lead_time_padrao} dias (padrão)
                                      </span>
                                    ) : (
                                      <span className="text-foreground">{it.lead_time_dias} dias</span>
                                    )}
                                  </td>
                                  <td className="px-4 py-2 text-right">
                                    <LeadTimeRealCell fornecedorId={f.id} itemId={it.item_id} cadastrado={it.lead_time_dias ?? it.lead_time_padrao} />
                                  </td>
                                  <td className="px-4 py-2 text-right text-foreground">{it.quantidade_minima_compra || "—"}</td>
                                  <td className="px-4 py-2 text-right text-foreground">{it.multiplo_compra || "—"}</td>
                                  <td className="px-4 py-2 text-center">
                                    {it.principal ? (
                                      <Star className="h-3.5 w-3.5 fill-warning text-warning inline" />
                                    ) : (
                                      <span className="text-muted-foreground">—</span>
                                    )}
                                  </td>
                                  <td className="px-4 py-2 text-center">
                                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                                      it.ativo ? "bg-success/12 text-success" : "bg-muted text-muted-foreground"
                                    }`}>
                                      {it.ativo ? "Ativo" : "Inativo"}
                                    </span>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                      <p className="text-[11px] text-muted-foreground italic px-4 py-2 bg-muted/10 border-t border-border/30">
                        Para editar preço, lead time e condições de um item, abra o item em "Itens" e use a seção "Fornecedores do item".
                      </p>
                    </CollapsibleContent>
                  </Collapsible>
                )}
              </div>
            );
          })}
          {filtered.length === 0 && (
            <div className="glass-card">
              <EmptyState
                icon={Truck}
                title={fornecedores && fornecedores.length > 0 ? "Nenhum fornecedor encontrado" : "Nenhum fornecedor cadastrado"}
                description="Cadastre fornecedores para vincular aos seus itens."
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function LeadTimeRealBadge({ fornecedorId }: { fornecedorId: string }) {
  const stats = useLeadTimeReal({ fornecedorId });
  if (stats.amostras === 0) {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground" title="Nenhum pedido completo para calcular lead time real ainda.">
        <Clock className="h-3 w-3" />
        Sem histórico de lead time
      </span>
    );
  }
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-primary/12 text-primary"
      title={`Média de ${stats.amostras} pedido(s) recebido(s) completamente.`}
    >
      <Clock className="h-3 w-3" />
      Lead real médio: {stats.mediaDias.toFixed(1)} dias
    </span>
  );
}

function LeadTimeRealCell({
  fornecedorId,
  itemId,
  cadastrado,
}: {
  fornecedorId: string;
  itemId: string;
  cadastrado: number;
}) {
  const stats = useLeadTimeReal({ fornecedorId, itemId });
  if (stats.amostras === 0) {
    return <span className="text-muted-foreground italic">sem dados</span>;
  }
  const diff = stats.mediaDias - cadastrado;
  const cls = Math.abs(diff) < 1
    ? "text-foreground"
    : diff > 0
      ? "text-destructive"
      : "text-success";
  const sinal = diff > 0 ? "+" : "";
  return (
    <span className={`${cls} font-medium`} title={`${stats.amostras} pedido(s) considerado(s).`}>
      {stats.mediaDias.toFixed(1)} dias{" "}
      <span className="text-[10px] font-normal">({sinal}{diff.toFixed(1)} vs cadastrado)</span>
    </span>
  );
}
