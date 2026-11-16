import { createContext, useContext } from 'react';

export type Role = 'ADMIN' | 'COORDENADOR' | 'TECNICO' | 'OPERACIONAL';
export type AuthUser = {
  id: string;
  username: string;
  displayName: string;
  role: Role;
  mustChangePassword: boolean;
};

export const roleNames: Record<Role, string> = {
  ADMIN: 'Admin', COORDENADOR: 'Coordenador', TECNICO: 'Técnico', OPERACIONAL: 'Operacional',
};

// O componente AuthProvider fica em AuthProvider.tsx.
export const AuthContext = createContext<AuthUser | null>(null);
export function useAuth() {
  const user = useContext(AuthContext);
  if (!user) throw new Error('Usuário não autenticado.');
  return user;
}

export function canAccess(role: Role, path: string) {
  if (role === 'ADMIN') return true;
  if (path === '/usuarios') return false;
  if (role === 'COORDENADOR') return true;
  if (['/estoque', '/pedidos', '/producao'].includes(path) || path.startsWith('/producao/')) return true;
  return role === 'TECNICO' && path === '/movimentacoes';
}
