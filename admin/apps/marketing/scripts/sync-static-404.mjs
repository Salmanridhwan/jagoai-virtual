import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { staticUICSS } from '../../../scripts/static-ui.mjs';
import { marketingErrorRecovery as content } from '../src/routes/_error-recovery.ts';

const output = new URL('../static/404.html', import.meta.url);
function escapeHTML(value) {
	return String(value).replace(/[&<>"']/gu, (character) => `&#${character.charCodeAt(0)};`);
}

const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex" />
    <meta name="color-scheme" content="light dark" />
    <link rel="icon" href="/icon.svg" />
    <link rel="license" href="/assets/brand/fonts/LICENSE-Geist.txt" />
    <title>Page not found · OpenPost</title>
    <style>${await staticUICSS()}
      @font-face { font-family: Geist; src: url('/assets/brand/fonts/Geist-Regular.ttf') format('truetype'); font-weight: 400; font-display: swap; }
      @font-face { font-family: Geist; src: url('/assets/brand/fonts/Geist-SemiBold.ttf') format('truetype'); font-weight: 600; font-display: swap; }
    </style>
  </head>
  <body data-theme-button="dither">
    <main class="op-recovery">
      <a class="op-recovery-brand" href="/" aria-label="OpenPost home">
        <picture><source srcset="/assets/brand/logo-dark.svg" media="(prefers-color-scheme: dark)" /><img src="/assets/brand/logo.svg" alt="" width="28" height="28" /></picture>OpenPost
      </a>
      <div class="op-recovery-body">
        <div>
          <h1>${escapeHTML(content.title)}</h1>
          <p class="op-recovery-copy">${escapeHTML(content.description)}</p>
          <div class="op-recovery-actions">
            <a data-static-action data-dither-button="always" href="${escapeHTML(content.primary.href)}"><svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 19-7-7 7-7M5 12h14" /></svg>${escapeHTML(content.primary.label)}</a>
            <a class="op-recovery-link" href="${escapeHTML(content.help.href)}">${escapeHTML(content.help.label)}</a>
          </div>
        </div>
        <figure class="op-recovery-art">
          <img src="${escapeHTML(content.illustration)}" alt="" width="768" height="768" />
          <figcaption class="op-recovery-status">${content.status}</figcaption>
        </figure>
      </div>
    </main>
  </body>
</html>
`;

if (process.argv.includes('--check')) {
	assert.equal(
		await readFile(output, 'utf8'),
		html,
		'static/404.html is stale; run bun scripts/sync-static-404.mjs'
	);
	console.log('Verified static 404 uses the shared UI source.');
} else {
	await writeFile(output, html);
	console.log('Updated static/404.html.');
}
