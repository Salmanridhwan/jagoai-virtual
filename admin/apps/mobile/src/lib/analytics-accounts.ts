/**
 * Derives the analytics account filter from the analytics overview's own
 * account list (the authorized `overview.accounts`), never from the
 * workspace accounts query, so the picker offers exactly the accounts the
 * payload describes.
 */
export interface AnalyticsAccountOption {
  id: string;
  platform: string;
  username: string;
}

export function analyticsAccountOptions<T extends AnalyticsAccountOption>(
  overviewAccounts: readonly T[] | null | undefined,
  accountId: string,
): { options: T[]; effectiveAccountId: string } {
  const options = overviewAccounts ? [...overviewAccounts] : [];
  if (!accountId) return { options, effectiveAccountId: "" };
  const retained = options.some((account) => account.id === accountId);
  return { options, effectiveAccountId: retained ? accountId : "" };
}
