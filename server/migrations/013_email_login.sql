-- Permite usar um e-mail como login (ex.: nome@empresa.com.br), além do formato anterior.
-- Contas existentes continuam válidas: o formato antigo segue aceito.
ALTER TABLE public.app_users DROP CONSTRAINT app_users_username_format;
ALTER TABLE public.app_users ADD CONSTRAINT app_users_username_format CHECK (
  username ~ '^[a-z0-9._-]{3,40}$'
  OR (length(username) <= 120 AND username ~ '^[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$')
);
