import { useEffect, useState, type FormEvent } from 'react';
import { useAuth, roleNames, type Role } from '@/auth';

type UserRow = {
  id: string; username: string; displayName: string; role: Role;
  active: boolean; mustChangePassword: boolean; createdAt: string;
};
const roleOptions: Role[] = ['ADMIN', 'COORDENADOR', 'TECNICO', 'OPERACIONAL'];

async function request(path: string, options?: RequestInit) {
  const response = await fetch(path, { credentials: 'same-origin', ...options,
    headers: { 'Content-Type': 'application/json', ...options?.headers } });
  const body = await response.json();
  if (response.status === 401) window.dispatchEvent(new Event('session-expired'));
  if (!response.ok) throw new Error(body.error || 'Falha no servidor.');
  return body;
}

export default function UsersPage() {
  const current = useAuth();
  const [users, setUsers] = useState<UserRow[]>([]);
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<Role>('OPERACIONAL');
  const [resetId, setResetId] = useState<string | null>(null);
  const [resetPassword, setResetPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  async function refresh() { setUsers(await request('/api/users')); }
  useEffect(() => { refresh().catch((cause) => setError(cause.message)); }, []);

  async function create(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(''); setSuccess('');
    try {
      await request('/api/users', { method: 'POST', body: JSON.stringify({ username, displayName, password, role }) });
      setUsername(''); setDisplayName(''); setPassword(''); setRole('OPERACIONAL');
      await refresh(); setSuccess('Conta criada. A pessoa deverá trocar a senha no primeiro acesso.');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Falha ao criar usuário.'); }
    finally { setBusy(false); }
  }

  async function update(id: string, changes: object) {
    setBusy(true); setError(''); setSuccess('');
    try {
      await request(`/api/users/${id}`, { method: 'PATCH', body: JSON.stringify(changes) });
      await refresh(); setSuccess('Conta atualizada.');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Falha ao atualizar usuário.'); }
    finally { setBusy(false); }
  }

  async function reset(event: FormEvent) {
    event.preventDefault();
    if (!resetId) return;
    setBusy(true); setError(''); setSuccess('');
    try {
      await request(`/api/users/${resetId}/reset-password`, {
        method: 'POST', body: JSON.stringify({ password: resetPassword }),
      });
      setResetId(null); setResetPassword(''); await refresh();
      setSuccess('Senha temporária definida. As sessões anteriores foram encerradas.');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Falha ao redefinir senha.'); }
    finally { setBusy(false); }
  }

  return (
    <div className="space-y-6 max-w-5xl">
      <div><h2 className="text-xl font-semibold">Usuários e acessos</h2>
        <p className="text-sm text-muted-foreground mt-1">Somente o Admin cria contas. Senhas temporárias devem ser trocadas no primeiro acesso.</p>
      </div>
      <form onSubmit={create} className="rounded-xl border border-border bg-card p-5 space-y-4">
        <h3 className="font-semibold">Criar conta</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm">Nome da pessoa
            <input required minLength={2} maxLength={120} value={displayName} onChange={(e) => setDisplayName(e.target.value)}
              className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2" />
          </label>
          <label className="text-sm">Login (e-mail ou usuário)
            <input required minLength={3} maxLength={120} pattern="[a-zA-Z0-9._%+\-]+(@[a-zA-Z0-9\-]+(\.[a-zA-Z0-9\-]+)*\.[a-zA-Z]{2,})?"
              title="Um e-mail (ex.: nome@empresa.com.br) ou um login com letras, números, ponto, hífen ou _."
              value={username} autoComplete="off"
              onChange={(e) => setUsername(e.target.value.trim())} placeholder="ex: nome@empresa.com.br"
              className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2" />
          </label>
          <label className="text-sm">Grupo
            <select value={role} onChange={(e) => setRole(e.target.value as Role)}
              className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2">
              {roleOptions.map((option) => <option value={option} key={option}>{roleNames[option]}</option>)}
            </select>
          </label>
          <label className="text-sm">Senha temporária (mínimo 8 caracteres)
            <input type="password" required minLength={8} maxLength={128} autoComplete="new-password"
              value={password} onChange={(e) => setPassword(e.target.value)}
              className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2" />
          </label>
        </div>
        <button disabled={busy} className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50">Criar usuário</button>
      </form>

      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {success && <p role="status" className="text-sm text-success">{success}</p>}

      <div className="rounded-xl border border-border bg-card divide-y divide-border">
        <div className="p-4 font-semibold">Contas ({users.length})</div>
        {users.map((account) => (
          <div key={account.id} className="p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div><div className="font-medium">{account.displayName} <span className="text-muted-foreground text-sm">@{account.username}</span></div>
                <div className="text-xs text-muted-foreground">{account.active ? 'Ativo' : 'Desativado'} · {account.mustChangePassword ? 'Troca de senha pendente' : 'Senha definida'}</div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <select aria-label={`Grupo de ${account.displayName}`} value={account.role} disabled={busy || account.id === current.id}
                  onChange={(e) => update(account.id, { role: e.target.value })}
                  className="rounded-md border border-border bg-background px-2 py-1.5 text-sm">
                  {roleOptions.map((option) => <option value={option} key={option}>{roleNames[option]}</option>)}
                </select>
                <button disabled={busy || account.id === current.id} onClick={() => update(account.id, { active: !account.active })}
                  className="rounded-md border border-border px-3 py-1.5 text-sm disabled:opacity-50">
                  {account.active ? 'Desativar' : 'Reativar'}
                </button>
                <button disabled={busy} onClick={() => { setResetId(resetId === account.id ? null : account.id); setResetPassword(''); }}
                  className="rounded-md border border-border px-3 py-1.5 text-sm">Redefinir senha</button>
              </div>
            </div>
            {resetId === account.id && (
              <form onSubmit={reset} className="flex flex-wrap gap-2 items-end">
                <label className="text-sm flex-1 min-w-48">Nova senha temporária
                  <input type="password" required minLength={8} maxLength={128} autoComplete="new-password"
                    value={resetPassword} onChange={(e) => setResetPassword(e.target.value)}
                    className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2" />
                </label>
                <button disabled={busy} className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50">Salvar senha</button>
              </form>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
