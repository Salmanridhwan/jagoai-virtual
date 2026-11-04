import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { referencedMessageKeys } from "./i18n-source-usage.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const messagesDirectory = path.join(root, "apps/web", "messages");
const settings = JSON.parse(
  await readFile(path.join(root, "apps/web", "project.inlang", "settings.json"), "utf8"),
);
const locales = settings.locales;
const catalogs = new Map();

for (const locale of locales) {
  const content = await readFile(path.join(messagesDirectory, `${locale}.json`), "utf8");
  catalogs.set(locale, JSON.parse(content));
}

const referenceLocale = settings.baseLocale;
const referenceCatalog = catalogs.get(referenceLocale);
const referenceKeys = new Set(Object.keys(referenceCatalog));
const unchangedThemeMessages = new Set([
  // Product name. Its surrounding copy is localized where context is needed.
  "theme_library_workshop",
]);
let failed = false;

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entryPath === path.join(root, "apps/web", "src", "lib", "paraglide")) continue;
      files.push(...(await sourceFiles(entryPath)));
    } else if (/\.(?:js|svelte|ts)$/.test(entry.name)) {
      files.push(entryPath);
    }
  }
  return files;
}

function placeholders(message) {
  return [
    ...new Set([...message.matchAll(/\{([A-Za-z][\w]*)\b[^}]*\}/g)].map((match) => match[1])),
  ].sort();
}

function sameList(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function isSingleWord(message) {
  return /^[\p{L}\p{N}]+(?:[-/][\p{L}\p{N}]+)*$/u.test(message.trim());
}

function translationArtifact(message) {
  if (/\bPLCE\d+\b|プレース\d+/i.test(message)) return "placeholder stand-in";
  if (/^(?:译|翻译)[：:]|^(?:translation|translated)[：:]/i.test(message)) {
    return "translation marker";
  }
  return null;
}

const missingSourceMessages = new Map();
for (const sourcePath of await sourceFiles(path.join(root, "apps/web", "src"))) {
  const source = await readFile(sourcePath, "utf8");
  for (const key of referencedMessageKeys(source)) {
    if (referenceKeys.has(key)) continue;
    const paths = missingSourceMessages.get(key) ?? [];
    paths.push(path.relative(root, sourcePath));
    missingSourceMessages.set(key, paths);
  }
}

if (missingSourceMessages.size > 0) {
  failed = true;
  console.error(`${referenceLocale}.json is missing messages used by frontend source:`);
  for (const [key, paths] of [...missingSourceMessages].sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    console.error(`  ${key}: ${[...new Set(paths)].join(", ")}`);
  }
}

for (const locale of locales.filter((locale) => locale !== referenceLocale)) {
  const catalog = catalogs.get(locale);
  const keys = new Set(Object.keys(catalog));
  const missing = [...referenceKeys].filter((key) => !keys.has(key)).sort();
  const extra = [...keys].filter((key) => !referenceKeys.has(key)).sort();

  if (missing.length > 0 || extra.length > 0) {
    failed = true;
    console.error(`${locale}.json does not match ${referenceLocale}.json:`);
    if (missing.length > 0) console.error(`  Missing: ${missing.join(", ")}`);
    if (extra.length > 0) console.error(`  Extra: ${extra.join(", ")}`);
  }

  const placeholderMismatches = [...referenceKeys].filter(
    (key) =>
      key in catalog && !sameList(placeholders(referenceCatalog[key]), placeholders(catalog[key])),
  );
  if (placeholderMismatches.length > 0) {
    failed = true;
    console.error(`${locale}.json changes placeholders used by ${referenceLocale}.json:`);
    for (const key of placeholderMismatches) {
      console.error(
        `  ${key}: expected {${placeholders(referenceCatalog[key]).join(", ")}}, found {${placeholders(catalog[key]).join(", ")}}`,
      );
    }
  }

  const invalidMessages = [...referenceKeys].flatMap((key) => {
    const message = catalog[key];
    if (typeof message !== "string" || message.trim().length === 0) {
      return [[key, "empty or non-string message"]];
    }
    const artifact = translationArtifact(message);
    return artifact ? [[key, artifact]] : [];
  });
  if (invalidMessages.length > 0) {
    failed = true;
    console.error(`${locale}.json contains invalid translation artifacts:`);
    for (const [key, reason] of invalidMessages) console.error(`  ${key}: ${reason}`);
  }

  const themeKeys = [...referenceKeys].filter((key) => key.startsWith("theme_"));
  const unchangedThemeKeys = themeKeys.filter(
    (key) => !unchangedThemeMessages.has(key) && catalog[key] === referenceCatalog[key],
  );
  const untranslatedThemeMessages = unchangedThemeKeys.filter(
    (key) => !isSingleWord(referenceCatalog[key]),
  );
  if (untranslatedThemeMessages.length > 0) {
    failed = true;
    console.error(`${locale}.json leaves multiword theme messages in English:`);
    console.error(`  ${untranslatedThemeMessages.join(", ")}`);
  }

  const unchangedThemeLimit = Math.max(12, Math.floor(themeKeys.length / 10));
  if (unchangedThemeKeys.length > unchangedThemeLimit) {
    failed = true;
    console.error(
      `${locale}.json leaves ${unchangedThemeKeys.length} theme messages in English; the limit is ${unchangedThemeLimit}.`,
    );
  }

  if (catalog.language_label === referenceCatalog.language_label) {
    failed = true;
    console.error(`${locale}.json must localize language_label for the locale picker.`);
  }
}

if (failed) process.exit(1);
console.log(`Translation catalogs match (${referenceKeys.size} messages per locale).`);

// FMT-03 (#393): apps/web/src/lib/paraglide has a single writer
// (`generate:i18n` in apps/web/package.json) and a single declared option set.
// The Vite plugin in apps/web/vite.config.ts regenerates the same directory
// during dev and test runs, so its options must stay identical to the scoped
// command. The upstream `emitTsDeclarations` path is slow on this
// catalog, so both writers keep it off and share the fast declarations in
// scripts/paraglide-declarations.mjs instead. Compare the two textually to
// catch future drift.
const webPackage = JSON.parse(await readFile(path.join(root, "apps/web", "package.json"), "utf8"));
const generateCommand = webPackage.scripts["generate:i18n"] ?? "";
const viteConfig = await readFile(path.join(root, "apps/web", "vite.config.ts"), "utf8");
const drift = [];
const strategyMatch = generateCommand.match(/--strategy\s+((?:(?!--)[A-Za-z0-9-]+\s*)+)/);
const declaredStrategy = strategyMatch ? strategyMatch[1].trim().split(/\s+/) : [];
const pluginStrategyMatch = viteConfig.match(/strategy:\s*\[([^\]]*)\]/);
const pluginStrategy = pluginStrategyMatch
  ? [...pluginStrategyMatch[1].matchAll(/'([^']+)'/g)].map((match) => match[1])
  : [];
if (
  declaredStrategy.length === 0 ||
  pluginStrategy.length !== declaredStrategy.length ||
  pluginStrategy.some((value, index) => value !== declaredStrategy[index])
) {
  drift.push(
    `strategy mismatch: generate:i18n declares [${declaredStrategy.join(", ")}] but vite.config.ts has [${pluginStrategy.join(", ")}]`,
  );
}
const declaredStructure = generateCommand.match(/--output-structure\s+(\S+)/)?.[1];
const pluginStructure = viteConfig.match(/outputStructure:\s*'([^']+)'/)?.[1];
if (!declaredStructure || declaredStructure !== pluginStructure) {
  drift.push(
    `output-structure mismatch: generate:i18n declares ${declaredStructure ?? "(none)"} but vite.config.ts has ${pluginStructure ?? "(none)"}`,
  );
}
const declaredIsServer = generateCommand.match(/--is-server\s+"([^"]+)"/)?.[1];
const pluginIsServer = viteConfig.match(/isServer:\s*"([^"]+)"/)?.[1];
if (!declaredIsServer || declaredIsServer !== pluginIsServer) {
  drift.push("is-server mismatch between generate:i18n and vite.config.ts");
}
if (
  generateCommand.includes("--emit-ts-declarations") ||
  !generateCommand.includes("scripts/paraglide-declarations.mjs")
) {
  drift.push(
    "generate:i18n must skip upstream --emit-ts-declarations and run scripts/paraglide-declarations.mjs instead",
  );
}
if (
  !/emitTsDeclarations:\s*false/.test(viteConfig) ||
  !viteConfig.includes("paraglideFastDeclarationsPlugin") ||
  !viteConfig.includes("scripts/paraglide-declarations.mjs")
) {
  drift.push(
    "vite.config.ts must set emitTsDeclarations: false and regenerate declarations through paraglideFastDeclarationsPlugin",
  );
}
if (drift.length > 0) {
  for (const reason of drift) console.error(reason);
  process.exit(1);
}

// When generated output exists, the shipped strategy array must equal the
// declared one. Skipped on fresh checkouts before the first generate:i18n run.
let runtimeSource = null;
try {
  runtimeSource = await readFile(
    path.join(root, "apps/web", "src", "lib", "paraglide", "runtime.js"),
    "utf8",
  );
} catch {
  runtimeSource = null;
}
if (runtimeSource) {
  const generatedStrategy = runtimeSource.match(/export const strategy = \[([^\]]*)\]/)?.[1];
  const generatedTokens = generatedStrategy
    ? [...generatedStrategy.matchAll(/"([^"]+)"/g)].map((match) => match[1])
    : [];
  if (
    generatedTokens.length !== declaredStrategy.length ||
    generatedTokens.some((value, index) => value !== declaredStrategy[index])
  ) {
    console.error(
      `generated runtime strategy [${generatedTokens.join(", ")}] does not match generate:i18n [${declaredStrategy.join(", ")}]; re-run generate:i18n`,
    );
    process.exit(1);
  }
}
console.log("Paraglide writer options match generate:i18n.");
