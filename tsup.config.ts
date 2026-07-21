import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    "providers/index": "src/providers/index.ts",
    "providers/openai-compatible": "src/providers/openai-compatible.ts",
    "providers/register-builtins": "src/providers/register-builtins.ts",
    "prompts/index": "src/prompts/index.ts",
    "core/index": "src/core/index.ts",
    "react/index": "src/react/index.ts",
  },
  format: ["esm", "cjs"],
  dts: true,
  // Shared chunks are required so singletons (ProviderRegistry,
  // TemplateRegistry) are the SAME module instance across entry points —
  // e.g. providers registered via `providers/register-builtins` must land
  // in the same registry that `index`'s `getProviderInstance` reads from.
  splitting: true,
  sourcemap: true,
  clean: true,
  target: "es2020",
  // perplexity-fallback.json is imported by the perplexity provider
  loader: {
    ".json": "json",
  },
});
