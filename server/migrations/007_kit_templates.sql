-- Modelos reutilizáveis de kit, separados dos rascunhos e montagens concluídas.
CREATE TABLE public.kit_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome text NOT NULL CHECK (length(btrim(nome)) > 0),
  configuracao jsonb NOT NULL CHECK (jsonb_typeof(configuracao) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER kit_templates_updated_at
BEFORE UPDATE ON public.kit_templates
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
