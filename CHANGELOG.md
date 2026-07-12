# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

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
