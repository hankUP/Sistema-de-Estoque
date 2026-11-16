import { useState, useEffect, useRef } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ItemFormFields, calcSuggestions, type ItemFormState } from "@/components/ItemFormFields";
import { ItemFornecedoresEditor } from "@/components/ItemFornecedoresEditor";
import { CostCenterSelect } from "@/components/CostCenterSelect";
import { FieldLabel } from "@/components/FieldLabel";
import { Input } from "@/components/ui/input";
import { DeleteItemDialog } from "@/components/DeleteItemDialog";
import { useUpdateItem, defaultsForTipo, type Item } from "@/hooks/useItems";
import { useStock } from "@/hooks/useStock";
import { useReactivateItem } from "@/hooks/useItemDeletion";
import { Trash2, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/auth";

type Props = {
  item: Item | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function EditItemDialog({ item, open, onOpenChange }: Props) {
  const user = useAuth();
  const updateItem = useUpdateItem();
  const reactivate = useReactivateItem();
  const { data: stockEntries, isLoading: stockLoading, isError: stockError } = useStock(30, item && !item.ativo ? "inativos" : "ativos");
  const currentStock = item ? stockEntries?.find((entry) => entry.item.id === item.id)?.fisico : undefined;
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [stockBase, setStockBase] = useState<number | null>(null);
  const [stockTarget, setStockTarget] = useState("");
  const [stockDirty, setStockDirty] = useState(false);
  const [adjustmentCenterId, setAdjustmentCenterId] = useState("");

  const [formState, setFormState] = useState<ItemFormState>({
    nome: "", tipo: "MP", unidade: "un", consumoDiario: "0",
    leadTime: "0", estoqueMinimo: "0", estoqueIdeal: "0", estoqueMaximo: "0", custoUnitario: "0",
    modoProducaoPadrao: "JIT",
    unidadeCompra: "", fatorConversao: "",
  });
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const manualOverrides = useRef(new Set<string>());

  useEffect(() => {
    setStockBase(null);
    setStockTarget("");
    setStockDirty(false);
    setAdjustmentCenterId("");
  }, [item?.id, open]);

  useEffect(() => {
    if (open && !stockDirty && currentStock !== undefined) {
      setStockBase(currentStock);
      setStockTarget(String(currentStock));
    }
  }, [open, currentStock, stockDirty]);

  useEffect(() => {
    if (item) {
      manualOverrides.current = new Set(["estoqueMinimo", "estoqueIdeal", "estoqueMaximo"]);
      setFormState({
        nome: item.nome,
        tipo: item.tipo,
        unidade: item.unidade,
        consumoDiario: String(item.consumo_diario),
        leadTime: String(item.lead_time_dias),
        estoqueMinimo: String(item.estoque_minimo),
        estoqueIdeal: String(item.estoque_ideal),
        estoqueMaximo: String(item.estoque_maximo),
        custoUnitario: String(item.custo_unitario || 0),
        modoProducaoPadrao: (item.modo_producao_padrao as string) || (item.tipo === "PF" ? "JIT" : ""),
        unidadeCompra: item.unidade_compra || "",
        fatorConversao: item.fator_conversao != null && Number(item.fator_conversao) !== 1
          ? String(item.fator_conversao)
          : "",
      });
      const hasAdvanced =
        Number(item.consumo_diario) > 0 ||
        Number(item.estoque_ideal) > 0 ||
        Number(item.estoque_maximo) > 0 ||
        Number(item.custo_unitario) > 0;
      setAdvancedOpen(hasAdvanced);
    }
  }, [item]);

  const handleChange = (field: keyof ItemFormState, value: string) => {
    if (["estoqueMinimo", "estoqueIdeal", "estoqueMaximo"].includes(field)) {
      manualOverrides.current.add(field);
    }
    if (field === "consumoDiario" || field === "leadTime") {
      manualOverrides.current.clear();
    }
    setFormState((prev) => {
      const next = { ...prev, [field]: value };
      if (field === "consumoDiario" || field === "leadTime") {
        const cd = Number(field === "consumoDiario" ? value : prev.consumoDiario);
        const lt = Number(field === "leadTime" ? value : prev.leadTime);
        if (cd > 0 && lt > 0) {
          const s = calcSuggestions(cd, lt);
          if (!manualOverrides.current.has("estoqueMinimo")) next.estoqueMinimo = String(s.min);
          if (!manualOverrides.current.has("estoqueIdeal")) next.estoqueIdeal = String(s.ideal);
          if (!manualOverrides.current.has("estoqueMaximo")) next.estoqueMaximo = String(s.max);
        }
      }
      return next;
    });
  };

  const handleSave = async () => {
    if (!item || !formState.nome.trim()) return;
    const targetQuantity = Number(stockTarget);
    if (stockBase !== null && (!stockTarget.trim() || !Number.isFinite(targetQuantity) || targetQuantity < 0)) {
      toast.error("Informe uma quantidade física válida.");
      return;
    }
    const stockChanged = stockBase !== null && targetQuantity !== stockBase;
    try {
      const newTipo = formState.tipo as "MP" | "SUB" | "PF";
      const tipoChanged = newTipo !== item.tipo;
      // Quando o tipo muda, reaplica defaults inteligentes de comportamento.
      const def = tipoChanged ? defaultsForTipo(newTipo) : null;
      const fatorNum = Number(formState.fatorConversao);
      const fatorFinal = Number.isFinite(fatorNum) && fatorNum > 0 ? fatorNum : 1;
      await updateItem.mutateAsync({
        id: item.id,
        nome: formState.nome.trim(),
        tipo: newTipo,
        unidade: formState.unidade,
        consumo_diario: Number(formState.consumoDiario),
        lead_time_dias: Number(formState.leadTime),
        estoque_minimo: Number(formState.estoqueMinimo),
        estoque_ideal: Number(formState.estoqueIdeal),
        estoque_maximo: Number(formState.estoqueMaximo),
        custo_unitario: Number(formState.custoUnitario),
        modo_producao_padrao: newTipo === "PF"
          ? ((formState.modoProducaoPadrao as "JIT" | "ESTOQUE") || "JIT")
          : null,
        unidade_compra: formState.unidadeCompra?.trim() || null,
        fator_conversao: fatorFinal,
        ...(stockChanged && { stockAdjustment: {
          expectedQuantity: stockBase,
          targetQuantity,
          centerId: adjustmentCenterId,
        } }),
        ...(def
          ? {
              produzido_internamente: def.produzido_internamente,
              gera_sugestao_compra: def.gera_sugestao_compra,
              compra_direta: def.compra_direta,
              controla_estoque: def.controla_estoque,
            }
          : {}),
      });
      toast.success(stockChanged ? "Item e estoque físico atualizados!" : "Item atualizado!");
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Editar Item</DialogTitle>
        </DialogHeader>

        <ItemFormFields
          state={formState}
          onChange={handleChange}
          layout="dialog"
          advancedOpen={advancedOpen}
          onAdvancedOpenChange={setAdvancedOpen}
          extraBasicFields={(
            <>
              <div>
                <FieldLabel label="Quantidade física em estoque" help="Informe o saldo total após a contagem, não apenas a diferença. Se mudar, o sistema registra um ajuste no histórico." />
                <Input
                  type="number"
                  min="0"
                  step="any"
                  value={stockTarget}
                  onChange={(event) => { setStockTarget(event.target.value); setStockDirty(true); }}
                  disabled={stockBase === null || updateItem.isPending}
                  placeholder={stockLoading ? "Carregando saldo..." : "0"}
                />
                {stockError && <p className="text-xs text-destructive mt-1">Não foi possível consultar o estoque.</p>}
              </div>
              {stockBase !== null && stockTarget.trim() !== "" && Number(stockTarget) !== stockBase && (
                <div className="col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <FieldLabel label="Setor do ajuste (opcional)" />
                    <CostCenterSelect value={adjustmentCenterId} onChange={setAdjustmentCenterId} sectorOnly required={false} />
                  </div>
                  <div>
                    <FieldLabel label="Responsável pela contagem" />
                    <Input value={user.displayName} readOnly aria-readonly="true" />
                  </div>
                  <p className="sm:col-span-2 text-xs text-muted-foreground">O setor é opcional; o responsável é registrado pela conta conectada.</p>
                </div>
              )}
            </>
          )}
        />

        <div className="mt-4 pt-4 border-t border-border/50">
          <ItemFornecedoresEditor
            itemId={item?.id}
            custoReferenciaItem={Number(formState.custoUnitario) || 0}
            leadTimePadraoItem={Number(formState.leadTime) || 0}
            itemUnidadeEstoque={formState.unidade || "un"}
            itemUnidadeCompra={formState.unidadeCompra || null}
            itemFatorConversao={Number(formState.fatorConversao) > 0 ? Number(formState.fatorConversao) : 1}
          />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 mt-4 pt-4 border-t border-border/50">
          <div className="flex items-center gap-2">
            {item && item.ativo && (
              <Button
                variant="outline"
                className="text-destructive border-destructive/30 hover:bg-destructive/10 hover:text-destructive"
                onClick={() => item && setConfirmDeleteId(item.id)}
              >
                <Trash2 className="h-4 w-4" /> Excluir ou desativar item
              </Button>
            )}
            {item && !item.ativo && (
              <Button
                variant="outline"
                className="text-success border-success/30 hover:bg-success/10 hover:text-success"
                onClick={async () => {
                  try {
                    await reactivate.mutateAsync(item.id);
                    toast.success(`"${item.nome}" voltou a aparecer nos cadastros.`);
                    onOpenChange(false);
                  } catch (e: any) {
                    toast.error(e?.message ?? String(e));
                  }
                }}
                disabled={reactivate.isPending}
              >
                <RotateCcw className="h-4 w-4" /> Reativar item
              </Button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
            <Button onClick={handleSave} disabled={updateItem.isPending || stockLoading}>Salvar</Button>
          </div>
        </div>

        <DeleteItemDialog
          itemId={confirmDeleteId}
          open={!!confirmDeleteId}
          onOpenChange={(o) => {
            if (!o) {
              const wasOpen = !!confirmDeleteId;
              setConfirmDeleteId(null);
              // Se o item foi desativado/excluído, fecha o dialog de edição também
              if (wasOpen) onOpenChange(false);
            }
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
