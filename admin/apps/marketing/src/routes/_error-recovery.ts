export const marketingErrorRecovery = {
	status: 404,
	label: 'Page not found',
	title: 'Page not found',
	description: 'The link may be old or mistyped.',
	primary: { label: 'Back home', href: '/' },
	help: { label: 'Help centre', href: '/docs' },
	illustration: '/assets/marketing/missing-page.webp'
} as const;
