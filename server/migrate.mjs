import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import pg from 'pg';

if (!process.env.DATABASE_URL && !process.env.PGHOST) throw new Error('Defina DATABASE_URL ou PGHOST.');
const client = new pg.Client(process.env.DATABASE_URL ? { connectionString: process.env.DATABASE_URL } : {});
await client.connect();
try {
  await client.query('CREATE TABLE IF NOT EXISTS app_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
  const directory = join(import.meta.dirname, 'migrations');
  for (const name of (await readdir(directory)).filter((entry) => entry.endsWith('.sql')).sort()) {
    const exists = await client.query('SELECT 1 FROM app_migrations WHERE name = $1', [name]);
    if (exists.rowCount) continue;
    const sql = await readFile(join(directory, name), 'utf8');
    await client.query('BEGIN');
    try {
      await client.query(sql);
      await client.query('INSERT INTO app_migrations (name) VALUES ($1)', [name]);
      await client.query('COMMIT');
      console.log(`Aplicada: ${name}`);
    } catch (error) {
      await client.query('ROLLBACK');
      throw new Error(`Falha na migração ${name}: ${error.message}`, { cause: error });
    }
  }
} finally {
  await client.end();
}
