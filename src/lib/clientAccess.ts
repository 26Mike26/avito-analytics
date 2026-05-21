import type { AccountData, User } from '../types';

export function isClientUser(user: User | null | undefined): boolean {
  return user?.role === 'client';
}

export function canManagePlatform(user: User | null | undefined): boolean {
  return !isClientUser(user);
}

export function visibleAccountIdsForUser(
  user: User | null | undefined,
  accounts: Record<string, AccountData>
): string[] {
  if (!user) return [];
  const ids = isClientUser(user)
    ? user.clientAccountIds?.length
      ? user.clientAccountIds
      : user.accountIds
    : user.accountIds;
  return Array.from(new Set(ids)).filter((id) => Boolean(accounts[id]));
}

export function visibleAccountsForUser(
  user: User | null | undefined,
  accounts: Record<string, AccountData>
): AccountData[] {
  return visibleAccountIdsForUser(user, accounts).map((id) => accounts[id]);
}
