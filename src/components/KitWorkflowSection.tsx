import { useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SectionCard } from '@/components/SectionCard';
import { kitAction, useKitPlans, useRefreshKitPlans, type KitPlan } from '@/hooks/useKitPlans';
import { useWorkQueueAvailability } from '@/hooks/useWorkQueueAvailability';
import { useAuth } from '@/auth';

const formatQuantity = (value: number) => new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 3 }).format(value);

export function KitWorkflowSection({ mode }: { mode: 'fila' | 'producao' }) {
  const user = useAuth();
  const { data: plans = [], isLoading } = useKitPlans();
  const { data: work = [], isLoading: workLoading } = useWorkQueueAvailability();
  const refresh = useRefreshKitPlans();
  const [busyId, setBusyId] = useState<string | null>(null);
  const visible = plans.filter(plan => plan.status === 'NA_FILA' || plan.status === 'EM_PRODUCAO')
    .sort((a, b) => (a.ordem ?? 0) - (b.ordem ?? 0));

  const act = async (name: string, args: Record<string, unknown>, success: string) => {
    try {
      setBusyId(String(args._id));
      await kitAction(name, args);
      await refresh();
      toast.success(success);
    } catch (error) { toast.error(error instanceof Error ? error.message : String(error)); }
    finally { setBusyId(null); }
  };
  const start = (plan: KitPlan) => {
    void act('start_kit_plan', { _id: plan.id }, 'Montagem do kit iniciada.');
  };
  const complete = (plan: KitPlan) => {
    if (!window.confirm(`Concluir ${plan.nome} e baixar seus materiais para ${plan.destino}?`)) return;
    void act('complete_kit_plan', { _id: plan.id }, 'Kit concluído. Materiais baixados do estoque.');
  };

  if (visible.length === 0) return null;

  return <SectionCard title={mode === 'fila' ? `Kits anteriores na fila (${visible.length})` : `Kits anteriores na produção (${visible.length})`}
    description={mode === 'fila'
      ? 'Kits configurados entram aqui antes da produção. A fila de kits é ordenada pela data de entrada.'
      : 'Inicie a montagem e conclua para registrar o consumo. O saldo é conferido novamente na conclusão.'}>
    {isLoading || workLoading ? <p className="text-sm text-muted-foreground">Carregando kits...</p> :
      <div className="space-y-3">{visible.map(plan => {
        const queueRow = work.find(row => row.kind === 'KIT' && row.id === plan.id);
        const materials = queueRow?.materials ?? [];
        const shortages = materials.filter(material => material.missing > 0);
        const cameras = plan.configuracao.courts.reduce((sum, court) => sum + court.cameras, 0);
        const buttons = plan.configuracao.courts.reduce((sum, court) => sum + court.botoes, 0);
        return <div key={plan.id} className="rounded-lg border border-border bg-card/40 p-4 space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div><h3 className="text-sm font-semibold">{queueRow && <span className="mr-2 text-primary">#{queueRow.position}</span>}{plan.nome} <span className="text-xs font-normal text-muted-foreground">· Kit anterior</span></h3>
              <p className="text-xs text-muted-foreground">{plan.destino} · {cameras} câmera(s) · {buttons} botão(ões) · {plan.configuracao.courts.length} local(is)</p>
            </div>
            <span className={`rounded-full px-2 py-1 text-xs font-medium ${plan.status === 'EM_PRODUCAO' ? 'bg-warning/15 text-warning' : 'bg-muted text-muted-foreground'}`}>
              {plan.status === 'EM_PRODUCAO' ? 'Em produção' : 'Na fila'}
            </span>
          </div>
          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <strong>Materiais ({materials.length})</strong>
              <span className={shortages.length ? 'font-medium text-destructive' : 'text-success'}>
                {shortages.length ? `${shortages.length} item(ns) em falta` : 'Todos os materiais disponíveis'}
              </span>
            </div>
            <div className="overflow-x-auto rounded-md border border-border">
              <table className="w-full min-w-[620px] text-xs">
                <thead className="bg-muted/50 text-muted-foreground"><tr>
                  <th scope="col" className="px-3 py-2 text-left font-medium">Material</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">Usará</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">Disponível agora</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">Restará</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">Falta</th>
                </tr></thead>
                <tbody>{materials.map(({ itemId, nome, unidade, needed, availableBefore, balanceAfter, missing }) => {
                  const unit = unidade;
                  return <tr key={itemId} className={`border-t border-border/50 ${missing > 0 ? 'bg-destructive/10' : ''}`}>
                    <td className="px-3 py-2 font-medium">{nome}</td>
                    <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">{formatQuantity(needed)} {unit}</td>
                    <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">{formatQuantity(Math.max(0, availableBefore))} {unit}</td>
                    <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">{formatQuantity(Math.max(0, balanceAfter))} {unit}</td>
                    <td className={`px-3 py-2 text-right tabular-nums whitespace-nowrap ${missing > 0 ? 'font-semibold text-destructive' : 'text-muted-foreground'}`}>{missing > 0 ? `${formatQuantity(missing)} ${unit}` : '—'}</td>
                  </tr>;
                })}</tbody>
              </table>
            </div>
            <p className="text-xs text-muted-foreground">Saldo projetado após as montagens anteriores da fila única. As reservas de ordens BOM já estão representadas na sequência.</p>
          </div>
          {shortages.length > 0 && <p className="text-xs font-medium text-destructive">Reponha os itens em falta antes de iniciar ou concluir a montagem.</p>}
          {mode === 'fila' ? <div className="flex gap-2"><Button size="sm" variant="outline" asChild><Link to="/producao">Abrir Produção</Link></Button></div>
            : <div className="flex flex-wrap items-end gap-2">
              {plan.status === 'NA_FILA' ? <><span className="text-xs text-muted-foreground">Responsável: <strong className="text-foreground">{user.displayName}</strong></span>
                <Button size="sm" disabled={busyId === plan.id || !queueRow || shortages.length > 0} onClick={() => start(plan)}>Iniciar montagem</Button></>
                : <><span className="text-xs text-muted-foreground">Montador: {plan.responsavel}</span>
                  <Button size="sm" disabled={busyId === plan.id || !queueRow || shortages.length > 0} onClick={() => complete(plan)}>Concluir e baixar estoque</Button>
                  <Button size="sm" variant="ghost" disabled={busyId === plan.id} onClick={() => void act('return_kit_to_queue', { _id: plan.id }, 'Kit devolvido à fila.')}>Voltar à fila</Button></>}
            </div>}
        </div>;
      })}</div>}
  </SectionCard>;
}
