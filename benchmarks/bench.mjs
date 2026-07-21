#!/usr/bin/env node
/**
 * Benchmarks for `@pranavraut033/llm-core`, run against the REAL built
 * `dist/` output (run `npm run build` first if `dist/` is stale/missing).
 *
 * Measures:
 *   1. Gzipped bundle size of the `index`, `core/index`, and `react/index`
 *      entry points.
 *   2. Cold `import()` time of `dist/index.js` (median of N fresh `node`
 *      processes, so results aren't polluted by the module cache).
 *   3. Time to resolve a provider instance via `getProviderInstance`
 *      (using the built-in, SDK-free `ollama` provider).
 *   4. A hardcoded, explicitly-labeled "approximate, reported elsewhere"
 *      table of competitor bundle sizes, for context only.
 *
 * Emits a Markdown report to stdout and to `benchmarks/results.md`.
 *
 * Usage: `npm run bench` (defined in package.json).
 */
import { execFileSync } from "node:child_process";
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { gzipSync } from "node:zlib";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, "..");
const distDir = resolve(rootDir, "dist");

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

function fmtMs(ms) {
  return `${ms.toFixed(2)} ms`;
}

function fmtKB(bytes) {
  return `${(bytes / 1024).toFixed(2)} KB`;
}

// ---------------------------------------------------------------------------
// 1. Gzipped bundle sizes
// ---------------------------------------------------------------------------

function readDistFile(relativePath) {
  const absPath = resolve(distDir, relativePath);
  try {
    statSync(absPath);
  } catch {
    throw new Error(
      `Missing ${absPath} — run \`npm run build\` before \`npm run bench\`.`
    );
  }
  return readFileSync(absPath);
}

function gzippedSize(relativePath) {
  return gzipSync(readDistFile(relativePath)).length;
}

// tsup's `splitting: true` (required for shared singletons, see
// tsup.config.ts) means an entry file like `core/index.js` is often a thin
// shim re-exporting from shared `chunk-*.js` files rather than containing
// the real code inline. Measuring the entry file alone therefore
// understates its actual transitive weight — so in addition to the raw
// entry-file size, we also walk its local relative imports and report the
// gzipped size of the entry file plus everything it transitively pulls in.
function resolveTransitiveLocalFiles(entryRelPath, seen = new Set()) {
  const absPath = resolve(distDir, entryRelPath);
  if (seen.has(absPath)) return seen;
  seen.add(absPath);

  const source = readFileSync(absPath, "utf8");
  const importRegex = /from\s+["'](\.[^"']+)["']|import\s+["'](\.[^"']+)["']/g;
  let match;
  while ((match = importRegex.exec(source))) {
    const specifier = match[1] ?? match[2];
    const resolvedRelPath = resolve(dirname(absPath), specifier).replace(
      `${distDir}/`,
      ""
    );
    resolveTransitiveLocalFiles(resolvedRelPath, seen);
  }
  return seen;
}

function transitiveGzippedSize(entryRelPath) {
  const files = resolveTransitiveLocalFiles(entryRelPath);
  const concatenated = Buffer.concat([...files].map((f) => readFileSync(f)));
  return gzipSync(concatenated).length;
}

const bundleSizes = {
  "index.js (main entry, no provider SDK required)": gzippedSize("index.js"),
  "core/index.js (framework-agnostic controllers)":
    gzippedSize("core/index.js"),
  "react/index.js (React hooks)": gzippedSize("react/index.js"),
};

const transitiveBundleSizes = {
  "index.js + transitively imported local chunks":
    transitiveGzippedSize("index.js"),
  "core/index.js + transitively imported local chunks":
    transitiveGzippedSize("core/index.js"),
  "react/index.js + transitively imported local chunks":
    transitiveGzippedSize("react/index.js"),
};

// ---------------------------------------------------------------------------
// 2. Cold import time — median of N fresh `node` process spawns
// ---------------------------------------------------------------------------

const COLD_IMPORT_RUNS = 10;
const indexEntryUrl = pathToFileURL(resolve(distDir, "index.js")).href;
const workerPath = resolve(__dirname, "_cold-import-worker.mjs");

const coldImportTimes = [];
for (let i = 0; i < COLD_IMPORT_RUNS; i++) {
  const output = execFileSync(process.execPath, [workerPath, indexEntryUrl], {
    encoding: "utf8",
  });
  coldImportTimes.push(Number.parseFloat(output.trim()));
}
const coldImportMedian = median(coldImportTimes);

// ---------------------------------------------------------------------------
// 3. Provider instantiation cost — `getProviderInstance("ollama", ...)`,
//    the one built-in provider that needs no SDK/API key to construct.
// ---------------------------------------------------------------------------

const { getProviderInstance, BUILTIN_PROVIDERS } = await import(
  pathToFileURL(resolve(distDir, "index.js")).href
);
await import(
  pathToFileURL(resolve(distDir, "providers/register-builtins.js")).href
);

const providerConfig = {
  keyResolver: async () => undefined,
};

const PROVIDER_RUNS = 50;
const providerInstantiationTimes = [];
for (let i = 0; i < PROVIDER_RUNS; i++) {
  const { performance } = await import("node:perf_hooks");
  const start = performance.now();
  await getProviderInstance(BUILTIN_PROVIDERS.OLLAMA, providerConfig);
  providerInstantiationTimes.push(performance.now() - start);
}
const providerFirstCall = providerInstantiationTimes[0];
const providerWarmMedian = median(providerInstantiationTimes.slice(1));

// ---------------------------------------------------------------------------
// 4. Hardcoded, explicitly-approximate competitor bundle sizes
// ---------------------------------------------------------------------------

const measuredAt = new Date().toLocaleDateString("en-US", {
  year: "numeric",
  month: "long",
  day: "numeric",
});

const competitorTable = `
> **Not measured the same way — approximate, for context only.** As of
> ${measuredAt}, via [bundlephobia.com](https://bundlephobia.com) (min+gzip).
> These are third-party-reported figures for the packages' full/core
> entry points, not numbers this benchmark script computed itself, and
> they move release to release — treat as ballpark, not a head-to-head
> measurement.

| Package                    | Reported min+gzip size (approx.) |
| --------------------------- | --------------------------------- |
| \`ai\` (Vercel AI SDK core) | ~40-50 KB                         |
| \`langchain\` (core)        | ~90-120 KB                        |
`.trim();

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

const bundleRows = Object.entries(bundleSizes)
  .map(([label, bytes]) => `| ${label} | ${fmtKB(bytes)} (${bytes} bytes) |`)
  .join("\n");

const transitiveBundleRows = Object.entries(transitiveBundleSizes)
  .map(([label, bytes]) => `| ${label} | ${fmtKB(bytes)} (${bytes} bytes) |`)
  .join("\n");

const report = `## Performance benchmarks (measured)

_Generated by \`benchmarks/bench.mjs\` (\`npm run bench\`) against the built \`dist/\` output on ${measuredAt}, Node ${process.version}, ${process.platform}/${process.arch}. These numbers are measured directly by this script, not sourced externally — re-run locally to reproduce._

### Gzipped bundle size

| Entry point | Gzipped size |
| ----------- | ------------ |
${bundleRows}

Because \`splitting: true\` produces shared \`chunk-*.js\` files (required so
singletons like the provider registry are the same module instance across
entry points — see \`tsup.config.ts\`), an entry file alone can understate
its real transitive weight. For a more honest "what does importing only
this entry point actually cost" number, here's the entry file plus
everything it transitively imports locally:

| Entry point (+ local imports) | Gzipped size |
| ------------------------------ | ------------ |
${transitiveBundleRows}

### Cold import time

Median of ${COLD_IMPORT_RUNS} fresh \`node\` process spawns, each doing a single \`import("${"dist/index.js"}")\` with no shared module cache with the parent process or prior runs (so the number includes Node's own module-graph resolution/parse/eval, not just this package's code).

| Metric | Value |
| ------ | ----- |
| Median cold import time (n=${COLD_IMPORT_RUNS}) | ${fmtMs(coldImportMedian)} |
| Min | ${fmtMs(Math.min(...coldImportTimes))} |
| Max | ${fmtMs(Math.max(...coldImportTimes))} |

### Provider instantiation cost

Time to resolve a provider instance via \`getProviderInstance(BUILTIN_PROVIDERS.OLLAMA, config)\` — \`ollama\` requires no SDK and no API key to construct, so this isolates registry/factory overhead from network/auth latency. Measured in-process (same Node instance, module already loaded), ${PROVIDER_RUNS} calls.

| Metric | Value |
| ------ | ----- |
| First call (cold registry lookup) | ${fmtMs(providerFirstCall)} |
| Median of remaining ${PROVIDER_RUNS - 1} calls (warm) | ${fmtMs(providerWarmMedian)} |

### Competitor bundle sizes (context only)

${competitorTable}
`;

writeFileSync(resolve(__dirname, "results.md"), report);
console.log(report);
