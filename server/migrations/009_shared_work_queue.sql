-- Kits e ordens de produção compartilham uma única prioridade.
ALTER TABLE public.kit_plans ADD COLUMN ordem integer;

CREATE TEMP TABLE work_queue_backfill AS
SELECT kind, id, row_number() OVER (ORDER BY entered_at, kind, id)::integer AS nova_ordem
FROM (
  SELECT 'OP' AS kind, id, queue_created_at AS entered_at
  FROM public.production_orders WHERE status IN ('PLANEJADA', 'EM_PRODUCAO')
  UNION ALL
  SELECT 'KIT' AS kind, id, COALESCE(enfileirado_em, created_at) AS entered_at
  FROM public.kit_plans WHERE status IN ('NA_FILA', 'EM_PRODUCAO')
) active;

UPDATE public.production_orders po SET ordem = b.nova_ordem
FROM work_queue_backfill b WHERE b.kind = 'OP' AND b.id = po.id;
UPDATE public.kit_plans k SET ordem = b.nova_ordem
FROM work_queue_backfill b WHERE b.kind = 'KIT' AND b.id = k.id;
DROP TABLE work_queue_backfill;

CREATE SEQUENCE public.work_queue_order_seq;
SELECT setval('public.work_queue_order_seq', GREATEST(1,
  (SELECT COALESCE(MAX(ordem), 0) FROM public.production_orders),
  (SELECT COALESCE(MAX(ordem), 0) FROM public.kit_plans)), true);

CREATE OR REPLACE FUNCTION public.assign_production_queue_order()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.status IN ('PLANEJADA', 'EM_PRODUCAO') AND
     (TG_OP = 'INSERT' OR OLD.status NOT IN ('PLANEJADA', 'EM_PRODUCAO')) THEN
    NEW.ordem := nextval('public.work_queue_order_seq');
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER assign_production_queue_order_trg
BEFORE INSERT OR UPDATE OF status ON public.production_orders
FOR EACH ROW EXECUTE FUNCTION public.assign_production_queue_order();

CREATE INDEX kit_plans_ordem_idx ON public.kit_plans (ordem);

-- A demanda do kit é reservada como a demanda de uma OP com BOM.
CREATE OR REPLACE FUNCTION public.manage_kit_reservations()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  kit_id uuid;
  kit_status text;
  kit_config jsonb;
BEGIN
  kit_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.id ELSE NEW.id END;
  DELETE FROM public.reservations WHERE referencia = 'KIT:' || kit_id::text;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  kit_status := NEW.status;
  kit_config := NEW.configuracao;
  IF kit_status IN ('NA_FILA', 'EM_PRODUCAO') THEN
    INSERT INTO public.reservations (item_id, quantidade, referencia)
    SELECT (component ->> 'item_id')::uuid, SUM((component ->> 'quantidade')::numeric), 'KIT:' || kit_id::text
    FROM jsonb_array_elements(kit_config -> 'componentes') component
    GROUP BY (component ->> 'item_id')::uuid;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER manage_kit_reservations_trg
AFTER INSERT OR UPDATE OR DELETE ON public.kit_plans
FOR EACH ROW EXECUTE FUNCTION public.manage_kit_reservations();

INSERT INTO public.reservations (item_id, quantidade, referencia)
SELECT (component ->> 'item_id')::uuid, SUM((component ->> 'quantidade')::numeric), 'KIT:' || k.id::text
FROM public.kit_plans k CROSS JOIN LATERAL jsonb_array_elements(k.configuracao -> 'componentes') component
WHERE k.status IN ('NA_FILA', 'EM_PRODUCAO')
GROUP BY k.id, (component ->> 'item_id')::uuid;

-- Uma BOM usada na fila não pode mudar a demanda de uma ordem já planejada.
CREATE OR REPLACE FUNCTION public.protect_active_order_bom()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.production_order_items poi
    JOIN public.production_orders po ON po.id = poi.production_order_id
    WHERE po.status IN ('PLANEJADA', 'EM_PRODUCAO')
      AND poi.item_id IN (CASE WHEN TG_OP = 'INSERT' THEN NEW.item_pai_id ELSE OLD.item_pai_id END,
                          CASE WHEN TG_OP = 'DELETE' THEN OLD.item_pai_id ELSE NEW.item_pai_id END)
  ) THEN
    RAISE EXCEPTION 'Esta estrutura BOM está em uso por uma montagem na fila. Conclua ou remova a ordem antes de editá-la.';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE TRIGGER protect_active_order_bom_trg
BEFORE INSERT OR UPDATE OR DELETE ON public.bom_items
FOR EACH ROW EXECUTE FUNCTION public.protect_active_order_bom();
