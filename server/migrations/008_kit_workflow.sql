-- Kits configuráveis passam por fila e produção antes do consumo.
ALTER TABLE public.kit_plans DROP CONSTRAINT kit_plans_status_check;
ALTER TABLE public.kit_plans ADD CONSTRAINT kit_plans_status_check
  CHECK (status IN ('RASCUNHO', 'NA_FILA', 'EM_PRODUCAO', 'CONCLUIDO'));
ALTER TABLE public.kit_plans
  ADD COLUMN enfileirado_em timestamptz,
  ADD COLUMN iniciado_em timestamptz;

CREATE INDEX kit_plans_queue_idx ON public.kit_plans (status, enfileirado_em);
