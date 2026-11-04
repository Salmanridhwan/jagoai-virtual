import { readFile } from "node:fs/promises";
import { format } from "oxfmt";
import { staticActionTexture } from "../packages/ui/src/lib/static-action.ts";

// Static pages work before application bundles or cached assets are available.
// Inline the UI tokens and texture instead of maintaining another palette.
export async function staticUICSS() {
  const [tokens, recovery, dither] = await Promise.all([
    readFile(new URL("../packages/ui/src/lib/tokens.css", import.meta.url), "utf8"),
    readFile(new URL("../packages/ui/src/lib/recovery.css", import.meta.url), "utf8"),
    readFile(new URL("../packages/dither/src/style.css", import.meta.url), "utf8"),
  ]);
  const dark = tokens.match(/\.dark\s*\{([^}]+)\}/u)?.[1];
  if (!dark) throw new Error("Static UI requires the shared dark token catalogue");
  const texture = Object.entries(staticActionTexture)
    .map(([key, value]) => `${key}: ${value};`)
    .join("\n");
  const generated = `${tokens}\n@media (prefers-color-scheme: dark) { :root {${dark}} }\n${recovery}\n${dither}\n:root { ${texture} }\nhtml { background: var(--background); color: var(--foreground); font-family: var(--theme-font-sans); }\nbody { margin: 0; }`;
  const result = await format("static-ui.css", generated, { printWidth: 100 });
  if (result.errors.length) throw new Error("Could not format standalone UI styles");
  return result.code;
}
