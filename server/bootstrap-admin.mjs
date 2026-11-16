import pg from 'pg';
import { hashPassword } from './auth.mjs';

const client = new pg.Client(process.env.DATABASE_URL ? { connectionString: process.env.DATABASE_URL } : {});
await client.connect();
try {
  await client.query('BEGIN');
  await client.query("SELECT pg_advisory_xact_lock(hashtext('bootstrap-admin'))");
  const count = await client.query('SELECT count(*)::int AS total FROM public.app_users');
  if (count.rows[0].total !== 0) {
    console.log('Usuários existentes; o Admin inicial não foi recriado.');
  } else {
    if (!process.env.APP_PASSWORD || process.env.APP_PASSWORD.length < 8) {
      throw new Error('Defina APP_PASSWORD com pelo menos 8 caracteres para criar o primeiro Admin.');
    }
    const credentials = await hashPassword(process.env.APP_PASSWORD);
    await client.query(`INSERT INTO public.app_users
      (username, display_name, password_salt, password_hash, role, must_change_password)
      VALUES ('admin', 'Administrador', $1, $2, 'ADMIN', true)`,
    [credentials.salt, credentials.hash]);
    console.log('Conta admin criada. Entre com a senha atual do sistema e troque-a no primeiro acesso.');
  }
  await client.query('COMMIT');
} catch (error) {
  await client.query('ROLLBACK');
  throw error;
} finally {
  await client.end();
}
