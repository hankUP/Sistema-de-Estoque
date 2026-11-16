-- Identifica exatamente as movimentações de cada conclusão de ordem BOM.
ALTER TABLE public.production_orders ADD COLUMN current_completion_id uuid;
ALTER TABLE public.movements
  ADD COLUMN production_order_id uuid REFERENCES public.production_orders(id) ON DELETE SET NULL,
  ADD COLUMN completion_id uuid;
CREATE INDEX movements_completion_id_idx ON public.movements (completion_id);
