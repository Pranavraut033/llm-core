# @resume-builder/llm-core

Domain-agnostic, multi-provider LLM core: a provider registry/factory,
generic LLM/tool types, structured (Zod) output, an injectable token-usage
tracker, and a Handlebars-based prompt-template system generic over a
host-defined context and purpose vocabulary.

Extracted from the [resume-builder](https://github.com/) app's LLM layer so
the provider/prompt/registry machinery can be reused for any domain — not
just resumes.

## Design

- **Server = nothing, host = everything.** This package never talks to a
  database, never reads from disk/secure storage, and never registers a
  provider as a side effect of importing the main entry point. You inject:
  - a `keyResolver` to resolve API keys/credentials per provider,
  - an optional `onUsage` sink to persist token-usage records,
  - an optional `logger`.
- **Open provider IDs.** `ProviderId` is just `string`. The six built-in
  providers are exposed as `BUILTIN_PROVIDERS` constants, but you can
  register your own provider under any id via `LLMProvider.register(...)`.
- **Opt-in registration.** Built-in providers are NOT registered by
  importing `@resume-builder/llm-core`. Import
  `@resume-builder/llm-core/providers/register-builtins` (once, for its side
  effects) to register all six, or call `LLMProvider.register` yourself for
  a custom subset.
- **`dangerouslyAllowBrowser: true`.** The OpenAI-compatible providers
  (OpenAI, Grok, Perplexity) construct their client with
  `dangerouslyAllowBrowser: true`, since this package is designed for
  client-side / Tauri-style apps where the host already controls how API
  keys are stored and exposed. Don't ship a real user-supplied API key to an
  untrusted browser context.

## Install

```bash
npm install @resume-builder/llm-core zod handlebars
```

Provider SDKs are **optional peer dependencies** — install only the ones you
need:

```bash
npm install openai            # OpenAI, Grok, Perplexity (OpenAI-compatible)
npm install @anthropic-ai/sdk # Anthropic
npm install @google/genai     # Gemini
```

`ollama` requires no SDK (plain `fetch` against a local server).

## Entry points

| Subpath                                                | Contents                                                                                                                                                                                                         |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@resume-builder/llm-core`                             | Types, `ProviderId`/`BUILTIN_PROVIDERS`, `LLMCoreConfig`, logger, token-usage types/utilities, `ProviderRegistry`/`getRegistry`, `getProviderInstance`, `LLMProvider` base class. **No provider SDKs required.** |
| `@resume-builder/llm-core/providers/register-builtins` | Side-effect import that registers all 6 built-in providers (OpenAI, Gemini, Grok, Perplexity, Ollama, Anthropic). Requires the relevant SDKs to be installed.                                                    |
| `@resume-builder/llm-core/providers/openai-compatible` | `OpenAICompatibleProvider` base class for building custom OpenAI-compatible providers. Requires `openai`.                                                                                                        |
| `@resume-builder/llm-core/prompts`                     | Generic Handlebars prompt-template registry/resolver/validator.                                                                                                                                                  |

## Quick start

### 1. Configure key resolution and usage tracking

```ts
import type { LLMCoreConfig } from "@resume-builder/llm-core";
import { BUILTIN_PROVIDERS } from "@resume-builder/llm-core";

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
// Registers OpenAI, Gemini, Grok, Perplexity, Ollama, Anthropic.
import "@resume-builder/llm-core/providers/register-builtins";
```

Or register only what you need / your own custom provider:

```ts
import { LLMProvider } from "@resume-builder/llm-core";

class MyCustomProvider extends LLMProvider {
  // ... implement providerType, streamSupported, fetchModels,
  // validateConnection, runLLM, runStructuredLLM
}

LLMProvider.register(
  "my-company-llm",
  { name: "My Company LLM", requiresAuth: true },
  (apiKey) => new MyCustomProvider(apiKey)
);
```

### 3. Get a provider instance and call it

```ts
import {
  BUILTIN_PROVIDERS,
  getProviderInstance,
} from "@resume-builder/llm-core";

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
import { resolveTemplate } from "@resume-builder/llm-core/prompts";
import type { PromptTemplate } from "@resume-builder/llm-core/prompts";

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

## Token usage

`LLMUsageInfo` is a persistence-agnostic shape populated by every provider.
Use `mergeLLMUsageInfo` to combine usage from multiple calls (must share the
same `provider`/`model`), and `trackTokenUsage` to fill in a `requestId` and
hand the record to your own `sink`:

```ts
import { trackTokenUsage } from "@resume-builder/llm-core";

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
```
