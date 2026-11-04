// FMT-03 (#393, #371): fast Paraglide declarations.
//
// Upstream `emitTsDeclarations` runs a TypeScript declaration emit over every
// generated message. On the full catalogue, that is much slower than deriving
// the declarations from the compiler's explicit JSDoc types.
//
// The generated message modules are structurally regular (JSDoc typedefs,
// `@type`-annotated consts, alias re-exports), so this module derives their
// `.d.ts` siblings syntactically in milliseconds, without a type checker.
// `runtime.js`, `server.js` and `registry.js` are small fixed-shape outputs;
// their declarations still come from the upstream emitter for full fidelity.
// Anything the parser does not recognize throws instead of emitting an
// `any` stub, so a new compiler shape fails the build instead of silently
// hiding type errors.
//
// Hook ordering is exercised through a real Vite dev container in the tests:
// `vite build` runs `buildStart` hooks sequentially in registration order,
// but the dev server dispatches `buildStart`/`watchChange` through its plugin
// container concurrently across plugins AND environments. The upstream plugin
// compiles asynchronously and its output writer deletes files the compile did
// not emit (seeded `.d.ts` siblings included), so a plain-function settle
// hook loses the race and the dev session runs without declarations until the
// next save. `sequential: true` on our object hooks makes the dev container
// drain in-flight earlier hooks before running ours; `order: "post"` only
// fixes sort position and is not sufficient on its own. A shared settle queue
// additionally serializes our own hooks against concurrent environment
// dispatches. `buildEnd`/`closeBundle` reconverge one-shot flows (`vitest`,
// `vite build`) after the compiler has settled.

import { readdir, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

const MESSAGE_DIRECTORY = "messages";

/** Files whose declarations still come from the upstream TypeScript emitter. */
const STATIC_FILES = new Set(["runtime.js", "server.js", "registry.js"]);

/**
 * @param {unknown} error
 * @returns {boolean}
 */
function isEnoent(error) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

/**
 * @param {string} filePath
 * @param {number} lineNumber
 * @param {string} line
 * @param {string} reason
 * @returns {never}
 */
function fail(filePath, lineNumber, line, reason) {
  throw new Error(
    `paraglide-declarations: ${reason} in ${filePath}:${lineNumber}: ${line.slice(0, 160)}`,
  );
}

/**
 * @param {string} body
 * @param {string} filePath
 * @param {number} lineNumber
 * @param {string} line
 * @returns {{ name: string, typeText: string }}
 */
function splitTypedef(body, filePath, lineNumber, line) {
  // `/** @typedef {<type>} <Name> */` — the outer braces belong to the
  // JSDoc comment; the inner text is the type. The type itself may contain
  // braces, so split the name at the last `}` first.
  if (!body.startsWith("{")) fail(filePath, lineNumber, line, "malformed @typedef");
  const closing = body.lastIndexOf("}");
  if (closing < 0) fail(filePath, lineNumber, line, "malformed @typedef");
  const name = body.slice(closing + 1).trim();
  const typeText = normalizeImportQuotes(body.slice(1, closing).trim());
  if (!/^[A-Za-z_$][\w$]*$/.test(name) || typeText.length === 0) {
    fail(filePath, lineNumber, line, "malformed @typedef");
  }
  return { name, typeText };
}

/**
 * Upstream declaration emit normalizes `import('...')` to double quotes.
 * @param {string} typeText
 * @returns {string}
 */
function normalizeImportQuotes(typeText) {
  return typeText.replace(/import\('([^']+)'\)/g, 'import("$1")');
}

/**
 * Derive the `.d.ts` for one generated message module (`messages/*.js` or
 * the `_index.js` barrel). Pure and synchronous.
 * @param {string} jsSource
 * @param {{ sourcePath?: string }} [options]
 * @returns {string}
 */
export function generateMessageDeclarations(jsSource, { sourcePath = "messages.js" } = {}) {
  const lines = jsSource.split("\n");
  /** @type {string[]} */
  const output = [];
  /** @type {string | null} */
  let pendingDoc = null;
  let index = 0;

  /**
   * @param {number} lineNumber
   * @param {string} line
   * @returns {void}
   */
  const flushTypedef = (lineNumber, line) => {
    const body = line.slice("/** @typedef ".length, -" */".length);
    const { name, typeText } = splitTypedef(body, sourcePath, lineNumber, line);
    output.push(`export type ${name} = ${typeText};`);
  };

  /**
   * @param {string | null} doc
   * @param {boolean} exported
   * @param {string} name
   * @param {string} typeText
   * @returns {void}
   */
  const emitTypedConst = (doc, exported, name, typeText) => {
    if (doc) output.push(doc);
    output.push(`${exported ? "export" : "declare"} const ${name}: ${typeText};`);
  };

  while (index < lines.length) {
    const lineNumber = index + 1;
    const line = lines[index];

    if (line === "" || line.startsWith("/* eslint-disable */") || line.startsWith("//")) {
      index += 1;
      continue;
    }
    if (line.startsWith("import ")) {
      // Value imports (`getLocale`, locale bundles, `registry`) only serve
      // the stripped bodies; the surviving types reference modules inline.
      index += 1;
      continue;
    }
    if (line.startsWith("/**")) {
      const block = [line];
      while (!block[block.length - 1].includes("*/")) {
        index += 1;
        if (index >= lines.length) fail(sourcePath, lineNumber, line, "unterminated JSDoc block");
        block.push(lines[index]);
      }
      index += 1;
      if (block.length === 1 && block[0].startsWith("/** @typedef ") && block[0].endsWith(" */")) {
        if (pendingDoc) fail(sourcePath, lineNumber, line, "typedef after doc comment");
        flushTypedef(lineNumber, block[0]);
      } else {
        if (pendingDoc) fail(sourcePath, lineNumber, line, "consecutive doc comments");
        const text = block.join("\n");
        // A multiline `@typedef` would otherwise be swallowed here as an
        // ordinary doc comment and the type silently lost from the output.
        if (text.includes("@typedef")) fail(sourcePath, lineNumber, line, "multiline @typedef");
        pendingDoc = text;
      }
      continue;
    }
    if (line.startsWith("export *")) {
      const match = line.match(/^export \*( as ([A-Za-z_$][\w$]*))? from '(.*)';?$/);
      if (!match || pendingDoc) fail(sourcePath, lineNumber, line, "unexpected re-export");
      const alias = match[2] ? ` * as ${match[2]}` : " *";
      output.push(`export${alias} from "${match[3]}";`);
      index += 1;
      continue;
    }
    const typedConst = line.match(/^(export )?const ([A-Za-z_$][\w$]*) = \/\*\* @type \{(.*)$/);
    if (typedConst) {
      // The `@type` comment ends at the first ` */`; the captured text runs
      // `{<type>} */ <trailing implementation>`, so the type is the inner
      // text between the outer braces.
      const end = typedConst[3].indexOf(" */");
      if (end < 0) fail(sourcePath, lineNumber, line, "multiline @type annotation");
      const braced = typedConst[3].slice(0, end).trim();
      if (!braced.endsWith("}")) fail(sourcePath, lineNumber, line, "malformed @type annotation");
      const typeText = normalizeImportQuotes(braced.slice(0, -1).trim());
      if (typeText.length === 0) fail(sourcePath, lineNumber, line, "empty @type annotation");
      emitTypedConst(pendingDoc, Boolean(typedConst[1]), typedConst[2], typeText);
      pendingDoc = null;
      // Skip the stripped implementation body. Generated bodies are always
      // indented and end with a column-zero closer; the next declaration
      // starts at column zero.
      index += 1;
      while (index < lines.length) {
        const next = lines[index];
        if (
          next === "" ||
          next === "};" ||
          next === "});" ||
          next.startsWith(" ") ||
          next.startsWith("\t")
        ) {
          index += 1;
          continue;
        }
        if (
          next.startsWith("/**") ||
          next.startsWith("/*") ||
          next.startsWith("import ") ||
          next.startsWith("export ") ||
          /^const [A-Za-z_$]/.test(next)
        ) {
          break;
        }
        fail(sourcePath, index + 1, next, "unexpected top-level line in message body");
      }
      continue;
    }
    const aliasExport = line.match(/^export \{(.*)\};?$/);
    if (aliasExport) {
      if (pendingDoc || aliasExport[1].trim().length === 0) {
        fail(sourcePath, lineNumber, line, "unexpected alias export");
      }
      output.push(`export {${aliasExport[1]}};`);
      index += 1;
      continue;
    }
    fail(sourcePath, lineNumber, line, "unrecognized generated shape");
  }

  if (pendingDoc) fail(sourcePath, lines.length, "", "dangling doc comment");
  return `${output.join("\n")}\n`;
}

/**
 * Emit `.d.ts` siblings for the generated message modules under `outdir`
 * (`messages.js` plus `messages/*.js`). Returns the written paths.
 *
 * Skips silently when the outdir is not a locale-modules layout (for
 * example the message-modules production build, which needs no
 * declarations). This also keeps the Vite companion plugin safe if it ever
 * runs against a non-check outdir.
 * @param {string} outdir
 * @returns {Promise<string[]>}
 */
export async function emitMessageDeclarationsFromOutdir(outdir) {
  /** @type {string[]} */
  const written = [];
  /** @type {string[]} */
  const candidates = [];
  let localeLayout = false;
  try {
    for (const entry of await readdir(path.join(outdir, MESSAGE_DIRECTORY))) {
      if (entry === "_index.js") localeLayout = true;
      if (entry.endsWith(".js")) candidates.push(path.join(MESSAGE_DIRECTORY, entry));
    }
  } catch (error) {
    if (isEnoent(error)) {
      throw new Error(`paraglide-declarations: no generated messages in ${outdir}`);
    }
    throw error;
  }
  if (!localeLayout) return written;
  try {
    await readFile(path.join(outdir, "messages.js"), "utf8");
    candidates.push("messages.js");
  } catch (error) {
    if (!isEnoent(error)) throw error;
  }

  for (const relativePath of candidates) {
    const absolutePath = path.join(outdir, relativePath);
    const jsSource = await readFile(absolutePath, "utf8");
    const declaration = generateMessageDeclarations(jsSource, { sourcePath: relativePath });
    // Mirror the upstream sibling convention: `en.js` -> `en.d.ts`.
    const declarationPath = `${absolutePath.slice(0, -".js".length)}.d.ts`;
    await writeFile(declarationPath, declaration);
    written.push(`${relativePath.slice(0, -".js".length)}.d.ts`);
  }
  return written;
}

/**
 * Emit `.d.ts` siblings for the small fixed-shape outputs (`runtime.js`,
 * `server.js`, `registry.js`) with the upstream TypeScript emitter.
 *
 * The package `exports` map hides the deep compiler path, so resolve it
 * through the published entry point. A moved file fails loudly here instead
 * of silently changing behavior.
 * @param {string} outdir
 * @returns {Promise<string[]>}
 */
export async function emitStaticDeclarationsFromOutdir(outdir) {
  const require = createRequire(import.meta.url);
  const entry = require.resolve("@inlang/paraglide-js");
  const emitterPath = path.join(path.dirname(entry), "compiler/emit-ts-declarations.js");
  const { emitTsDeclarations } = await import(pathToFileURL(emitterPath).href);
  /** @type {Record<string, string>} */
  const output = {};
  for (const file of STATIC_FILES) {
    try {
      output[file] = await readFile(path.join(outdir, file), "utf8");
    } catch (error) {
      if (!isEnoent(error)) throw error;
    }
  }
  if (Object.keys(output).length === 0) return [];
  const declarations = await emitTsDeclarations(output);
  /** @type {string[]} */
  const written = [];
  for (const [relativePath, content] of Object.entries(declarations)) {
    await writeFile(path.join(outdir, relativePath), content);
    written.push(relativePath);
  }
  return written;
}

/** Remove `.d.ts` files whose `.js` sibling no longer exists.
 * @param {string} outdir
 * @returns {Promise<string[]>}
 */
export async function pruneOrphanDeclarations(outdir) {
  const removed = [];
  const roots = [outdir, path.join(outdir, MESSAGE_DIRECTORY)];
  for (const root of roots) {
    /** @type {string[]} */
    let entries = [];
    try {
      entries = await readdir(root);
    } catch (error) {
      if (isEnoent(error)) continue;
      throw error;
    }
    for (const entry of entries) {
      if (!entry.endsWith(".d.ts")) continue;
      const jsName = `${entry.slice(0, -".d.ts".length)}.js`;
      try {
        await readFile(path.join(root, jsName), "utf8");
      } catch (error) {
        if (!isEnoent(error)) throw error;
        await rm(path.join(root, `${entry}`));
        removed.push(path.relative(outdir, path.join(root, entry)));
      }
    }
  }
  return removed;
}

/**
 * @param {string} outdir
 * @returns {Promise<{ messages: string[], statics: string[], pruned: string[], milliseconds: number }>}
 */
export async function emitAllDeclarationsFromOutdir(outdir) {
  const started = Date.now();
  const messages = await emitMessageDeclarationsFromOutdir(outdir);
  const statics = await emitStaticDeclarationsFromOutdir(outdir);
  const pruned = await pruneOrphanDeclarations(outdir);
  return { messages, statics, pruned, milliseconds: Date.now() - started };
}

/**
 * Serialize settle runs so concurrent hook dispatches (the dev container
 * fans `buildStart`/`watchChange` out across plugins and environments) never
 * interleave two settles with each other.
 * @returns {(task: () => Promise<unknown>) => Promise<unknown>}
 */
function createSettleQueue() {
  /** @type {Promise<unknown>} */
  let tail = Promise.resolve();
  return (/** @type {() => Promise<unknown>} */ task) => {
    const run = tail.then(task, task);
    tail = run.catch(() => {});
    return run;
  };
}

/**
 * Vite plugin that keeps the fast message declarations in sync while the
 * upstream paraglide plugin owns the `.js` output.
 *
 * `buildStart`/`watchChange` use object hooks with `sequential: true` so the
 * dev container drains the upstream plugin's in-flight compile before running
 * ours (plain function hooks run concurrently there and lose the race against
 * the compiler deleting files it did not emit). `buildEnd`/`closeBundle`
 * reconverge one-shot flows (`vitest`, `vite build`) once the compiler has
 * settled. Every hook funnels through one serialized settle queue.
 * @param {{ outdir?: string }} [options]
 * @returns {{ name: string, buildStart: { order: "post", sequential: true, handler: () => Promise<unknown> }, watchChange: { order: "post", sequential: true, handler: (file: string) => unknown }, buildEnd: () => Promise<void>, closeBundle: () => Promise<void> }}
 */
export function paraglideFastDeclarationsPlugin({ outdir = "./src/lib/paraglide" } = {}) {
  const resolved = () => path.resolve(process.cwd(), outdir);
  const isOwnOutput = (/** @type {string} */ file) =>
    path.resolve(process.cwd(), file).startsWith(`${resolved()}${path.sep}`);
  const isInputChange = (/** @type {string} */ file) =>
    !isOwnOutput(file) &&
    (file.includes("project.inlang") || /(^|\/)messages\/.*\.json$/.test(file));
  const settleAll = () => emitAllDeclarationsFromOutdir(resolved()).then(() => undefined);
  const settleMessages = () => emitMessageDeclarationsFromOutdir(resolved()).then(() => undefined);
  const enqueue = createSettleQueue();
  return {
    name: "openpost-paraglide-fast-declarations",
    buildStart: {
      order: "post",
      sequential: true,
      handler: () => enqueue(settleAll),
    },
    watchChange: {
      order: "post",
      sequential: true,
      handler: (/** @type {string} */ file) => {
        if (isInputChange(file)) {
          // Project settings can change the runtime Locale union as well as
          // message types. Catalogue-only edits keep the cheaper message pass.
          return enqueue(file.includes("project.inlang") ? settleAll : settleMessages);
        }
      },
    },
    async buildEnd() {
      await enqueue(settleAll);
    },
    async closeBundle() {
      await enqueue(settleAll);
    },
  };
}

const isEntrypoint =
  process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (isEntrypoint) {
  const outdirFlag = process.argv.indexOf("--outdir");
  const outdir = outdirFlag === -1 ? null : process.argv[outdirFlag + 1];
  if (!outdir) {
    console.error("Usage: paraglide-declarations.mjs --outdir <dir>");
    process.exit(1);
  }
  const result = await emitAllDeclarationsFromOutdir(path.resolve(outdir));
  console.log(
    `Paraglide declarations: ${result.messages.length} message, ${result.statics.length} static, ` +
      `pruned ${result.pruned.length} in ${result.milliseconds}ms.`,
  );
}
