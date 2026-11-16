import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import pg from 'pg';

const stockPath = 'posicao_estoque_2026-10-14.csv';
const supplierPath = 'fornecedores_2026-10-14.csv';
const reference = 'Estoque inicial importado de posicao_estoque_2026-10-14.csv';
const apply = process.argv.includes('--apply');

function parseCsv(path) {
  const bytes = readFileSync(path);
  const source = bytes.toString('utf8').replace(/^\uFEFF/, '');
  const rows = [];
  let row = [], cell = '', quoted = false;
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (char === '"') {
      if (quoted && source[i + 1] === '"') { cell += '"'; i++; }
      else quoted = !quoted;
    } else if (char === ';' && !quoted) {
      row.push(cell); cell = '';
    } else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && source[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some((value) => value !== '')) rows.push(row);
      row = [];
    } else {
      cell += char;
    }
  }
  if (quoted) throw new Error(`Aspas incompletas em ${path}`);
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const [header, ...data] = rows;
  if (!header || data.some((values) => values.length !== header.length)) throw new Error(`CSV irregular: ${path}`);
  return { rows: data.map((values) => Object.fromEntries(header.map((key, index) => [key, values[index].trim()]))), sha256: createHash('sha256').update(bytes).digest('hex') };
}

function decimal(value, label) {
  const normalized = value.replace(/\./g, '').replace(',', '.');
  const number = Number(normalized);
  if (!value || !Number.isFinite(number) || number < 0) throw new Error(`Número inválido em ${label}: ${value}`);
  return number;
}

const key = (value) => value.trim().toLocaleLowerCase('pt-BR');
const stockFile = parseCsv(stockPath);
const supplierFile = parseCsv(supplierPath);
const requiredStock = ['Item', 'Tipo', 'Unidade', 'Estoque Físico', 'Estoque Mínimo', 'Consumo Diário'];
const requiredSupplier = ['Nome', 'Ativo', 'Telefone', 'WhatsApp', 'Email', 'Avaliação', 'Observações', 'Itens Associados'];
for (const column of requiredStock) if (!(column in stockFile.rows[0])) throw new Error(`Coluna ausente: ${column}`);
for (const column of requiredSupplier) if (!(column in supplierFile.rows[0])) throw new Error(`Coluna ausente: ${column}`);

const stockRows = stockFile.rows.map((row) => {
  const tipo = { 'Matéria-prima': 'MP', Submontagem: 'SUB', 'Produto final': 'PF' }[row.Tipo];
  if (!row.Item || !row.Unidade || !tipo) throw new Error(`Item incompleto: ${row.Item}`);
  return { nome: row.Item, tipo, unidade: row.Unidade, fisico: decimal(row['Estoque Físico'], row.Item),
    estoque_minimo: decimal(row['Estoque Mínimo'], row.Item), consumo_diario: decimal(row['Consumo Diário'], row.Item) };
});
const supplierRows = supplierFile.rows.map((row) => {
  if (!row.Nome || !['Sim', 'Não'].includes(row.Ativo)) throw new Error(`Fornecedor incompleto: ${row.Nome}`);
  const avaliacao = row['Avaliação'] ? Number(row['Avaliação']) : null;
  if (avaliacao !== null && (!Number.isInteger(avaliacao) || avaliacao < 1 || avaliacao > 5)) throw new Error(`Avaliação inválida: ${row.Nome}`);
  return { nome: row.Nome, ativo: row.Ativo === 'Sim', telefone: row.Telefone || null,
    whatsapp: row.WhatsApp || null, email: row.Email || null, avaliacao,
    observacoes: row['Observações'] || null,
    itens: row['Itens Associados'] ? row['Itens Associados'].split(',').map((name) => name.trim()).filter(Boolean) : [] };
});
for (const [label, rows] of [['item', stockRows], ['fornecedor', supplierRows]]) {
  const names = rows.map((row) => key(row.nome));
  if (new Set(names).size !== names.length) throw new Error(`Nomes duplicados no CSV de ${label}`);
}
const sourceItems = new Set(stockRows.map((row) => key(row.nome)));
for (const supplier of supplierRows) for (const name of supplier.itens) {
  if (!sourceItems.has(key(name))) throw new Error(`Vínculo de fornecedor sem item correspondente: ${name}`);
}

const pool = new pg.Pool({ ...(process.env.DATABASE_URL ? { connectionString: process.env.DATABASE_URL } : {}), max: 1 });
const db = await pool.connect();
const stats = { itensCriados: 0, itensExistentes: 0, fornecedoresCriados: 0, fornecedoresExistentes: 0,
  vinculosCriados: 0, vinculosExistentes: 0, movimentosCriados: 0, movimentosExistentes: 0,
  unidadesFisicasImportadas: 0, conflitos: [] };
try {
  await db.query('BEGIN');
  await db.query('LOCK TABLE public.items, public.fornecedores, public.item_fornecedores, public.movements IN SHARE ROW EXCLUSIVE MODE');
  const existingItems = await db.query('SELECT id,nome,tipo,unidade FROM public.items WHERE deleted_at IS NULL');
  const itemsByName = new Map(existingItems.rows.map((item) => [key(item.nome), item]));
  const itemIds = new Map();
  let importCenter = null;
  for (const row of stockRows) {
    let item = itemsByName.get(key(row.nome));
    if (item) {
      if (item.tipo !== row.tipo || key(item.unidade) !== key(row.unidade)) {
        throw new Error(`Item existente com tipo/unidade diferente: ${row.nome}`);
      }
      stats.itensExistentes++;
    } else {
      const inserted = await db.query(
        'INSERT INTO public.items (nome,tipo,unidade,estoque_minimo,consumo_diario) VALUES ($1,$2,$3,$4,$5) RETURNING id,nome,tipo,unidade',
        [row.nome, row.tipo, row.unidade, row.estoque_minimo, row.consumo_diario],
      );
      item = inserted.rows[0];
      itemsByName.set(key(row.nome), item);
      stats.itensCriados++;
    }
    itemIds.set(key(row.nome), item.id);
    if (row.fisico <= 0) continue;
    const prior = await db.query('SELECT id FROM public.movements WHERE item_id=$1 AND referencia=$2', [item.id, reference]);
    if (prior.rowCount) { stats.movimentosExistentes++; continue; }
    const current = await db.query('SELECT COALESCE(SUM(quantidade),0)::numeric AS fisico FROM public.movements WHERE item_id=$1', [item.id]);
    if (Number(current.rows[0].fisico) !== 0) {
      stats.conflitos.push({ item: row.nome, existente: current.rows[0].fisico, csv: row.fisico });
      continue;
    }
    if (!importCenter) {
      const center = await db.query("SELECT id FROM public.centros_custo WHERE tipo='SETOR' AND lower(btrim(nome))=lower($1)", ['Sem atribuição (importação CSV)']);
      if (center.rowCount) importCenter = center.rows[0].id;
      else {
        const created = await db.query("INSERT INTO public.centros_custo (nome,tipo,descricao,ativo) VALUES ($1,'SETOR',$2,false) RETURNING id",
          ['Sem atribuição (importação CSV)', 'Saldo inicial sem setor ou pessoa identificados no arquivo de origem']);
        importCenter = created.rows[0].id;
      }
    }
    await db.query("INSERT INTO public.movements (item_id,tipo_movimentacao,quantidade,referencia,centro_custo_id,usuario_nome) VALUES ($1,'INICIAL',$2,$3,$4,$5)",
      [item.id, row.fisico, reference, importCenter, 'Não informado (importação CSV)']);
    stats.movimentosCriados++;
    stats.unidadesFisicasImportadas += row.fisico;
  }

  const existingSuppliers = await db.query('SELECT id,nome FROM public.fornecedores');
  const suppliersByName = new Map(existingSuppliers.rows.map((supplier) => [key(supplier.nome), supplier]));
  for (const row of supplierRows) {
    let supplier = suppliersByName.get(key(row.nome));
    if (supplier) stats.fornecedoresExistentes++;
    else {
      const inserted = await db.query('INSERT INTO public.fornecedores (nome,ativo,telefone,whatsapp,email,avaliacao,observacoes) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id,nome',
        [row.nome, row.ativo, row.telefone, row.whatsapp, row.email, row.avaliacao, row.observacoes]);
      supplier = inserted.rows[0];
      stats.fornecedoresCriados++;
    }
    for (const name of row.itens) {
      const itemId = itemIds.get(key(name));
      const link = await db.query('INSERT INTO public.item_fornecedores (item_id,fornecedor_id,principal) VALUES ($1,$2,false) ON CONFLICT (item_id,fornecedor_id) DO NOTHING RETURNING id',
        [itemId, supplier.id]);
      if (link.rowCount) stats.vinculosCriados++;
      else stats.vinculosExistentes++;
    }
  }
  if (stats.conflitos.length) throw new Error(`Saldos existentes diferentes do CSV: ${JSON.stringify(stats.conflitos)}`);
  if (apply) await db.query('COMMIT');
  else await db.query('ROLLBACK');
  console.log(JSON.stringify({ mode: apply ? 'applied' : 'dry-run', sources: {
    stock: { rows: stockRows.length, sha256: stockFile.sha256 },
    suppliers: { rows: supplierRows.length, sha256: supplierFile.sha256 } }, stats }, null, 2));
} catch (error) {
  await db.query('ROLLBACK');
  throw error;
} finally {
  db.release();
  await pool.end();
}
