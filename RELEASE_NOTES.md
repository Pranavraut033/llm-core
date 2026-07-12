# Release Notes

## v0.1.0 — 2026-07-12

First release of `@resume-builder/llm-core`: a standalone toolkit for talking to LLM providers from any host app.

**What's in it:**

- **Ten providers, one interface** — OpenAI, Anthropic, Gemini, Ollama, and now DeepSeek, Groq, Mistral, and OpenRouter all work through the same provider API, so switching models is a config change, not a rewrite.
- **Embeddings support** — generate embeddings with OpenAI, Gemini, or Ollama through the same client.
- **More resilient by default** — clearer error messages when a provider call fails, a built-in model/pricing catalog, and better handling of interrupted streaming responses.
- **Safer custom prompt templates** — template validation now catches malformed templates before they reach a live call.

This is an initial extraction from the resume-builder app, so expect the API surface to stabilize over the next few releases.
