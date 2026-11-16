import { randomUUID } from 'node:crypto';

const identifier = /^[a-z_][a-z0-9_]*$/;
const quote = (name) => {
  if (!identifier.test(name)) throw new Error(`Identificador inválido: ${name}`);
  return `"${name}"`;
};

function splitSelection(input) {
  const pieces = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < input.length; index++) {
    if (input[index] === '(') depth++;
    else if (input[index] === ')') depth--;
    else if (input[index] === ',' && depth === 0) {
      pieces.push(input.slice(start, index).trim());
      start = index + 1;
    }
    if (depth < 0) throw new Error('Seleção inválida');
  }
  if (depth !== 0) throw new Error('Seleção inválida');
  pieces.push(input.slice(start).trim());
  return pieces.filter(Boolean);
}

function parseSelection(input = '*') {
  const fields = [];
  const relations = [];
  for (const piece of splitSelection(input)) {
    if (piece === '*') { fields.push('*'); continue; }
    const match = /^(?:(\w+):)?(\w+)(?:!(\w+))?\((.*)\)$/.exec(piece);
    if (match) {
      relations.push({ alias: match[1] || match[2], table: match[2], constraint: match[3], selection: parseSelection(match[4]) });
    } else if (identifier.test(piece)) fields.push(piece);
    else throw new Error(`Seleção inválida: ${piece}`);
  }
  return { fields, relations };
}

export async function loadSchema(pool) {
  const columns = await pool.query(`SELECT table_name, column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name NOT IN ('app_migrations')`);
  const tables = new Map();
  for (const row of columns.rows) {
    if (!tables.has(row.table_name)) tables.set(row.table_name, new Set());
    tables.get(row.table_name).add(row.column_name);
  }
  const constraints = await pool.query(`SELECT con.conname AS name, src.relname AS source_table,
    dst.relname AS target_table, source_attr.attname AS source_column, target_attr.attname AS target_column
    FROM pg_constraint con
    JOIN pg_class src ON src.oid = con.conrelid
    JOIN pg_class dst ON dst.oid = con.confrelid
    JOIN pg_namespace ns ON ns.oid = src.relnamespace
    JOIN pg_attribute source_attr ON source_attr.attrelid = con.conrelid AND source_attr.attnum = con.conkey[1]
    JOIN pg_attribute target_attr ON target_attr.attrelid = con.confrelid AND target_attr.attnum = con.confkey[1]
    WHERE con.contype = 'f' AND ns.nspname = 'public' AND array_length(con.conkey, 1) = 1`);
  return { tables, relations: constraints.rows };
}

function assertTable(schema, table) {
  if (!schema.tables.has(table)) throw new Error(`Tabela desconhecida: ${table}`);
}
function assertColumn(schema, table, column) {
  if (!schema.tables.get(table)?.has(column)) throw new Error(`Coluna desconhecida: ${table}.${column}`);
}

function makeWhere(schema, table, filters = [], parameters) {
  if (!Array.isArray(filters)) throw new Error('Filtros inválidos');
  const clauses = [];
  for (const filter of filters) {
    assertColumn(schema, table, filter.column);
    const col = quote(filter.column);
    const op = filter.op;
    if (op === 'is') {
      if (filter.value !== null) throw new Error('Filtro is aceita apenas null');
      clauses.push(`${col} IS NULL`);
    } else if (op === 'in') {
      if (!Array.isArray(filter.value)) throw new Error('Filtro in inválido');
      const placeholders = filter.value.map((value) => { parameters.push(value); return `$${parameters.length}`; });
      clauses.push(placeholders.length ? `${col} IN (${placeholders.join(', ')})` : 'FALSE');
    } else if (op === 'not.in') {
      const list = typeof filter.value === 'string'
        ? filter.value.replace(/^\(|\)$/g, '').split(',').map((x) => x.trim())
        : filter.value;
      if (!Array.isArray(list)) throw new Error('Filtro not.in inválido');
      const placeholders = list.map((value) => { parameters.push(value); return `$${parameters.length}`; });
      clauses.push(placeholders.length ? `${col} NOT IN (${placeholders.join(', ')})` : 'TRUE');
    } else {
      const operators = { eq: '=', neq: '<>', gt: '>', gte: '>=', lt: '<', lte: '<=' };
      if (!operators[op]) throw new Error(`Operador desconhecido: ${op}`);
      parameters.push(filter.value);
      clauses.push(`${col} ${operators[op]} $${parameters.length}`);
    }
  }
  return clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';
}

function project(row, selection) {
  if (selection.fields.includes('*')) return { ...row };
  return Object.fromEntries([...selection.fields, ...selection.relations.map((relation) => relation.alias)]
    .map((field) => [field, row[field]]));
}

async function hydrate(client, schema, table, rows, selection) {
  for (const relation of selection.relations) {
    assertTable(schema, relation.table);
    const matches = schema.relations.filter((fk) => fk.source_table === table && fk.target_table === relation.table &&
      (!relation.constraint || fk.name === relation.constraint));
    if (matches.length !== 1) throw new Error(`Relação ambígua: ${table} → ${relation.table}`);
    const fk = matches[0];
    const ids = [...new Set(rows.map((row) => row[fk.source_column]).filter((value) => value != null))];
    const related = ids.length
      ? (await client.query(`SELECT * FROM ${quote(relation.table)} WHERE ${quote(fk.target_column)} IN (${ids.map((_, index) => `$${index + 1}`).join(', ')})`, ids)).rows
      : [];
    await hydrate(client, schema, relation.table, related, relation.selection);
    const byId = new Map(related.map((row) => [row[fk.target_column], project(row, relation.selection)]));
    for (const row of rows) row[relation.alias] = byId.get(row[fk.source_column]) || null;
  }
  return rows;
}

function validateValues(schema, table, input) {
  const rows = Array.isArray(input) ? input : [input];
  if (!rows.length || rows.some((row) => !row || typeof row !== 'object' || Array.isArray(row))) {
    throw new Error('Dados inválidos');
  }
  for (const row of rows) for (const column of Object.keys(row)) assertColumn(schema, table, column);
  return rows;
}

async function resolveStockAttribution(client, centerId, operator) {
  if (centerId != null && typeof centerId !== 'string') throw new Error('Setor inválido.');
  const selectedCenter = centerId?.trim();
  let resolvedCenterId = selectedCenter;
  if (selectedCenter) {
    const center = await client.query("SELECT id FROM public.centros_custo WHERE id = $1 AND ativo AND tipo = 'SETOR'", [selectedCenter]);
    if (!center.rowCount) throw new Error('Selecione um setor ativo.');
  } else {
    const name = 'Sem atribuição (cadastro)';
    const existing = await client.query("SELECT id FROM public.centros_custo WHERE tipo = 'SETOR' AND lower(btrim(nome)) = lower($1)", [name]);
    if (existing.rowCount) resolvedCenterId = existing.rows[0].id;
    else {
      const inserted = await client.query(
        "INSERT INTO public.centros_custo (nome, tipo, descricao, ativo) VALUES ($1, 'SETOR', $2, false) ON CONFLICT DO NOTHING RETURNING id",
        [name, 'Movimentações de cadastro sem setor informado'],
      );
      resolvedCenterId = inserted.rows[0]?.id ?? (await client.query(
        "SELECT id FROM public.centros_custo WHERE tipo = 'SETOR' AND lower(btrim(nome)) = lower($1)", [name],
      )).rows[0]?.id;
    }
    if (!resolvedCenterId) throw new Error('Não foi possível registrar a movimentação sem setor.');
  }
  return {
    centerId: resolvedCenterId,
    operator: typeof operator === 'string' && operator.trim() ? operator.trim() : 'Não informado (cadastro)',
  };
}

function kitComponentTotals(config) {
  const components = config?.componentes;
  if (!Array.isArray(components) || !components.length || components.length > 100) {
    throw new Error('O kit precisa ter componentes.');
  }
  const totals = new Map();
  for (const row of components) {
    const qty = Number(row?.quantidade);
    if (!/^[a-f0-9-]{36}$/i.test(String(row?.item_id || '')) || !Number.isFinite(qty) || qty <= 0 || qty > 100000) {
      throw new Error('Componente ou quantidade inválida no kit.');
    }
    totals.set(row.item_id, (totals.get(row.item_id) || 0) + qty);
  }
  return totals;
}

async function sharedQueueAvailability(client) {
  const [orders, orderItems, bom, substitutions, kits, items, movements, externalReservations] = await Promise.all([
    client.query("SELECT id, ordem, status FROM public.production_orders WHERE status IN ('PLANEJADA', 'EM_PRODUCAO')"),
    client.query('SELECT production_order_id, item_id, quantidade FROM public.production_order_items'),
    client.query('SELECT item_pai_id, item_componente_id, quantidade FROM public.bom_items'),
    client.query('SELECT production_order_id, item_original_id, item_substituto_id FROM public.production_order_substitutions'),
    client.query("SELECT id, ordem, status, configuracao FROM public.kit_plans WHERE status IN ('NA_FILA', 'EM_PRODUCAO')"),
    client.query('SELECT id, nome, unidade FROM public.items'),
    client.query('SELECT item_id, SUM(quantidade) AS quantidade FROM public.movements GROUP BY item_id'),
    client.query("SELECT item_id, SUM(quantidade) AS quantidade FROM public.reservations WHERE referencia IS NULL OR (referencia NOT LIKE 'OP:%' AND referencia NOT LIKE 'KIT:%') GROUP BY item_id"),
  ]);
  const names = new Map(items.rows.map(item => [item.id, item]));
  const physical = new Map(movements.rows.map(row => [row.item_id, roundQty(row.quantidade)]));
  for (const row of externalReservations.rows) physical.set(row.item_id, roundQty((physical.get(row.item_id) || 0) - Number(row.quantidade)));
  const bomByParent = new Map();
  for (const row of bom.rows) {
    if (!bomByParent.has(row.item_pai_id)) bomByParent.set(row.item_pai_id, []);
    bomByParent.get(row.item_pai_id).push(row);
  }
  const subsByOrder = new Map();
  for (const row of substitutions.rows) {
    if (!subsByOrder.has(row.production_order_id)) subsByOrder.set(row.production_order_id, new Map());
    subsByOrder.get(row.production_order_id).set(row.item_original_id, row.item_substituto_id);
  }
  const needs = new Map();
  for (const order of orders.rows) needs.set(order.id, new Map());
  for (const row of orderItems.rows) {
    const target = needs.get(row.production_order_id);
    if (!target) continue;
    for (const component of bomByParent.get(row.item_id) || []) {
      const itemId = subsByOrder.get(row.production_order_id)?.get(component.item_componente_id) || component.item_componente_id;
      target.set(itemId, roundQty((target.get(itemId) || 0) + Number(component.quantidade) * Number(row.quantidade)));
    }
  }
  for (const kit of kits.rows) needs.set(kit.id, kitComponentTotals(kit.configuracao));
  const entries = [
    ...orders.rows.map(row => ({ kind: 'OP', ...row })),
    ...kits.rows.map(({ configuracao, ...row }) => ({ kind: 'KIT', ...row })),
  ].sort((a, b) => Number(a.ordem) - Number(b.ordem) || a.id.localeCompare(b.id));
  const remaining = new Map(physical);
  return entries.map((entry, index) => {
    const materials = [...(needs.get(entry.id) || [])].map(([itemId, needed]) => {
      const availableBefore = remaining.get(itemId) || 0;
      const balanceAfter = roundQty(availableBefore - needed);
      remaining.set(itemId, balanceAfter);
      const item = names.get(itemId);
      return { itemId, nome: item?.nome || 'Item não encontrado', unidade: item?.unidade || 'un',
        needed, availableBefore, balanceAfter, missing: Math.max(0, -balanceAfter) };
    });
    return { kind: entry.kind, id: entry.id, status: entry.status, ordem: Number(entry.ordem),
      position: index + 1, materials, canStart: materials.every(row => row.missing === 0) };
  });
}

// Quantidades são somadas em JS; arredondar evita resíduos como 0.30000000000000004.
const roundQty = (value) => Math.round(Number(value) * 1e6) / 1e6;

async function checkSharedQueueStock(client, kind, id) {
  await client.query('LOCK TABLE public.movements IN SHARE ROW EXCLUSIVE MODE');
  await client.query('LOCK TABLE public.reservations IN SHARE ROW EXCLUSIVE MODE');
  const row = (await sharedQueueAvailability(client)).find(entry => entry.kind === kind && entry.id === id);
  if (!row) throw new Error('Montagem não encontrada na fila. Atualize a página.');
  if (!row.materials.length) throw new Error('Esta montagem não tem componentes na estrutura. Revise a BOM ou o kit.');
  const missing = row.materials.find(material => material.missing > 0);
  if (missing) throw new Error(`Estoque insuficiente de ${missing.nome}: precisa ${missing.needed}, faltam ${missing.missing} considerando a fila única.`);
  return row;
}

export async function executeQuery(pool, schema, input, user = null) {
  if (input.action === 'rpc') {
    if (input.name === 'start_production_order' || input.name === 'complete_production_order') {
      const args = input.args || {};
      const operator = String(args._responsavel || '').trim();
      const starting = input.name === 'start_production_order';
      if (starting && (!operator || operator.length > 160)) throw new Error('Informe o montador.');
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('LOCK TABLE public.production_orders, public.kit_plans IN SHARE ROW EXCLUSIVE MODE');
        const orders = await client.query('SELECT * FROM public.production_orders WHERE id = $1 FOR UPDATE', [args._id]);
        const order = orders.rows[0];
        if (!order || order.status !== (starting ? 'PLANEJADA' : 'EM_PRODUCAO')) {
          throw new Error(starting ? 'A ordem precisa estar na fila para iniciar.' : 'A ordem precisa estar em produção para concluir.');
        }
        if (!order.centro_custo_id) throw new Error('Informe o centro de custo da ordem.');
        if (!starting && !order.montador_nome?.trim()) throw new Error('Informe o montador antes de concluir.');
        const availability = await checkSharedQueueStock(client, 'OP', order.id);
        if (starting) {
          const updated = await client.query(`UPDATE public.production_orders
            SET status = 'EM_PRODUCAO', started_at = now(), montagem_started_at = now(),
                montador_nome = $2, modo_execucao = $3
            WHERE id = $1 RETURNING *`, [order.id, operator, args._modo_execucao || null]);
          await client.query('COMMIT');
          return { data: updated.rows[0], count: null };
        }
        const completionId = randomUUID();
        const substitutions = await client.query('SELECT item_substituto_id FROM public.production_order_substitutions WHERE production_order_id = $1', [order.id]);
        const replacementIds = new Set(substitutions.rows.map(row => row.item_substituto_id));
        for (const material of availability.materials) {
          await client.query(`INSERT INTO public.movements
            (item_id, tipo_movimentacao, quantidade, referencia, centro_custo_id, usuario_nome, production_order_id, completion_id)
            VALUES ($1, 'CONSUMO', $2, $3, $4, $5, $6, $7)`, [material.itemId, -material.needed,
            `Produção ${order.id.slice(0, 8)}${replacementIds.has(material.itemId) ? ' (substituto)' : ''}`,
            order.centro_custo_id, user?.display_name || order.montador_nome, order.id, completionId]);
        }
        if (order.destino === 'ESTOQUE') {
          const products = await client.query('SELECT item_id, quantidade FROM public.production_order_items WHERE production_order_id = $1', [order.id]);
          for (const product of products.rows) {
            await client.query(`INSERT INTO public.movements
              (item_id, tipo_movimentacao, quantidade, referencia, centro_custo_id, usuario_nome, production_order_id, completion_id)
              VALUES ($1, 'PRODUCAO', $2, $3, $4, $5, $6, $7)`, [product.item_id, product.quantidade,
              `Ordem de produção ${order.id.slice(0, 8)}`, order.centro_custo_id, user?.display_name || order.montador_nome, order.id, completionId]);
          }
        }
        const updated = await client.query(`UPDATE public.production_orders
          SET status = 'CONCLUIDA', completed_at = now(), montagem_completed_at = now(), current_completion_id = $2,
              tempo_total_seg = CASE WHEN started_at IS NULL THEN NULL ELSE GREATEST(0, ROUND(EXTRACT(EPOCH FROM (now() - started_at)))) END,
              tempo_montagem_seg = CASE WHEN montagem_started_at IS NULL THEN NULL ELSE GREATEST(0, ROUND(EXTRACT(EPOCH FROM (now() - montagem_started_at)))) END
          WHERE id = $1 RETURNING *`, [order.id, completionId]);
        await client.query('COMMIT');
        return { data: updated.rows[0], count: null };
      } catch (error) { await client.query('ROLLBACK'); throw error; }
      finally { client.release(); }
    }
    if (input.name === 'revert_production_completion') {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('LOCK TABLE public.production_orders, public.kit_plans IN SHARE ROW EXCLUSIVE MODE');
        await client.query('LOCK TABLE public.movements IN SHARE ROW EXCLUSIVE MODE');
        await client.query('LOCK TABLE public.reservations IN SHARE ROW EXCLUSIVE MODE');
        const orders = await client.query('SELECT * FROM public.production_orders WHERE id = $1 FOR UPDATE', [input.args?._id]);
        const order = orders.rows[0];
        if (!order || order.status !== 'CONCLUIDA') throw new Error('A ordem precisa estar concluída para reverter.');
        if (order.shipping_date || order.received_date || order.envio_started_at || order.envio_completed_at) {
          throw new Error('A ordem já entrou no envio. Revise o envio antes de reverter a montagem.');
        }
        if (!order.current_completion_id) {
          throw new Error('Esta conclusão é anterior ao rastreio de movimentações. Revise-a manualmente para evitar baixar o estoque duas vezes.');
        }
        const movements = await client.query(`SELECT item_id, quantidade, tipo_movimentacao
          FROM public.movements WHERE completion_id = $1 AND production_order_id = $2
            AND tipo_movimentacao IN ('CONSUMO', 'PRODUCAO')`, [order.current_completion_id, order.id]);
        if (!movements.rowCount) throw new Error('Movimentações da conclusão não encontradas.');
        const products = new Map();
        for (const movement of movements.rows) if (movement.tipo_movimentacao === 'PRODUCAO') {
          products.set(movement.item_id, (products.get(movement.item_id) || 0) + Number(movement.quantidade));
        }
        for (const [itemId, quantity] of products) {
          const balance = await client.query(`SELECT
            (SELECT COALESCE(SUM(quantidade), 0) FROM public.movements WHERE item_id = $1)
            - (SELECT COALESCE(SUM(quantidade), 0) FROM public.reservations WHERE item_id = $1) AS disponivel`, [itemId]);
          if (Number(balance.rows[0].disponivel) < quantity) {
            throw new Error('O produto final já foi usado ou reservado. Não é possível desfazer sua entrada no estoque.');
          }
        }
        for (const movement of movements.rows) {
          await client.query(`INSERT INTO public.movements
            (item_id, tipo_movimentacao, quantidade, referencia, centro_custo_id, usuario_nome, production_order_id, completion_id)
            VALUES ($1, 'AJUSTE', $2, $3, $4, $5, $6, $7)`, [movement.item_id, -Number(movement.quantidade),
            `Reversão produção ${order.id.slice(0, 8)}`, order.centro_custo_id, user?.display_name || order.montador_nome,
            order.id, order.current_completion_id]);
        }
        const updated = await client.query(`UPDATE public.production_orders
          SET status = 'EM_PRODUCAO', completed_at = NULL, montagem_completed_at = NULL,
              tempo_total_seg = NULL, tempo_montagem_seg = NULL, current_completion_id = NULL,
              envio_started_at = NULL, envio_completed_at = NULL
          WHERE id = $1 RETURNING *`, [order.id]);
        await client.query('COMMIT');
        return { data: updated.rows[0], count: null };
      } catch (error) { await client.query('ROLLBACK'); throw error; }
      finally { client.release(); }
    }
    if (input.name === 'work_queue_availability') {
      return { data: await sharedQueueAvailability(pool), count: null };
    }
    if (input.name === 'reorder_work_queue') {
      const entries = input.args?._entries;
      if (!Array.isArray(entries) || entries.length > 1000 || entries.some(entry =>
        !['OP', 'KIT'].includes(entry?.kind) || !/^[a-f0-9-]{36}$/i.test(String(entry?.id || '')))) {
        throw new Error('Ordem da fila inválida.');
      }
      const keys = entries.map(entry => `${entry.kind}:${entry.id}`);
      if (new Set(keys).size !== keys.length) throw new Error('Há montagens repetidas na fila.');
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('LOCK TABLE public.production_orders, public.kit_plans IN SHARE ROW EXCLUSIVE MODE');
        const active = await client.query(`SELECT 'OP:' || id::text AS key FROM public.production_orders WHERE status IN ('PLANEJADA', 'EM_PRODUCAO')
          UNION ALL SELECT 'KIT:' || id::text AS key FROM public.kit_plans WHERE status IN ('NA_FILA', 'EM_PRODUCAO')`);
        if (active.rowCount !== keys.length || active.rows.some(row => !keys.includes(row.key))) {
          throw new Error('A fila mudou. Atualize a página antes de reordenar.');
        }
        for (const [index, entry] of entries.entries()) {
          await client.query(`UPDATE public.${entry.kind === 'OP' ? 'production_orders' : 'kit_plans'} SET ordem = $2 WHERE id = $1`, [entry.id, index + 1]);
        }
        await client.query('COMMIT');
        return { data: entries.map((entry, index) => ({ ...entry, ordem: index + 1 })), count: null };
      } catch (error) { await client.query('ROLLBACK'); throw error; }
      finally { client.release(); }
    }
    if (input.name === 'save_kit_template') {
      const args = input.args || {};
      const name = String(args._nome || '').trim();
      const config = args._configuracao;
      if (!name || name.length > 160 || !config || typeof config !== 'object' || Array.isArray(config)) {
        throw new Error('Informe um nome e uma configuração válidos para o kit padrão.');
      }
      const result = args._id
        ? await pool.query('UPDATE public.kit_templates SET nome = $2, configuracao = $3 WHERE id = $1 RETURNING *',
          [args._id, name, JSON.stringify(config)])
        : await pool.query('INSERT INTO public.kit_templates (nome, configuracao) VALUES ($1, $2) RETURNING *',
          [name, JSON.stringify(config)]);
      if (!result.rowCount) throw new Error('Kit padrão não encontrado.');
      return { data: result.rows[0], count: null };
    }
    if (input.name === 'delete_kit_template') {
      const result = await pool.query('DELETE FROM public.kit_templates WHERE id = $1 RETURNING id', [input.args?._id]);
      if (!result.rowCount) throw new Error('Kit padrão não encontrado.');
      return { data: result.rows[0], count: null };
    }
    if (input.name === 'save_kit_plan') {
      const args = input.args || {};
      const name = String(args._nome || '').trim();
      const config = args._configuracao;
      if (!name || name.length > 160 || !config || typeof config !== 'object' || Array.isArray(config)) {
        throw new Error('Informe um nome e uma configuração válidos para o kit.');
      }
      const client = await pool.connect();
      try {
        if (args._id) {
          const result = await client.query(
            `UPDATE public.kit_plans SET nome = $2, configuracao = $3
             WHERE id = $1 AND status = 'RASCUNHO' RETURNING *`,
            [args._id, name, JSON.stringify(config)],
          );
          if (!result.rowCount) throw new Error('Rascunho não encontrado ou já concluído.');
          return { data: result.rows[0], count: null };
        }
        const result = await client.query(
          'INSERT INTO public.kit_plans (nome, configuracao) VALUES ($1, $2) RETURNING *',
          [name, JSON.stringify(config)],
        );
        return { data: result.rows[0], count: null };
      } finally { client.release(); }
    }
    if (input.name === 'delete_kit_plan') {
      const result = await pool.query("DELETE FROM public.kit_plans WHERE id = $1 AND status = 'RASCUNHO' RETURNING id", [input.args?._id]);
      if (!result.rowCount) throw new Error('Só é possível excluir rascunhos.');
      return { data: result.rows[0], count: null };
    }
    if (input.name === 'queue_kit_plan') {
      const args = input.args || {};
      const destination = String(args._destino || '').trim();
      if (!destination || destination.length > 160 || !args._centro_custo_id) {
        throw new Error('Informe a arena/cliente e o setor.');
      }
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const plans = await client.query('SELECT * FROM public.kit_plans WHERE id = $1 FOR UPDATE', [args._id]);
        const plan = plans.rows[0];
        if (!plan || plan.status !== 'RASCUNHO') throw new Error('Somente rascunhos podem entrar na fila.');
        const center = await client.query("SELECT id FROM public.centros_custo WHERE id = $1 AND tipo = 'SETOR' AND ativo", [args._centro_custo_id]);
        if (!center.rowCount) throw new Error('Selecione um setor ativo.');
        for (const itemId of kitComponentTotals(plan.configuracao).keys()) {
          const item = await client.query('SELECT 1 FROM public.items WHERE id = $1 AND ativo AND deleted_at IS NULL', [itemId]);
          if (!item.rowCount) throw new Error('Um componente do kit está inativo ou não existe.');
        }
        const result = await client.query(
          `UPDATE public.kit_plans SET status = 'NA_FILA', destino = $2, centro_custo_id = $3,
           enfileirado_em = now(), ordem = nextval('public.work_queue_order_seq') WHERE id = $1 RETURNING *`,
          [plan.id, destination, args._centro_custo_id],
        );
        await client.query('COMMIT');
        return { data: result.rows[0], count: null };
      } catch (error) { await client.query('ROLLBACK'); throw error; }
      finally { client.release(); }
    }
    if (input.name === 'start_kit_plan') {
      const args = input.args || {};
      const operator = String(args._responsavel || '').trim();
      if (!operator || operator.length > 160) throw new Error('Informe o responsável pela montagem.');
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('LOCK TABLE public.production_orders, public.kit_plans IN SHARE ROW EXCLUSIVE MODE');
        const plans = await client.query('SELECT * FROM public.kit_plans WHERE id = $1 FOR UPDATE', [args._id]);
        const plan = plans.rows[0];
        if (!plan || plan.status !== 'NA_FILA') throw new Error('O kit precisa estar na fila para iniciar a montagem.');
        await checkSharedQueueStock(client, 'KIT', plan.id);
        const result = await client.query(
          `UPDATE public.kit_plans SET status = 'EM_PRODUCAO', responsavel = $2, iniciado_em = now()
           WHERE id = $1 RETURNING *`,
          [plan.id, operator],
        );
        await client.query('COMMIT');
        return { data: result.rows[0], count: null };
      } catch (error) { await client.query('ROLLBACK'); throw error; }
      finally { client.release(); }
    }
    if (input.name === 'return_kit_to_draft' || input.name === 'return_kit_to_queue') {
      const from = input.name === 'return_kit_to_draft' ? 'NA_FILA' : 'EM_PRODUCAO';
      const to = input.name === 'return_kit_to_draft' ? 'RASCUNHO' : 'NA_FILA';
      const result = await pool.query(
        `UPDATE public.kit_plans SET status = $2,
         iniciado_em = CASE WHEN $2 = 'NA_FILA' THEN NULL ELSE iniciado_em END,
         responsavel = CASE WHEN $2 = 'NA_FILA' THEN NULL ELSE responsavel END
         WHERE id = $1 AND status = $3 RETURNING *`,
        [input.args?._id, to, from],
      );
      if (!result.rowCount) throw new Error('O kit mudou de status. Atualize a página.');
      return { data: result.rows[0], count: null };
    }
    if (input.name === 'complete_kit_plan') {
      const args = input.args || {};
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('LOCK TABLE public.production_orders, public.kit_plans IN SHARE ROW EXCLUSIVE MODE');
        const plans = await client.query('SELECT * FROM public.kit_plans WHERE id = $1 FOR UPDATE', [args._id]);
        const plan = plans.rows[0];
        if (!plan || plan.status !== 'EM_PRODUCAO') throw new Error('O kit precisa estar em produção para concluir.');
        if (!plan.destino || !plan.centro_custo_id || !plan.responsavel) throw new Error('Faltam dados da montagem.');
        const quantities = kitComponentTotals(plan.configuracao);
        await checkSharedQueueStock(client, 'KIT', plan.id);
        for (const [itemId, qty] of quantities) {
          await client.query(
            `INSERT INTO public.movements (item_id, tipo_movimentacao, quantidade, referencia, centro_custo_id, usuario_nome)
             VALUES ($1, 'CONSUMO', $2, $3, $4, $5)`,
            [itemId, -qty, `Kit ${plan.id.slice(0, 8)} · ${plan.destino}`, plan.centro_custo_id, user?.display_name || plan.responsavel],
          );
        }
        const result = await client.query(
          `UPDATE public.kit_plans SET status = 'CONCLUIDO', concluido_em = now()
           WHERE id = $1 RETURNING *`,
          [plan.id],
        );
        await client.query('COMMIT');
        return { data: result.rows[0], count: null };
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally { client.release(); }
    }
    if (input.name === 'receive_purchase_order') {
      // Recebimento atômico: entrada no estoque, registro do recebimento e saldo do pedido
      // numa única transação, com o pedido travado para evitar recebimentos simultâneos.
      const args = input.args || {};
      const quantity = roundQty(args._quantidade);
      const factor = args._fator == null ? 1 : Number(args._fator);
      const price = args._preco_unitario == null ? null : Number(args._preco_unitario);
      const receivedAt = new Date(args._data_real);
      if (!Number.isFinite(quantity) || quantity <= 0) throw new Error('Informe uma quantidade maior que zero.');
      if (!Number.isFinite(factor) || factor <= 0) throw new Error('Fator de conversão inválido.');
      if (price !== null && (!Number.isFinite(price) || price < 0)) throw new Error('Preço unitário inválido.');
      if (Number.isNaN(receivedAt.getTime())) throw new Error('Informe a data real do recebimento.');
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await client.query(`SELECT o.*, f.nome AS fornecedor_nome FROM public.purchase_orders o
          LEFT JOIN public.fornecedores f ON f.id = o.fornecedor_id WHERE o.id = $1 FOR UPDATE OF o`, [args._order_id]);
        const order = result.rows[0];
        if (!order) throw new Error('Pedido de compra não encontrado.');
        if (order.status === 'CANCELADO' || order.status === 'RECEBIDO_COMPLETO') {
          throw new Error('Este pedido não aceita mais recebimentos. Atualize a página.');
        }
        if (!order.centro_custo_id) throw new Error('O pedido precisa de um centro de custo para registrar a entrada.');
        const received = roundQty(order.quantidade_recebida || 0);
        const remaining = roundQty(Number(order.quantidade) - received);
        if (quantity > remaining) throw new Error(`Quantidade excede o restante do pedido (${remaining}).`);
        const reference = `Pedido de compra ${order.id.slice(0, 8)}${order.fornecedor_nome ? ` · ${order.fornecedor_nome}` : ''}`;
        await client.query(`INSERT INTO public.movements
          (item_id, tipo_movimentacao, quantidade, preco_unitario, referencia, data, centro_custo_id, usuario_nome)
          VALUES ($1, 'COMPRA', $2, $3, $4, $5, $6, $7)`,
        [order.item_id, roundQty(quantity * factor), price, reference, receivedAt.toISOString(),
          order.centro_custo_id, user?.display_name || null]);
        await client.query(`INSERT INTO public.purchase_order_recebimentos (purchase_order_id, quantidade, data_real)
          VALUES ($1, $2, $3)`, [order.id, quantity, receivedAt.toISOString()]);
        const totalReceived = roundQty(received + quantity);
        const updated = await client.query(`UPDATE public.purchase_orders SET quantidade_recebida = $2, status = $3
          WHERE id = $1 RETURNING *`,
        [order.id, totalReceived, totalReceived >= Number(order.quantidade) ? 'RECEBIDO_COMPLETO' : 'RECEBIDO_PARCIAL']);
        await client.query('COMMIT');
        return { data: updated.rows[0], count: null };
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally { client.release(); }
    }
    if (input.name === 'create_item_with_initial_stock') {
      const args = input.args || {};
      const item = validateValues(schema, 'items', args._item)[0];
      const quantity = args._quantity;
      if (typeof quantity !== 'number' || !Number.isFinite(quantity) || quantity <= 0) {
        throw new Error('Informe uma quantidade inicial maior que zero.');
      }
      const columns = Object.keys(item);
      if (!columns.length || typeof item.nome !== 'string' || !item.nome.trim()) {
        throw new Error('Informe o nome do item.');
      }
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const attribution = await resolveStockAttribution(client, args._center_id, user?.display_name || args._operator);
        const values = columns.map((column) => item[column]);
        const inserted = await client.query(
          `INSERT INTO public.items (${columns.map(quote).join(', ')}) VALUES (${columns.map((_, index) => `$${index + 1}`).join(', ')}) RETURNING *`,
          values,
        );
        await client.query(
          `INSERT INTO public.movements (item_id, tipo_movimentacao, quantidade, referencia, centro_custo_id, usuario_nome, preco_unitario)
           VALUES ($1, 'INICIAL', $2, 'Estoque inicial no cadastro', $3, $4, $5)`,
          [inserted.rows[0].id, quantity, attribution.centerId, attribution.operator, item.custo_unitario ?? null],
        );
        await client.query('COMMIT');
        return { data: inserted.rows[0], count: null };
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    }
    if (input.name === 'update_item_with_stock_adjustment') {
      const args = input.args || {};
      const itemId = args._item_id;
      const updates = validateValues(schema, 'items', args._updates)[0];
      const target = args._target_quantity;
      const expected = args._expected_quantity;
      const allowed = new Set(['nome', 'tipo', 'unidade', 'consumo_diario', 'lead_time_dias',
        'estoque_minimo', 'estoque_ideal', 'estoque_maximo', 'custo_unitario',
        'modo_producao_padrao', 'unidade_compra', 'fator_conversao', 'produzido_internamente',
        'gera_sugestao_compra', 'compra_direta', 'controla_estoque']);
      const columns = Object.keys(updates);
      if (!columns.length || columns.some((column) => !allowed.has(column))) throw new Error('Alterações inválidas no item.');
      if (typeof itemId !== 'string' || !itemId) throw new Error('Item inválido.');
      if (typeof target !== 'number' || !Number.isFinite(target) || target < 0 ||
          typeof expected !== 'number' || !Number.isFinite(expected)) {
        throw new Error('Informe uma quantidade física válida.');
      }
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('LOCK TABLE public.movements IN SHARE ROW EXCLUSIVE MODE');
        const item = await client.query('SELECT id FROM public.items WHERE id = $1 FOR UPDATE', [itemId]);
        if (!item.rowCount) throw new Error('Item não encontrado.');
        const currentResult = await client.query(
          'SELECT COALESCE(SUM(quantidade), 0) AS fisico FROM public.movements WHERE item_id = $1', [itemId],
        );
        const current = roundQty(currentResult.rows[0].fisico);
        if (current !== roundQty(expected)) throw new Error('O estoque mudou desde que você abriu o item. Atualize a página e tente novamente.');
        const values = columns.map((column) => updates[column]);
        const updated = await client.query(
          `UPDATE public.items SET ${columns.map((column, index) => `${quote(column)} = $${index + 1}`).join(', ')}
           WHERE id = $${columns.length + 1} RETURNING *`,
          [...values, itemId],
        );
        const difference = roundQty(target - current);
        if (difference !== 0) {
          const attribution = await resolveStockAttribution(client, args._center_id, user?.display_name || args._operator);
          await client.query(
            `INSERT INTO public.movements (item_id, tipo_movimentacao, quantidade, referencia, centro_custo_id, usuario_nome)
             VALUES ($1, 'AJUSTE', $2, 'Ajuste de estoque no cadastro', $3, $4)`,
            [itemId, difference, attribution.centerId, attribution.operator],
          );
        }
        await client.query('COMMIT');
        return { data: updated.rows[0], count: null };
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    }
    if (input.name !== 'registrar_preco_historico') throw new Error('Função desconhecida');
    const a = input.args || {};
    await pool.query('SELECT public.registrar_preco_historico($1, $2, $3, $4, $5)',
      [a._item_id, a._fornecedor_id, a._preco, a._origem, a._purchase_order_id ?? null]);
    return { data: null, count: null };
  }
  const { table, action } = input;
  assertTable(schema, table);
  if (!['select', 'insert', 'update', 'delete', 'upsert'].includes(action)) throw new Error('Ação desconhecida');
  if ((table === 'kit_plans' || table === 'kit_templates') && action !== 'select') {
    throw new Error('Use as ações de montagem de kits.');
  }
  const selection = parseSelection(input.columns || '*');
  for (const field of selection.fields) if (field !== '*') assertColumn(schema, table, field);
  const client = await pool.connect();
  try {
    const parameters = [];
    let where = makeWhere(schema, table, input.filters, parameters);
    let sql;
    let count = null;
    if (action === 'select') {
      if (input.count) {
        count = Number((await client.query(`SELECT count(*) AS count FROM ${quote(table)}${where}`, parameters)).rows[0].count);
      }
      sql = `SELECT * FROM ${quote(table)}${where}`;
      for (const order of input.orders || []) {
        assertColumn(schema, table, order.column);
      }
      if (input.orders?.length) sql += ` ORDER BY ${input.orders.map((o) => `${quote(o.column)} ${o.ascending ? 'ASC' : 'DESC'}`).join(', ')}`;
      if (input.limit != null) {
        if (!Number.isInteger(input.limit) || input.limit < 0) throw new Error('Limite inválido');
        parameters.push(input.limit);
        sql += ` LIMIT $${parameters.length}`;
      }
    } else if (action === 'insert' || action === 'upsert') {
      const rows = validateValues(schema, table, input.values);
      const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))];
      if (!columns.length) throw new Error('Dados vazios');
      const values = rows.map((row) => `(${columns.map((column) => {
        parameters.push(row[column] ?? null);
        return `$${parameters.length}`;
      }).join(', ')})`).join(', ');
      sql = `INSERT INTO ${quote(table)} (${columns.map(quote).join(', ')}) VALUES ${values}`;
      if (action === 'upsert') {
        const conflict = (input.onConflict || 'id').split(',').map((x) => x.trim());
        for (const column of conflict) assertColumn(schema, table, column);
        const updates = columns.filter((column) => !conflict.includes(column));
        sql += ` ON CONFLICT (${conflict.map(quote).join(', ')}) ${updates.length
          ? `DO UPDATE SET ${updates.map((column) => `${quote(column)} = EXCLUDED.${quote(column)}`).join(', ')}`
          : 'DO NOTHING'}`;
      }
      sql += ' RETURNING *';
    } else {
      if (!input.filters?.length) throw new Error('Alteração sem filtro recusada');
      if (action === 'update') {
        const row = validateValues(schema, table, input.values)[0];
        const columns = Object.keys(row);
        if (!columns.length) throw new Error('Dados vazios');
        parameters.length = 0;
        const assignments = columns.map((column) => {
          parameters.push(row[column]);
          return `${quote(column)} = $${parameters.length}`;
        });
        where = makeWhere(schema, table, input.filters, parameters);
        sql = `UPDATE ${quote(table)} SET ${assignments.join(', ')}${where} RETURNING *`;
      } else sql = `DELETE FROM ${quote(table)}${where} RETURNING *`;
    }
    const rows = input.head && action === 'select' ? [] : (await client.query(sql, parameters)).rows;
    await hydrate(client, schema, table, rows, selection);
    const data = rows.map((row) => project(row, selection));
    if (input.single) {
      if (data.length !== 1) throw new Error(`Esperada uma linha; encontradas ${data.length}`);
      return { data: data[0], count };
    }
    return { data: input.head ? null : data, count };
  } finally {
    client.release();
  }
}
