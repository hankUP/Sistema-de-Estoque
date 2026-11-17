import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import pg from 'pg';
import { executeQuery, loadSchema } from './query.mjs';
import { authorizeQuery, clearSessionCookie, createSession, findSession,
  hashToken, publicUser, sessionCookie, sessionToken, verifyPassword } from './auth.mjs';
import { handleUserRoute } from './user-routes.mjs';

if (!process.env.DATABASE_URL && !process.env.PGHOST) throw new Error('Defina DATABASE_URL ou PGHOST.');
pg.types.setTypeParser(1700, Number);
const pool = new pg.Pool({ ...(process.env.DATABASE_URL ? { connectionString: process.env.DATABASE_URL } : {}), max: 10 });
await pool.query('SELECT 1');
const schema = await loadSchema(pool);
const failedLogins = new Map();

// Remove sessões vencidas ao iniciar e a cada hora.
async function purgeExpiredSessions() {
  try {
    const result = await pool.query('DELETE FROM public.app_sessions WHERE expires_at <= now()');
    if (result.rowCount) console.log(`Sessões vencidas removidas: ${result.rowCount}`);
  } catch (error) {
    console.error('Falha ao remover sessões vencidas:', error.message);
  }
}
await purgeExpiredSessions();
setInterval(purgeExpiredSessions, 60 * 60_000).unref();
const host = process.env.HOST || '127.0.0.1';
const port = Number(process.env.PORT || 3001);
const staticRoot = resolve(import.meta.dirname, '../dist');

function json(response, status, value, headers = {}) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  response.end(JSON.stringify(value));
}

function readJson(request) {
  return new Promise((resolveBody, reject) => {
    let content = '';
    request.on('data', (chunk) => {
      content += chunk;
      if (content.length > 1_000_000) request.destroy();
    });
    request.on('end', () => {
      try { resolveBody(JSON.parse(content)); }
      catch { reject(new Error('JSON inválido')); }
    });
    request.on('error', reject);
  });
}

function sameOrigin(request) {
  const origin = request.headers.origin;
  return !origin || new URL(origin).host === request.headers.host;
}

const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2' };

async function serveStatic(pathname, response) {
  const requested = resolve(staticRoot, `.${decodeURIComponent(pathname)}`);
  if (requested !== staticRoot && !requested.startsWith(staticRoot + sep)) {
    response.writeHead(403).end(); return;
  }
  let file = requested;
  try {
    if (!(await stat(file)).isFile()) file = join(staticRoot, 'index.html');
  } catch { file = join(staticRoot, 'index.html'); }
  try {
    const bytes = await readFile(file);
    response.writeHead(200, { 'Content-Type': `${mime[extname(file)] || 'application/octet-stream'}; charset=utf-8`,
      'X-Content-Type-Options': 'nosniff', 'Cache-Control': file.endsWith('index.html') ? 'no-store' : 'public, max-age=3600' });
    response.end(bytes);
  } catch { response.writeHead(404).end('Execute npm run build primeiro.'); }
}

const server = createServer(async (request, response) => {
  try {
    const pathname = new URL(request.url, `http://${request.headers.host}`).pathname;
    if (pathname.startsWith('/api/')) {
      if (request.method !== 'GET' && !sameOrigin(request)) return json(response, 403, { error: 'Origem inválida' });
      if (pathname === '/api/session' && request.method === 'GET') {
        const user = await findSession(pool, request);
        return json(response, 200, { authenticated: !!user, user: user ? publicUser(user) : null });
      }
      if (pathname === '/api/session' && request.method === 'POST') {
        const body = await readJson(request);
        const username = String(body.username || '').trim().toLowerCase().slice(0, 64);
        const address = request.socket.remoteAddress || 'unknown';
        const key = `${address}:${username}`;
        const now = Date.now();
        if (failedLogins.size > 5000) {
          for (const [entryKey, entry] of failedLogins) if (entry.until < now && entry.last < now - 15 * 60_000) failedLogins.delete(entryKey);
        }
        let attempts = failedLogins.get(key);
        // Bloqueio expirado: recomeça a contagem em vez de bloquear no próximo erro.
        if (!attempts || (attempts.until && attempts.until <= now)) attempts = { count: 0, until: 0, last: now };
        if (attempts.until > now) return json(response, 429, { error: 'Muitas tentativas. Aguarde 15 minutos.' });
        const account = username && (await pool.query('SELECT * FROM public.app_users WHERE username = $1', [username])).rows[0];
        const valid = await verifyPassword(body.password, account?.password_salt || '0'.repeat(32),
          account?.password_hash || '0'.repeat(128));
        if (!account?.active || !valid) {
          attempts.count++;
          attempts.last = Date.now();
          attempts.until = attempts.count >= 5 ? Date.now() + 15 * 60_000 : 0;
          failedLogins.set(key, attempts);
          return json(response, 401, { error: 'Login ou senha inválidos.' });
        }
        failedLogins.delete(key);
        const token = await createSession(pool, account.id);
        return json(response, 200, { authenticated: true, user: publicUser(account) },
          { 'Set-Cookie': sessionCookie(token) });
      }
      if (pathname === '/api/session' && request.method === 'DELETE') {
        const token = sessionToken(request);
        if (token) await pool.query('DELETE FROM public.app_sessions WHERE token_hash = $1', [hashToken(token)]);
        return json(response, 200, { authenticated: false }, { 'Set-Cookie': clearSessionCookie() });
      }
      const user = await findSession(pool, request);
      if (!user) return json(response, 401, { error: 'Sessão expirada. Entre novamente.' });
      // "return await": sem o await, erros de validação escapavam do catch abaixo e derrubavam o servidor.
      if (pathname === '/api/password' && request.method === 'POST') {
        return await handleUserRoute(pool, request, response, pathname, user, readJson, json);
      }
      if (user.must_change_password) return json(response, 403, { error: 'Troque sua senha antes de continuar.' });
      if (pathname === '/api/operators' && request.method === 'GET') {
        if (user.role !== 'ADMIN' && user.role !== 'COORDENADOR') return json(response, 403, { error: 'Sem permissão.' });
        // ?todos=1 lista todos os usuários ativos (correção de montador); sem ele, só quem recebe atribuições.
        const everyone = new URL(request.url, 'http://localhost').searchParams.get('todos') === '1';
        const operators = await pool.query(`SELECT id, display_name, role FROM public.app_users
          WHERE active AND ($1 OR role IN ('TECNICO', 'OPERACIONAL')) ORDER BY display_name`, [everyone]);
        return json(response, 200, operators.rows.map((row) => ({ id: row.id, displayName: row.display_name, role: row.role })));
      }
      if (pathname === '/api/users' || pathname.startsWith('/api/users/')) {
        return await handleUserRoute(pool, request, response, pathname, user, readJson, json);
      }
      if (pathname === '/api/query' && request.method === 'POST') {
        const input = await readJson(request);
        await authorizeQuery(pool, user, input);
        const result = await executeQuery(pool, schema, input, user);
        return json(response, 200, result);
      }
      return json(response, 404, { error: 'Rota desconhecida' });
    }
    if (request.method === 'GET' || request.method === 'HEAD') return await serveStatic(pathname, response);
    response.writeHead(405).end();
  } catch (error) {
    console.error(error);
    if (!response.headersSent) json(response, error.status || (error.code === '23505' ? 409 : 400),
      { error: error.code === '23505' ? 'Já existe um registro com esses dados.' : error.message || 'Erro interno' });
  }
});

server.listen(port, host, () => console.log(`Servidor disponível em http://${host}:${port}`));
process.on('SIGINT', async () => { server.close(); await pool.end(); process.exit(0); });
// Rede de segurança: um erro assíncrono não tratado é registrado, mas não derruba o sistema para todos.
process.on('unhandledRejection', (error) => console.error('Erro não tratado:', error));
