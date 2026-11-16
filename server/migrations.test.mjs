import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { executeQuery, loadSchema } from './query.mjs';

test('migrations, CRUD, relações e regras de estoque', async () => {
  const database = new PGlite();
  try {
    const directory = join(import.meta.dirname, 'migrations');
    const files = (await readdir(directory)).filter((name) => name.endsWith('.sql')).sort();
    assert.deepEqual(files, ['001_initial.sql', '002_remove_unused_sections.sql', '003_movement_cost_centers.sql', '004_allow_existing_orders_with_inactive_centers.sql', '005_default_departments.sql', '006_kit_plans.sql', '007_kit_templates.sql', '008_kit_workflow.sql', '009_shared_work_queue.sql', '010_production_completion_trace.sql', '011_subassembly_destination.sql', '012_user_accounts.sql']);
    for (const file of files) {
      const sql = await readFile(join(directory, file), 'utf8');
      await database.exec(sql);
    }
    const pool = { query: (...args) => database.query(...args), connect: async () => ({
      query: (...args) => database.query(...args), release() {},
    }) };
    const schema = await loadSchema(pool);
    assert(schema.tables.has('items'));
    assert(schema.tables.has('app_users'));
    assert(schema.tables.has('app_sessions'));
    assert(schema.tables.has('production_orders'));
    for (const removed of ['production_order_costs', 'implantation_due_date_history', 'production_shipping_history', 'production_failures']) {
      assert(!schema.tables.has(removed), `${removed} ainda existe`);
    }
    assert(schema.tables.has('centros_custo'));
    assert(schema.tables.get('movements').has('centro_custo_id'));
    assert(!schema.tables.get('production_orders').has('implantada_em'));
    const insert = (name, type) => executeQuery(pool, schema, {
      table: 'items', action: 'insert', values: { nome: name, tipo: type }, columns: '*', filters: [], orders: [], single: true,
    });
    const parent = (await insert('Produto teste', 'PF')).data;
    const component = (await insert('Componente teste', 'MP')).data;
    assert(parent.id);
    await executeQuery(pool, schema, {
      table: 'bom_items', action: 'insert', values: { item_pai_id: parent.id, item_componente_id: component.id, quantidade: 2 },
      filters: [], orders: [],
    });
    const bom = await executeQuery(pool, schema, {
      table: 'bom_items', action: 'select', columns: '*, item_pai:items!bom_items_item_pai_id_fkey(nome)',
      filters: [{ column: 'item_pai_id', op: 'eq', value: parent.id }], orders: [],
    });
    assert.equal(bom.data[0].item_pai.nome, 'Produto teste');
    const center = (await executeQuery(pool, schema, {
      table: 'centros_custo', action: 'insert', values: { nome: 'Almoxarifado', tipo: 'SETOR' },
      filters: [], orders: [], single: true,
    })).data;
    const initialItem = (await executeQuery(pool, schema, {
      action: 'rpc', name: 'create_item_with_initial_stock', args: {
        _item: { nome: 'Item com saldo inicial', tipo: 'MP', unidade: 'un', custo_unitario: 12 },
        _quantity: 7, _center_id: center.id, _operator: 'Joana',
      },
    })).data;
    const initialMovement = await database.query(
      'SELECT tipo_movimentacao, quantidade, centro_custo_id, usuario_nome FROM movements WHERE item_id = $1',
      [initialItem.id],
    );
    assert.deepEqual(initialMovement.rows.map((row) => ({ ...row, quantidade: Number(row.quantidade) })), [
      { tipo_movimentacao: 'INICIAL', quantidade: 7, centro_custo_id: center.id, usuario_nome: 'Joana' },
    ]);
    const unassignedItem = (await executeQuery(pool, schema, {
      action: 'rpc', name: 'create_item_with_initial_stock', args: {
        _item: { nome: 'Item sem atribuição', tipo: 'MP' }, _quantity: 5,
      },
    })).data;
    await executeQuery(pool, schema, {
      action: 'rpc', name: 'update_item_with_stock_adjustment', args: {
        _item_id: unassignedItem.id, _updates: { nome: 'Item sem atribuição' },
        _expected_quantity: 5, _target_quantity: 4,
      },
    });
    const unassigned = await database.query(`SELECT m.quantidade, m.usuario_nome, c.nome AS setor, c.ativo
      FROM movements m JOIN centros_custo c ON c.id = m.centro_custo_id
      WHERE m.item_id = $1 ORDER BY m.created_at, m.id`, [unassignedItem.id]);
    assert.equal(unassigned.rows.reduce((total, row) => total + Number(row.quantidade), 0), 4);
    assert.equal(unassigned.rows.length, 2);
    assert(unassigned.rows.every((row) => row.usuario_nome === 'Não informado (cadastro)' &&
      row.setor === 'Sem atribuição (cadastro)' && row.ativo === false));
    await executeQuery(pool, schema, {
      action: 'rpc', name: 'update_item_with_stock_adjustment', args: {
        _item_id: initialItem.id, _updates: { nome: 'Item ajustado' },
        _expected_quantity: 7, _target_quantity: 3, _center_id: center.id, _operator: 'Maria',
      },
    });
    const adjusted = await database.query(
      'SELECT i.nome, SUM(m.quantidade) AS saldo, COUNT(m.id) AS movimentos FROM items i JOIN movements m ON m.item_id = i.id WHERE i.id = $1 GROUP BY i.nome',
      [initialItem.id],
    );
    assert.equal(adjusted.rows[0].nome, 'Item ajustado');
    assert.equal(Number(adjusted.rows[0].saldo), 3);
    assert.equal(Number(adjusted.rows[0].movimentos), 2);
    await assert.rejects(() => executeQuery(pool, schema, {
      action: 'rpc', name: 'update_item_with_stock_adjustment', args: {
        _item_id: initialItem.id, _updates: { nome: 'Atualização desatualizada' },
        _expected_quantity: 7, _target_quantity: 1, _center_id: center.id, _operator: 'Maria',
      },
    }));
    await database.exec('ALTER TABLE movements ADD CONSTRAINT test_adjust_reversal CHECK (quantidade <> -2)');
    await assert.rejects(() => executeQuery(pool, schema, {
      action: 'rpc', name: 'update_item_with_stock_adjustment', args: {
        _item_id: initialItem.id, _updates: { nome: 'Atualização que deve reverter' },
        _expected_quantity: 3, _target_quantity: 1, _center_id: center.id, _operator: 'Maria',
      },
    }));
    const unchanged = await database.query('SELECT nome FROM items WHERE id = $1', [initialItem.id]);
    assert.equal(unchanged.rows[0].nome, 'Item ajustado');
    await database.exec('ALTER TABLE movements DROP CONSTRAINT test_adjust_reversal');
    await database.exec('ALTER TABLE movements ADD CONSTRAINT test_initial_limit CHECK (quantidade < 100)');
    await assert.rejects(() => executeQuery(pool, schema, {
      action: 'rpc', name: 'create_item_with_initial_stock', args: {
        _item: { nome: 'Cadastro que deve reverter', tipo: 'MP' },
        _quantity: 100, _center_id: center.id, _operator: 'Joana',
      },
    }));
    const rolledBack = await database.query("SELECT id FROM items WHERE nome = 'Cadastro que deve reverter'");
    assert.equal(rolledBack.rowCount, 0);
    await database.exec('ALTER TABLE movements DROP CONSTRAINT test_initial_limit');
    await executeQuery(pool, schema, {
      table: 'movements', action: 'insert', values: { item_id: component.id, tipo_movimentacao: 'INICIAL', quantidade: 10, preco_unitario: 5, centro_custo_id: center.id, usuario_nome: 'Joana' },
      filters: [], orders: [],
    });
    const attributed = await executeQuery(pool, schema, {
      table: 'movements', action: 'select', columns: 'centro_custo_id, usuario_nome, centros_custo(nome,tipo)',
      filters: [{ column: 'item_id', op: 'eq', value: component.id }], orders: [],
    });
    assert.equal(attributed.data[0].centros_custo.nome, 'Almoxarifado');
    assert.equal(attributed.data[0].usuario_nome, 'Joana');
    await assert.rejects(() => executeQuery(pool, schema, {
      table: 'movements', action: 'insert', values: { item_id: component.id, tipo_movimentacao: 'AJUSTE', quantidade: 1, usuario_nome: 'Joana' },
      filters: [], orders: [],
    }));
    await executeQuery(pool, schema, {
      table: 'centros_custo', action: 'update', values: { ativo: false },
      filters: [{ column: 'id', op: 'eq', value: center.id }], orders: [],
    });
    const retained = await database.query('SELECT centro_custo_id FROM movements WHERE item_id = $1', [component.id]);
    assert.equal(retained.rows[0].centro_custo_id, center.id);
    await executeQuery(pool, schema, {
      table: 'movements', action: 'insert', values: { item_id: component.id, tipo_movimentacao: 'AJUSTE', quantidade: 1, centro_custo_id: center.id, usuario_nome: 'Joana' },
      filters: [], orders: [],
    });
    await executeQuery(pool, schema, {
      table: 'centros_custo', action: 'update', values: { ativo: true },
      filters: [{ column: 'id', op: 'eq', value: center.id }], orders: [],
    });
    const stock = await executeQuery(pool, schema, {
      table: 'movements', action: 'select', columns: 'quantidade',
      filters: [{ column: 'item_id', op: 'eq', value: component.id }], orders: [], count: true,
    });
    assert.equal(stock.count, 2);
    assert.equal(Number(stock.data[0].quantidade), 10);
    const cost = await database.query('SELECT custo_medio FROM items WHERE id = $1', [component.id]);
    assert.equal(Number(cost.rows[0].custo_medio), 5);

    const template = (await executeQuery(pool, schema, { action: 'rpc', name: 'save_kit_template', args: {
      _nome: 'Kit de duas câmeras', _configuracao: { courts: [{ nome: 'Sala', cameras: 2, botoes: 2 }] },
    } })).data;
    await executeQuery(pool, schema, { action: 'rpc', name: 'save_kit_template', args: {
      _id: template.id, _nome: 'Kit padrão da sala', _configuracao: { courts: [{ nome: 'Sala', cameras: 2, botoes: 1 }] },
    } });
    const savedTemplate = await database.query('SELECT nome, configuracao FROM kit_templates WHERE id = $1', [template.id]);
    assert.equal(savedTemplate.rows[0].nome, 'Kit padrão da sala');
    assert.equal(savedTemplate.rows[0].configuracao.courts[0].botoes, 1);
    await executeQuery(pool, schema, { action: 'rpc', name: 'delete_kit_template', args: { _id: template.id } });
    assert.equal((await database.query('SELECT id FROM kit_templates WHERE id = $1', [template.id])).rowCount, 0);

    const draft = (await executeQuery(pool, schema, { action: 'rpc', name: 'save_kit_plan', args: {
      _nome: 'Arena teste', _configuracao: { componentes: [{ item_id: component.id, quantidade: 100 }] },
    } })).data;
    await assert.rejects(() => executeQuery(pool, schema, { action: 'rpc', name: 'complete_kit_plan', args: {
      _id: draft.id,
    } }), /em produção/);
    assert.equal((await database.query('SELECT status FROM kit_plans WHERE id = $1', [draft.id])).rows[0].status, 'RASCUNHO');
    await executeQuery(pool, schema, { action: 'rpc', name: 'queue_kit_plan', args: {
      _id: draft.id, _destino: 'Arena teste', _centro_custo_id: center.id,
    } });
    assert.equal((await database.query('SELECT status FROM kit_plans WHERE id = $1', [draft.id])).rows[0].status, 'NA_FILA');
    assert.equal(Number((await database.query('SELECT quantidade FROM reservations WHERE referencia = $1', [`KIT:${draft.id}`])).rows[0].quantidade), 100);
    await assert.rejects(() => executeQuery(pool, schema, { action: 'rpc', name: 'start_kit_plan', args: {
      _id: draft.id, _responsavel: 'Joana',
    } }), /Estoque insuficiente/);
    await executeQuery(pool, schema, { action: 'rpc', name: 'return_kit_to_draft', args: { _id: draft.id } });
    assert.equal((await database.query('SELECT id FROM reservations WHERE referencia = $1', [`KIT:${draft.id}`])).rowCount, 0);
    await executeQuery(pool, schema, { action: 'rpc', name: 'save_kit_plan', args: {
      _id: draft.id, _nome: 'Arena teste', _configuracao: { componentes: [{ item_id: component.id, quantidade: 2 }] },
    } });
    await executeQuery(pool, schema, { action: 'rpc', name: 'queue_kit_plan', args: {
      _id: draft.id, _destino: 'Arena teste', _centro_custo_id: center.id,
    } });
    await executeQuery(pool, schema, { action: 'rpc', name: 'start_kit_plan', args: {
      _id: draft.id, _responsavel: 'Joana',
    } });
    assert.equal((await database.query('SELECT status FROM kit_plans WHERE id = $1', [draft.id])).rows[0].status, 'EM_PRODUCAO');
    assert.equal(Number((await database.query("SELECT COUNT(*) AS count FROM movements WHERE item_id = $1 AND tipo_movimentacao = 'CONSUMO'", [component.id])).rows[0].count), 0);
    await database.query("INSERT INTO reservations (item_id, quantidade, referencia) VALUES ($1, 10, 'TESTE')", [component.id]);
    await assert.rejects(() => executeQuery(pool, schema, { action: 'rpc', name: 'complete_kit_plan', args: { _id: draft.id } }), /Estoque insuficiente/);
    assert.equal((await database.query('SELECT status FROM kit_plans WHERE id = $1', [draft.id])).rows[0].status, 'EM_PRODUCAO');
    await database.query("DELETE FROM reservations WHERE referencia = 'TESTE'");
    await executeQuery(pool, schema, { action: 'rpc', name: 'complete_kit_plan', args: { _id: draft.id } });
    assert.equal((await database.query('SELECT id FROM reservations WHERE referencia = $1', [`KIT:${draft.id}`])).rowCount, 0);
    await assert.rejects(() => executeQuery(pool, schema, { action: 'rpc', name: 'complete_kit_plan', args: {
      _id: draft.id,
    } }), /em produção/);
    assert.equal(Number((await database.query("SELECT SUM(quantidade) AS total FROM movements WHERE item_id = $1 AND tipo_movimentacao = 'CONSUMO'", [component.id])).rows[0].total), -2);
    await assert.rejects(() => executeQuery(pool, schema, { table: 'kit_plans', action: 'delete', filters: [], orders: [] }), /ações de montagem/);

    const order = (await executeQuery(pool, schema, {
      table: 'production_orders', action: 'insert', values: { item_id: parent.id, quantidade: 3, status: 'PLANEJADA', centro_custo_id: center.id },
      filters: [], orders: [], single: true,
    })).data;
    const reserved = await database.query('SELECT quantidade FROM reservations WHERE referencia = $1', [`OP:${order.id}`]);
    assert.equal(Number(reserved.rows[0].quantidade), 6);
    await assert.rejects(() => database.query('UPDATE bom_items SET quantidade = 3 WHERE item_pai_id = $1', [parent.id]), /em uso por uma montagem/);
    const secondKit = (await executeQuery(pool, schema, { action: 'rpc', name: 'save_kit_plan', args: {
      _nome: 'Kit da fila compartilhada', _configuracao: { componentes: [{ item_id: component.id, quantidade: 5 }] },
    } })).data;
    await executeQuery(pool, schema, { action: 'rpc', name: 'queue_kit_plan', args: {
      _id: secondKit.id, _destino: 'Arena', _centro_custo_id: center.id,
    } });
    assert.equal(Number((await database.query('SELECT quantidade FROM reservations WHERE referencia = $1', [`KIT:${secondKit.id}`])).rows[0].quantidade), 5);
    let availability = (await executeQuery(pool, schema, { action: 'rpc', name: 'work_queue_availability' })).data;
    assert.equal(availability.find(row => row.id === order.id).canStart, true);
    assert.equal(availability.find(row => row.id === secondKit.id).canStart, false);
    await executeQuery(pool, schema, { action: 'rpc', name: 'reorder_work_queue', args: { _entries: [
      { kind: 'KIT', id: secondKit.id }, { kind: 'OP', id: order.id },
    ] } });
    availability = (await executeQuery(pool, schema, { action: 'rpc', name: 'work_queue_availability' })).data;
    assert.equal(availability.find(row => row.id === secondKit.id).canStart, true);
    assert.equal(availability.find(row => row.id === order.id).canStart, false);
    await executeQuery(pool, schema, { action: 'rpc', name: 'start_kit_plan', args: {
      _id: secondKit.id, _responsavel: 'Joana',
    } });
    await executeQuery(pool, schema, { action: 'rpc', name: 'return_kit_to_queue', args: { _id: secondKit.id } });
    await executeQuery(pool, schema, { action: 'rpc', name: 'return_kit_to_draft', args: { _id: secondKit.id } });
    await executeQuery(pool, schema, { action: 'rpc', name: 'delete_kit_plan', args: { _id: secondKit.id } });
    const queued = await executeQuery(pool, schema, {
      table: 'production_orders', action: 'select', columns: 'id, items(nome)',
      filters: [{ column: 'status', op: 'not.in', value: '(CONCLUIDA,IMPLANTADA)' }], orders: [],
    });
    assert.equal(queued.data[0].items.nome, 'Produto teste');

    const supplier = (await executeQuery(pool, schema, {
      table: 'fornecedores', action: 'insert', values: { nome: 'Fornecedor teste' }, filters: [], orders: [], single: true,
    })).data;
    await executeQuery(pool, schema, {
      table: 'item_fornecedores', action: 'insert',
      values: { item_id: component.id, fornecedor_id: supplier.id, preco_unitario: 7 }, filters: [], orders: [],
    });
    const prices = await database.query('SELECT preco_unitario FROM item_fornecedor_precos WHERE item_id = $1 AND fornecedor_id = $2',
      [component.id, supplier.id]);
    assert.equal(Number(prices.rows[0].preco_unitario), 7);

    await executeQuery(pool, schema, { action: 'rpc', name: 'start_production_order', args: {
      _id: order.id, _responsavel: 'Joana',
    } });
    assert.equal((await database.query('SELECT status FROM production_orders WHERE id = $1', [order.id])).rows[0].status, 'EM_PRODUCAO');
    await database.exec('ALTER TABLE movements ADD CONSTRAINT test_op_rollback CHECK (quantidade <> -6)');
    await assert.rejects(() => executeQuery(pool, schema, { action: 'rpc', name: 'complete_production_order', args: { _id: order.id } }));
    assert.equal((await database.query('SELECT status FROM production_orders WHERE id = $1', [order.id])).rows[0].status, 'EM_PRODUCAO');
    assert.equal(Number((await database.query("SELECT COALESCE(SUM(quantidade), 0) AS total FROM movements WHERE item_id = $1 AND tipo_movimentacao = 'CONSUMO'", [component.id])).rows[0].total), -2);
    await database.exec('ALTER TABLE movements DROP CONSTRAINT test_op_rollback');
    await executeQuery(pool, schema, { action: 'rpc', name: 'complete_production_order', args: { _id: order.id } });
    assert.equal(Number((await database.query("SELECT SUM(quantidade) AS total FROM movements WHERE item_id = $1 AND tipo_movimentacao = 'CONSUMO'", [component.id])).rows[0].total), -8);
    assert.equal(Number((await database.query("SELECT SUM(quantidade) AS total FROM movements WHERE item_id = $1 AND tipo_movimentacao = 'PRODUCAO'", [parent.id])).rows[0].total), 3);
    await executeQuery(pool, schema, { action: 'rpc', name: 'revert_production_completion', args: { _id: order.id } });
    assert.equal((await database.query('SELECT status FROM production_orders WHERE id = $1', [order.id])).rows[0].status, 'EM_PRODUCAO');
    assert.equal(Number((await database.query('SELECT SUM(quantidade) AS saldo FROM movements WHERE item_id = $1', [component.id])).rows[0].saldo), 9);
    assert.equal(Number((await database.query('SELECT SUM(quantidade) AS saldo FROM movements WHERE item_id = $1', [parent.id])).rows[0].saldo), 0);
    await executeQuery(pool, schema, { action: 'rpc', name: 'complete_production_order', args: { _id: order.id } });
    assert.equal(Number((await database.query('SELECT SUM(quantidade) AS saldo FROM movements WHERE item_id = $1', [component.id])).rows[0].saldo), 3);
    const clientOrder = (await executeQuery(pool, schema, {
      table: 'production_orders', action: 'insert', values: { item_id: parent.id, quantidade: 1, status: 'PLANEJADA', centro_custo_id: center.id, destino: 'CLIENTE', cliente: 'Arena' },
      filters: [], orders: [], single: true,
    })).data;
    await executeQuery(pool, schema, { action: 'rpc', name: 'start_production_order', args: { _id: clientOrder.id, _responsavel: 'Joana' } });
    await executeQuery(pool, schema, { action: 'rpc', name: 'complete_production_order', args: { _id: clientOrder.id } });
    assert.equal(Number((await database.query('SELECT SUM(quantidade) AS saldo FROM movements WHERE item_id = $1', [component.id])).rows[0].saldo), 1);
    await executeQuery(pool, schema, { action: 'rpc', name: 'revert_production_completion', args: { _id: clientOrder.id } });
    assert.equal(Number((await database.query('SELECT SUM(quantidade) AS saldo FROM movements WHERE item_id = $1', [component.id])).rows[0].saldo), 3);
    assert.equal((await database.query('SELECT status FROM production_orders WHERE id = $1', [clientOrder.id])).rows[0].status, 'EM_PRODUCAO');
    await database.query('UPDATE production_orders SET received_date = $2 WHERE id = $1', [order.id, '2026-10-13']);
    const completed = await database.query('SELECT status, concluida_em, received_date FROM production_orders WHERE id = $1', [order.id]);
    assert.equal(completed.rows[0].status, 'CONCLUIDA');
    assert(completed.rows[0].concluida_em);
    assert.equal(completed.rows[0].received_date.toISOString().slice(0, 10), '2026-10-13');
  } finally {
    await database.close();
  }
});

test('submontagens só entram no estoque intermediário', async () => {
  const database = new PGlite();
  try {
    const directory = join(import.meta.dirname, 'migrations');
    for (const file of (await readdir(directory)).filter(name => name.endsWith('.sql')).sort()) {
      await database.exec(await readFile(join(directory, file), 'utf8'));
    }
    const center = (await database.query("INSERT INTO centros_custo (nome, tipo) VALUES ('Produção', 'SETOR') RETURNING id")).rows[0];
    const sub = (await database.query("INSERT INTO items (nome, tipo) VALUES ('Botoeira montada', 'SUB') RETURNING id")).rows[0];
    const final = (await database.query("INSERT INTO items (nome, tipo) VALUES ('Kit final', 'PF') RETURNING id")).rows[0];
    await assert.rejects(() => database.query(
      "INSERT INTO production_orders (item_id, quantidade, centro_custo_id, destino, cliente) VALUES ($1, 1, $2, 'CLIENTE', 'Arena')",
      [sub.id, center.id],
    ), /Submontagens devem ter destino Estoque intermediário/);
    const stockOrder = (await database.query(
      "INSERT INTO production_orders (item_id, quantidade, centro_custo_id, destino) VALUES ($1, 1, $2, 'ESTOQUE') RETURNING id",
      [sub.id, center.id],
    )).rows[0];
    await assert.rejects(() => database.query(
      "UPDATE production_orders SET destino = 'CLIENTE' WHERE id = $1", [stockOrder.id],
    ), /Submontagens devem ter destino Estoque intermediário/);
    const finalOrder = (await database.query(
      "INSERT INTO production_orders (item_id, quantidade, centro_custo_id, destino, cliente) VALUES ($1, 1, $2, 'CLIENTE', 'Arena') RETURNING id",
      [final.id, center.id],
    )).rows[0];
    await assert.rejects(() => database.query(
      'INSERT INTO production_order_items (production_order_id, item_id, quantidade, ordem) VALUES ($1, $2, 1, 2)',
      [finalOrder.id, sub.id],
    ), /Submontagens devem ter destino Estoque intermediário/);
    await assert.rejects(() => database.query(
      "UPDATE items SET tipo = 'SUB' WHERE id = $1", [final.id],
    ), /não pode ser alterado para Submontagem/);
  } finally {
    await database.close();
  }
});

test('migração de centros preserva movimentações anteriores sem atribuição', async () => {
  const database = new PGlite();
  try {
    for (const name of ['001_initial.sql', '002_remove_unused_sections.sql']) {
      await database.exec(await readFile(join(import.meta.dirname, 'migrations', name), 'utf8'));
    }
    const item = await database.query("INSERT INTO items (nome, tipo) VALUES ('Legado', 'MP') RETURNING id");
    await database.query("INSERT INTO movements (item_id, tipo_movimentacao, quantidade) VALUES ($1, 'INICIAL', 1)", [item.rows[0].id]);
    for (const name of ['003_movement_cost_centers.sql', '004_allow_existing_orders_with_inactive_centers.sql']) {
      await database.exec(await readFile(join(import.meta.dirname, 'migrations', name), 'utf8'));
    }
    const result = await database.query(`SELECT m.usuario_nome, c.nome, c.ativo
      FROM movements m JOIN centros_custo c ON c.id = m.centro_custo_id`);
    assert.deepEqual(result.rows, [{ usuario_nome: 'Não informado (histórico)', nome: 'Sem atribuição (histórico)', ativo: false }]);
  } finally {
    await database.close();
  }
});

test('recebimento de compra é atômico e ajuste aceita quantidades fracionadas', async () => {
  const database = new PGlite();
  try {
    const directory = join(import.meta.dirname, 'migrations');
    for (const file of (await readdir(directory)).filter((name) => name.endsWith('.sql')).sort()) {
      await database.exec(await readFile(join(directory, file), 'utf8'));
    }
    const pool = { query: (...args) => database.query(...args), connect: async () => ({
      query: (...args) => database.query(...args), release() {},
    }) };
    const schema = await loadSchema(pool);
    const user = { display_name: 'Coordenação' };
    const center = (await database.query("INSERT INTO centros_custo (nome, tipo) VALUES ('Compras', 'SETOR') RETURNING id")).rows[0].id;
    const supplier = (await database.query("INSERT INTO fornecedores (nome) VALUES ('Fornecedor X') RETURNING id")).rows[0].id;
    const item = (await database.query("INSERT INTO items (nome, tipo, unidade) VALUES ('Cabo', 'MP', 'm') RETURNING id")).rows[0].id;
    const order = (await database.query(`INSERT INTO purchase_orders (item_id, fornecedor_id, quantidade, preco_unitario, centro_custo_id)
      VALUES ($1, $2, 10, 5, $3) RETURNING id`, [item, supplier, center])).rows[0].id;
    const receive = (quantidade) => executeQuery(pool, schema, { action: 'rpc', name: 'receive_purchase_order', args: {
      _order_id: order, _quantidade: quantidade, _fator: 1, _preco_unitario: 5, _data_real: '2026-11-16T12:00:00Z',
    } }, user);

    assert.equal((await receive(4)).data.status, 'RECEBIDO_PARCIAL');
    await assert.rejects(() => receive(7), /excede o restante/);
    assert.equal((await receive(6)).data.status, 'RECEBIDO_COMPLETO');
    await assert.rejects(() => receive(1), /não aceita mais/);
    const movements = await database.query("SELECT SUM(quantidade)::float AS total, MIN(usuario_nome) AS quem FROM movements WHERE item_id = $1 AND tipo_movimentacao = 'COMPRA'", [item]);
    assert.equal(movements.rows[0].total, 10);
    assert.equal(movements.rows[0].quem, 'Coordenação');
    const receipts = await database.query('SELECT count(*)::int AS total FROM purchase_order_recebimentos WHERE purchase_order_id = $1', [order]);
    assert.equal(receipts.rows[0].total, 2);

    // 0.1 + 0.2 em JS é 0.30000000000000004; o ajuste não pode recusar por isso.
    const fractional = (await database.query("INSERT INTO items (nome, tipo, unidade) VALUES ('Tubo', 'MP', 'm') RETURNING id")).rows[0].id;
    await database.query("INSERT INTO movements (item_id, tipo_movimentacao, quantidade, centro_custo_id, usuario_nome) VALUES ($1, 'AJUSTE', 0.1, $2, 'Teste'), ($1, 'AJUSTE', 0.2, $2, 'Teste')", [fractional, center]);
    await executeQuery(pool, schema, { action: 'rpc', name: 'update_item_with_stock_adjustment', args: {
      _item_id: fractional, _updates: { nome: 'Tubo' }, _target_quantity: 1, _expected_quantity: 0.1 + 0.2, _center_id: center,
    } }, user);
    const balance = await database.query('SELECT SUM(quantidade)::float AS total FROM movements WHERE item_id = $1', [fractional]);
    assert.equal(balance.rows[0].total, 1);
  } finally { await database.close(); }
});
