import { useRef, useState } from "react";
import { FormDialog } from "@/components/FormDialog";
import { ItemFormFields, calcSuggestions, type ItemFormState } from "@/components/ItemFormFields";
import { ItemFornecedoresEditor } from "@/components/ItemFornecedoresEditor";
import { CostCenterSelect } from "@/components/CostCenterSelect";
import { FieldLabel } from "@/components/FieldLabel";
import { Input } from "@/components/ui/input";
import { useCreateItem } from "@/hooks/useItems";
import { useAuth } from "@/auth";
import { toast } from "sonner";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

const EMPTY_STATE: ItemFormState = {
  nome: "", tipo: "MP", unidade: "un", consumoDiario: "0",
  leadTime: "0", estoqueMinimo: "0", estoqueIdeal: "0", estoqueMaximo: "0", custoUnitario: "0",
  modoProducaoPadrao: "JIT",
  unidadeCompra: "", fatorConversao: "",
};

export function CreateItemDialog({ open, onOpenChange }: Props) {
  const user = useAuth();
  const createItem = useCreateItem();
  const [formState, setFormState] = useState<ItemFormState>(EMPTY_STATE);
  const [createdItemId, setCreatedItemId] = useState<string | null>(null);
  const [initialQuantity, setInitialQuantity] = useState("");
  const [initialCenterId, setInitialCenterId] = useState("");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const manualOverrides = useRef(new Set<string>());

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

  const reset = () => {
    setFormState(EMPTY_STATE);
    setCreatedItemId(null);
    setInitialQuantity("");
    setInitialCenterId("");
    setAdvancedOpen(false);
    manualOverrides.current.clear();
  };

  const handleSubmit = async () => {
    if (!formState.nome.trim()) {
      toast.error("Informe o nome do item.");
      return;
    }
    if (createdItemId) {
      // Item já criado nesta sessão — apenas fechar
      toast.success("Item cadastrado!");
      reset();
      onOpenChange(false);
      return;
    }
    const quantity = initialQuantity.trim() ? Number(initialQuantity) : 0;
    if (!Number.isFinite(quantity) || quantity < 0) {
      toast.error("Informe uma quantidade inicial válida.");
      return;
    }
    try {
      const fatorNum = Number(formState.fatorConversao);
      const fatorFinal = Number.isFinite(fatorNum) && fatorNum > 0 ? fatorNum : 1;
      const newItem = await createItem.mutateAsync({
        nome: formState.nome.trim(),
        tipo: formState.tipo as "MP" | "SUB" | "PF",
        unidade: formState.unidade,
        consumo_diario: Number(formState.consumoDiario),
        estoque_minimo: Number(formState.estoqueMinimo),
        estoque_ideal: Number(formState.estoqueIdeal),
        estoque_maximo: Number(formState.estoqueMaximo),
        lead_time_dias: Number(formState.leadTime),
        custo_unitario: Number(formState.custoUnitario),
        modo_producao_padrao: formState.tipo === "PF"
          ? ((formState.modoProducaoPadrao as "JIT" | "ESTOQUE") || "JIT")
          : null,
        unidade_compra: formState.unidadeCompra?.trim() || null,
        fator_conversao: fatorFinal,
        ...(quantity > 0 && { initialStock: {
          quantity,
          centerId: initialCenterId,
        } }),
      });
      setCreatedItemId(newItem.id);
      toast.success(quantity > 0
        ? "Item e estoque inicial registrados! Agora você pode adicionar fornecedores."
        : "Item criado! Agora você pode adicionar fornecedores com preço e condições comerciais.");
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const loading = createItem.isPending;

  return (
    <FormDialog
      open={open}
      onOpenChange={(v) => { if (!v) reset(); onOpenChange(v); }}
      title="Cadastrar Item"
      description="Cadastre o item e, se já houver unidades físicas, informe a quantidade inicial. Depois você pode adicionar fornecedores."
      onSubmit={handleSubmit}
      submitLabel={createdItemId ? "Concluir" : "Salvar item"}
      loading={loading}
      submitDisabled={!formState.nome.trim()}
    >
      <ItemFormFields
        state={formState}
        onChange={handleChange}
        layout="dialog"
        advancedOpen={advancedOpen}
        onAdvancedOpenChange={setAdvancedOpen}
        extraBasicFields={!createdItemId && (
          <>
            <div>
              <FieldLabel label="Quantidade inicial em estoque" help="Quantidade física disponível agora, na unidade de medida do item. Deixe vazio se ainda não houver estoque. Estoque mínimo é apenas um limite de alerta." />
              <Input type="number" min="0" step="any" placeholder="Ex: 10" value={initialQuantity} onChange={(event) => setInitialQuantity(event.target.value)} />
            </div>
            {Number(initialQuantity) > 0 && (
              <div className="col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <FieldLabel label="Setor do estoque inicial (opcional)" />
                  <CostCenterSelect value={initialCenterId} onChange={setInitialCenterId} sectorOnly required={false} />
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
          itemId={createdItemId || undefined}
          custoReferenciaItem={Number(formState.custoUnitario) || 0}
          leadTimePadraoItem={Number(formState.leadTime) || 0}
          itemUnidadeEstoque={formState.unidade || "un"}
          itemUnidadeCompra={formState.unidadeCompra || null}
          itemFatorConversao={Number(formState.fatorConversao) > 0 ? Number(formState.fatorConversao) : 1}
          pendingItemHint="Salve o item primeiro (botão abaixo). Depois você poderá adicionar fornecedores com preço, lead time, quantidade mínima e múltiplo de compra."
        />
      </div>
    </FormDialog>
  );
}
