INSERT INTO public.centros_custo (nome, tipo) VALUES
  ('Administrativo', 'SETOR'),
  ('Comercial', 'SETOR'),
  ('Financeiro', 'SETOR'),
  ('Marketing', 'SETOR'),
  ('Operacional', 'SETOR'),
  ('RH', 'SETOR'),
  ('Tecnologia', 'SETOR')
ON CONFLICT DO NOTHING;
