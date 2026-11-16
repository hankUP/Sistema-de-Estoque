import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { authorizeQuery, createSession, findSession, hashPassword, validPassword, verifyPassword } from './auth.mjs';
import { handleUserRoute } from './user-routes.mjs';

async function migrate(db) {
  const directory = join(import.meta.dirname, 'migrations');
  for (const file of (await readdir(directory)).filter((name) => name.endsWith('.sql')).sort()) {
    await db.exec(await readFile(join(directory, file), 'utf8'));
  }
}

test('senhas aceitam oito caracteres e rejeitam sete', async () => {
  assert.equal(validPassword('1234567'), false);
  assert.equal(validPassword('12345678'), true);
  await assert.rejects(hashPassword('1234567'), /entre 8 e 128/);
  const credentials = await hashPassword('12345678');
  assert(await verifyPassword('12345678', credentials.salt, credentials.hash));
});

test('contas individuais: senha derivada, sessão persistente e usuário desativado', async () => {
  const db = new PGlite();
  try {
    await migrate(db);
    const credentials = await hashPassword('SenhaTemporaria123!');
    assert(await verifyPassword('SenhaTemporaria123!', credentials.salt, credentials.hash));
    assert(!(await verifyPassword('senha-incorreta', credentials.salt, credentials.hash)));
    const account = await db.query(`INSERT INTO public.app_users
      (username, display_name, password_salt, password_hash, role)
      VALUES ('admin', 'Administrador', $1, $2, 'ADMIN') RETURNING id`,
    [credentials.salt, credentials.hash]);
    const token = await createSession(db, account.rows[0].id);
    const request = { headers: { cookie: `estoque_session=${token}` } };
    assert.equal((await findSession(db, request)).username, 'admin');
    await db.query('UPDATE public.app_users SET active = false WHERE id = $1', [account.rows[0].id]);
    assert.equal(await findSession(db, request), null);
  } finally { await db.close(); }
});

test('grupos são verificados na API e somente Admin cria contas', async () => {
  const db = new PGlite();
  try {
    await migrate(db);
    const admin = { id: '11111111-1111-4111-8111-111111111111', role: 'ADMIN', display_name: 'Administrador' };
    const adminCredentials = await hashPassword('SenhaAdminInicial123!');
    await db.query(`INSERT INTO public.app_users
      (id, username, display_name, password_salt, password_hash, role)
      VALUES ($1, 'admin', 'Administrador', $2, $3, 'ADMIN')`,
    [admin.id, adminCredentials.salt, adminCredentials.hash]);
    const coordinator = { id: '22222222-2222-4222-8222-222222222222', role: 'COORDENADOR', display_name: 'Coordenação' };
    const technician = { id: '33333333-3333-4333-8333-333333333333', role: 'TECNICO', display_name: 'Técnico' };
    const operator = { id: '44444444-4444-4444-8444-444444444444', role: 'OPERACIONAL', display_name: 'Operador' };
    const select = (table, columns = '*') => ({ table, action: 'select', columns });
    const insert = (table) => ({ table, action: 'insert', values: { nome: 'Teste' } });
    await authorizeQuery(db, admin, insert('items'));
    await authorizeQuery(db, coordinator, insert('items'));
    await authorizeQuery(db, technician, insert('movements'));
    await assert.rejects(authorizeQuery(db, technician, insert('items')), /Sem permissão/);
    await assert.rejects(authorizeQuery(db, operator, insert('movements')), /Sem permissão/);
    await authorizeQuery(db, operator, select('items'));
    await assert.rejects(authorizeQuery(db, operator, select('fornecedores')), /Sem permissão/);
    await assert.rejects(authorizeQuery(db, admin, select('app_users')), /Sem permissão/);
    await assert.rejects(authorizeQuery(db, admin, select('items', '*,app_users(*)')), /Sem permissão/);
    await assert.rejects(authorizeQuery(db, operator, {
      table: 'production_order_stages', action: 'update', values: { status: 'CONCLUIDA' },
      filters: [{ column: 'id', op: 'eq', value: '55555555-5555-4555-8555-555555555555' }],
    }), /tarefa não está atribuída/);

    // Relações seguem a permissão de leitura da tabela relacionada.
    await assert.rejects(authorizeQuery(db, operator, select('purchase_orders', '*,fornecedores(nome)')), /Sem permissão/);
    await authorizeQuery(db, technician, select('purchase_orders', '*,fornecedores(nome)'));
    await authorizeQuery(db, operator, select('bom_items', '*,item_pai:items!bom_items_item_pai_id_fkey(nome)'));

    // Responsável é sempre o usuário da sessão, inclusive em upsert.
    const upsert = { table: 'production_order_substitutions', action: 'upsert', values: { usuario_nome: 'Outra pessoa' } };
    await authorizeQuery(db, technician, upsert);
    assert.equal(upsert.values.usuario_nome, 'Técnico');
    const montador = { table: 'production_orders', action: 'update', values: { montador_nome: 'Outra pessoa' } };
    await authorizeQuery(db, technician, montador);
    assert.equal(montador.values.montador_nome, 'Técnico');
    await assert.rejects(authorizeQuery(db, admin, {
      table: 'movements', action: 'update', values: { usuario_nome: 'Outra pessoa' },
    }), /não pode ser alterado/);
    // Técnico não recebe compras (o recebimento é uma RPC transacional de Admin/Coordenador).
    await assert.rejects(authorizeQuery(db, technician, { action: 'rpc', name: 'receive_purchase_order', args: {} }), /Sem permissão/);

    const response = {};
    const json = (_response, status, value) => { response.status = status; response.value = value; };
    const body = { username: 'joana', displayName: 'Joana Silva', role: 'OPERACIONAL', password: 'SenhaTemporaria123!' };
    await assert.rejects(handleUserRoute(db, {}, response, '/api/users', coordinator, async () => body, json), /Sem permissão/);
    await handleUserRoute(db, { method: 'POST' }, response, '/api/users', admin, async () => body, json);
    assert.equal(response.status, 201);
    assert.equal(response.value.username, 'joana');
    assert.equal((await db.query('SELECT count(*)::int AS total FROM public.app_users')).rows[0].total, 2);
  } finally { await db.close(); }
});
