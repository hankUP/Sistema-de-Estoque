import type { ReactNode } from 'react';
import { AuthContext, type AuthUser } from './auth';

export function AuthProvider({ user, children }: { user: AuthUser; children: ReactNode }) {
  return <AuthContext.Provider value={user}>{children}</AuthContext.Provider>;
}
