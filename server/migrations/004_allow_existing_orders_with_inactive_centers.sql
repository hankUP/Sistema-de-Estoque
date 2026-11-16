-- Uma ordem existente pode gerar movimentos depois da desativação do centro.
-- O centro segue vinculado ao histórico; novos pedidos continuam exigindo centro ativo.
DROP TRIGGER IF EXISTS validate_movements_cost_center ON public.movements;
