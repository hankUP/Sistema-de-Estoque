-- Centros servem para atribuir movimentações a um setor ou a uma pessoa.
-- Registros são desativados, nunca apagados, para preservar o histórico.
CREATE TABLE public.centros_custo (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome text NOT NULL,
  tipo text NOT NULL CHECK (tipo IN ('SETOR', 'PESSOA')),
  descricao text,
  ativo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT centros_custo_nome_nao_vazio CHECK (length(btrim(nome)) > 0)
);

CREATE UNIQUE INDEX centros_custo_tipo_nome_unique ON public.centros_custo (tipo, lower(btrim(nome)));
CREATE TRIGGER update_centros_custo_updated_at
  BEFORE UPDATE ON public.centros_custo
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.movements
  ADD COLUMN centro_custo_id uuid REFERENCES public.centros_custo(id) ON DELETE RESTRICT;
ALTER TABLE public.purchase_orders
  ADD COLUMN centro_custo_id uuid REFERENCES public.centros_custo(id) ON DELETE RESTRICT;
ALTER TABLE public.production_orders
  ADD COLUMN centro_custo_id uuid REFERENCES public.centros_custo(id) ON DELETE RESTRICT;

-- Migra históricos que não tinham atribuição sem inventar uma pessoa responsável.
DO $$
DECLARE legacy_id uuid;
BEGIN
  IF EXISTS (SELECT 1 FROM public.movements WHERE centro_custo_id IS NULL) THEN
    INSERT INTO public.centros_custo (nome, tipo, descricao, ativo)
    VALUES ('Sem atribuição (histórico)', 'SETOR', 'Movimentações anteriores ao cadastro de centros de custo', false)
    RETURNING id INTO legacy_id;
    UPDATE public.movements SET centro_custo_id = legacy_id WHERE centro_custo_id IS NULL;
    UPDATE public.movements SET usuario_nome = 'Não informado (histórico)'
      WHERE usuario_nome IS NULL OR btrim(usuario_nome) = '';
  END IF;
END;
$$;

ALTER TABLE public.movements
  ALTER COLUMN centro_custo_id SET NOT NULL,
  ALTER COLUMN usuario_nome SET NOT NULL,
  ADD CONSTRAINT movements_responsavel_nao_vazio CHECK (length(btrim(usuario_nome)) > 0);

CREATE OR REPLACE FUNCTION public.validate_active_cost_center()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.centro_custo_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.centro_custo_id IS DISTINCT FROM OLD.centro_custo_id)
     AND NOT EXISTS (SELECT 1 FROM public.centros_custo WHERE id = NEW.centro_custo_id AND ativo) THEN
    RAISE EXCEPTION 'Selecione um centro de custo ativo.';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER validate_purchase_orders_cost_center BEFORE INSERT OR UPDATE ON public.purchase_orders
  FOR EACH ROW EXECUTE FUNCTION public.validate_active_cost_center();
CREATE TRIGGER validate_production_orders_cost_center BEFORE INSERT OR UPDATE ON public.production_orders
  FOR EACH ROW EXECUTE FUNCTION public.validate_active_cost_center();

CREATE INDEX idx_movements_centro_custo ON public.movements(centro_custo_id);
CREATE INDEX idx_purchase_orders_centro_custo ON public.purchase_orders(centro_custo_id);
CREATE INDEX idx_production_orders_centro_custo ON public.production_orders(centro_custo_id);
