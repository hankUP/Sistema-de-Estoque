import { useState } from "react";
import { toast } from "sonner";
import { Building2, Pencil, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FieldLabel } from "@/components/FieldLabel";
import { LoadingSkeleton, EmptyState } from "@/components/LoadingAndEmpty";
import { PageHeader } from "@/components/PageHeader";
import { useCostCenters, useCreateCostCenter, useUpdateCostCenter, type CostCenter } from "@/hooks/useCostCenters";

export default function CostCentersPage() {
  const { data: centers, isLoading } = useCostCenters();
  const createCenter = useCreateCostCenter();
  const updateCenter = useUpdateCostCenter();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [nome, setNome] = useState("");
  const [tipo, setTipo] = useState<CostCenter["tipo"]>("SETOR");
  const [descricao, setDescricao] = useState("");

  const reset = () => {
    setEditingId(null);
    setFormOpen(false);
    setNome("");
    setTipo("SETOR");
    setDescricao("");
  };
  const edit = (center: CostCenter) => {
    setEditingId(center.id);
    setNome(center.nome);
    setTipo(center.tipo);
    setDescricao(center.descricao || "");
    setFormOpen(true);
  };
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!nome.trim()) return toast.error("Informe um nome.");
    try {
      const changes = { nome: nome.trim(), tipo, descricao: descricao.trim() || null };
      if (editingId) await updateCenter.mutateAsync({ id: editingId, ...changes });
      else await createCenter.mutateAsync(changes);
      toast.success(editingId ? "Centro atualizado." : "Centro cadastrado.");
      reset();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível salvar o centro.");
    }
  };
  const toggle = async (center: CostCenter) => {
    try {
      await updateCenter.mutateAsync({ id: center.id, ativo: !center.ativo });
      toast.success(center.ativo ? "Centro desativado. O histórico foi preservado." : "Centro ativado.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível alterar o centro.");
    }
  };

  return (
    <div className="space-y-5">
      <PageHeader title="Centros de Custo" description="Cadastre setores ou pessoas para identificar a origem de cada movimentação." />
      <div className="glass-card p-5 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-semibold text-foreground">Cadastro</h2>
          <Button size="sm" onClick={() => { reset(); setFormOpen(true); }} className="gap-1.5">
            <Plus className="h-4 w-4" /> Novo centro
          </Button>
        </div>
        {formOpen && (
          <form onSubmit={save} className="grid gap-3 sm:grid-cols-2 border-t border-border pt-4">
            <div>
              <FieldLabel label="Nome" required />
              <Input value={nome} onChange={(event) => setNome(event.target.value)} maxLength={120} placeholder="Ex: Almoxarifado ou Maria Silva" required />
            </div>
            <div>
              <FieldLabel label="Tipo" required />
              <select value={tipo} onChange={(event) => setTipo(event.target.value as CostCenter["tipo"])} className="bg-input border border-border rounded-lg px-3 h-10 text-sm text-foreground w-full">
                <option value="SETOR">Setor</option>
                <option value="PESSOA">Pessoa</option>
              </select>
            </div>
            <div className="sm:col-span-2">
              <FieldLabel label="Descrição (opcional)" />
              <Input value={descricao} onChange={(event) => setDescricao(event.target.value)} maxLength={300} placeholder="Ex: Equipe de montagem" />
            </div>
            <div className="sm:col-span-2 flex gap-2">
              <Button type="submit" disabled={createCenter.isPending || updateCenter.isPending}>Salvar</Button>
              <Button type="button" variant="outline" onClick={reset}>Cancelar</Button>
            </div>
          </form>
        )}
      </div>
      {isLoading ? <LoadingSkeleton rows={3} /> : !centers?.length ? (
        <EmptyState icon={Building2} title="Nenhum centro cadastrado" description="Cadastre o primeiro setor ou responsável para usar nas movimentações." />
      ) : (
        <div className="glass-card divide-y divide-border/50">
          {centers.map((center) => (
            <div key={center.id} className="p-4 flex flex-wrap items-center gap-3">
              <div className="flex-1 min-w-48">
                <div className="font-medium text-foreground">{center.nome}</div>
                <div className="text-xs text-muted-foreground">
                  {center.tipo === "SETOR" ? "Setor" : "Pessoa"} · {center.ativo ? "Ativo" : "Inativo"}
                  {center.descricao ? ` · ${center.descricao}` : ""}
                </div>
              </div>
              <Button size="sm" variant="outline" onClick={() => edit(center)} className="gap-1"><Pencil className="h-3.5 w-3.5" /> Editar</Button>
              <Button size="sm" variant="outline" onClick={() => toggle(center)} disabled={updateCenter.isPending}>
                {center.ativo ? "Desativar" : "Ativar"}
              </Button>
            </div>
          ))}
        </div>
      )}
      <p className="text-xs text-muted-foreground">Desativar impede novas seleções e mantém a identificação nas movimentações anteriores.</p>
    </div>
  );
}
