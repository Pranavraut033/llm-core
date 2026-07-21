# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [0.3.0] - 2026-07-21

### Added

- Streaming `createCompletion`/`createChat`/`createObject` controllers under a new `/core` entry point — framework-agnostic observable stores shaped for `useSyncExternalStore` ([9625491])
- `/react` entry point with `useCompletion`, `useChat`, `useObject`, and `useModels` hooks wrapping the `/core` controllers ([9625491])
- `isProviderSDKAvailable(providerId)` to check whether a provider's peer SDK is installed without importing it ([1f2fc44])

### Changed

- Provider peer SDKs (`openai`, `@anthropic-ai/sdk`, `@google/genai`) are now lazily `import()`ed inside each provider's methods instead of at module load, so importing an unused provider no longer requires its SDK to be installed ([1f2fc44])

### Fixed

- Ollama: streaming tool-call ids now use Ollama's own id/function.index instead of local array position, which collided when calls were split one-per-chunk in streams ([1bd227f])
- Ollama: `think` now defaults to `false` unless a positive `thinkingBudget` is set, preventing unbounded thinking from starving content on hybrid-reasoning models ([1bd227f])
- Ollama: `num_ctx` now defaults to 8192 instead of Ollama's tiny built-in default, which was silently truncating generation ([1bd227f])
- Ollama: structured output now uses native grammar-constrained `format: schemaJson` instead of injecting the JSON Schema into the prompt ([1bd227f])
- Logger: `Error` objects now preserve their message/stack across JSON serialization instead of flattening to `"[object Error]"` or `"{}"` ([038c3a1])
- Groq: error logging downgraded from error to warn, with a fallback model list when the models endpoint is unavailable ([4d2df86])

### Internal

- Cold-import benchmark comparing provider-loading cost with lazy SDK imports ([07a9614])
- Documentation for the `/core`/`/react` entry points and lazy SDK loading ([70fde58])

[9625491]: https://github.com/Pranavraut033/llm-core/commit/9625491
[1f2fc44]: https://github.com/Pranavraut033/llm-core/commit/1f2fc44
[1bd227f]: https://github.com/Pranavraut033/llm-core/commit/1bd227f
[038c3a1]: https://github.com/Pranavraut033/llm-core/commit/038c3a1
[4d2df86]: https://github.com/Pranavraut033/llm-core/commit/4d2df86
[07a9614]: https://github.com/Pranavraut033/llm-core/commit/07a9614
[70fde58]: https://github.com/Pranavraut033/llm-core/commit/70fde58

## [0.1.0] - 2026-07-12

### Added

- Multi-provider LLM abstraction with a provider registry/factory and a typed, module-augmentable `ProviderId` ([6c02c04])
- Generic prompt-template registry with Handlebars resolution and Zod validation
- Injectable token-usage tracker
- `embed()` support with OpenAI, Gemini, and Ollama implementations ([cf5728a])
- Unified `LLMError` hierarchy, per-model capability catalog, token pricing table, and streaming resilience helpers, wired through every provider and the token tracker ([2d36209])
- DeepSeek, Groq, Mistral, and OpenRouter providers via a generic OpenAI-compatible provider base ([65bbe99])

### Fixed

- Template validation now uses `Handlebars.parse()` instead of a custom check ([616ebc4])
- Corrected package library name ([3a52a00])

### Internal

- Typed `ProviderId` refactor and matching test updates ([6c02c04], [2887ce3])
- Comprehensive test coverage for providers, logger, and prompts ([ef00b68])
- Documentation updates for typed `ProviderId` and custom provider registration ([75ce62f])

[6c02c04]: https://github.com/Pranavraut033/llm-core/commit/6c02c04
[cf5728a]: https://github.com/Pranavraut033/llm-core/commit/cf5728a
[2d36209]: https://github.com/Pranavraut033/llm-core/commit/2d36209
[65bbe99]: https://github.com/Pranavraut033/llm-core/commit/65bbe99
[616ebc4]: https://github.com/Pranavraut033/llm-core/commit/616ebc4
[3a52a00]: https://github.com/Pranavraut033/llm-core/commit/3a52a00
[2887ce3]: https://github.com/Pranavraut033/llm-core/commit/2887ce3
[ef00b68]: https://github.com/Pranavraut033/llm-core/commit/ef00b68
[75ce62f]: https://github.com/Pranavraut033/llm-core/commit/75ce62f
