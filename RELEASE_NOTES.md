# Release Notes

## v0.3.0 — 2026-07-21

Streaming state management and a lighter, faster-loading core.

**What's new:**

- **Streaming controllers and React hooks** — new `/core` and `/react` entry points (`createCompletion`, `createChat`, `createObject`, plus `useCompletion`, `useChat`, `useObject`, `useModels`) handle streaming state for you, so you don't have to hand-roll loading/error/partial-output logic for chat and completion UIs.
- **Faster cold starts** — provider SDKs (OpenAI, Anthropic, Gemini) now load lazily, only when a provider is actually used. Importing the package, or a provider you're not using, no longer requires that provider's SDK to be installed. Check ahead of time with `isProviderSDKAvailable(providerId)`.
- **More reliable Ollama** — fixes to streaming tool calls, thinking budgets, context window sizing, and structured output.

No breaking changes — existing code keeps working as-is.

## v0.1.0 — 2026-07-12

First release of `@resume-builder/llm-core`: a standalone toolkit for talking to LLM providers from any host app.

**What's in it:**

- **Ten providers, one interface** — OpenAI, Anthropic, Gemini, Ollama, and now DeepSeek, Groq, Mistral, and OpenRouter all work through the same provider API, so switching models is a config change, not a rewrite.
- **Embeddings support** — generate embeddings with OpenAI, Gemini, or Ollama through the same client.
- **More resilient by default** — clearer error messages when a provider call fails, a built-in model/pricing catalog, and better handling of interrupted streaming responses.
- **Safer custom prompt templates** — template validation now catches malformed templates before they reach a live call.

This is an initial extraction from the resume-builder app, so expect the API surface to stabilize over the next few releases.
