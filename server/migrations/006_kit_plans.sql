-- Configurações de kits. Salvar um plano não reserva nem movimenta estoque.
CREATE TABLE public.kit_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome text NOT NULL CHECK (length(btrim(nome)) > 0),
  configuracao jsonb NOT NULL CHECK (jsonb_typeof(configuracao) = 'object'),
  destino text,
  centro_custo_id uuid REFERENCES public.centros_custo(id),
  responsavel text,
  status text NOT NULL DEFAULT 'RASCUNHO' CHECK (status IN ('RASCUNHO', 'CONCLUIDO')),
  concluido_em timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER kit_plans_updated_at
BEFORE UPDATE ON public.kit_plans
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
