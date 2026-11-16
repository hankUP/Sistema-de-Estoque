import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { useItemImpact, useDeactivateItem, useHardDeleteItem } from "@/hooks/useItemDeletion";
import { AlertTriangle, Info, Loader2, Trash2, Archive } from "lucide-react";
import { toast } from "sonner";
import { CostCenterSelect } from "@/components/CostCenterSelect";
import { useAuth } from "@/auth";

type Props = {
  itemId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone?: () => void;
};

export function DeleteItemDialog({ itemId, open, onOpenChange, onDone }: Props) {
  const user = useAuth();
  const { data: impact, isLoading } = useItemImpact(open ? itemId : null);
  const deactivate = useDeactivateItem();
  const hardDelete = useHardDeleteItem();
  const [zerarEstoque, setZerarEstoque] = useState(false);
  const [centroCustoId, setCentroCustoId] = useState("");

  useEffect(() => {
    if (open) setZerarEstoque(false);
  }, [open, itemId]);

  const temEstoque = !!impact && impact.estoqueFisico !== 0;
  const temBloqueios = !!impact && impact.bloqueiosAtivos.length > 0;
  const podeExcluirDef = !!impact && impact.podeExcluirDefinitivo;

  async function handleDeactivate() {
    if (!impact) return;
    try {
      await deactivate.mutateAsync({
        itemId: impact.itemId,
        zerarEstoque,
        estoqueAtual: impact.estoqueFisico,
        centroCustoId,
      });
      toast.success("Item desativado", {
        description: `"${impact.itemNome}" foi desativado e não aparecerá mais em novos cadastros. O histórico foi preservado.`,
      });
      onOpenChange(false);
      onDone?.();
    } catch (e: any) {
      toast.error("Não foi possível desativar", { description: e?.message ?? String(e) });
    }
  }

  async function handleHardDelete() {
    if (!impact) return;
    try {
      await hardDelete.mutateAsync(impact.itemId);
      toast.success("Item excluído", { description: `"${impact.itemNome}" foi excluído definitivamente.` });
      onOpenChange(false);
      onDone?.();
    } catch (e: any) {
      toast.error("Não foi possível excluir", { description: e?.message ?? String(e) });
    }
  }

  const loading = deactivate.isPending || hardDelete.isPending;

  return (
    <Dialog open={open} onOpenChange={(v) => !loading && onOpenChange(v)}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="h-5 w-5" />
            Excluir item do cadastro
          </DialogTitle>
          <DialogDescription>
            A exclusão definitiva apaga o cadastro do banco. A desativação preserva
            todo o histórico e apenas remove o item dos novos fluxos.
          </DialogDescription>
        </DialogHeader>

        {isLoading || !impact ? (
          <div className="flex items-center justify-center py-8 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin mr-2" />
            Calculando impacto...
          </div>
        ) : (
          <div className="space-y-4">
            <div className="rounded-md border border-border bg-muted/30 p-3">
              <div className="text-sm font-medium mb-2">{impact.itemNome}</div>
              <ul className="text-xs space-y-1 text-muted-foreground">
                <ImpactLine
                  label="Estoque físico atual"
                  value={`${impact.estoqueFisico} unidade(s)`}
                  highlight={impact.estoqueFisico !== 0}
                />
                <ImpactLine label="Movimentações no histórico" value={String(impact.movimentacoes)} />
                <ImpactLine
                  label="Estruturas (BOM) como componente"
                  value={String(impact.bomComoComponente)}
                  highlight={impact.bomComoComponente > 0}
                />
                <ImpactLine
                  label="Estruturas (BOM) como produto pai"
                  value={String(impact.bomComoPai)}
                  highlight={impact.bomComoPai > 0}
                />
                <ImpactLine
                  label="Pedidos de compra (em aberto / total)"
                  value={`${impact.pedidosCompraAbertos} / ${impact.pedidosCompraTotal}`}
                  highlight={impact.pedidosCompraAbertos > 0}
                />
                <ImpactLine
                  label="Ordens de produção (em aberto / total)"
                  value={`${impact.ordensProducaoAbertas} / ${impact.ordensProducaoTotal}`}
                  highlight={impact.ordensProducaoAbertas > 0}
                />
                <ImpactLine
                  label="Reservas em ordens de produção"
                  value={`${impact.reservas} unidade(s)`}
                  highlight={impact.reservas > 0}
                />
                <ImpactLine
                  label="Fornecedores vinculados"
                  value={String(impact.fornecedoresVinculados)}
                />
              </ul>
            </div>

            {temBloqueios && (
              <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                  <div>
                    <div className="font-semibold mb-1">Vínculos ativos impedem a exclusão definitiva:</div>
                    <ul className="list-disc list-inside space-y-0.5">
                      {impact.bloqueiosAtivos.map((b) => (
                        <li key={b}>{b}</li>
                      ))}
                    </ul>
                    <div className="mt-2">
                      Você ainda pode <strong>desativar</strong> o item — ele continuará nos
                      registros existentes mas não poderá ser usado em novos cadastros.
                    </div>
                  </div>
                </div>
              </div>
            )}

            {temEstoque && (
              <div className="rounded-md border border-warning/40 bg-warning/10 p-3 text-xs">
                <div className="flex items-start gap-2 text-warning">
                  <Info className="h-4 w-4 shrink-0 mt-0.5" />
                  <div className="text-foreground/90">
                    Este item possui estoque{impact.estoqueFisico < 0 ? " negativo" : ""} de{" "}
                    <strong>{impact.estoqueFisico} unidade(s)</strong>.
                  </div>
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <Checkbox
                    id="zerar-estoque"
                    checked={zerarEstoque}
                    onCheckedChange={(v) => setZerarEstoque(!!v)}
                  />
                  <Label htmlFor="zerar-estoque" className="text-xs cursor-pointer">
                    {impact.estoqueFisico > 0
                      ? "Zerar estoque automaticamente antes de desativar (cria movimentação de ajuste)"
                      : "Corrigir estoque para zero antes de desativar (cria movimentação de ajuste positivo)"}
                  </Label>
                </div>
                {!zerarEstoque && (
                  <p className="mt-2 text-muted-foreground">
                    O saldo será mantido no histórico e voltará a aparecer se o item for reativado.
                  </p>
                )}
                {zerarEstoque && (
                  <div className="mt-3 space-y-2">
                    <label className="block text-xs font-medium">Centro de custo do ajuste</label>
                    <CostCenterSelect value={centroCustoId} onChange={setCentroCustoId} />
                    <p className="text-xs text-muted-foreground">Responsável pelo ajuste: <span className="text-foreground font-medium">{user.displayName}</span></p>
                  </div>
                )}
              </div>
            )}

            {!temBloqueios && !podeExcluirDef && impact.movimentacoes > 0 && (
              <div className="rounded-md border border-primary/30 bg-primary/5 p-3 text-xs">
                <div className="flex items-start gap-2">
                  <Info className="h-4 w-4 shrink-0 mt-0.5 text-primary" />
                  <div>
                    Este item já possui histórico. Recomendamos <strong>desativar</strong>{" "}
                    em vez de excluir definitivamente, para preservar o histórico de movimentações.
                  </div>
                </div>
              </div>
            )}

            {podeExcluirDef && (
              <div className="rounded-md border border-success/30 bg-success/10 p-3 text-xs">
                Este item nunca foi utilizado e pode ser excluído definitivamente sem afetar histórico.
              </div>
            )}
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-2">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={loading}
          >
            Cancelar
          </Button>
          <Button
            variant="secondary"
            onClick={handleDeactivate}
            disabled={loading || !impact || temBloqueios || (temEstoque && zerarEstoque && !centroCustoId)}
            title={
              temBloqueios
                ? "Resolva os vínculos ativos antes de desativar"
                : "Desativar item (preserva histórico)"
            }
          >
            <Archive className="h-4 w-4 mr-1.5" />
            {deactivate.isPending ? "Desativando..." : "Desativar item"}
          </Button>
          <Button
            variant="destructive"
            onClick={handleHardDelete}
            disabled={loading || !podeExcluirDef}
            title={
              podeExcluirDef
                ? "Excluir definitivamente do banco"
                : "Exclusão definitiva indisponível: o item já foi utilizado"
            }
          >
            <Trash2 className="h-4 w-4 mr-1.5" />
            {hardDelete.isPending ? "Excluindo..." : "Excluir definitivamente"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ImpactLine({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <li className="flex items-center justify-between gap-3">
      <span>{label}</span>
      <span
        className={
          highlight
            ? "font-semibold text-warning"
            : "font-medium text-foreground"
        }
      >
        {value}
      </span>
    </li>
  );
}
