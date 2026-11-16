-- Uma submontagem é um componente intermediário: sua produção entra no estoque.
-- Históricos antigos não são reescritos; a regra vale para novas ordens e alterações de destino/produto.
CREATE OR REPLACE FUNCTION public.validate_production_order_sub_destination()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF NEW.destino = 'CLIENTE' AND (
    EXISTS (SELECT 1 FROM public.items WHERE id = NEW.item_id AND tipo = 'SUB')
    OR (TG_OP = 'UPDATE' AND EXISTS (
      SELECT 1 FROM public.production_order_items poi
      JOIN public.items i ON i.id = poi.item_id
      WHERE poi.production_order_id = NEW.id AND i.tipo = 'SUB'
    ))
  ) THEN
    RAISE EXCEPTION 'Submontagens devem ter destino Estoque intermediário.';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER validate_production_order_sub_destination_trg
BEFORE INSERT OR UPDATE OF item_id, destino ON public.production_orders
FOR EACH ROW EXECUTE FUNCTION public.validate_production_order_sub_destination();

CREATE OR REPLACE FUNCTION public.validate_production_order_item_sub_destination()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.production_orders po
    JOIN public.items i ON i.id = NEW.item_id
    WHERE po.id = NEW.production_order_id AND po.destino = 'CLIENTE' AND i.tipo = 'SUB'
  ) THEN
    RAISE EXCEPTION 'Submontagens devem ter destino Estoque intermediário.';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER validate_production_order_item_sub_destination_trg
BEFORE INSERT OR UPDATE OF item_id, production_order_id ON public.production_order_items
FOR EACH ROW EXECUTE FUNCTION public.validate_production_order_item_sub_destination();

CREATE OR REPLACE FUNCTION public.validate_item_type_sub_destination()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF NEW.tipo = 'SUB' AND OLD.tipo IS DISTINCT FROM NEW.tipo AND EXISTS (
    SELECT 1 FROM public.production_orders po
    WHERE po.destino = 'CLIENTE' AND (
      po.item_id = NEW.id OR EXISTS (
        SELECT 1 FROM public.production_order_items poi
        WHERE poi.production_order_id = po.id AND poi.item_id = NEW.id
      )
    )
  ) THEN
    RAISE EXCEPTION 'Este produto possui ordem para Cliente e não pode ser alterado para Submontagem.';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER validate_item_type_sub_destination_trg
BEFORE UPDATE OF tipo ON public.items
FOR EACH ROW EXECUTE FUNCTION public.validate_item_type_sub_destination();
