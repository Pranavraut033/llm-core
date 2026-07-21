# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working in
this repository: `@pranavraut033/llm-core`.

## What this package is

A standalone, domain-agnostic TypeScript package providing a multi-provider
LLM abstraction: provider registry/factory, generic prompt-template
registry/resolver/validation (Handlebars + Zod), and an injectable
token-usage tracker. It was extracted from the resume-builder app's
`src/lib/llm/` so the provider/prompt machinery can be reused in any host.

This is its own git repository, separate from the parent `resume-builder`
monorepo it lives under. Treat it as an independently versioned/published
package — do not assume access to, or reuse of, root-level config, `src/`
code, or `@/` path aliases from the parent repo.

## Design rules (do not violate)

- **Server = nothing, host = everything.** Never read from disk, secure
  storage, or a database. Never make network calls except inside a
  provider's `runLLM`/`runStructuredLLM`/`fetchModels`/`validateConnection`.
  API keys, persistence, and logging are all injected via `LLMCoreConfig`
  (`keyResolver`, `onUsage`, `logger`).
- **Typed, module-augmentable `ProviderId`.** It's `keyof ProviderIdRegistry`
  (`src/providerType.ts`), not a plain `string` — registering or looking up
  an undeclared id is a compile-time error. Built-ins are seeded into
  `ProviderIdRegistry` and exposed via `BUILTIN_PROVIDERS`. Consumers add a
  custom provider id by augmenting `ProviderIdRegistry` via declaration
  merging (`declare module "@pranavraut033/llm-core" { interface
ProviderIdRegistry { "my-id": true } }`), then calling
  `LLMProvider.register(id, metadata, ctor)`. Don't widen `ProviderId` back
  to `string` — that's exactly the safety this interface exists to provide.
  Tests that need a custom id augment it via
  `tests/helpers/ambientProviderIds.ts` (see Testing notes below).
- **Opt-in registration.** Importing the main entry point (`src/index.ts`)
  must NOT register any providers as a side effect. Built-in providers are
  registered only by importing `./providers/register-builtins` (or by the
  host calling `LLMProvider.register` itself).
- **No provider SDK leakage into the core barrels.** `src/index.ts` and
  `src/providers/index.ts` must not transitively import `openai`,
  `@anthropic-ai/sdk`, or `@google/genai` — those are optional peer deps.
  `OpenAICompatibleProvider` (which needs `openai`) lives in its own entry
  point: `src/providers/openai-compatible.ts`.
- **Generic prompts.** `PromptTemplate<TContext, TPurpose>` and
  `TemplateRegistry` are generic over a host-defined context shape and
  purpose string union — don't reintroduce resume-specific types
  (`PromptContext`, `PROMPT_PURPOSES`, etc.).

## Build entry points (tsup, `tsup.config.ts`)

Seven entries, each emitted as ESM + CJS + `.d.ts`:

- `index` — types, `ProviderId`/`BUILTIN_PROVIDERS`, `LLMCoreConfig`, logger,
  token-usage types/utilities, `ProviderRegistry`/`getRegistry`,
  `getProviderInstance`, `LLMProvider` base class.
- `providers/index` — registry/factory/base-class re-exports (no SDKs).
- `providers/openai-compatible` — `OpenAICompatibleProvider` (requires
  `openai`).
- `providers/register-builtins` — side-effect import registering all 10
  built-in providers (OpenAI, Gemini, Grok, Groq, Perplexity, Ollama,
  Anthropic, DeepSeek, Mistral, OpenRouter — the last four via
  `OpenAICompatibleProvider`/`genericOpenAICompatible.ts`). Peer SDKs are
  lazily `import()`ed inside each provider's methods, not at module load —
  `isProviderSDKAvailable()` (`src/providers/sdkAvailability.ts`) checks
  whether a given provider's SDK is installed without importing it.
- `prompts/index` — generic prompt template registry/resolver/validation.
- `core/index` — framework-agnostic streaming controllers (`createCompletion`,
  `createChat`, `createObject`), each a plain observable store shaped for
  `useSyncExternalStore` (`{ getSnapshot(), subscribe(cb), ...actions }`). No
  React import here.
- `react/index` — React hooks (`useCompletion`, `useChat`, `useObject`,
  `useModels`) wrapping the `core` controllers via `useSyncExternalStore`.
  `react` is an optional peer dep.

`splitting: true` is REQUIRED — it forces shared chunks so singletons
(`ProviderRegistry`, `TemplateRegistry`) are the same module instance across
entry points. If you ever set this back to `false`, providers registered via
`register-builtins` will land in a different registry instance than
`index`'s `getProviderInstance` reads from, and lookups will silently fail.

When adding a new entry point or subpath export, update in lockstep:
`tsup.config.ts` (`entry`), `package.json` (`exports` map + `sideEffects`
array if it has registration side effects), and the README's entry-points
table.

## Commands

```bash
npm install
npm run build         # tsup -> dist (ESM + CJS + .d.ts)
npm run dev            # tsup --watch
npm run type-check     # tsc --noEmit
npm test               # vitest (watch)
npm run test:run       # vitest run
npm run lint           # eslint .
npm run lint:fix       # eslint . --fix
npm run format         # prettier --write .
npm run format:check   # prettier --check .
npm run bench           # cold-import benchmark (benchmarks/bench.mjs) — measures
                         # provider-loading cost before/after lazy SDK imports
```

Before committing: `npm run lint:fix && npm run format && npm run type-check && npm run test:run`.

## Testing notes

- `ProviderRegistry` and `TemplateRegistry` are singletons — tests that
  register custom providers/templates should do so in their own test file
  (Vitest isolates module state per file) or `clear()`/reset between tests.
- `tests/helpers/dummyProvider.ts` provides a network-free `DummyProvider`
  for registry/factory/integration tests — prefer it over hitting a real
  provider SDK.
- `tests/helpers/ambientProviderIds.ts` augments `ProviderIdRegistry` with
  every custom/fixture provider id used across the test suite (e.g.
  `"my-custom-llm"`, `"integration-dummy"`) — import it for side effects in
  any test file that registers a custom id. Ids meant to test the
  _unregistered/typo_ runtime guard (e.g. `"totally-unknown"`) should stay
  undeclared and use an explicit `as ProviderId` cast at the call site
  instead, since that's the realistic failure mode being tested.
- After changing the `exports` map, entry points, or any ESM/CJS interop
  (e.g. how a CJS dependency like `handlebars` is imported), validate with
  `npm pack` + a scratch consumer script in both ESM and CJS — `tsc`/build
  alone has missed real bugs here before (see git history).

## Conventions

- Relative imports only — no `@/` alias, no dependency on the parent
  `resume-builder` repo's `tsconfig`/path mapping.
- `dangerouslyAllowBrowser: true` is intentional for the OpenAI-compatible
  providers (OpenAI, Grok, Perplexity, DeepSeek, Groq, Mistral, OpenRouter) —
  this package targets client-side /
  Tauri-style hosts. Don't "fix" this without checking the README's design
  notes.
- Provider metadata (`ProviderMetadata`) is data-only — no React/icon
  imports.
