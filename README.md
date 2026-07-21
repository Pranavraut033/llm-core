# @pranavraut033/llm-core

**A client-side, BYOK-first LLM core: typed provider registry, streaming
completions/chat/structured-output controllers, React hooks, and a
Handlebars prompt-template system — with no server and no forced
dependencies.**

[![npm version](https://img.shields.io/npm/v/@pranavraut033/llm-core)](https://www.npmjs.com/package/@pranavraut033/llm-core)
[![license](https://img.shields.io/npm/l/@pranavraut033/llm-core)](./LICENSE)
[![bundle size](https://img.shields.io/bundlephobia/minzip/@pranavraut033/llm-core)](https://bundlephobia.com/package/@pranavraut033/llm-core)

Extracted from the [resume-builder](https://github.com/) app's LLM layer so
the provider/prompt/registry/controller machinery can be reused for any
domain — not just resumes.

## Features

- **Client-only, BYOK.** Never talks to a server, database, or disk — every
  API key is resolved by a host-injected `keyResolver`, so keys never have
  to leave the client/Tauri process.
- **Ten built-in providers**, one interface: OpenAI, Anthropic, Gemini,
  Grok, Groq, Perplexity, Ollama, DeepSeek, Mistral, OpenRouter.
- **Typed, extensible provider IDs.** `ProviderId` is `keyof
ProviderIdRegistry`, not a plain `string` — an unregistered/typo'd id is a
  compile-time error, and hosts can add their own ids via declaration
  merging.
- **Opt-in registration.** Importing the package registers nothing; you
  choose what to pull in.
- **Streaming completion / chat / structured-output controllers**
  (`/core`) — framework-agnostic observable stores wrapping
  `generateText`/`runLLM`/`runStructuredLLM`, built for
  `useSyncExternalStore` compatibility.
- **React hooks** (`/react`) — `useCompletion`, `useChat`, `useObject`,
  `useModels`, thin bindings over `/core` with no duplicated logic.
- **Structured (Zod) output** via a generic, host-defined Handlebars
  prompt-template registry (`/prompts`).
- **Unified error taxonomy** — every provider throws a typed `LLMError`
  subclass instead of leaking raw SDK errors.
- **Injectable token-usage tracking** — no built-in persistence; you supply
  the sink.

## Design

- **Server = nothing, host = everything.** This package never talks to a
  database, never reads from disk/secure storage, and never registers a
  provider as a side effect of importing the main entry point. You inject:
  - a `keyResolver` to resolve API keys/credentials per provider,
  - an optional `onUsage` sink to persist token-usage records,
  - an optional `logger`.
- **Typed, extensible provider IDs.** `ProviderId` is `keyof ProviderIdRegistry`
  — not a plain `string`. The ten built-ins are seeded into that interface
  and exposed as `BUILTIN_PROVIDERS` constants. To register your own
  provider with full type safety, augment `ProviderIdRegistry` via
  TypeScript declaration merging, then call `LLMProvider.register(...)`
  with that id — see [Custom providers](#custom-providers) below.
- **Opt-in registration.** Built-in providers are NOT registered by
  importing `@pranavraut033/llm-core`. Import
  `@pranavraut033/llm-core/providers/register-builtins` (once, for its side
  effects) to register all ten, or call `LLMProvider.register` yourself for
  a custom subset.
- **`dangerouslyAllowBrowser: true`.** The OpenAI-compatible providers
  (OpenAI, Grok, Perplexity, DeepSeek, Groq, Mistral, OpenRouter) construct
  their client with `dangerouslyAllowBrowser: true`, since this package is
  designed for client-side / Tauri-style apps where the host already
  controls how API keys are stored and exposed. Don't ship a real
  user-supplied API key to an untrusted browser context.
- **Unified error taxonomy.** Every provider throws a typed `LLMError`
  subclass (`src/errors.ts`) — rate limits, auth failures, context-length
  errors, etc. all normalize to a common shape instead of leaking raw SDK
  errors.

## Install

```bash
npm install @pranavraut033/llm-core zod handlebars
```

Provider SDKs are **optional peer dependencies**, resolved lazily — install
only the ones you need. Even importing
`@pranavraut033/llm-core/providers/register-builtins` doesn't require them
upfront; a given provider's SDK is only actually imported the first time you
call a method (`runLLM`, `fetchModels`, etc.) on an instance of that
provider. Calling one without its SDK installed throws a clear
`ProviderSDKNotInstalledError` instead of a raw "Cannot find package" error;
`isProviderSDKAvailable(providerId)` lets you check ahead of time.

```bash
npm install openai            # OpenAI, Grok, Perplexity, DeepSeek, Groq, Mistral, OpenRouter (all OpenAI-compatible)
npm install @anthropic-ai/sdk # Anthropic
npm install @google/genai     # Gemini
```

`ollama` requires no SDK (plain `fetch` against a local server).

`react` is also an **optional peer dependency**, needed only if you import
`@pranavraut033/llm-core/react`:

```bash
npm install react
```

## Entry points

| Subpath                                               | Contents                                                                                                                                                                                                         |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@pranavraut033/llm-core`                             | Types, `ProviderId`/`BUILTIN_PROVIDERS`, `LLMCoreConfig`, logger, token-usage types/utilities, `ProviderRegistry`/`getRegistry`, `getProviderInstance`, `LLMProvider` base class. **No provider SDKs required.** |
| `@pranavraut033/llm-core/providers/register-builtins` | Side-effect import that registers all 10 built-in providers (OpenAI, Gemini, Grok, Groq, Perplexity, Ollama, Anthropic, DeepSeek, Mistral, OpenRouter). **Never requires any provider SDK to be installed** — each SDK is lazily `import()`ed the first time a method is called on an instance of that provider; use `isProviderSDKAvailable(providerId)` to check ahead of time.                                                                                                            |
| `@pranavraut033/llm-core/providers/openai-compatible` | `OpenAICompatibleProvider` base class for building custom OpenAI-compatible providers. Requires `openai`.                                                                                                        |
| `@pranavraut033/llm-core/prompts`                     | Generic Handlebars prompt-template registry/resolver/validator.                                                                                                                                                  |
| `@pranavraut033/llm-core/core`                        | Framework-agnostic reactive controllers (`createCompletion`, `createChat`, `createObject`) — plain observable stores, no framework import.                                                                       |
| `@pranavraut033/llm-core/react`                       | React hooks (`useCompletion`, `useChat`, `useObject`, `useModels`) binding the `/core` controllers via `useSyncExternalStore`. Requires `react` (optional peer dependency).                                      |

## Quick start

### 1. Configure key resolution and usage tracking

```ts
import type { LLMCoreConfig } from "@pranavraut033/llm-core";
import { BUILTIN_PROVIDERS } from "@pranavraut033/llm-core";

const config: LLMCoreConfig = {
  keyResolver: async (providerId) => {
    // e.g. read from Tauri secure storage, localStorage, env vars, a vault...
    return await myKeyStore.get(providerId);
  },
  onUsage: async (usage) => {
    // e.g. persist to your own database
    await myDb.tokenUsage.create(usage);
  },
};
```

### 2. Register providers

```ts
// Registers OpenAI, Gemini, Grok, Groq, Perplexity, Ollama, Anthropic, DeepSeek, Mistral, OpenRouter.
import "@pranavraut033/llm-core/providers/register-builtins";
```

Or register only what you need / your own custom provider — see
[Custom providers](#custom-providers) for the typed registration step.

### 3. Get a provider instance and call it

```ts
import {
  BUILTIN_PROVIDERS,
  getProviderInstance,
} from "@pranavraut033/llm-core";

const provider = await getProviderInstance(BUILTIN_PROVIDERS.OPENAI, config);

const { result, usage } = await provider.generateText(
  "You are a helpful assistant.",
  "Say hello in five languages.",
  { model: "gpt-4o-mini" }
);

await config.onUsage?.(usage);
```

### 4. Structured output via prompt templates

```ts
import { z } from "zod";
import { resolveTemplate } from "@pranavraut033/llm-core/prompts";
import type { PromptTemplate } from "@pranavraut033/llm-core/prompts";

interface MyContext {
  topic: string;
}

const outlineTemplate: PromptTemplate<MyContext, "generate_outline"> = {
  id: "outline",
  purpose: "generate_outline",
  requiredContext: ["topic"],
  outputSchema: z.object({ sections: z.array(z.string()) }),
  systemPrompt: "You are a writing assistant.",
  userPrompt: "Outline a blog post about {{topic}}.",
};

const resolved = resolveTemplate(outlineTemplate, {
  topic: "TypeScript generics",
});

const { result, usage } = await provider.runStructuredLLM(
  resolved,
  { model: "gpt-4o-mini" },
  outlineTemplate.outputSchema!,
  "Outline"
);

// result is typed as { sections: string[] }
```

### 5. React: `useCompletion` / `useChat`

Both hooks are thin `useSyncExternalStore` bindings over the framework-agnostic
`/core` controllers — same streaming/abort/usage semantics, just wired into
React state.

```tsx
import { useCompletion } from "@pranavraut033/llm-core/react";
import { BUILTIN_PROVIDERS } from "@pranavraut033/llm-core";

function Assistant() {
  const { text, complete, stop, isLoading, error, usage } = useCompletion({
    provider: { providerId: BUILTIN_PROVIDERS.OPENAI, config },
    model: "gpt-4o-mini",
    systemPrompt: "You are a helpful assistant.",
    onUsage: (usage) => config.onUsage?.(usage),
  });

  return (
    <div>
      <button onClick={() => complete("Say hello in five languages.")}>
        Ask
      </button>
      {isLoading && <button onClick={stop}>Stop</button>}
      <p>{text}</p>
      {error && <p>{error.message}</p>}
    </div>
  );
}
```

```tsx
import { useChat } from "@pranavraut033/llm-core/react";
import { BUILTIN_PROVIDERS } from "@pranavraut033/llm-core";

function Chat() {
  const { messages, sendMessage, isLoading } = useChat({
    provider: { providerId: BUILTIN_PROVIDERS.OPENAI, config },
    model: "gpt-4o-mini",
  });

  return (
    <div>
      {messages.map((m) => (
        <p key={m.id}>
          <strong>{m.role}:</strong> {m.content}
        </p>
      ))}
      <button
        disabled={isLoading}
        onClick={() => sendMessage("What's the weather like on Mars?")}
      >
        Send
      </button>
    </div>
  );
}
```

`useObject` (structured output) and `useModels` (model catalog + connection
validation for a provider) follow the same pattern — see
`@pranavraut033/llm-core/react`'s exports for their full signatures.

## Comparison

|                                              | `@pranavraut033/llm-core`                      | Vercel AI SDK                     | LangChain.js                     | LiteLLM                               | OpenRouter                                       |
| -------------------------------------------- | ---------------------------------------------- | --------------------------------- | -------------------------------- | ------------------------------------- | ------------------------------------------------ |
| Client-side/BYOK execution (no server hop)   | ✅                                             | ✅ (also supports server-side)    | Mostly server-side (Node-first)  | ❌ — is itself a server/proxy         | ❌ — is itself a hosted routing service          |
| Typed, extensible provider ids               | ✅ (`ProviderId` = `keyof ProviderIdRegistry`) | Partial (string-based model ids)  | Partial (string-based model ids) | N/A (config-driven, not typed client) | N/A (single API surface, not a typed client lib) |
| Opt-in registration (no import side effects) | ✅                                             | N/A (no central registry)         | N/A (no central registry)        | N/A                                   | N/A                                              |
| Bundled prompt-template registry             | ✅ (Handlebars + Zod, `/prompts`)              | ❌ (bring your own)               | ✅ (`PromptTemplate`, LCEL)      | ❌                                    | ❌                                               |
| Structured (Zod) output                      | ✅                                             | ✅ (`generateObject`)             | ✅ (via output parsers)          | Partial (passthrough to upstream API) | Partial (passthrough to upstream API)            |
| Framework hooks (React/Vue/etc.)             | ✅ React now; core is framework-agnostic       | ✅ React/Vue/Svelte               | ❌ (no first-party UI hooks)     | ❌                                    | ❌                                               |
| Built-in providers                           | 10                                             | ~20+ (via provider packages)      | 15+ (via integration packages)   | 100+ (proxies upstream APIs)          | 100+ (routes to upstream APIs)                   |
| Requires a server                            | No                                             | No (but commonly deployed as one) | Typically yes (Node runtime)     | Yes — it IS a server                  | Yes — it IS a hosted service                     |

**Note on LiteLLM and OpenRouter:** both are routing/proxy _services_, not
client-side libraries you import — they sit between your app and the model
provider, which is the opposite of this package's client-only design (and
the reason "requires a server" is trivially "yes" for them). They're
included here because they're common alternatives when someone reaches for
"a way to talk to a bunch of LLM providers," not because they compete on the
same axis.

This package's actual differentiated axis: **client-only BYOK execution +
typed/extensible provider ids + a bundled prompt-template registry**, in one
package with no forced server hop and no forced provider SDKs. It is not a
claim of being more feature-complete than Vercel AI SDK or LangChain.js —
both have broader provider coverage and a larger ecosystem; this package
optimizes for a narrower, opinionated shape (client/Tauri-style hosts that
own their own key storage and want type safety over provider ids).

## Performance

Measured against the built `dist/` output via `benchmarks/bench.mjs`
(`npm run bench`) on July 21, 2026, Node v24.2.0, darwin/arm64. Re-run
`npm run bench` locally to reproduce — these are this package's own numbers,
not third-party reports.

### Gzipped bundle size

| Entry point                                       | Gzipped size         |
| ------------------------------------------------- | -------------------- |
| `index.js` (main entry, no provider SDK required) | 2.89 KB (2960 bytes) |
| `core/index.js` (framework-agnostic controllers)  | 0.18 KB (182 bytes)  |
| `react/index.js` (React hooks)                    | 1.03 KB (1052 bytes) |

Because `splitting: true` produces shared `chunk-*.js` files (required so
singletons like the provider registry are the same module instance across
entry points — see `tsup.config.ts`), an entry file alone can understate its
real transitive weight. Entry file plus everything it transitively imports
locally:

| Entry point (+ local imports)                         | Gzipped size         |
| ----------------------------------------------------- | -------------------- |
| `index.js` + transitively imported local chunks       | 7.44 KB (7622 bytes) |
| `core/index.js` + transitively imported local chunks  | 6.08 KB (6228 bytes) |
| `react/index.js` + transitively imported local chunks | 6.74 KB (6905 bytes) |

### Cold import time

Median of 10 fresh `node` process spawns, each doing a single
`import("dist/index.js")` with no shared module cache between processes.

| Metric                         | Value    |
| ------------------------------ | -------- |
| Median cold import time (n=10) | 11.85 ms |
| Min                            | 10.89 ms |
| Max                            | 14.08 ms |

### Provider instantiation cost

Time to resolve a provider instance via
`getProviderInstance(BUILTIN_PROVIDERS.OLLAMA, config)` — `ollama` requires
no SDK and no API key to construct, so this isolates registry/factory
overhead from network/auth latency. Measured in-process, 50 calls.

| Metric                              | Value   |
| ----------------------------------- | ------- |
| First call (cold registry lookup)   | 0.14 ms |
| Median of remaining 49 calls (warm) | 0.00 ms |

### Competitor bundle sizes (context only)

> **Not measured the same way — approximate, for context only.** As of
> July 21, 2026, via [bundlephobia.com](https://bundlephobia.com) (min+gzip).
> These are third-party-reported figures for the packages' full/core entry
> points, not numbers this benchmark script computed itself, and they move
> release to release — treat as ballpark, not a head-to-head measurement.

| Package                   | Reported min+gzip size (approx.) |
| ------------------------- | -------------------------------- |
| `ai` (Vercel AI SDK core) | ~40-50 KB                        |
| `langchain` (core)        | ~90-120 KB                       |

The full generated report (identical numbers, regenerated on every
`npm run bench` run) also lives at
[`benchmarks/results.md`](./benchmarks/results.md).

## Custom providers

`ProviderId` is `keyof ProviderIdRegistry`, not a plain `string` — registering
a provider under an undeclared id is a compile-time error. Declare your id
once via TypeScript declaration merging, then register and use it like any
built-in:

```ts
// e.g. in a project-wide ambient file such as src/llm-providers.d.ts
declare module "@pranavraut033/llm-core" {
  interface ProviderIdRegistry {
    "my-company-llm": true;
  }
}
```

```ts
import { LLMProvider } from "@pranavraut033/llm-core";

class MyCustomProvider extends LLMProvider {
  // ... implement providerType, streamSupported, fetchModels,
  // validateConnection, runLLM, runStructuredLLM
}

// "my-company-llm" type-checks (and autocompletes) because of the
// augmentation above — any other string is rejected.
LLMProvider.register(
  "my-company-llm",
  { name: "My Company LLM", requiresAuth: true },
  (apiKey) => new MyCustomProvider(apiKey)
);

const provider = await getProviderInstance("my-company-llm", config);
```

The augmentation is pure TypeScript — it has no runtime effect and isn't
required for the code to run (e.g. under plain `vitest`/`tsx`/`ts-node`'s
transpile-only modes). It exists purely so `tsc`/your editor catch a typo'd
or unregistered provider id before it reaches `LLMProvider.register` or
`getProviderInstance` at runtime.

## Embeddings

Providers that support it (OpenAI, Gemini, Ollama) implement `embed()`:

```ts
const { result, usage } = await provider.embed(["hello world"], {
  model: "text-embedding-3-small",
});
```

## Model catalog and pricing

`MODEL_CATALOG`/`getModelInfo` (`src/models/modelCatalog.ts`) expose
per-model capabilities (context window, vision/tool support, etc.), and
`MODEL_PRICING`/`computeCostUSD` (`src/tokens/pricing.ts`) give per-model
token pricing for cost estimation from an `LLMUsageInfo` record.

## Errors

Every provider throws typed `LLMError` subclasses (`src/errors.ts`) —
e.g. `RateLimitError`, `AuthenticationError`, `ContextLengthError` — instead
of raw SDK errors, so hosts can branch on error type without knowing which
provider raised it.

## Token usage

`LLMUsageInfo` is a persistence-agnostic shape populated by every provider.
Use `mergeLLMUsageInfo` to combine usage from multiple calls (must share the
same `provider`/`model`), and `trackTokenUsage` to fill in a `requestId` and
hand the record to your own `sink`:

```ts
import { trackTokenUsage } from "@pranavraut033/llm-core";

await trackTokenUsage(usage, {
  sink: async (u) => myDb.tokenUsage.create(u),
});
```

## Testing

```bash
npm install
npm run build       # tsup -> dist (ESM + CJS + .d.ts)
npm run type-check  # tsc --noEmit
npm test            # vitest
npm run bench        # benchmarks/bench.mjs -> benchmarks/results.md (see Performance)
```
