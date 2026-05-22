import { useCallback, useEffect, useMemo, useState } from 'react';
import type { AccountData, User } from '../types';
import { visibleAccountsForUser } from './clientAccess';

export type ClientScope = 'all' | string;

const CLIENT_SCOPE_KEY = 'avito-client-scope';

function loadClientScope(): ClientScope {
  try {
    return localStorage.getItem(CLIENT_SCOPE_KEY) || 'all';
  } catch {
    return 'all';
  }
}

function saveClientScope(scope: ClientScope) {
  try {
    localStorage.setItem(CLIENT_SCOPE_KEY, scope);
  } catch {
    // Не блокируем интерфейс, если браузер запретил localStorage.
  }
}

export function useClientScope(
  user: User | null | undefined,
  accountsMap: Record<string, AccountData>
) {
  const [scope, setScopeState] = useState<ClientScope>(() => loadClientScope());
  const visibleAccounts = useMemo(
    () => visibleAccountsForUser(user, accountsMap),
    [accountsMap, user]
  );

  const validScope = useMemo<ClientScope>(() => {
    if (scope === 'all') return 'all';
    if (visibleAccounts.some((account) => account.id === scope)) return scope;
    return visibleAccounts.length === 0 ? scope : 'all';
  }, [scope, visibleAccounts]);

  useEffect(() => {
    if (visibleAccounts.length === 0 || validScope === scope) return;
    setScopeState(validScope);
    saveClientScope(validScope);
  }, [scope, validScope, visibleAccounts.length]);

  const setScope = useCallback((next: ClientScope) => {
    setScopeState(next);
    saveClientScope(next);
  }, []);

  const scopedAccounts = useMemo(
    () =>
      validScope === 'all'
        ? visibleAccounts
        : visibleAccounts.filter((account) => account.id === validScope),
    [validScope, visibleAccounts]
  );

  return {
    scope: validScope,
    setScope,
    visibleAccounts,
    scopedAccounts,
  };
}
