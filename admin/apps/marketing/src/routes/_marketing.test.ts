import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PLATFORM_LIMITS } from '@openpost/platform-text';
import { getPlatform } from './_marketing';
const routesDir = new URL('.', import.meta.url);
const marketingSource = readFileSync(new URL('_marketing.ts', routesDir), 'utf8');
const storiesSource = readFileSync(new URL('platforms/_stories.ts', routesDir), 'utf8');
const linkedInFormatterSource = readFileSync(
	new URL('_components/tools/LinkedInFormatter.svelte', routesDir),
	'utf8'
);

function catalogueSource(): string {
	const marker = '// Capability claim sources — end';
	const index = marketingSource.indexOf(marker);
	expect(index, 'marketing catalogue source marker is present').toBeGreaterThan(-1);
	return marketingSource.slice(index + marker.length);
}

function parseXVideoCaps(source: string) {
	const gib = (name: string) => {
		const match = new RegExp(`${name}\\s*=\\s*(\\d+) \\* 1024 \\* 1024 \\* 1024`).exec(source);
		expect(match, `${name} is declared in providerlimits/x.go`).not.toBeNull();
		return Number(match![1]);
	};
	const minutes = (name: string) => {
		const match = new RegExp(`${name}\\s*=\\s*(\\d+) \\* 60`).exec(source);
		expect(match, `${name} is declared in providerlimits/x.go`).not.toBeNull();
		return Number(match![1]);
	};
	return {
		standardGib: gib('XPostVideoMaxBytes'),
		standardMinutes: minutes('XPostVideoMaxDurationSeconds'),
		premiumGib: gib('XPremiumPostVideoMaxBytes'),
		premiumMinutes: minutes('XPremiumPostVideoMaxDurationSeconds')
	};
}

describe('marketing capability claims', () => {
	it('states the X account video caps the server enforces', () => {
		const serverSource = readFileSync(
			new URL('../../../../apps/server/internal/providerlimits/x.go', import.meta.url),
			'utf8'
		);
		const caps = parseXVideoCaps(serverSource);
		const x = getPlatform('x');
		expect(x).toBeDefined();
		const videoClaim = x!.limits.find((limit) => limit.startsWith('Video:'));
		expect(videoClaim).toBeDefined();
		expect(videoClaim).toContain(`${caps.standardMinutes} minutes`);
		expect(videoClaim).toContain(`${caps.standardGib} GiB`);
		expect(videoClaim).toContain(`${caps.premiumMinutes} minutes`);
		expect(videoClaim).toContain(`${caps.premiumGib} GiB`);
	});

	it('states the catalogue text limits for every platform page', () => {
		for (const platform of [
			'x',
			'mastodon',
			'pixelfed',
			'bluesky',
			'linkedin',
			'threads',
			'facebook',
			'instagram',
			'tiktok',
			'youtube',
			'telegram',
			'discord'
		] as const) {
			const entry = getPlatform(platform);
			expect(entry).toBeDefined();
			const charLimit = PLATFORM_LIMITS[platform].charLimit.toLocaleString('en-US');
			const statesLimit = [...entry!.limits, ...entry!.formats.map((format) => format.text)].some(
				(text) => text.includes(charLimit)
			);
			expect(statesLimit, `${platform} states its catalogue text limit`).toBe(true);
		}
	});

	it('derives marketing catalogue limit numbers from the owners instead of literals', () => {
		const source = catalogueSource();
		for (const literal of [
			'25,000',
			'2,200',
			'63,206',
			'4,096',
			'1,250',
			'4,000',
			'5,000',
			'3,000',
			'2,000 characters',
			'500 characters',
			'300 characters',
			'280 standard',
			'20 minutes',
			'125 minutes',
			'8 GiB',
			'16 GiB',
			'1,024'
		]) {
			expect(source.includes(literal), `catalogue restates ${JSON.stringify(literal)}`).toBe(false);
		}
	});

	it('derives story and tool limit numbers from the owners instead of literals', () => {
		for (const literal of ['4,096', '1,024']) {
			expect(storiesSource.includes(literal), `stories restate ${literal}`).toBe(false);
		}
		for (const literal of ['> 3000', '- 3000', '3,000-character']) {
			expect(linkedInFormatterSource.includes(literal), `LinkedIn tool restates ${literal}`).toBe(
				false
			);
		}
		expect(linkedInFormatterSource.includes('PLATFORM_LIMITS.linkedin.charLimit')).toBe(true);
	});
});

describe('provider reference limit tables', () => {
	const docsRoot = new URL('../../../../docs/reference/providers/', import.meta.url);

	it('generates the X account table from the catalogue and provider limits', () => {
		const serverSource = readFileSync(
			new URL('../../../../apps/server/internal/providerlimits/x.go', import.meta.url),
			'utf8'
		);
		const caps = parseXVideoCaps(serverSource);
		const page = readFileSync(new URL('x.md', docsRoot), 'utf8');
		expect(page.includes('<!-- provider-limits:start -->')).toBe(true);
		expect(page.includes('<!-- provider-limits:end -->')).toBe(true);
		expect(page).toContain(`${PLATFORM_LIMITS.x.charLimit} weighted characters`);
		expect(page).toContain('25,000 weighted characters');
		expect(page).toContain(`${caps.standardMinutes} minutes`);
		expect(page).toContain(`${caps.standardGib} GiB`);
		expect(page).toContain(`${caps.premiumMinutes} minutes`);
		expect(page).toContain(`${caps.premiumGib} GiB`);
		const verified = /Verified (\d{4}-\d{2}-\d{2})/.exec(serverSource);
		expect(verified).not.toBeNull();
		expect(page).toContain(verified![1].slice(8));
	});

	it('generates the Instagram caption table from the catalogue', () => {
		const serverSource = readFileSync(
			new URL('../../../../apps/server/internal/providerlimits/instagram.go', import.meta.url),
			'utf8'
		);
		const page = readFileSync(new URL('instagram.md', docsRoot), 'utf8');
		expect(page.includes('<!-- provider-limits:start -->')).toBe(true);
		expect(page.includes('<!-- provider-limits:end -->')).toBe(true);
		expect(page).toContain(
			`${PLATFORM_LIMITS.instagram.charLimit.toLocaleString('en-US')} characters`
		);
		const verified = /Verified (\d{4}-\d{2}-\d{2})/.exec(serverSource);
		expect(verified).not.toBeNull();
		expect(page).toContain(verified![1].slice(8));
	});
});
