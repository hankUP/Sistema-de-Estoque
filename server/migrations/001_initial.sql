-- Esquema inicial para instalações novas.
-- O acesso ao banco é exclusivo da API; políticas RLS permissivas do projeto antigo foram removidas.

-- 20260404062927_e0bf1420-2da9-436a-ab8c-53286b2a2d7e.sql
-- Create enum types
CREATE TYPE public.item_type AS ENUM ('MP', 'SUB', 'PF');
CREATE TYPE public.movement_type AS ENUM ('INICIAL', 'COMPRA', 'CONSUMO', 'PRODUCAO', 'SAIDA', 'AJUSTE');
CREATE TYPE public.purchase_status AS ENUM ('ABERTO', 'PARCIAL', 'RECEBIDO');
CREATE TYPE public.production_status AS ENUM ('PLANEJADA', 'EM_PRODUCAO', 'CONCLUIDA');

-- Items table
CREATE TABLE public.items (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  nome TEXT NOT NULL,
  tipo public.item_type NOT NULL DEFAULT 'MP',
  unidade TEXT NOT NULL DEFAULT 'un',
  estoque_minimo NUMERIC NOT NULL DEFAULT 0,
  ativo BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- BOM (Bill of Materials)
CREATE TABLE public.bom_items (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  item_pai_id UUID NOT NULL REFERENCES public.items(id) ON DELETE CASCADE,
  item_componente_id UUID NOT NULL REFERENCES public.items(id) ON DELETE CASCADE,
  quantidade NUMERIC NOT NULL DEFAULT 1,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(item_pai_id, item_componente_id)
);

-- Movements
CREATE TABLE public.movements (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  data TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  item_id UUID NOT NULL REFERENCES public.items(id) ON DELETE CASCADE,
  tipo_movimentacao public.movement_type NOT NULL,
  quantidade NUMERIC NOT NULL,
  referencia TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Purchase Orders
CREATE TABLE public.purchase_orders (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  item_id UUID NOT NULL REFERENCES public.items(id) ON DELETE CASCADE,
  quantidade NUMERIC NOT NULL,
  status public.purchase_status NOT NULL DEFAULT 'ABERTO',
  data_prevista DATE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Production Orders
CREATE TABLE public.production_orders (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  item_id UUID NOT NULL REFERENCES public.items(id) ON DELETE CASCADE,
  quantidade NUMERIC NOT NULL,
  status public.production_status NOT NULL DEFAULT 'PLANEJADA',
  data TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Reservations
CREATE TABLE public.reservations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  item_id UUID NOT NULL REFERENCES public.items(id) ON DELETE CASCADE,
  quantidade NUMERIC NOT NULL,
  referencia TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS on all tables







-- Public access policies (internal system, no auth required for now)







-- Indexes for performance
CREATE INDEX idx_movements_item_id ON public.movements(item_id);
CREATE INDEX idx_movements_data ON public.movements(data);
CREATE INDEX idx_movements_tipo ON public.movements(tipo_movimentacao);
CREATE INDEX idx_bom_item_pai ON public.bom_items(item_pai_id);
CREATE INDEX idx_bom_item_componente ON public.bom_items(item_componente_id);
CREATE INDEX idx_purchase_orders_status ON public.purchase_orders(status);
CREATE INDEX idx_production_orders_status ON public.production_orders(status);
CREATE INDEX idx_reservations_item_id ON public.reservations(item_id);

-- Updated_at trigger function
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- Triggers for updated_at
CREATE TRIGGER update_items_updated_at BEFORE UPDATE ON public.items FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_purchase_orders_updated_at BEFORE UPDATE ON public.purchase_orders FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_production_orders_updated_at BEFORE UPDATE ON public.production_orders FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 20260404064355_13d8469f-a7bd-43dd-a496-798b868c3cba.sql
-- Create fornecedores (suppliers) table
CREATE TABLE public.fornecedores (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  nome TEXT NOT NULL,
  telefone TEXT,
  email TEXT,
  whatsapp TEXT,
  observacoes TEXT,
  ativo BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- RLS



-- Trigger for updated_at
CREATE TRIGGER update_fornecedores_updated_at BEFORE UPDATE ON public.fornecedores
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Add new columns to items
ALTER TABLE public.items ADD COLUMN estoque_ideal NUMERIC NOT NULL DEFAULT 0;
ALTER TABLE public.items ADD COLUMN estoque_maximo NUMERIC NOT NULL DEFAULT 0;
ALTER TABLE public.items ADD COLUMN lead_time_dias INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.items ADD COLUMN fornecedor_id UUID REFERENCES public.fornecedores(id);

-- 20260406154703_d989478a-c068-4fd6-9b7a-85a25605100d.sql
ALTER TABLE public.production_orders ADD COLUMN IF NOT EXISTS ordem integer NOT NULL DEFAULT 0;

-- 20260408035652_78ab06f2-3199-43b1-a707-c3e7826b9119.sql
CREATE TABLE public.item_fornecedores (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  item_id UUID NOT NULL REFERENCES public.items(id) ON DELETE CASCADE,
  fornecedor_id UUID NOT NULL REFERENCES public.fornecedores(id) ON DELETE CASCADE,
  principal BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(item_id, fornecedor_id)
);





-- Migrate existing fornecedor_id data from items to the junction table
INSERT INTO public.item_fornecedores (item_id, fornecedor_id, principal)
SELECT id, fornecedor_id, true
FROM public.items
WHERE fornecedor_id IS NOT NULL;

-- 20260408035956_f3279ef0-12eb-4fc0-90e7-9d0745c2326a.sql
ALTER TABLE public.fornecedores ADD COLUMN avaliacao integer DEFAULT NULL;

CREATE OR REPLACE FUNCTION public.validate_fornecedor_avaliacao()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.avaliacao IS NOT NULL AND (NEW.avaliacao < 1 OR NEW.avaliacao > 5) THEN
    RAISE EXCEPTION 'avaliacao must be between 1 and 5';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER validate_fornecedor_avaliacao_trigger
BEFORE INSERT OR UPDATE ON public.fornecedores
FOR EACH ROW
EXECUTE FUNCTION public.validate_fornecedor_avaliacao();

-- 20260408040654_f8f42c2d-ed52-4967-8409-82b5fdf1d803.sql
ALTER TABLE public.items ADD COLUMN consumo_diario numeric NOT NULL DEFAULT 0;

-- 20260408042820_a84a730b-4ffa-4585-bffa-e01a9748d70e.sql
ALTER TABLE public.bom_items
  DROP CONSTRAINT IF EXISTS bom_items_item_pai_id_fkey,
  DROP CONSTRAINT IF EXISTS bom_items_item_componente_id_fkey,
  ADD CONSTRAINT bom_items_item_pai_id_fkey FOREIGN KEY (item_pai_id) REFERENCES public.items(id) ON DELETE CASCADE,
  ADD CONSTRAINT bom_items_item_componente_id_fkey FOREIGN KEY (item_componente_id) REFERENCES public.items(id) ON DELETE CASCADE;

-- 20260408045354_8586c1d9-efc2-40cf-ad8c-2a68d353f84a.sql
CREATE OR REPLACE FUNCTION public.manage_production_reservations()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
BEGIN
  -- On DELETE or status changing away from PLANEJADA/EM_PRODUCAO: remove reservations
  IF TG_OP = 'DELETE' THEN
    DELETE FROM public.reservations WHERE referencia = 'OP:' || OLD.id::text;
    RETURN OLD;
  END IF;

  -- On UPDATE: if status changed away from PLANEJADA/EM_PRODUCAO, remove reservations
  IF TG_OP = 'UPDATE' AND OLD.status IN ('PLANEJADA', 'EM_PRODUCAO') AND NEW.status NOT IN ('PLANEJADA', 'EM_PRODUCAO') THEN
    DELETE FROM public.reservations WHERE referencia = 'OP:' || NEW.id::text;
    RETURN NEW;
  END IF;

  -- On UPDATE: if status changed TO PLANEJADA/EM_PRODUCAO (from something else), or quantity/item changed, recreate
  IF TG_OP = 'UPDATE' THEN
    IF NEW.status IN ('PLANEJADA', 'EM_PRODUCAO') THEN
      DELETE FROM public.reservations WHERE referencia = 'OP:' || NEW.id::text;
      INSERT INTO public.reservations (item_id, quantidade, referencia)
      SELECT bi.item_componente_id, bi.quantidade * NEW.quantidade, 'OP:' || NEW.id::text
      FROM public.bom_items bi
      WHERE bi.item_pai_id = NEW.item_id;
    END IF;
    RETURN NEW;
  END IF;

  -- On INSERT with PLANEJADA or EM_PRODUCAO: create reservations
  IF TG_OP = 'INSERT' AND NEW.status IN ('PLANEJADA', 'EM_PRODUCAO') THEN
    INSERT INTO public.reservations (item_id, quantidade, referencia)
    SELECT bi.item_componente_id, bi.quantidade * NEW.quantidade, 'OP:' || NEW.id::text
    FROM public.bom_items bi
    WHERE bi.item_pai_id = NEW.item_id;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_production_reservations
AFTER INSERT OR UPDATE OR DELETE ON public.production_orders
FOR EACH ROW EXECUTE FUNCTION public.manage_production_reservations();

-- 20260408051226_1fd450bd-70ea-4d5c-bf49-aa69ba3cced5.sql
-- Attach trigger for production order reservations
CREATE TRIGGER trg_manage_production_reservations
  AFTER INSERT OR UPDATE OR DELETE ON public.production_orders
  FOR EACH ROW
  EXECUTE FUNCTION public.manage_production_reservations();

-- Attach trigger for updated_at on items
CREATE TRIGGER trg_items_updated_at
  BEFORE UPDATE ON public.items
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Attach trigger for updated_at on fornecedores
CREATE TRIGGER trg_fornecedores_updated_at
  BEFORE UPDATE ON public.fornecedores
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Attach trigger for updated_at on purchase_orders
CREATE TRIGGER trg_purchase_orders_updated_at
  BEFORE UPDATE ON public.purchase_orders
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Attach trigger for updated_at on production_orders
CREATE TRIGGER trg_production_orders_updated_at
  BEFORE UPDATE ON public.production_orders
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Attach trigger for fornecedor avaliacao validation
CREATE TRIGGER trg_validate_fornecedor_avaliacao
  BEFORE INSERT OR UPDATE ON public.fornecedores
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_fornecedor_avaliacao();

-- 20260416053332_0c3a5e4e-dc42-4dd9-a4c3-37cecd653a37.sql
ALTER TABLE public.items ADD COLUMN custo_unitario numeric NOT NULL DEFAULT 0;

-- 20260417044202_94aa1ff4-e4fd-4175-aa9c-91bb5629a993.sql
-- Add new statuses to production_status enum for implantação flow
ALTER TYPE public.production_status ADD VALUE IF NOT EXISTS 'A_IMPLANTAR';
ALTER TYPE public.production_status ADD VALUE IF NOT EXISTS 'IMPLANTADA';

-- 20260417044927_3caad2ad-2e0e-4faa-8518-a842ed3f919b.sql
-- Add new columns
ALTER TABLE public.production_orders
  ADD COLUMN IF NOT EXISTS cliente text,
  ADD COLUMN IF NOT EXISTS concluida_em timestamptz,
  ADD COLUMN IF NOT EXISTS implantada_em timestamptz;

-- Trigger function to maintain timestamps automatically based on status changes
CREATE OR REPLACE FUNCTION public.sync_production_status_timestamps()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  -- Entering A_IMPLANTAR (or any post-production state) sets concluida_em if not set
  IF NEW.status IN ('A_IMPLANTAR', 'IMPLANTADA', 'CONCLUIDA') AND NEW.concluida_em IS NULL THEN
    NEW.concluida_em := now();
  END IF;

  -- Reverting to PLANEJADA or EM_PRODUCAO clears the completion timestamp
  IF NEW.status IN ('PLANEJADA', 'EM_PRODUCAO') THEN
    NEW.concluida_em := NULL;
    NEW.implantada_em := NULL;
  END IF;

  -- Entering IMPLANTADA sets implantada_em if not set
  IF NEW.status = 'IMPLANTADA' AND NEW.implantada_em IS NULL THEN
    NEW.implantada_em := now();
  END IF;

  -- Reverting from IMPLANTADA back to A_IMPLANTAR clears implantada_em
  IF NEW.status = 'A_IMPLANTAR' THEN
    NEW.implantada_em := NULL;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sync_production_status_timestamps_trg ON public.production_orders;
CREATE TRIGGER sync_production_status_timestamps_trg
BEFORE INSERT OR UPDATE ON public.production_orders
FOR EACH ROW
EXECUTE FUNCTION public.sync_production_status_timestamps();

-- 20260417045518_206a1398-1392-4391-8dc6-ba88f5a23c7b.sql
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'production_destino') THEN
    CREATE TYPE public.production_destino AS ENUM ('ESTOQUE', 'CLIENTE');
  END IF;
END $$;

ALTER TABLE public.production_orders
  ADD COLUMN IF NOT EXISTS destino public.production_destino NOT NULL DEFAULT 'ESTOQUE';

-- 20260421163220_6c3208ac-0a08-4be4-b8b2-9ee9e17be2be.sql
-- Remove triggers duplicados em production_orders
DROP TRIGGER IF EXISTS trg_production_reservations ON public.production_orders;
DROP TRIGGER IF EXISTS update_production_orders_updated_at ON public.production_orders;

-- Limpa reservas duplicadas: mantém apenas uma linha por (referencia, item_id, quantidade)
DELETE FROM public.reservations r
USING public.reservations r2
WHERE r.ctid < r2.ctid
  AND r.referencia = r2.referencia
  AND r.item_id = r2.item_id
  AND r.quantidade = r2.quantidade
  AND r.referencia LIKE 'OP:%';

-- 20260421213952_98b76c32-fc85-46b2-855c-5c2b18504b4e.sql
-- Adiciona campos opcionais para nova lógica de reposição (totalmente retrocompatíveis)
-- politica_reposicao: NULL = comportamento atual; 'estoque_minimo' ou 'cobertura' = nova lógica
ALTER TABLE public.items
  ADD COLUMN IF NOT EXISTS politica_reposicao text NULL,
  ADD COLUMN IF NOT EXISTS cobertura_desejada numeric NULL,
  ADD COLUMN IF NOT EXISTS consumo_diario_calculado numeric NULL;

-- Validação leve via trigger (CHECK seria muito rígido p/ retrocompat)
CREATE OR REPLACE FUNCTION public.validate_items_politica_reposicao()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.politica_reposicao IS NOT NULL
     AND NEW.politica_reposicao NOT IN ('estoque_minimo', 'cobertura') THEN
    RAISE EXCEPTION 'politica_reposicao deve ser NULL, ''estoque_minimo'' ou ''cobertura''';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_items_politica_reposicao ON public.items;
CREATE TRIGGER trg_validate_items_politica_reposicao
BEFORE INSERT OR UPDATE ON public.items
FOR EACH ROW
EXECUTE FUNCTION public.validate_items_politica_reposicao();

-- 20260422004650_6f6f5b77-6a8e-45c6-9e29-7f1bd488c617.sql
-- 1) Ampliar item_fornecedores com campos comerciais
ALTER TABLE public.item_fornecedores
  ADD COLUMN IF NOT EXISTS preco_unitario numeric,
  ADD COLUMN IF NOT EXISTS lead_time_dias integer,
  ADD COLUMN IF NOT EXISTS quantidade_minima_compra numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS multiplo_compra numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ativo boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS observacoes text,
  ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone NOT NULL DEFAULT now();

-- Validações de domínio
ALTER TABLE public.item_fornecedores
  DROP CONSTRAINT IF EXISTS item_fornecedores_preco_nonneg_chk,
  DROP CONSTRAINT IF EXISTS item_fornecedores_qmin_nonneg_chk,
  DROP CONSTRAINT IF EXISTS item_fornecedores_mult_nonneg_chk,
  DROP CONSTRAINT IF EXISTS item_fornecedores_lead_nonneg_chk;

ALTER TABLE public.item_fornecedores
  ADD CONSTRAINT item_fornecedores_preco_nonneg_chk CHECK (preco_unitario IS NULL OR preco_unitario >= 0),
  ADD CONSTRAINT item_fornecedores_qmin_nonneg_chk CHECK (quantidade_minima_compra >= 0),
  ADD CONSTRAINT item_fornecedores_mult_nonneg_chk CHECK (multiplo_compra >= 0),
  ADD CONSTRAINT item_fornecedores_lead_nonneg_chk CHECK (lead_time_dias IS NULL OR lead_time_dias >= 0);

-- Não permitir duplicatas (item, fornecedor)
CREATE UNIQUE INDEX IF NOT EXISTS item_fornecedores_item_fornecedor_uniq
  ON public.item_fornecedores (item_id, fornecedor_id);

-- Apenas um fornecedor principal por item
CREATE UNIQUE INDEX IF NOT EXISTS item_fornecedores_principal_uniq
  ON public.item_fornecedores (item_id) WHERE principal = true;

-- Trigger updated_at
DROP TRIGGER IF EXISTS trg_item_fornecedores_updated_at ON public.item_fornecedores;
CREATE TRIGGER trg_item_fornecedores_updated_at
  BEFORE UPDATE ON public.item_fornecedores
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Backfill: copiar custo/lead time do item nos vínculos existentes que estão sem valores
UPDATE public.item_fornecedores ifn
SET
  preco_unitario = COALESCE(ifn.preco_unitario, i.custo_unitario),
  lead_time_dias = COALESCE(ifn.lead_time_dias, i.lead_time_dias)
FROM public.items i
WHERE ifn.item_id = i.id;

-- 2) purchase_orders: fornecedor obrigatório + snapshot de preço
ALTER TABLE public.purchase_orders
  ADD COLUMN IF NOT EXISTS fornecedor_id uuid,
  ADD COLUMN IF NOT EXISTS preco_unitario numeric;

-- Backfill fornecedor: prioridade fornecedor principal do item, senão qualquer vínculo, senão items.fornecedor_id
UPDATE public.purchase_orders po
SET fornecedor_id = sub.fornecedor_id
FROM (
  SELECT DISTINCT ON (po2.id)
    po2.id AS po_id,
    COALESCE(
      (SELECT ifn.fornecedor_id FROM public.item_fornecedores ifn
        WHERE ifn.item_id = po2.item_id AND ifn.principal = true LIMIT 1),
      (SELECT ifn.fornecedor_id FROM public.item_fornecedores ifn
        WHERE ifn.item_id = po2.item_id ORDER BY ifn.created_at LIMIT 1),
      i.fornecedor_id
    ) AS fornecedor_id
  FROM public.purchase_orders po2
  LEFT JOIN public.items i ON i.id = po2.item_id
) sub
WHERE po.id = sub.po_id AND po.fornecedor_id IS NULL;

-- Backfill preço: vínculo do fornecedor escolhido, senão custo de referência do item
UPDATE public.purchase_orders po
SET preco_unitario = COALESCE(
  (SELECT ifn.preco_unitario FROM public.item_fornecedores ifn
    WHERE ifn.item_id = po.item_id AND ifn.fornecedor_id = po.fornecedor_id LIMIT 1),
  (SELECT i.custo_unitario FROM public.items i WHERE i.id = po.item_id),
  0
)
WHERE po.preco_unitario IS NULL;

-- Tornar fornecedor_id obrigatório (apenas se todos os pedidos puderem ser preenchidos)
DO $$
DECLARE missing_count int;
BEGIN
  SELECT count(*) INTO missing_count FROM public.purchase_orders WHERE fornecedor_id IS NULL;
  IF missing_count = 0 THEN
    EXECUTE 'ALTER TABLE public.purchase_orders ALTER COLUMN fornecedor_id SET NOT NULL';
  END IF;
END $$;

-- FK e validações
ALTER TABLE public.purchase_orders
  DROP CONSTRAINT IF EXISTS purchase_orders_fornecedor_fkey;
ALTER TABLE public.purchase_orders
  ADD CONSTRAINT purchase_orders_fornecedor_fkey
    FOREIGN KEY (fornecedor_id) REFERENCES public.fornecedores(id) ON DELETE RESTRICT;

ALTER TABLE public.purchase_orders
  DROP CONSTRAINT IF EXISTS purchase_orders_preco_nonneg_chk;
ALTER TABLE public.purchase_orders
  ADD CONSTRAINT purchase_orders_preco_nonneg_chk CHECK (preco_unitario IS NULL OR preco_unitario >= 0);

CREATE INDEX IF NOT EXISTS purchase_orders_fornecedor_idx ON public.purchase_orders(fornecedor_id);
CREATE INDEX IF NOT EXISTS item_fornecedores_fornecedor_idx ON public.item_fornecedores(fornecedor_id);

-- 20260422005931_bbb17f32-c5e3-45b5-aa5c-bbc5395914c4.sql
-- 1. Adicionar custo_medio em items (inicializa com custo_unitario para compatibilidade)
ALTER TABLE public.items
  ADD COLUMN IF NOT EXISTS custo_medio numeric NOT NULL DEFAULT 0;

UPDATE public.items SET custo_medio = custo_unitario WHERE custo_medio = 0 AND custo_unitario > 0;

-- 2. Adicionar preco_unitario em movements (nullable) para snapshot da entrada
ALTER TABLE public.movements
  ADD COLUMN IF NOT EXISTS preco_unitario numeric;

-- 3. Função que recalcula custo médio ponderado em entradas de estoque
CREATE OR REPLACE FUNCTION public.recalcular_custo_medio()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_estoque_atual numeric;
  v_custo_medio_atual numeric;
  v_preco_entrada numeric;
  v_novo_custo numeric;
  v_qtd_entrada numeric;
BEGIN
  -- Apenas entradas (quantidade positiva) afetam o custo médio
  IF NEW.quantidade IS NULL OR NEW.quantidade <= 0 THEN
    RETURN NEW;
  END IF;

  -- Apenas tipos que representam entrada física no estoque
  IF NEW.tipo_movimentacao NOT IN ('COMPRA', 'INICIAL', 'PRODUCAO', 'AJUSTE') THEN
    RETURN NEW;
  END IF;

  v_qtd_entrada := NEW.quantidade;

  -- Estoque atual ANTES da nova entrada (soma de movimentos anteriores)
  SELECT COALESCE(SUM(quantidade), 0) INTO v_estoque_atual
  FROM public.movements
  WHERE item_id = NEW.item_id
    AND id <> NEW.id;

  SELECT COALESCE(custo_medio, 0), COALESCE(custo_unitario, 0)
    INTO v_custo_medio_atual, v_preco_entrada
  FROM public.items WHERE id = NEW.item_id;

  -- Preço da entrada: snapshot do movimento; fallback para custo de referência do item
  v_preco_entrada := COALESCE(NEW.preco_unitario, v_preco_entrada);

  -- Sem preço da entrada: nada a recalcular
  IF v_preco_entrada IS NULL OR v_preco_entrada <= 0 THEN
    RETURN NEW;
  END IF;

  IF v_estoque_atual <= 0 THEN
    -- Estoque zerado: novo custo médio = preço da entrada
    v_novo_custo := v_preco_entrada;
  ELSE
    v_novo_custo := (v_estoque_atual * v_custo_medio_atual + v_qtd_entrada * v_preco_entrada)
                    / (v_estoque_atual + v_qtd_entrada);
  END IF;

  UPDATE public.items
     SET custo_medio = ROUND(v_novo_custo::numeric, 6)
   WHERE id = NEW.item_id;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_recalcular_custo_medio ON public.movements;
CREATE TRIGGER trg_recalcular_custo_medio
AFTER INSERT ON public.movements
FOR EACH ROW
EXECUTE FUNCTION public.recalcular_custo_medio();

-- 20260422010854_1648d510-8d39-4d72-9c93-51fb93406369.sql
-- 1. Adicionar novos valores ao enum (sem remover os antigos para preservar dados durante a migração)
ALTER TYPE public.purchase_status ADD VALUE IF NOT EXISTS 'CRIADO';
ALTER TYPE public.purchase_status ADD VALUE IF NOT EXISTS 'RECEBIDO_PARCIAL';
ALTER TYPE public.purchase_status ADD VALUE IF NOT EXISTS 'RECEBIDO_COMPLETO';
ALTER TYPE public.purchase_status ADD VALUE IF NOT EXISTS 'CANCELADO';

-- 2. Adicionar quantidade_recebida
ALTER TABLE public.purchase_orders
  ADD COLUMN IF NOT EXISTS quantidade_recebida numeric NOT NULL DEFAULT 0;

-- 20260422012049_3e940769-cebb-417d-a485-2a28257e2471.sql
-- 1. Tabela de histórico
CREATE TABLE IF NOT EXISTS public.item_fornecedor_precos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id uuid NOT NULL,
  fornecedor_id uuid NOT NULL,
  preco_unitario numeric NOT NULL CHECK (preco_unitario >= 0),
  data_inicio timestamptz NOT NULL DEFAULT now(),
  data_fim timestamptz,
  origem text NOT NULL DEFAULT 'CADASTRO' CHECK (origem IN ('CADASTRO', 'PEDIDO')),
  purchase_order_id uuid,
  observacao text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ifp_item_fornecedor ON public.item_fornecedor_precos (item_id, fornecedor_id, data_inicio DESC);
CREATE INDEX IF NOT EXISTS idx_ifp_data_inicio ON public.item_fornecedor_precos (data_inicio DESC);





-- 2. Função genérica de inserção que fecha o registro anterior
CREATE OR REPLACE FUNCTION public.registrar_preco_historico(
  _item_id uuid,
  _fornecedor_id uuid,
  _preco numeric,
  _origem text,
  _purchase_order_id uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF _preco IS NULL OR _preco < 0 THEN RETURN; END IF;

  -- Fecha o registro aberto anterior (data_fim NULL) para o mesmo item-fornecedor
  UPDATE public.item_fornecedor_precos
     SET data_fim = now()
   WHERE item_id = _item_id
     AND fornecedor_id = _fornecedor_id
     AND data_fim IS NULL;

  INSERT INTO public.item_fornecedor_precos (item_id, fornecedor_id, preco_unitario, origem, purchase_order_id)
  VALUES (_item_id, _fornecedor_id, _preco, _origem, _purchase_order_id);
END;
$$;

-- 3. Trigger em item_fornecedores: registra ao inserir/alterar preço
CREATE OR REPLACE FUNCTION public.trg_item_fornecedor_preco()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.preco_unitario IS NOT NULL THEN
      PERFORM public.registrar_preco_historico(NEW.item_id, NEW.fornecedor_id, NEW.preco_unitario, 'CADASTRO', NULL);
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.preco_unitario IS DISTINCT FROM OLD.preco_unitario AND NEW.preco_unitario IS NOT NULL THEN
      PERFORM public.registrar_preco_historico(NEW.item_id, NEW.fornecedor_id, NEW.preco_unitario, 'CADASTRO', NULL);
    END IF;
    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_item_fornecedor_preco ON public.item_fornecedores;
CREATE TRIGGER trg_item_fornecedor_preco
AFTER INSERT OR UPDATE ON public.item_fornecedores
FOR EACH ROW EXECUTE FUNCTION public.trg_item_fornecedor_preco();

-- 4. Trigger em purchase_orders: registra ponto histórico com origem PEDIDO
CREATE OR REPLACE FUNCTION public.trg_purchase_order_preco()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.preco_unitario IS NOT NULL AND NEW.fornecedor_id IS NOT NULL THEN
    -- Para pedidos: NÃO fecha o registro de cadastro anterior (preço de tabela continua válido).
    -- Apenas insere um ponto histórico com origem PEDIDO e data_fim = now() (intervalo zero, é um evento).
    INSERT INTO public.item_fornecedor_precos
      (item_id, fornecedor_id, preco_unitario, origem, purchase_order_id, data_inicio, data_fim)
    VALUES
      (NEW.item_id, NEW.fornecedor_id, NEW.preco_unitario, 'PEDIDO', NEW.id, now(), now());
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_purchase_order_preco ON public.purchase_orders;
CREATE TRIGGER trg_purchase_order_preco
AFTER INSERT ON public.purchase_orders
FOR EACH ROW EXECUTE FUNCTION public.trg_purchase_order_preco();

-- 5. Backfill: registro inicial para vínculos existentes que tenham preço
INSERT INTO public.item_fornecedor_precos (item_id, fornecedor_id, preco_unitario, origem, data_inicio)
SELECT item_id, fornecedor_id, preco_unitario, 'CADASTRO', COALESCE(updated_at, created_at, now())
FROM public.item_fornecedores
WHERE preco_unitario IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.item_fornecedor_precos h
    WHERE h.item_id = item_fornecedores.item_id
      AND h.fornecedor_id = item_fornecedores.fornecedor_id
      AND h.origem = 'CADASTRO'
  );

-- 20260422012950_94ac2f81-1eb5-4549-a4eb-a054ecaea942.sql
CREATE TABLE IF NOT EXISTS public.purchase_order_recebimentos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_order_id uuid NOT NULL,
  quantidade numeric NOT NULL CHECK (quantidade > 0),
  data_real timestamptz NOT NULL DEFAULT now(),
  observacao text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_por_purchase_order ON public.purchase_order_recebimentos (purchase_order_id, data_real);





-- Backfill: pedidos já completos ganham um evento com data = updated_at
INSERT INTO public.purchase_order_recebimentos (purchase_order_id, quantidade, data_real, observacao)
SELECT po.id, po.quantidade_recebida, COALESCE(po.updated_at, po.created_at, now()), 'Backfill automático'
FROM public.purchase_orders po
WHERE po.status IN ('RECEBIDO_COMPLETO', 'RECEBIDO')
  AND po.quantidade_recebida > 0
  AND NOT EXISTS (SELECT 1 FROM public.purchase_order_recebimentos r WHERE r.purchase_order_id = po.id);

-- 20260422014300_d32ba457-c355-4d76-9ffb-c19d1589be77.sql
ALTER TABLE public.purchase_orders
  ADD COLUMN IF NOT EXISTS frete numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS impostos numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS outros_custos numeric NOT NULL DEFAULT 0;

-- 20260422020245_fcaea2d7-df37-4290-bedf-209ec3bae7eb.sql
-- Tabela de centros de custo (cliente / projeto / setor) usada para rastrear
-- onde o dinheiro está sendo aplicado: compras, produção, consumo, implantação.
CREATE TABLE public.centros_custo (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  nome text NOT NULL UNIQUE,
  descricao text,
  ativo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);



-- Mantemos o padrão atual do projeto (acesso público ao dado operacional)


CREATE TRIGGER update_centros_custo_updated_at
  BEFORE UPDATE ON public.centros_custo
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Referências opcionais nas três tabelas operacionais.
-- Não obrigatório (NULL permitido) — podemos preencher gradualmente.
ALTER TABLE public.purchase_orders
  ADD COLUMN centro_custo_id uuid REFERENCES public.centros_custo(id) ON DELETE SET NULL;

ALTER TABLE public.production_orders
  ADD COLUMN centro_custo_id uuid REFERENCES public.centros_custo(id) ON DELETE SET NULL;

ALTER TABLE public.movements
  ADD COLUMN centro_custo_id uuid REFERENCES public.centros_custo(id) ON DELETE SET NULL;

-- Centro de custo separado para o pós-venda (implantação no cliente)
ALTER TABLE public.production_orders
  ADD COLUMN centro_custo_implantacao_id uuid REFERENCES public.centros_custo(id) ON DELETE SET NULL;

CREATE INDEX idx_purchase_orders_centro_custo ON public.purchase_orders(centro_custo_id);
CREATE INDEX idx_production_orders_centro_custo ON public.production_orders(centro_custo_id);
CREATE INDEX idx_production_orders_centro_custo_impl ON public.production_orders(centro_custo_implantacao_id);
CREATE INDEX idx_movements_centro_custo ON public.movements(centro_custo_id);

-- Quando uma ordem de produção for concluída, a movimentação de CONSUMO
-- e a de PRODUCAO geradas pelo código já podem carregar centro_custo_id
-- diretamente. Nada a fazer no trigger atual.

-- 20260423022800_b4c8dc02-f4db-4a3f-900f-97e00673bb5f.sql
-- 1. Adicionar novos campos em items
ALTER TABLE public.items
  ADD COLUMN IF NOT EXISTS modo_producao_padrao text,
  ADD COLUMN IF NOT EXISTS produzido_internamente boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS gera_sugestao_compra boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS compra_direta boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS controla_estoque boolean NOT NULL DEFAULT true;

-- 2. Validação de modo_producao_padrao via trigger (não usar CHECK por flexibilidade)
CREATE OR REPLACE FUNCTION public.validate_items_modo_producao()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.modo_producao_padrao IS NOT NULL
     AND NEW.modo_producao_padrao NOT IN ('JIT', 'ESTOQUE') THEN
    RAISE EXCEPTION 'modo_producao_padrao deve ser NULL, ''JIT'' ou ''ESTOQUE''';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_items_modo_producao ON public.items;
CREATE TRIGGER trg_validate_items_modo_producao
  BEFORE INSERT OR UPDATE ON public.items
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_items_modo_producao();

-- 3. Aplicar defaults inteligentes por tipo nos itens já cadastrados
-- Matéria-prima: já está com defaults corretos (compra_direta=true, gera_sugestao_compra=true, controla_estoque=true, produzido_internamente=false)
UPDATE public.items
   SET produzido_internamente = false,
       gera_sugestao_compra = true,
       compra_direta = true,
       controla_estoque = true,
       modo_producao_padrao = NULL
 WHERE tipo = 'MP';

-- Submontagem
UPDATE public.items
   SET produzido_internamente = true,
       gera_sugestao_compra = false,
       compra_direta = false,
       controla_estoque = true,
       modo_producao_padrao = NULL
 WHERE tipo = 'SUB';

-- Produto Final: JIT por padrão
UPDATE public.items
   SET produzido_internamente = true,
       gera_sugestao_compra = false,
       compra_direta = false,
       controla_estoque = true,
       modo_producao_padrao = COALESCE(modo_producao_padrao, 'JIT')
 WHERE tipo = 'PF';

-- 20260423025651_408d56c2-0a9b-4330-8bf4-588719566a41.sql
-- Tabela de snapshot de custo por componente da OP
CREATE TABLE IF NOT EXISTS public.production_order_costs (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  production_order_id uuid NOT NULL REFERENCES public.production_orders(id) ON DELETE CASCADE,
  item_id uuid NOT NULL REFERENCES public.items(id),
  quantidade numeric NOT NULL,
  custo_unitario numeric NOT NULL,
  custo_total numeric NOT NULL,
  fonte_custo text NOT NULL DEFAULT 'HIBRIDO',
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_production_order_costs_op
  ON public.production_order_costs(production_order_id);






-- Total real agregado na OP
ALTER TABLE public.production_orders
  ADD COLUMN IF NOT EXISTS custo_total_real numeric;

-- 20260424022553_2900900b-2478-4978-8597-c2567f5acbf2.sql
-- Adiciona suporte a unidade de compra e fator de conversão
-- Item: padrão (unidade_compra/fator_conversao). Vínculo: override opcional.
-- Regra: quando vínculo tem unidade_compra/fator_conversao preenchidos, sobrescreve o do item.
-- preco_unitario (vínculo) e custo_unitario (item) passam a ser por UNIDADE DE COMPRA.

-- 1) Itens
ALTER TABLE public.items
  ADD COLUMN IF NOT EXISTS unidade_compra text,
  ADD COLUMN IF NOT EXISTS fator_conversao numeric NOT NULL DEFAULT 1;

-- Backfill: itens existentes ficam com fator 1 e unidade_compra = unidade
UPDATE public.items
   SET unidade_compra = COALESCE(unidade_compra, unidade),
       fator_conversao = COALESCE(fator_conversao, 1);

-- Validação: fator_conversao > 0
CREATE OR REPLACE FUNCTION public.validate_items_fator_conversao()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.fator_conversao IS NULL OR NEW.fator_conversao <= 0 THEN
    RAISE EXCEPTION 'fator_conversao deve ser maior que zero';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_items_fator_conversao ON public.items;
CREATE TRIGGER trg_validate_items_fator_conversao
  BEFORE INSERT OR UPDATE ON public.items
  FOR EACH ROW EXECUTE FUNCTION public.validate_items_fator_conversao();

-- 2) Vínculo item-fornecedor (override opcional, NULL = usa do item)
ALTER TABLE public.item_fornecedores
  ADD COLUMN IF NOT EXISTS unidade_compra text,
  ADD COLUMN IF NOT EXISTS fator_conversao numeric;

-- Validação: se preenchido, > 0
CREATE OR REPLACE FUNCTION public.validate_item_fornecedores_fator_conversao()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.fator_conversao IS NOT NULL AND NEW.fator_conversao <= 0 THEN
    RAISE EXCEPTION 'fator_conversao do vínculo, quando preenchido, deve ser maior que zero';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_if_fator_conversao ON public.item_fornecedores;
CREATE TRIGGER trg_validate_if_fator_conversao
  BEFORE INSERT OR UPDATE ON public.item_fornecedores
  FOR EACH ROW EXECUTE FUNCTION public.validate_item_fornecedores_fator_conversao();

-- 3) Atualiza trigger de custo médio para considerar fator de conversão
-- Hipótese: movements.preco_unitario é por UNIDADE DE ESTOQUE (como hoje).
-- A camada de aplicação fará a divisão pelo fator antes de gravar o movement,
-- então o trigger NÃO precisa mudar a fórmula do custo médio.
-- Mas se vier um preço "por embalagem" historicamente, a divisão fica a cargo da app.
-- Mantemos o trigger atual (que opera em unidade de estoque) sem alteração de fórmula.

COMMENT ON COLUMN public.items.unidade_compra IS 'Unidade em que o item é comprado (ex: caixa, pacote). NULL = mesma da unidade de estoque.';
COMMENT ON COLUMN public.items.fator_conversao IS 'Quantas unidades de estoque há em 1 unidade de compra. Default 1.';
COMMENT ON COLUMN public.item_fornecedores.unidade_compra IS 'Override: unidade de compra para este fornecedor. NULL = usa a do item.';
COMMENT ON COLUMN public.item_fornecedores.fator_conversao IS 'Override: fator de conversão para este fornecedor. NULL = usa o do item.';
COMMENT ON COLUMN public.items.custo_unitario IS 'Custo de referência por UNIDADE DE COMPRA (ex: R$/caixa). Para custo por unidade de estoque: custo_unitario / fator_conversao.';
COMMENT ON COLUMN public.item_fornecedores.preco_unitario IS 'Preço por UNIDADE DE COMPRA (ex: R$/caixa). Para preço por unidade de estoque: preco_unitario / fator_conversao_efetivo.';

-- 20260424024724_c6f8a8ce-0e11-472b-a407-c3d68f27a896.sql
-- 1) Novas colunas
ALTER TABLE public.purchase_orders
  ADD COLUMN IF NOT EXISTS unidade_compra_snapshot text,
  ADD COLUMN IF NOT EXISTS fator_conversao_snapshot numeric,
  ADD COLUMN IF NOT EXISTS custo_unitario_estoque_snapshot numeric;

-- 2) Validação: fator > 0 quando preenchido
CREATE OR REPLACE FUNCTION public.validate_purchase_orders_snapshot()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.fator_conversao_snapshot IS NOT NULL AND NEW.fator_conversao_snapshot <= 0 THEN
    RAISE EXCEPTION 'fator_conversao_snapshot deve ser maior que zero';
  END IF;
  IF NEW.custo_unitario_estoque_snapshot IS NOT NULL AND NEW.custo_unitario_estoque_snapshot < 0 THEN
    RAISE EXCEPTION 'custo_unitario_estoque_snapshot não pode ser negativo';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS validate_purchase_orders_snapshot_trigger ON public.purchase_orders;
CREATE TRIGGER validate_purchase_orders_snapshot_trigger
  BEFORE INSERT OR UPDATE ON public.purchase_orders
  FOR EACH ROW EXECUTE FUNCTION public.validate_purchase_orders_snapshot();

-- 3) Backfill: pedidos sem snapshot recebem os valores atuais do item / vínculo
WITH efetivo AS (
  SELECT
    po.id AS po_id,
    COALESCE(ifn.unidade_compra, i.unidade_compra, i.unidade) AS unidade_compra_eff,
    COALESCE(NULLIF(ifn.fator_conversao, 0), NULLIF(i.fator_conversao, 0), 1) AS fator_eff
  FROM public.purchase_orders po
  JOIN public.items i ON i.id = po.item_id
  LEFT JOIN public.item_fornecedores ifn
    ON ifn.item_id = po.item_id AND ifn.fornecedor_id = po.fornecedor_id
  WHERE po.unidade_compra_snapshot IS NULL
     OR po.fator_conversao_snapshot IS NULL
)
UPDATE public.purchase_orders po
SET
  unidade_compra_snapshot = COALESCE(po.unidade_compra_snapshot, e.unidade_compra_eff),
  fator_conversao_snapshot = COALESCE(po.fator_conversao_snapshot, e.fator_eff),
  custo_unitario_estoque_snapshot = COALESCE(
    po.custo_unitario_estoque_snapshot,
    CASE
      WHEN po.preco_unitario IS NOT NULL AND e.fator_eff > 0
      THEN ROUND((po.preco_unitario / e.fator_eff)::numeric, 6)
      ELSE NULL
    END
  )
FROM efetivo e
WHERE po.id = e.po_id;

-- 20260424030955_4a96d180-fc5b-468e-bacb-4ef6ff7f7c4f.sql
-- 1) Adicionar tipo RETORNO ao enum movement_type
ALTER TYPE public.movement_type ADD VALUE IF NOT EXISTS 'RETORNO';

-- 2) Adicionar campos opcionais para rastreabilidade de usuário
ALTER TABLE public.movements
  ADD COLUMN IF NOT EXISTS user_id uuid,
  ADD COLUMN IF NOT EXISTS usuario_nome text;

-- 3) Atualizar trigger de custo médio para EXCLUIR RETORNO (devolução não atualiza custo)
CREATE OR REPLACE FUNCTION public.recalcular_custo_medio()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_estoque_atual numeric;
  v_custo_medio_atual numeric;
  v_preco_entrada numeric;
  v_novo_custo numeric;
  v_qtd_entrada numeric;
BEGIN
  IF NEW.quantidade IS NULL OR NEW.quantidade <= 0 THEN
    RETURN NEW;
  END IF;

  -- RETORNO é entrada física mas NÃO altera custo médio (é devolução de item já contabilizado)
  IF NEW.tipo_movimentacao NOT IN ('COMPRA', 'INICIAL', 'PRODUCAO', 'AJUSTE') THEN
    RETURN NEW;
  END IF;

  v_qtd_entrada := NEW.quantidade;

  SELECT COALESCE(SUM(quantidade), 0) INTO v_estoque_atual
  FROM public.movements
  WHERE item_id = NEW.item_id
    AND id <> NEW.id;

  SELECT COALESCE(custo_medio, 0), COALESCE(custo_unitario, 0)
    INTO v_custo_medio_atual, v_preco_entrada
  FROM public.items WHERE id = NEW.item_id;

  v_preco_entrada := COALESCE(NEW.preco_unitario, v_preco_entrada);

  IF v_preco_entrada IS NULL OR v_preco_entrada <= 0 THEN
    RETURN NEW;
  END IF;

  IF v_estoque_atual <= 0 THEN
    v_novo_custo := v_preco_entrada;
  ELSE
    v_novo_custo := (v_estoque_atual * v_custo_medio_atual + v_qtd_entrada * v_preco_entrada)
                    / (v_estoque_atual + v_qtd_entrada);
  END IF;

  UPDATE public.items
     SET custo_medio = ROUND(v_novo_custo::numeric, 6)
   WHERE id = NEW.item_id;

  RETURN NEW;
END;
$function$;

-- 20260424035221_b613fccc-602d-485d-b432-af66da6dfc67.sql
-- 1. Templates de etapas (configurável no futuro)
CREATE TABLE public.production_stage_templates (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  nome text NOT NULL,
  ordem integer NOT NULL,
  ativo boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);




CREATE TRIGGER trg_production_stage_templates_updated_at
BEFORE UPDATE ON public.production_stage_templates
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Seed das 4 etapas padrão
INSERT INTO public.production_stage_templates (nome, ordem) VALUES
  ('Montagem de Trilho', 1),
  ('Configuração da Raspberry', 2),
  ('Montagem da Caixa Hermética', 3),
  ('Embalar para envio', 4);

-- 2. Status das etapas
CREATE TYPE public.production_stage_status AS ENUM (
  'NAO_INICIADA',
  'EM_ANDAMENTO',
  'PAUSADA',
  'CONCLUIDA'
);

-- 3. Etapas vinculadas a cada OP
CREATE TABLE public.production_order_stages (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  production_order_id uuid NOT NULL REFERENCES public.production_orders(id) ON DELETE CASCADE,
  template_id uuid REFERENCES public.production_stage_templates(id) ON DELETE SET NULL,
  nome text NOT NULL,
  ordem integer NOT NULL,
  status public.production_stage_status NOT NULL DEFAULT 'NAO_INICIADA',
  started_at timestamp with time zone,
  completed_at timestamp with time zone,
  -- segundos
  tempo_bruto_seg integer,
  tempo_pausado_seg integer NOT NULL DEFAULT 0,
  tempo_produtivo_seg integer,
  observacoes text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE (production_order_id, ordem)
);




CREATE INDEX idx_pos_order ON public.production_order_stages(production_order_id);
CREATE INDEX idx_pos_status ON public.production_order_stages(status);

CREATE TRIGGER trg_production_order_stages_updated_at
BEFORE UPDATE ON public.production_order_stages
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 4. Pausas por etapa
CREATE TABLE public.production_stage_pauses (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  stage_id uuid NOT NULL REFERENCES public.production_order_stages(id) ON DELETE CASCADE,
  motivo text,
  started_at timestamp with time zone NOT NULL DEFAULT now(),
  ended_at timestamp with time zone,
  duracao_seg integer,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);




CREATE INDEX idx_psp_stage ON public.production_stage_pauses(stage_id);
CREATE INDEX idx_psp_open ON public.production_stage_pauses(stage_id) WHERE ended_at IS NULL;

-- 5. Campos de tempo na OP
ALTER TABLE public.production_orders
  ADD COLUMN started_at timestamp with time zone,
  ADD COLUMN completed_at timestamp with time zone,
  ADD COLUMN tempo_total_seg integer,
  ADD COLUMN tempo_produtivo_total_seg integer;

-- 6. Backfill: cria etapas "não iniciadas" para OPs ativas que ainda não têm etapas
INSERT INTO public.production_order_stages (production_order_id, template_id, nome, ordem, status)
SELECT po.id, t.id, t.nome, t.ordem, 'NAO_INICIADA'::public.production_stage_status
FROM public.production_orders po
CROSS JOIN public.production_stage_templates t
WHERE po.status IN ('PLANEJADA', 'EM_PRODUCAO')
  AND t.ativo = true
  AND NOT EXISTS (
    SELECT 1 FROM public.production_order_stages s WHERE s.production_order_id = po.id
  );

-- 20260424040112_f4bc3912-5206-4f6f-95cf-6fed80a25f7c.sql
-- Modo de execução da OP
CREATE TYPE public.production_assembly_mode AS ENUM ('SIMPLIFICADO', 'DETALHADO');

ALTER TABLE public.production_orders
  ADD COLUMN montador_nome text,
  ADD COLUMN modo_execucao public.production_assembly_mode;

ALTER TABLE public.production_order_stages
  ADD COLUMN montador_nome text;

ALTER TABLE public.production_stage_pauses
  ADD COLUMN montador_nome text;

-- 20260424044114_8e0bc9ba-0a7e-49ca-8e99-cca664ee3e8d.sql
-- 1. Adicionar campos de prazo (due_date) em production_orders
ALTER TABLE public.production_orders
  ADD COLUMN due_date date,
  ADD COLUMN due_date_original date,
  ADD COLUMN due_date_updated_at timestamp with time zone,
  ADD COLUMN due_date_change_count integer NOT NULL DEFAULT 0;

-- Índice para filtros de atraso/vencimento
CREATE INDEX idx_production_orders_due_date ON public.production_orders(due_date);
CREATE INDEX idx_production_orders_due_date_original ON public.production_orders(due_date_original);

COMMENT ON COLUMN public.production_orders.due_date IS 'Prazo atual de implantação (planejamento corrente)';
COMMENT ON COLUMN public.production_orders.due_date_original IS 'Prazo original (compromisso real). Só muda em correção de erro.';
COMMENT ON COLUMN public.production_orders.due_date_change_count IS 'Quantas vezes a OP foi remarcada (não conta correções).';

-- 2. Tabela de histórico de alterações de prazo
CREATE TABLE public.implantation_due_date_history (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  production_order_id uuid NOT NULL REFERENCES public.production_orders(id) ON DELETE CASCADE,
  old_date date,
  new_date date,
  change_type text NOT NULL,
  motivo text,
  changed_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT implantation_due_date_history_change_type_check
    CHECK (change_type IN ('definicao', 'correcao', 'remarcacao'))
);

CREATE INDEX idx_impl_due_date_history_op
  ON public.implantation_due_date_history(production_order_id, changed_at DESC);



-- Mesma política aberta usada nas outras tabelas do projeto

-- 20260424051644_8e651d8c-d3cb-439d-a533-f6682f4be688.sql
-- Adiciona queue_created_at em production_orders
ALTER TABLE public.production_orders
  ADD COLUMN IF NOT EXISTS queue_created_at timestamp with time zone;

-- Backfill: para registros existentes, a entrada na fila = created_at
UPDATE public.production_orders
   SET queue_created_at = created_at
 WHERE queue_created_at IS NULL;

-- Default e NOT NULL para novos registros
ALTER TABLE public.production_orders
  ALTER COLUMN queue_created_at SET DEFAULT now();

ALTER TABLE public.production_orders
  ALTER COLUMN queue_created_at SET NOT NULL;

-- Índice para consultas de fila/lead time por período
CREATE INDEX IF NOT EXISTS idx_production_orders_queue_created_at
  ON public.production_orders (queue_created_at);

-- 20260424190721_fcbe9c98-5b54-4ccf-9388-35ae7bbc61c0.sql
ALTER TABLE public.production_orders
ADD COLUMN IF NOT EXISTS envio_started_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS envio_completed_at TIMESTAMP WITH TIME ZONE;

CREATE TABLE IF NOT EXISTS public.production_shipping_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  production_order_id UUID NOT NULL,
  old_envio_started_at TIMESTAMP WITH TIME ZONE,
  new_envio_started_at TIMESTAMP WITH TIME ZONE,
  old_envio_completed_at TIMESTAMP WITH TIME ZONE,
  new_envio_completed_at TIMESTAMP WITH TIME ZONE,
  motivo TEXT,
  changed_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);





CREATE TABLE IF NOT EXISTS public.production_failures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  production_order_id UUID NOT NULL,
  etapa TEXT NOT NULL,
  motivo TEXT NOT NULL,
  occurred_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);





CREATE INDEX IF NOT EXISTS idx_production_shipping_history_order_changed_at
  ON public.production_shipping_history (production_order_id, changed_at DESC);

CREATE INDEX IF NOT EXISTS idx_production_failures_order_created_at
  ON public.production_failures (production_order_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.validate_shipping_window()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.envio_started_at IS NOT NULL
     AND NEW.completed_at IS NOT NULL
     AND NEW.envio_started_at < NEW.completed_at THEN
    RAISE EXCEPTION 'envio_started_at não pode ser anterior à conclusão da produção';
  END IF;

  IF NEW.envio_started_at IS NOT NULL
     AND NEW.envio_completed_at IS NOT NULL
     AND NEW.envio_completed_at < NEW.envio_started_at THEN
    RAISE EXCEPTION 'envio_completed_at não pode ser anterior a envio_started_at';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.validate_production_failure_etapa()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.etapa NOT IN ('PRODUCAO', 'ENVIO') THEN
    RAISE EXCEPTION 'etapa deve ser PRODUCAO ou ENVIO';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS validate_shipping_window_trigger ON public.production_orders;
CREATE TRIGGER validate_shipping_window_trigger
BEFORE INSERT OR UPDATE ON public.production_orders
FOR EACH ROW
EXECUTE FUNCTION public.validate_shipping_window();

DROP TRIGGER IF EXISTS validate_production_failure_etapa_trigger ON public.production_failures;
CREATE TRIGGER validate_production_failure_etapa_trigger
BEFORE INSERT OR UPDATE ON public.production_failures
FOR EACH ROW
EXECUTE FUNCTION public.validate_production_failure_etapa();

-- 20260429214055_5adc213b-99e7-4373-896a-c668f52ddaac.sql
-- Add sort_order to bom_items for predictable, manually controllable component ordering
ALTER TABLE public.bom_items
  ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 0;

-- Backfill: seed sort_order per parent based on existing creation order
WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (PARTITION BY item_pai_id ORDER BY created_at, id) AS rn
  FROM public.bom_items
)
UPDATE public.bom_items b
SET sort_order = r.rn
FROM ranked r
WHERE b.id = r.id;

CREATE INDEX IF NOT EXISTS idx_bom_items_pai_sort
  ON public.bom_items (item_pai_id, sort_order);

-- 20260430020908_b7b93a53-c234-4236-8e4f-3c9fe242cebf.sql
-- 1) Coluna deleted_at em items para soft-delete formal (em conjunto com ativo=false)
ALTER TABLE public.items
  ADD COLUMN IF NOT EXISTS deleted_at timestamp with time zone;

CREATE INDEX IF NOT EXISTS idx_items_ativo_deleted_at
  ON public.items (ativo, deleted_at);

-- 2) Adicionar novo valor ao enum movement_type (idempotente)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'movement_type' AND e.enumlabel = 'AJUSTE_EXCLUSAO'
  ) THEN
    ALTER TYPE public.movement_type ADD VALUE 'AJUSTE_EXCLUSAO';
  END IF;
END$$;

-- 20260430050428_ba183ea1-50df-4088-9690-d3d24a2c7d8f.sql
-- Tabela de substituições de itens por OP.
-- Cada linha indica que, NESTA OP, o item original será substituído pelo item substituto.
-- A BOM original NÃO é alterada — apenas o consumo/cálculo desta OP usa o substituto.
CREATE TABLE public.production_order_substitutions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  production_order_id uuid NOT NULL,
  item_original_id uuid NOT NULL,
  item_substituto_id uuid NOT NULL,
  quantidade numeric NOT NULL,
  custo_unitario_original numeric,
  custo_unitario_substituto numeric,
  motivo text,
  usuario_nome text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT production_order_substitutions_qty_pos CHECK (quantidade > 0),
  CONSTRAINT production_order_substitutions_no_self CHECK (item_original_id <> item_substituto_id),
  CONSTRAINT production_order_substitutions_unique_per_op UNIQUE (production_order_id, item_original_id)
);

CREATE INDEX idx_pos_op ON public.production_order_substitutions(production_order_id);
CREATE INDEX idx_pos_original ON public.production_order_substitutions(item_original_id);
CREATE INDEX idx_pos_substituto ON public.production_order_substitutions(item_substituto_id);





-- Atualiza o gerenciador de reservas para considerar substituições:
-- Se um componente da BOM tiver substituição registrada nesta OP, a reserva
-- é criada para o item SUBSTITUTO (não para o original).
CREATE OR REPLACE FUNCTION public.manage_production_reservations()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM public.reservations WHERE referencia = 'OP:' || OLD.id::text;
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.status IN ('PLANEJADA', 'EM_PRODUCAO') AND NEW.status NOT IN ('PLANEJADA', 'EM_PRODUCAO') THEN
    DELETE FROM public.reservations WHERE referencia = 'OP:' || NEW.id::text;
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.status IN ('PLANEJADA', 'EM_PRODUCAO') THEN
      DELETE FROM public.reservations WHERE referencia = 'OP:' || NEW.id::text;
      INSERT INTO public.reservations (item_id, quantidade, referencia)
      SELECT
        COALESCE(s.item_substituto_id, bi.item_componente_id),
        bi.quantidade * NEW.quantidade,
        'OP:' || NEW.id::text
      FROM public.bom_items bi
      LEFT JOIN public.production_order_substitutions s
        ON s.production_order_id = NEW.id
       AND s.item_original_id = bi.item_componente_id
      WHERE bi.item_pai_id = NEW.item_id;
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' AND NEW.status IN ('PLANEJADA', 'EM_PRODUCAO') THEN
    INSERT INTO public.reservations (item_id, quantidade, referencia)
    SELECT
      COALESCE(s.item_substituto_id, bi.item_componente_id),
      bi.quantidade * NEW.quantidade,
      'OP:' || NEW.id::text
    FROM public.bom_items bi
    LEFT JOIN public.production_order_substitutions s
      ON s.production_order_id = NEW.id
     AND s.item_original_id = bi.item_componente_id
    WHERE bi.item_pai_id = NEW.item_id;
  END IF;

  RETURN NEW;
END;
$function$;

-- Trigger para recriar reservas quando uma substituição é adicionada/alterada/removida
-- (apenas para OPs ativas em PLANEJADA/EM_PRODUCAO).
CREATE OR REPLACE FUNCTION public.refresh_reservations_on_substitution()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_op_id uuid;
  v_status text;
  v_item_pai uuid;
  v_qtd numeric;
BEGIN
  v_op_id := COALESCE(NEW.production_order_id, OLD.production_order_id);

  SELECT status::text, item_id, quantidade
    INTO v_status, v_item_pai, v_qtd
  FROM public.production_orders
  WHERE id = v_op_id;

  IF v_status NOT IN ('PLANEJADA', 'EM_PRODUCAO') THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  DELETE FROM public.reservations WHERE referencia = 'OP:' || v_op_id::text;
  INSERT INTO public.reservations (item_id, quantidade, referencia)
  SELECT
    COALESCE(s.item_substituto_id, bi.item_componente_id),
    bi.quantidade * v_qtd,
    'OP:' || v_op_id::text
  FROM public.bom_items bi
  LEFT JOIN public.production_order_substitutions s
    ON s.production_order_id = v_op_id
   AND s.item_original_id = bi.item_componente_id
  WHERE bi.item_pai_id = v_item_pai;

  RETURN COALESCE(NEW, OLD);
END;
$function$;

CREATE TRIGGER trg_refresh_reservations_on_substitution
AFTER INSERT OR UPDATE OR DELETE ON public.production_order_substitutions
FOR EACH ROW EXECUTE FUNCTION public.refresh_reservations_on_substitution();

-- 20260502160047_7447fd8f-8f89-4c51-ad33-0bb7f55d81da.sql
-- ============================================================
-- FASE 1: OP composta — tabela production_order_items
-- ============================================================
-- Cada OP passa a ter 1+ linhas em production_order_items, descrevendo os
-- produtos (BOMs) que compõem o conjunto a ser produzido. OPs antigas são
-- migradas com 1 linha cada (mantém retrocompatibilidade).

CREATE TABLE IF NOT EXISTS public.production_order_items (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  production_order_id UUID NOT NULL REFERENCES public.production_orders(id) ON DELETE CASCADE,
  item_id UUID NOT NULL,
  quantidade NUMERIC NOT NULL CHECK (quantidade > 0),
  ordem INTEGER NOT NULL DEFAULT 0,
  nome_snapshot TEXT,
  custo_snapshot NUMERIC,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_production_order_items_op
  ON public.production_order_items(production_order_id);
CREATE INDEX IF NOT EXISTS idx_production_order_items_item
  ON public.production_order_items(item_id);






-- Coluna opcional para dar nome customizado a OPs compostas
ALTER TABLE public.production_orders
  ADD COLUMN IF NOT EXISTS nome_conjunto TEXT;

-- ============================================================
-- BACKFILL: 1 linha em production_order_items para cada OP existente
-- ============================================================
INSERT INTO public.production_order_items
  (production_order_id, item_id, quantidade, ordem, nome_snapshot)
SELECT
  po.id,
  po.item_id,
  po.quantidade,
  0,
  i.nome
FROM public.production_orders po
LEFT JOIN public.items i ON i.id = po.item_id
WHERE NOT EXISTS (
  SELECT 1 FROM public.production_order_items poi
  WHERE poi.production_order_id = po.id
);

-- ============================================================
-- Ligar substituições a um sub-produto específico (FASE 1: opcional)
-- ============================================================
ALTER TABLE public.production_order_substitutions
  ADD COLUMN IF NOT EXISTS production_order_item_id UUID
  REFERENCES public.production_order_items(id) ON DELETE CASCADE;

-- Backfill: cada substituição existente aponta para a (única) linha da OP
UPDATE public.production_order_substitutions s
SET production_order_item_id = poi.id
FROM public.production_order_items poi
WHERE s.production_order_item_id IS NULL
  AND poi.production_order_id = s.production_order_id;

-- ============================================================
-- TRIGGERS: reserva agora consolida componentes de TODAS as linhas
-- ============================================================
CREATE OR REPLACE FUNCTION public.manage_production_reservations()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM public.reservations WHERE referencia = 'OP:' || OLD.id::text;
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.status IN ('PLANEJADA', 'EM_PRODUCAO')
     AND NEW.status NOT IN ('PLANEJADA', 'EM_PRODUCAO') THEN
    DELETE FROM public.reservations WHERE referencia = 'OP:' || NEW.id::text;
    RETURN NEW;
  END IF;

  IF (TG_OP = 'INSERT' AND NEW.status IN ('PLANEJADA', 'EM_PRODUCAO'))
     OR (TG_OP = 'UPDATE' AND NEW.status IN ('PLANEJADA', 'EM_PRODUCAO')) THEN

    DELETE FROM public.reservations WHERE referencia = 'OP:' || NEW.id::text;

    -- Soma componentes de TODAS as linhas (sub-produtos) da OP, considerando
    -- substituições registradas (por sub-produto quando informado, senão geral).
    INSERT INTO public.reservations (item_id, quantidade, referencia)
    SELECT
      COALESCE(s.item_substituto_id, bi.item_componente_id) AS item_id,
      SUM(bi.quantidade * poi.quantidade) AS quantidade,
      'OP:' || NEW.id::text
    FROM public.production_order_items poi
    JOIN public.bom_items bi ON bi.item_pai_id = poi.item_id
    LEFT JOIN public.production_order_substitutions s
      ON s.production_order_id = NEW.id
     AND s.item_original_id = bi.item_componente_id
     AND (s.production_order_item_id IS NULL OR s.production_order_item_id = poi.id)
    WHERE poi.production_order_id = NEW.id
    GROUP BY COALESCE(s.item_substituto_id, bi.item_componente_id);
  END IF;

  RETURN NEW;
END;
$function$;

-- Atualiza também o trigger que recalcula reservas quando substituição muda
CREATE OR REPLACE FUNCTION public.refresh_reservations_on_substitution()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_op_id uuid;
  v_status text;
BEGIN
  v_op_id := COALESCE(NEW.production_order_id, OLD.production_order_id);

  SELECT status::text INTO v_status
  FROM public.production_orders
  WHERE id = v_op_id;

  IF v_status NOT IN ('PLANEJADA', 'EM_PRODUCAO') THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  DELETE FROM public.reservations WHERE referencia = 'OP:' || v_op_id::text;

  INSERT INTO public.reservations (item_id, quantidade, referencia)
  SELECT
    COALESCE(s.item_substituto_id, bi.item_componente_id) AS item_id,
    SUM(bi.quantidade * poi.quantidade) AS quantidade,
    'OP:' || v_op_id::text
  FROM public.production_order_items poi
  JOIN public.bom_items bi ON bi.item_pai_id = poi.item_id
  LEFT JOIN public.production_order_substitutions s
    ON s.production_order_id = v_op_id
   AND s.item_original_id = bi.item_componente_id
   AND (s.production_order_item_id IS NULL OR s.production_order_item_id = poi.id)
  WHERE poi.production_order_id = v_op_id
  GROUP BY COALESCE(s.item_substituto_id, bi.item_componente_id);

  RETURN COALESCE(NEW, OLD);
END;
$function$;

-- Recria reservas quando production_order_items muda
CREATE OR REPLACE FUNCTION public.refresh_reservations_on_op_items_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_op_id uuid;
  v_status text;
BEGIN
  v_op_id := COALESCE(NEW.production_order_id, OLD.production_order_id);

  SELECT status::text INTO v_status
  FROM public.production_orders WHERE id = v_op_id;

  IF v_status NOT IN ('PLANEJADA', 'EM_PRODUCAO') THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  DELETE FROM public.reservations WHERE referencia = 'OP:' || v_op_id::text;

  INSERT INTO public.reservations (item_id, quantidade, referencia)
  SELECT
    COALESCE(s.item_substituto_id, bi.item_componente_id) AS item_id,
    SUM(bi.quantidade * poi.quantidade) AS quantidade,
    'OP:' || v_op_id::text
  FROM public.production_order_items poi
  JOIN public.bom_items bi ON bi.item_pai_id = poi.item_id
  LEFT JOIN public.production_order_substitutions s
    ON s.production_order_id = v_op_id
   AND s.item_original_id = bi.item_componente_id
   AND (s.production_order_item_id IS NULL OR s.production_order_item_id = poi.id)
  WHERE poi.production_order_id = v_op_id
  GROUP BY COALESCE(s.item_substituto_id, bi.item_componente_id);

  RETURN COALESCE(NEW, OLD);
END;
$function$;

DROP TRIGGER IF EXISTS trg_refresh_reservations_on_op_items
  ON public.production_order_items;
CREATE TRIGGER trg_refresh_reservations_on_op_items
AFTER INSERT OR UPDATE OR DELETE ON public.production_order_items
FOR EACH ROW
EXECUTE FUNCTION public.refresh_reservations_on_op_items_change();

-- 20260502160536_7c75f0d8-b27c-4ee0-8e8f-86ea4c118a08.sql
-- Trigger: garante que toda OP tenha pelo menos 1 linha em production_order_items.
-- Roda DEPOIS do insert da OP. Se o cliente não criou linha alguma na tabela
-- filha (caminho legado), cria 1 linha com base em (item_id, quantidade) da OP.
CREATE OR REPLACE FUNCTION public.ensure_production_order_items()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.production_order_items
    WHERE production_order_id = NEW.id
  ) THEN
    INSERT INTO public.production_order_items
      (production_order_id, item_id, quantidade, ordem, nome_snapshot)
    SELECT NEW.id, NEW.item_id, NEW.quantidade, 0, i.nome
    FROM public.items i WHERE i.id = NEW.item_id;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_ensure_production_order_items
  ON public.production_orders;
-- AFTER INSERT, com timing DEFERRABLE INITIALLY DEFERRED não é nativo aqui;
-- usamos AFTER INSERT padrão. Se o cliente já inseriu a linha-filha antes
-- desse trigger, o EXISTS evita duplicar. Caminhos que inserem a linha-filha
-- DEPOIS do insert da OP (como o hook useCreateProductionOrder) também ficam
-- seguros porque o EXISTS aqui já encontra (mas o hook insere depois — então
-- esse trigger faria backfill por engano). Para compatibilizar, o hook insere
-- a tabela-filha ANTES via mesma transação? Não há transação client-side.
-- Solução: o hook substitui a linha auto-criada por insert "real". Como o
-- trigger usa item_id/quantidade da própria OP (que o hook também enviou),
-- as linhas geradas batem para OP simples. Para OP composta, o hook envia
-- as N linhas reais e o trigger NÃO recria (porque AFTER INSERT da OP
-- termina antes do hook inserir). Logo, o hook DEVE deletar a linha
-- auto-criada antes de inserir as suas. Trataremos isso no hook.
CREATE TRIGGER trg_ensure_production_order_items
AFTER INSERT ON public.production_orders
FOR EACH ROW
EXECUTE FUNCTION public.ensure_production_order_items();

-- 20260503040130_e0dd08c4-6043-4d52-91bd-066b2fa013d8.sql
ALTER TABLE public.production_order_stages
ADD COLUMN IF NOT EXISTS quick_completed boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_pos_quick_completed
  ON public.production_order_stages(production_order_id)
  WHERE quick_completed = true;

-- 20260521165634_dfc76c11-9315-496f-a88e-0909aecce287.sql
-- Simplificação: campos novos de montagem e envio na OP.
-- Tabelas antigas (production_order_stages, production_stage_pauses, production_failures,
-- production_shipping_history) permanecem como legado, sem uso operacional novo.

ALTER TABLE public.production_orders
  ADD COLUMN IF NOT EXISTS montagem_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS montagem_completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS tempo_montagem_seg integer,
  ADD COLUMN IF NOT EXISTS shipping_date date,
  ADD COLUMN IF NOT EXISTS carrier_name text,
  ADD COLUMN IF NOT EXISTS tracking_code text,
  ADD COLUMN IF NOT EXISTS received_date date;

