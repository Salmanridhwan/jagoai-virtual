// Syncs the generated provider limit tables in docs/reference/providers/*.md
// from the capability owners: @openpost/platform-text for text limits and
// apps/server/internal/providerlimits for the X account video caps. This
// follows the scripts/sync-docs-openapi.mjs pattern used for media-limits.mdx:
// generated regions sit between provider-limits markers, and --check fails
// when a region is stale. Public palette, layout and copy voice are unchanged;
// only where the numbers come from changes.
import { readFile, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	PLATFORM_LIMITS,
	X_PREMIUM_CHAR_LIMIT
} from '../../../packages/platform-text/src/index.ts';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDir, '../../..');

const formatCount = (value) => value.toLocaleString('en-US');
const formatDate = (iso) =>
	new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', {
		day: 'numeric',
		month: 'long',
		year: 'numeric'
	});

async function providerSource(file) {
	return readFile(path.join(root, 'apps/server/internal/providerlimits', file), 'utf8');
}

function verifiedDate(source, file) {
	const match = /Verified (\d{4}-\d{2}-\d{2})/.exec(source);
	if (!match) throw new Error(`verified date is missing in providerlimits/${file}`);
	return formatDate(match[1]);
}

function goProduct(source, name, unit) {
	const match = new RegExp(`${name}\\s*=\\s*(\\d+) ${unit}`).exec(source);
	if (!match) throw new Error(`${name} declaration is missing in providerlimits`);
	return Number(match[1]);
}

const xSource = await providerSource('x.go');
const instagramSource = await providerSource('instagram.go');
const standardGib = goProduct(xSource, 'XPostVideoMaxBytes', '\\* 1024 \\* 1024 \\* 1024');
const standardMinutes = goProduct(xSource, 'XPostVideoMaxDurationSeconds', '\\* 60');
const premiumGib = goProduct(xSource, 'XPremiumPostVideoMaxBytes', '\\* 1024 \\* 1024 \\* 1024');
const premiumMinutes = goProduct(xSource, 'XPremiumPostVideoMaxDurationSeconds', '\\* 60');

const standardText = PLATFORM_LIMITS.x.charLimit;
const premiumText = X_PREMIUM_CHAR_LIMIT;
const instagramCaption = PLATFORM_LIMITS.instagram.charLimit;

const blocks = [
	{
		file: 'docs/reference/providers/x.md',
		block: [
			'| Connected X account | Text limit | Video duration | Video size |',
			'| --- | ---: | ---: | ---: |',
			`| Standard, unknown, or stale tier | ${formatCount(standardText)} weighted characters | ${formatCount(standardMinutes)} minutes | ${standardGib} GiB |`,
			`| Basic, Premium, or Premium+ | ${formatCount(premiumText)} weighted characters | ${formatCount(premiumMinutes)} minutes | ${premiumGib} GiB |`,
			'',
			`Text limits come from the capability catalogue for the standard and subscribed X tiers; video caps come from the provider limits. Provider documentation verified ${verifiedDate(xSource, 'x.go')}; see the links below.`
		].join('\n')
	},
	{
		file: 'docs/reference/providers/instagram.md',
		block: [
			'| Format | Caption limit |',
			'| --- | ---: |',
			`| Feed, carousel, Reel | ${formatCount(instagramCaption)} characters |`,
			'| Story | No caption |',
			'',
			`Caption limits come from the capability catalogue. Meta documents publishing in the [Content Publishing guide](https://developers.facebook.com/documentation/instagram-platform/content-publishing) (verified there ${verifiedDate(instagramSource, 'instagram.go')}).`
		].join('\n')
	}
];

const stale = [];
// The repository format gate owns the final table layout, so the generator
// formats its own output. Otherwise the committed file and the generated
// expectation disagree on cell padding and the check reports a false stale.
function formatFile(file) {
	const status = spawnSync('bunx', ['oxfmt', '--write', file], {
		cwd: root,
		stdio: 'ignore'
	}).status;
	if (status !== 0) throw new Error(`Failed to format ${file}`);
}

for (const { file, block } of blocks) {
	const absolute = path.join(root, file);
	const source = await readFile(absolute, 'utf8');
	const pattern = /(<!-- provider-limits:start -->)[\s\S]*?(<!-- provider-limits:end -->)/;
	if (!pattern.test(source)) {
		throw new Error(`${file} has no provider-limits markers`);
	}
	const next = source.replace(pattern, `$1\n${block}\n$2`);
	if (process.argv.includes('--check')) {
		if (next === source) continue;
		const probe = `${absolute}.probe.md`;
		await writeFile(probe, next);
		try {
			formatFile(probe);
			if ((await readFile(probe, 'utf8')) !== source) stale.push(file);
		} finally {
			await rm(probe, { force: true });
		}
		continue;
	}
	if (next !== source) {
		await writeFile(absolute, next);
		formatFile(absolute);
		console.log(`Updated provider limits -> ${file}`);
	}
}

if (stale.length > 0) {
	console.error(
		`Provider reference limit tables are stale:\n${stale.map((file) => `- ${file}`).join('\n')}\nRun bun apps/marketing/scripts/sync-provider-reference-limits.mjs`
	);
	process.exit(1);
}
console.log('Provider reference limit tables are current.');
