import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { useCreateProductionOrder } from '@/hooks/useProductionOrders';
import { FormDialog } from '@/components/FormDialog';
import { FieldLabel } from '@/components/FieldLabel';
import { CostCenterSelect } from '@/components/CostCenterSelect';
import { Input } from '@/components/ui/input';

type Product = {
  id: string;
  nome: string;
  tipo: string;
  modo_producao_padrao?: string | null;
};

export function BomOrderDialog({ open, onOpenChange, product }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  product: Product | null;
}) {
  const navigate = useNavigate();
  const createOrder = useCreateProductionOrder();
  const [quantity, setQuantity] = useState('1');
  const [destination, setDestination] = useState<'CLIENTE' | 'ESTOQUE'>('CLIENTE');
  const [customer, setCustomer] = useState('');
  const [costCenterId, setCostCenterId] = useState('');

  useEffect(() => {
    if (!open) return;
    setQuantity('1');
    setDestination(product?.tipo === 'SUB' || product?.modo_producao_padrao === 'ESTOQUE' ? 'ESTOQUE' : 'CLIENTE');
    setCustomer('');
    setCostCenterId('');
  }, [open, product?.id, product?.tipo, product?.modo_producao_padrao]);

  const submit = async () => {
    if (!product) return;
    const finalDestination = product.tipo === 'SUB' ? 'ESTOQUE' : destination;
    const amount = Number(quantity);
    if (!Number.isInteger(amount) || amount < 1) {
      toast.error('Informe uma quantidade inteira maior que zero.'); return;
    }
    if (finalDestination === 'CLIENTE' && !customer.trim()) {
      toast.error('Informe o cliente.'); return;
    }
    if (!costCenterId) {
      toast.error('Selecione o centro de custo.'); return;
    }
    try {
      await createOrder.mutateAsync({
        item_id: product.id,
        quantidade: amount,
        destino: finalDestination,
        cliente: finalDestination === 'CLIENTE' ? customer.trim() : null,
        centro_custo_id: costCenterId,
      });
      toast.success('Produto enviado à fila de montagem.');
      onOpenChange(false);
      navigate('/pedidos');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  };

  return <FormDialog
    open={open}
    onOpenChange={onOpenChange}
    title="Enviar produto à fila"
    description={product ? `Estrutura selecionada: ${product.nome}` : undefined}
    size="md"
    submitLabel="Enviar à fila"
    onSubmit={submit}
    loading={createOrder.isPending}
    submitDisabled={!product}
  >
    <div className="space-y-4">
      <div>
        <FieldLabel label="Quantidade de produtos" required />
        <Input type="number" min="1" step="1" value={quantity} onChange={event => setQuantity(event.target.value)} />
      </div>
      {product?.tipo === 'SUB' ? <div>
        <FieldLabel label="Destino" />
        <p className="rounded-md border border-border bg-muted/30 px-3 py-2 text-sm">Estoque intermediário — esta submontagem poderá ser usada em outro produto.</p>
      </div> : <div>
        <FieldLabel label="Destino" required />
        <select className="bg-input border border-border rounded-md px-3 h-10 text-sm text-foreground w-full" value={destination} onChange={event => setDestination(event.target.value as 'CLIENTE' | 'ESTOQUE')}>
          <option value="CLIENTE">Cliente</option>
          <option value="ESTOQUE">Estoque</option>
        </select>
      </div>}
      {product?.tipo !== 'SUB' && destination === 'CLIENTE' && <div>
        <FieldLabel label="Cliente" required />
        <Input value={customer} onChange={event => setCustomer(event.target.value)} maxLength={160} placeholder="Nome do cliente" />
      </div>}
      <div>
        <FieldLabel label="Centro de custo" required />
        <CostCenterSelect value={costCenterId} onChange={setCostCenterId} />
      </div>
    </div>
  </FormDialog>;
}
