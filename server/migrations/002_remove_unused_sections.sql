-- As telas de implantação, custos, indicadores e relatórios foram removidas.
-- Compras ainda mantém preços, frete e impostos para registrar o valor real dos itens.

CREATE OR REPLACE FUNCTION public.sync_production_status_timestamps()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.status = 'CONCLUIDA' AND NEW.concluida_em IS NULL THEN
    NEW.concluida_em := now();
  ELSIF NEW.status IN ('PLANEJADA', 'EM_PRODUCAO') THEN
    NEW.concluida_em := NULL;
  END IF;
  RETURN NEW;
END;
$$;

ALTER TABLE public.production_orders
  DROP COLUMN IF EXISTS implantada_em,
  DROP COLUMN IF EXISTS centro_custo_id,
  DROP COLUMN IF EXISTS centro_custo_implantacao_id,
  DROP COLUMN IF EXISTS custo_total_real,
  DROP COLUMN IF EXISTS due_date,
  DROP COLUMN IF EXISTS due_date_original,
  DROP COLUMN IF EXISTS due_date_updated_at,
  DROP COLUMN IF EXISTS due_date_change_count;

ALTER TABLE public.purchase_orders DROP COLUMN IF EXISTS centro_custo_id;
ALTER TABLE public.movements DROP COLUMN IF EXISTS centro_custo_id;

DROP TABLE IF EXISTS public.implantation_due_date_history;
DROP TABLE IF EXISTS public.production_order_costs;
DROP TABLE IF EXISTS public.centros_custo;
DROP TABLE IF EXISTS public.production_shipping_history;
DROP TABLE IF EXISTS public.production_failures;
