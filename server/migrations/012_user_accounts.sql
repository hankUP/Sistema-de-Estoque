CREATE TABLE public.app_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username text NOT NULL,
  display_name text NOT NULL,
  password_salt text NOT NULL,
  password_hash text NOT NULL,
  role text NOT NULL CHECK (role IN ('ADMIN', 'COORDENADOR', 'TECNICO', 'OPERACIONAL')),
  active boolean NOT NULL DEFAULT true,
  must_change_password boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT app_users_username_format CHECK (username ~ '^[a-z0-9._-]{3,40}$'),
  CONSTRAINT app_users_name_length CHECK (length(btrim(display_name)) BETWEEN 2 AND 120)
);
CREATE UNIQUE INDEX app_users_username_unique ON public.app_users (lower(username));

CREATE TABLE public.app_sessions (
  token_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX app_sessions_user_id_idx ON public.app_sessions (user_id);
CREATE INDEX app_sessions_expires_at_idx ON public.app_sessions (expires_at);

ALTER TABLE public.production_orders
  ADD COLUMN assigned_user_id uuid REFERENCES public.app_users(id) ON DELETE SET NULL;
CREATE INDEX production_orders_assigned_user_idx ON public.production_orders (assigned_user_id);
