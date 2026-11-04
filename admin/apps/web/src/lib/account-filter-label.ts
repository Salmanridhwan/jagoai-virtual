import type { SocialAccount } from '$lib/api/client';
import { m } from '$lib/paraglide/messages';
import { formatSocialAccountName, getPlatformName } from '$lib/utils';

/**
 * Account identity for the Inbox account filters. Both Engagement and Messages
 * render the same rows and the same trigger, so this lives here rather than in
 * each page.
 */
export function accountName(account: SocialAccount): string {
	return (
		formatSocialAccountName(account.account_username, account.platform) ||
		account.slug ||
		account.account_id ||
		account.platform
	);
}

/**
 * Accessible name for the account-filter trigger: the selected account when one
 * is chosen, otherwise the all-accounts mode. The visible label stays the
 * account list, so the announcement must not claim "All accounts" while a
 * single account scopes the request.
 */
export function accountFilterLabel(account: SocialAccount | undefined): string {
	if (!account) return m.engagement_all_accounts();
	return `${m.analytics_account_filter()}: ${accountName(account)}, ${getPlatformName(account.platform)}`;
}
