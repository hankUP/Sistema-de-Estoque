import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback);
export const roles = ['ADMIN', 'COORDENADOR', 'TECNICO', 'OPERACIONAL'];
const sessionHours = 12;
const allowedRead = new Set([
  'items', 'movements', 'reservations', 'purchase_orders', 'centros_custo',
  'bom_items', 'production_orders', 'production_order_items',
  'production_order_stages', 'production_stage_pauses', 'production_stage_templates',
  'production_order_substitutions', 'kit_plans',
]);
const technicianReadExtra = new Set([
  'fornecedores', 'item_fornecedores', 'item_fornecedor_precos', 'purchase_order_recebimentos',
]);
const technicianWrites = new Map([
  ['movements', new Set(['insert'])],
  ['production_orders', new Set(['update'])],
  ['production_order_stages', new Set(['insert', 'update'])],
  ['production_stage_pauses', new Set(['insert', 'update'])],
  ['production_order_substitutions', new Set(['insert', 'update', 'upsert', 'delete'])],
]);
const technicianRpcs = new Set([
  'work_queue_availability', 'start_production_order', 'complete_production_order',
  'registrar_preco_historico',
]);
// Registros cujo autor é fixado na criação e nunca pode ser alterado.
const recordActorColumns = new Map([
  ['movements', 'usuario_nome'],
  ['production_order_substitutions', 'usuario_nome'],
]);
// Colunas de quem executa o trabalho: quando enviadas, recebem o usuário da sessão.
const workActorColumns = new Map([
  ['production_orders', 'montador_nome'],
  ['production_order_stages', 'montador_nome'],
  ['kit_plans', 'responsavel'],
]);
const deniedGenericTables =new Set(['app_users', 'app_sessions', 'app_migrations']);

export function publicUser(row) {
  return { id: row.id, username: row.username, displayName: row.display_name,
    role: row.role, mustChangePassword: row.must_change_password };
}

export function validPassword(password) {
  return typeof password === 'string' && password.length >= 8 && password.length <= 128;
}

export async function hashPassword(password) {
  if (!validPassword(password)) throw new Error('A senha deve ter entre 8 e 128 caracteres.');
  const salt = randomBytes(16).toString('hex');
  const hash = (await scrypt(password, salt, 64)).toString('hex');
  return { salt, hash };
}

export async function verifyPassword(password, salt, hash) {
  if (typeof password !== 'string' || password.length > 128 || !salt || !hash) return false;
  const candidate = await scrypt(password, salt, 64);
  const stored = Buffer.from(hash, 'hex');
  return stored.length === candidate.length && timingSafeEqual(stored, candidate);
}

export function sessionToken(request) {
  return /(?:^|;\s*)estoque_session=([a-f0-9]{64})(?:;|$)/.exec(request.headers.cookie || '')?.[1] || null;
}

export function hashToken(token) { return createHash('sha256').update(token).digest('hex'); }

export async function findSession(pool, request) {
  const token = sessionToken(request);
  if (!token) return null;
  const result = await pool.query(`SELECT u.id, u.username, u.display_name, u.role, u.must_change_password
    FROM public.app_sessions s JOIN public.app_users u ON u.id = s.user_id
    WHERE s.token_hash = $1 AND s.expires_at > now() AND u.active`, [hashToken(token)]);
  return result.rows[0] || null;
}

export async function createSession(pool, userId) {
  const token = randomBytes(32).toString('hex');
  await pool.query(`INSERT INTO public.app_sessions (token_hash, user_id, expires_at)
    VALUES ($1, $2, now() + ($3::text || ' hours')::interval)`,
  [hashToken(token), userId, sessionHours]);
  return token;
}

export function sessionCookie(token) {
  const secure = process.env.COOKIE_SECURE === 'true' ? '; Secure' : '';
  return `estoque_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${sessionHours * 3600}${secure}`;
}

export function clearSessionCookie() {
  const secure = process.env.COOKIE_SECURE === 'true' ? '; Secure' : '';
  return `estoque_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secure}`;
}

export function assertRole(user, ...permitted) {
  if (!permitted.includes(user.role)) throw Object.assign(new Error('Sem permissão para esta operação.'), { status: 403 });
}

function queryPermission(user, input) {
  if (typeof input?.columns === 'string' && /\b(?:app_users|app_sessions|app_migrations)(?:!\w+)?\s*\(/i.test(input.columns)) return false;
  if (input.action === 'rpc') {
    if (user.role === 'ADMIN' || user.role === 'COORDENADOR') return true;
    if (input.name === 'work_queue_availability') return true;
    return (user.role === 'TECNICO' && technicianRpcs.has(input.name))
      || (user.role === 'OPERACIONAL' && ['start_production_order', 'complete_production_order'].includes(input.name));
  }
  if (deniedGenericTables.has(input.table)) return false;
  if (user.role === 'ADMIN' || user.role === 'COORDENADOR') return true;
  const canRead = (table) => allowedRead.has(table) || (user.role === 'TECNICO' && technicianReadExtra.has(table));
  // Tabelas relacionadas (ex.: "*,fornecedores(*)") exigem a mesma permissão de leitura.
  const relations = typeof input?.columns === 'string'
    ? [...input.columns.matchAll(/([A-Za-z_]\w*)(?:!\w+)?\s*\(/g)].map((match) => match[1])
    : [];
  if (relations.some((table) => !canRead(table))) return false;
  if (input.action === 'select') return canRead(input.table);
  if (user.role === 'TECNICO') {
    if (input.table === 'production_orders' && input.action === 'update') {
      const allowed = new Set(['montador_nome', 'modo_execucao']);
      return Object.keys(input.values || {}).length > 0 && Object.keys(input.values).every((key) => allowed.has(key));
    }
    return technicianWrites.get(input.table)?.has(input.action) || false;
  }
  return user.role === 'OPERACIONAL'
    && ((input.table === 'production_order_stages' && input.action === 'update')
      || (input.table === 'production_stage_pauses' && ['insert', 'update'].includes(input.action)));
}

async function assignedToOperationalUser(pool, user, input) {
  const table = input.table;
  const idFilter = input.filters?.find((filter) => filter.column === 'id' && filter.op === 'eq');
  let stageId;
  if (table === 'production_order_stages') {
    if (!idFilter || Object.keys(input.values || {}).some((key) => ![
      'status', 'started_at', 'completed_at', 'paused_at', 'tempo_pausado_seg',
      'montador_nome', 'tempo_bruto_seg', 'tempo_produtivo_seg',
    ].includes(key))) return false;
    stageId = idFilter.value;
    if (input.values?.montador_nome && input.values.montador_nome !== user.display_name) return false;
  } else if (input.action === 'insert') {
    const rows = Array.isArray(input.values) ? input.values : [input.values];
    if (rows.length !== 1) return false;
    if (Object.keys(rows[0] || {}).some((key) => !['stage_id', 'motivo'].includes(key))) return false;
    stageId = rows[0]?.stage_id;
  } else {
    if (!idFilter) return false;
    if (Object.keys(input.values || {}).some((key) => !['ended_at', 'duracao_seg'].includes(key))) return false;
    const result = await pool.query('SELECT stage_id FROM public.production_stage_pauses WHERE id = $1', [idFilter.value]);
    stageId = result.rows[0]?.stage_id;
  }
  if (typeof stageId !== 'string') return false;
  const assigned = await pool.query(`SELECT 1 FROM public.production_order_stages s
    JOIN public.production_orders o ON o.id = s.production_order_id
    WHERE s.id = $1 AND o.status = 'EM_PRODUCAO'
      AND o.assigned_user_id = $2`,
  [stageId, user.id]);
  return assigned.rowCount === 1;
}

export async function authorizeQuery(pool, user, input) {
  if (!queryPermission(user, input)) throw Object.assign(new Error('Sem permissão para esta operação.'), { status: 403 });
  if (user.role === 'OPERACIONAL' && input.action === 'rpc'
    && ['start_production_order', 'complete_production_order'].includes(input.name)) {
    const order = await pool.query('SELECT assigned_user_id FROM public.production_orders WHERE id = $1', [input.args?._id]);
    if (order.rows[0]?.assigned_user_id !== user.id) {
      throw Object.assign(new Error('Esta ordem não está atribuída a você.'), { status: 403 });
    }
  }
  if (input.action === 'rpc') {
    const args = input.args && typeof input.args === 'object' && !Array.isArray(input.args) ? input.args : {};
    if (['start_production_order', 'start_kit_plan'].includes(input.name)) {
      input.args = { ...args, _responsavel: user.display_name };
    } else if (['create_item_with_initial_stock', 'update_item_with_stock_adjustment'].includes(input.name)) {
      input.args = { ...args, _operator: user.display_name };
    }
  }
  // O responsável é sempre o usuário da sessão: nomes enviados pelo navegador são ignorados.
  const recordActor = recordActorColumns.get(input.table);
  if (recordActor && (input.action === 'insert' || input.action === 'upsert')) {
    const setActor = (row) => row && typeof row === 'object' && !Array.isArray(row)
      ? { ...row, [recordActor]: user.display_name }
      : row;
    input.values = Array.isArray(input.values) ? input.values.map(setActor) : setActor(input.values);
  }
  if (recordActor && input.action === 'update' && Object.hasOwn(input.values || {}, recordActor)) {
    throw Object.assign(new Error('O responsável deste registro não pode ser alterado.'), { status: 403 });
  }
  const workActor = workActorColumns.get(input.table);
  if (workActor && ['insert', 'upsert', 'update'].includes(input.action)) {
    const setWorker = (row) => row && typeof row === 'object' && !Array.isArray(row) && Object.hasOwn(row, workActor)
      ? { ...row, [workActor]: user.display_name }
      : row;
    input.values = Array.isArray(input.values) ? input.values.map(setWorker) : setWorker(input.values);
  }
  if (input.table === 'movements' && input.action === 'upsert') {
    throw Object.assign(new Error('Movimentações não podem ser substituídas.'), { status: 403 });
  }
  if (user.role === 'OPERACIONAL' && input.action !== 'select' && input.action !== 'rpc') {
    if (!(await assignedToOperationalUser(pool, user, input))) {
      throw Object.assign(new Error('Esta tarefa não está atribuída a você.'), { status: 403 });
    }
  }
}
