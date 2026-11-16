import { readFileSync } from 'node:fs';
import pg from 'pg';

const stock = readFileSync('posicao_estoque_2026-10-14.csv', 'utf8').trim().split(/\r?\n/);
const suppliers = readFileSync('fornecedores_2026-10-14.csv', 'utf8').trim().split(/\r?\n/);
const values = (line, header) => Object.fromEntries(line.split(';').map((cell, index) => [header[index], cell]));
const stockHeader = stock.shift().split(';');
const supplierHeader = suppliers.shift().split(';');
const number = (text) => Number(text.replace(',', '.'));
const key = (text) => text.trim().toLocaleLowerCase('pt-BR');
const pool = new pg.Pool({ ...(process.env.DATABASE_URL ? { connectionString: process.env.DATABASE_URL } : {}), max: 1 });
try {
  const [items, suppliersDb, links, counts] = await Promise.all([
    pool.query('SELECT i.nome,i.tipo,i.unidade,i.estoque_minimo,i.consumo_diario,COALESCE(SUM(m.quantidade),0) AS fisico FROM public.items i LEFT JOIN public.movements m ON m.item_id=i.id GROUP BY i.id'),
    pool.query('SELECT id,nome,ativo,telefone,whatsapp,email,avaliacao,observacoes FROM public.fornecedores'),
    pool.query('SELECT i.nome AS item,f.nome AS fornecedor FROM public.item_fornecedores x JOIN public.items i ON i.id=x.item_id JOIN public.fornecedores f ON f.id=x.fornecedor_id'),
    pool.query("SELECT (SELECT count(*) FROM public.items)::int AS items,(SELECT count(*) FROM public.fornecedores)::int AS fornecedores,(SELECT count(*) FROM public.movements)::int AS movements,(SELECT count(*) FROM public.reservations)::int AS reservations,(SELECT count(*) FROM public.purchase_orders)::int AS purchase_orders"),
  ]);
  const itemMap = new Map(items.rows.map((item) => [key(item.nome), item]));
  const supplierMap = new Map(suppliersDb.rows.map((supplier) => [key(supplier.nome), supplier]));
  const linkSet = new Set(links.rows.map((link) => `${key(link.fornecedor)}|${key(link.item)}`));
  const issues = [];
  for (const line of stock) {
    const csv = values(line, stockHeader);
    const db = itemMap.get(key(csv.Item));
    if (!db) { issues.push(`Item ausente: ${csv.Item}`); continue; }
    const tipo = { 'Matéria-prima': 'MP', Submontagem: 'SUB', 'Produto final': 'PF' }[csv.Tipo];
    if (db.tipo !== tipo || db.unidade !== csv.Unidade || number(db.fisico) !== number(csv['Estoque Físico']) ||
      number(db.estoque_minimo) !== number(csv['Estoque Mínimo']) || number(db.consumo_diario) !== number(csv['Consumo Diário'])) {
      issues.push(`Divergência em item: ${csv.Item}`);
    }
  }
  for (const line of suppliers) {
    const csv = values(line, supplierHeader);
    const db = supplierMap.get(key(csv.Nome));
    if (!db) { issues.push(`Fornecedor ausente: ${csv.Nome}`); continue; }
    if (db.ativo !== (csv.Ativo === 'Sim') || (db.telefone || '') !== csv.Telefone ||
      (db.whatsapp || '') !== csv.WhatsApp || (db.email || '') !== csv.Email ||
      String(db.avaliacao || '') !== csv['Avaliação'] || (db.observacoes || '') !== csv['Observações']) {
      issues.push(`Divergência em fornecedor: ${csv.Nome}`);
    }
    for (const item of csv['Itens Associados'].split(',').map((name) => name.trim()).filter(Boolean)) {
      if (!linkSet.has(`${key(csv.Nome)}|${key(item)}`)) issues.push(`Vínculo ausente: ${csv.Nome} / ${item}`);
    }
  }
  const original = itemMap.get(key('Raspberry Pi 4 Model B'));
  if (!original || number(original.fisico) !== 6) issues.push('Item anterior foi alterado');
  if (counts.rows[0].reservations !== 0 || counts.rows[0].purchase_orders !== 0) issues.push('Reservas ou pedidos inesperados');
  console.log(JSON.stringify({ csv: { items: stock.length, suppliers: suppliers.length }, database: counts.rows[0], issues }, null, 2));
  if (issues.length) process.exitCode = 1;
} finally {
  await pool.end();
}
