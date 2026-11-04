import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { expect, it } from 'vitest';

// Review check for the toast contract: app code must raise toasts through
// $lib/toast.ts so tone, position, duration, and action behaviour stay in one
// owner. Only toast.ts (the wrapper) and app-toast.svelte (the styling
// policy) may import svelte-sonner. Test files are exempt: they observe the
// sonner store with getActiveToasts instead of setting toast policy.
const webRoot = join(__dirname, '..', '..');
const scannedRoots = [join(webRoot, 'src')];
const owners = new Set([
	join(webRoot, 'src', 'lib', 'toast.ts'),
	join(webRoot, 'src', 'lib', 'components', 'app-toast.svelte')
]);
const directImport = /(?:from\s+|require\(\s*|import\(\s*)['"]svelte-sonner['"]/;

function collectFiles(root: string): string[] {
	const entries = readdirSync(root);
	const files: string[] = [];
	for (const entry of entries) {
		const path = join(root, entry);
		const stat = statSync(path);
		if (stat.isDirectory()) files.push(...collectFiles(path));
		else if (/\.(?:ts|js|svelte|mjs|cjs)$/.test(entry)) files.push(path);
	}
	return files;
}

it('keeps svelte-sonner imports inside the toast owner', () => {
	const offenders: string[] = [];
	for (const root of scannedRoots) {
		const files = statSync(root).isDirectory() ? collectFiles(root) : [root];
		for (const file of files) {
			if (owners.has(file)) continue;
			if (/\.(test|spec)\.[^.]+$/.test(file)) continue;
			if (directImport.test(readFileSync(file, 'utf8'))) {
				offenders.push(relative(webRoot, file));
			}
		}
	}
	expect(offenders).toEqual([]);
});
