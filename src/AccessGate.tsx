import { useEffect, useState, type FormEvent } from 'react';
import App, { queryClient } from './App';
import type { AuthUser } from './auth';
import { BrandMark } from './components/BrandMark';

const inputClass = 'w-full rounded-md border border-input bg-background px-3 py-2.5 text-foreground outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/25';
const buttonClass = 'w-full rounded-md bg-primary px-4 py-2.5 font-semibold text-primary-foreground shadow-lg shadow-primary/25 transition-colors hover:bg-primary/90 disabled:opacity-50';

export default function AccessGate() {
  const [status, setStatus] = useState<'checking' | 'login' | 'password' | 'ready' | 'offline'>('checking');
  const [user, setUser] = useState<AuthUser | null>(null);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const expired = () => {
      queryClient.clear();
      setUser(null);
      setPassword('');
      setStatus('login');
    };
    window.addEventListener('session-expired', expired);
    fetch('/api/session', { credentials: 'same-origin' })
      .then(async (response) => {
        if (!response.ok) throw new Error();
        const session = await response.json();
        setUser(session.user);
        setStatus(session.authenticated ? session.user.mustChangePassword ? 'password' : 'ready' : 'login');
      })
      .catch(() => setStatus('offline'));
    return () => window.removeEventListener('session-expired', expired);
  }, []);

  async function login(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/session', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin', body: JSON.stringify({ username, password }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Falha ao entrar.');
      queryClient.clear();
      setUser(result.user);
      setStatus(result.user.mustChangePassword ? 'password' : 'ready');
      if (!result.user.mustChangePassword) setPassword('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Falha ao entrar.');
    } finally { setBusy(false); }
  }

  async function changePassword(event: FormEvent) {
    event.preventDefault();
    if (newPassword !== confirmPassword) { setError('As senhas novas não coincidem.'); return; }
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/password', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ currentPassword: password, newPassword }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Não foi possível trocar a senha.');
      queryClient.clear();
      setUser(result.user);
      setPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setStatus('ready');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Falha ao trocar a senha.');
    } finally { setBusy(false); }
  }

  if (status === 'ready' && user) return <App user={user} />;
  return (
    <main className="relative min-h-screen overflow-hidden bg-background flex items-center justify-center p-6">
      <div className="pointer-events-none absolute -top-40 left-1/2 h-[28rem] w-[28rem] -translate-x-1/2 rounded-full bg-primary/15 blur-3xl" aria-hidden />
      <div className="relative w-full max-w-sm overflow-hidden rounded-xl bg-card shadow-2xl shadow-black/60 border border-border">
        <div className="brand-stripe h-1" aria-hidden />
        <div className="p-8">
        <BrandMark size="lg" subtitle="Estoque, Compras e Produção" />
        <h1 className="mt-8 text-lg font-semibold text-foreground">
          {status === 'password' ? 'Defina sua nova senha' : 'Acesse sua conta'}
        </h1>
        {status === 'checking' && <p className="mt-4 text-muted-foreground">Conectando ao servidor...</p>}
        {status === 'offline' && <p className="mt-4 text-destructive">Servidor indisponível. Recarregue a página.</p>}
        {status === 'login' && (
          <form onSubmit={login} className="mt-6 space-y-4">
            <label className="block text-sm font-medium" htmlFor="username">Usuário</label>
            <input id="username" autoComplete="username" required value={username}
              onChange={(event) => setUsername(event.target.value)}
              className={inputClass} />
            <label className="block text-sm font-medium" htmlFor="password">Senha</label>
            <input id="password" type="password" autoComplete="current-password" required value={password}
              onChange={(event) => setPassword(event.target.value)}
              className={inputClass} />
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
            <button disabled={busy} type="submit" className={buttonClass}>
              {busy ? 'Entrando...' : 'Entrar'}
            </button>
          </form>
        )}
        {status === 'password' && (
          <form onSubmit={changePassword} className="mt-6 space-y-4">
            <p className="text-sm text-muted-foreground">Olá, {user?.displayName}. Troque sua senha temporária para continuar.</p>
            <label className="block text-sm font-medium" htmlFor="current-password">Senha atual</label>
            <input id="current-password" type="password" autoComplete="current-password" required value={password}
              onChange={(event) => setPassword(event.target.value)}
              className={inputClass} />
            <label className="block text-sm font-medium" htmlFor="new-password">Nova senha (mínimo 8 caracteres)</label>
            <input id="new-password" type="password" autoComplete="new-password" required minLength={8}
              value={newPassword} onChange={(event) => setNewPassword(event.target.value)}
              className={inputClass} />
            <label className="block text-sm font-medium" htmlFor="confirm-password">Confirme a nova senha</label>
            <input id="confirm-password" type="password" autoComplete="new-password" required
              value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)}
              className={inputClass} />
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
            <button disabled={busy} type="submit" className={buttonClass}>
              {busy ? 'Salvando...' : 'Salvar nova senha'}
            </button>
          </form>
        )}
        </div>
      </div>
    </main>
  );
}
