/**
 * Helper spawned as a fresh `node` process by `bench.mjs` to measure a
 * genuinely cold `import()` (no shared module cache with the parent
 * process or previous runs). Prints the elapsed milliseconds to stdout.
 */
import { performance } from "node:perf_hooks";

const target = process.argv[2];
const start = performance.now();
await import(target);
const end = performance.now();

console.log(end - start);
