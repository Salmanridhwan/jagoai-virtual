# Frontend

The frontend is a SvelteKit app using Svelte 5 runes, TailwindCSS, Paraglide for i18n, and typed API access generated from the backend OpenAPI spec.

This page is for contributors changing the web app or its shared marketing controls.

## Expectations

- Refresh canonical product screenshots when a change alters a captured surface; see [Product screenshots](screenshots.md).

- Use standard Svelte 5 runes
- Keep API calls typed
- Preserve adapter-static output because the backend embeds the built assets
- Reuse the shared Shadcn-svelte controls from `apps/web/src/lib/components/ui/` for inputs, text areas, selects, checkboxes, radio groups, sliders, and related form UI
- Keep marketing controls on those same primitives; the marketing SvelteKit project resolves `$lib` to the shared frontend library
- Do not add visible native `input`, `select`, or `textarea` elements outside the shared primitives

## Browser baseline

The normal application baseline is Safari 16.4 and equivalents. Tailwind 4
already requires Safari 16.4, and the theme runtime depends on regex
lookbehind, which Safari gained in 16.4. Removing an avoidable failure on an
older engine (for example the `@asamuzakjp/css-color` detector patch) does not
certify the whole application there.

Keep unsupported-browser failures out of stale-chunk reload recovery:
reloading identical bytes into the same engine cannot add the missing
capability. Theme startup reports them under the `theme_unsupported_browser`
boundary and keeps the CSS fallback. Probes for a single engine feature must
use `new RegExp('(?<=a)b')` inside `try/catch`, never a lookbehind literal
that an older parser rejects before the catch executes.

## Useful commands

```bash
bun run dev -- frontend
bun run check -- frontend
bun run lint -- frontend
bun run test -- frontend
bun run check -- ui-consistency
bun run build -- frontend
```

The cached frontend task owns the compiled files in `apps/web/build` and omits
the tracked immutable editor model and audio trees from its cache entry. Vite
receives a temporary public tree without those assets, so it does not copy the
large files before the build links them into the final web output.
`bun run build -- frontend` checks the selected image bundle, model, and audio
manifests and their declared file sizes and SHA-256 digests, restores those
trees from `apps/web/static` with hard links when possible, refreshes both
generated web trees, validates the complete artifact, then replaces
`apps/server/cmd/openpost/public` atomically. Missing or partial sources fail before
an existing artifact changes.

## Translation generation

`apps/web` owns `src/lib/paraglide`. Marketing reads shared web components but
does not run another generator against that directory. The web CLI and Vite
plugin share the locale strategy, locale-module layout, and server detection.
`scripts/check-i18n.mjs` checks those options for drift.

`generate:i18n` compiles runtime JavaScript with the maintained Paraglide
compiler, then runs `scripts/paraglide-declarations.mjs`. The latter preserves
the compiler's explicit message input and locale types without type-checking
every generated message during declaration emit. Runtime, server, and registry
declarations still use the upstream emitter. Unrecognized message shapes fail
instead of producing permissive declarations.

The companion Vite plugin serializes its hooks after Paraglide writes output,
including after watched catalogue changes. Keep it paired with the upstream
plugin and keep `OPENPOST_PARAGLIDE_PRECOMPILED` for checks and browser suites
that already prepared declarations. Changes to the emitter must invalidate
the web Turbo tasks. Production builds retain their separate compilation
command; validate both check and build paths after changing this boundary.

Run the declaration and offline compiler regressions with:

```bash
devenv shell -- bun test scripts/paraglide-declarations.test.mjs scripts/paraglide-offline.test.mjs
```

These cover real TypeScript consumers, runtime translations and plurals,
unsupported generated syntax, and dev-hook ordering. For performance comparisons,
time `bun run --filter @openpost/web generate:i18n` before and after on the same
catalogue, then run `bun run check -- frontend-marketing` and the production
build. A faster generation step does not by itself measure total hosted CI time.
