import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

const output = resolve('../output/backup-antes-importacao-csv-2026-10-14.dump');
if (existsSync(output)) throw new Error(`Backup já existe: ${output}`);
mkdirSync(resolve('../output'), { recursive: true });
const bin = 'C:\\Program Files\\PostgreSQL\\17\\bin\\';
const dump = spawnSync(`${bin}pg_dump.exe`, ['--format=custom', '--file', output], { stdio: 'inherit', env: process.env });
if (dump.status !== 0) throw new Error(`pg_dump falhou: ${dump.status}`);
if (statSync(output).size === 0) throw new Error('Backup vazio');
const inspect = spawnSync(`${bin}pg_restore.exe`, ['--list', output], { stdio: ['ignore', 'ignore', 'inherit'] });
if (inspect.status !== 0) throw new Error('Backup inválido');
console.log(JSON.stringify({ backup: output, bytes: statSync(output).size }));
