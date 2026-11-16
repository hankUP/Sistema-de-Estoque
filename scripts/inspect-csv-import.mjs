import pg from 'pg';

const pool = new pg.Pool({ ...(process.env.DATABASE_URL ? { connectionString: process.env.DATABASE_URL } : {}), max: 1 });
try {
  const [columns, counts, suppliers, items, stock, centers, links] = await Promise.all([
    pool.query("SELECT table_name,column_name,data_type,is_nullable FROM information_schema.columns WHERE table_schema='public' AND table_name IN ('items','fornecedores','item_fornecedores','movements','centros_custo','reservations','purchase_orders') ORDER BY table_name,ordinal_position"),
    pool.query("SELECT 'items' AS tabela,count(*)::int AS total FROM public.items UNION ALL SELECT 'fornecedores',count(*)::int FROM public.fornecedores UNION ALL SELECT 'item_fornecedores',count(*)::int FROM public.item_fornecedores UNION ALL SELECT 'movements',count(*)::int FROM public.movements UNION ALL SELECT 'reservations',count(*)::int FROM public.reservations UNION ALL SELECT 'purchase_orders',count(*)::int FROM public.purchase_orders"),
    pool.query('SELECT id,nome,telefone,whatsapp,email,avaliacao,observacoes,ativo FROM public.fornecedores ORDER BY nome'),
    pool.query('SELECT id,nome,tipo,unidade,estoque_minimo,consumo_diario,ativo FROM public.items ORDER BY nome'),
    pool.query('SELECT item_id,COALESCE(SUM(quantidade),0) AS fisico FROM public.movements GROUP BY item_id'),
    pool.query('SELECT id,nome,tipo,ativo FROM public.centros_custo ORDER BY nome'),
    pool.query('SELECT item_id,fornecedor_id,principal FROM public.item_fornecedores'),
  ]);
  console.log(JSON.stringify({ columns: columns.rows, counts: counts.rows, suppliers: suppliers.rows, items: items.rows, stock: stock.rows, centers: centers.rows, links: links.rows }, null, 2));
} finally {
  await pool.end();
}
