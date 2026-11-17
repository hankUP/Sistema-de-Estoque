import { hashPassword, verifyPassword, validPassword, publicUser, assertRole, hashToken, sessionToken } from './auth.mjs';

// Login: nome de usuário (3 a 40: letras, números, ponto, hífen ou _) ou e-mail (ex.: nome@empresa.com.br).
// Mesma regra do banco (migração 013).
const loginPattern = /^[a-z0-9._-]{3,40}$/;
const emailPattern = /^[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/;
const validLogin = (value) => loginPattern.test(value) || (value.length <= 120 && emailPattern.test(value));
const uuidPattern = /^[a-f0-9-]{36}$/i;
const validRole = (value) => ['ADMIN', 'COORDENADOR', 'TECNICO', 'OPERACIONAL'].includes(value);
const badRequest = (message) => { throw Object.assign(new Error(message), { status: 400 }); };

export async function handleUserRoute(pool, request, response, pathname, user, readJson, json) {
  if (pathname === '/api/password' && request.method === 'POST') {
    const body = await readJson(request);
    if (!validPassword(body.newPassword)) badRequest('A nova senha deve ter entre 8 e 128 caracteres.');
    const account = (await pool.query('SELECT * FROM public.app_users WHERE id = $1 AND active', [user.id])).rows[0];
    if (!account || !(await verifyPassword(body.currentPassword, account.password_salt, account.password_hash))) {
      badRequest('Senha atual incorreta.');
    }
    if (body.currentPassword === body.newPassword) badRequest('Escolha uma senha diferente da atual.');
    const credentials = await hashPassword(body.newPassword);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const updated = await client.query(`UPDATE public.app_users SET password_salt = $2,
        password_hash = $3, must_change_password = false, updated_at = now()
        WHERE id = $1 RETURNING id, username, display_name, role, must_change_password`,
      [user.id, credentials.salt, credentials.hash]);
      await client.query('DELETE FROM public.app_sessions WHERE user_id = $1 AND token_hash <> $2',
        [user.id, hashToken(sessionToken(request))]);
      await client.query('COMMIT');
      return json(response, 200, { user: publicUser(updated.rows[0]) });
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }

  assertRole(user, 'ADMIN');
  if (pathname === '/api/users' && request.method === 'GET') {
    const rows = await pool.query(`SELECT id, username, display_name, role, active,
      must_change_password, created_at FROM public.app_users ORDER BY display_name, username`);
    return json(response, 200, rows.rows.map((row) => ({
      id: row.id, username: row.username, displayName: row.display_name,
      role: row.role, active: row.active, mustChangePassword: row.must_change_password,
      createdAt: row.created_at,
    })));
  }
  if (pathname === '/api/users' && request.method === 'POST') {
    const body = await readJson(request);
    const username = String(body.username || '').trim().toLowerCase();
    const displayName = String(body.displayName || '').trim();
    if (!validLogin(username)) badRequest('Use um e-mail (ex.: nome@empresa.com.br) ou um login de 3 a 40 caracteres: letras, números, ponto, hífen ou _.');
    if (displayName.length < 2 || displayName.length > 120) badRequest('Nome deve ter entre 2 e 120 caracteres.');
    if (!validRole(body.role)) badRequest('Grupo inválido.');
    if (!validPassword(body.password)) badRequest('A senha inicial deve ter entre 8 e 128 caracteres.');
    const credentials = await hashPassword(body.password);
    const result = await pool.query(`INSERT INTO public.app_users
      (username, display_name, password_salt, password_hash, role, created_by)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id, username, display_name, role, active, must_change_password, created_at`,
    [username, displayName, credentials.salt, credentials.hash, body.role, user.id]);
    const row = result.rows[0];
    return json(response, 201, { id: row.id, username: row.username,
      displayName: row.display_name, role: row.role, active: row.active,
      mustChangePassword: row.must_change_password, createdAt: row.created_at });
  }

  const match = /^\/api\/users\/([a-f0-9-]{36})(?:\/(reset-password))?$/.exec(pathname);
  if (!match || !uuidPattern.test(match[1])) badRequest('Rota desconhecida.');
  const targetId = match[1];
  if (match[2] === 'reset-password' && request.method === 'POST') {
    const body = await readJson(request);
    if (!validPassword(body.password)) badRequest('A senha temporária deve ter entre 8 e 128 caracteres.');
    const credentials = await hashPassword(body.password);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const updated = await client.query(`UPDATE public.app_users
        SET password_salt = $2, password_hash = $3, must_change_password = true, updated_at = now()
        WHERE id = $1 RETURNING id`, [targetId, credentials.salt, credentials.hash]);
      if (!updated.rowCount) badRequest('Usuário não encontrado.');
      await client.query('DELETE FROM public.app_sessions WHERE user_id = $1', [targetId]);
      await client.query('COMMIT');
      return json(response, 200, { ok: true });
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }
  if (!match[2] && request.method === 'PATCH') {
    const body = await readJson(request);
    const fields = Object.keys(body);
    if (!fields.length || fields.some((field) => !['displayName', 'role', 'active'].includes(field))) badRequest('Alterações inválidas.');
    if (body.displayName !== undefined && (typeof body.displayName !== 'string'
      || body.displayName.trim().length < 2 || body.displayName.trim().length > 120)) badRequest('Nome inválido.');
    if (body.role !== undefined && !validRole(body.role)) badRequest('Grupo inválido.');
    if (body.active !== undefined && typeof body.active !== 'boolean') badRequest('Estado inválido.');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('LOCK TABLE public.app_users IN SHARE ROW EXCLUSIVE MODE');
      const target = (await client.query('SELECT * FROM public.app_users WHERE id = $1 FOR UPDATE', [targetId])).rows[0];
      if (!target) badRequest('Usuário não encontrado.');
      const role = body.role ?? target.role;
      const active = body.active ?? target.active;
      if (targetId === user.id && (role !== 'ADMIN' || !active)) badRequest('Você não pode remover seu próprio acesso de Admin.');
      if (target.role === 'ADMIN' && target.active && (role !== 'ADMIN' || !active)) {
        const admins = (await client.query("SELECT count(*)::int AS total FROM public.app_users WHERE role = 'ADMIN' AND active")).rows[0].total;
        if (admins <= 1) badRequest('É necessário manter pelo menos um Admin ativo.');
      }
      const result = await client.query(`UPDATE public.app_users SET display_name = $2,
        role = $3, active = $4, updated_at = now() WHERE id = $1
        RETURNING id, username, display_name, role, active, must_change_password, created_at`,
      [targetId, body.displayName?.trim() ?? target.display_name, role, active]);
      if (!active || role !== target.role) await client.query('DELETE FROM public.app_sessions WHERE user_id = $1', [targetId]);
      await client.query('COMMIT');
      const row = result.rows[0];
      return json(response, 200, { id: row.id, username: row.username,
        displayName: row.display_name, role: row.role, active: row.active,
        mustChangePassword: row.must_change_password, createdAt: row.created_at });
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }
  badRequest('Rota desconhecida.');
}

