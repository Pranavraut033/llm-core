/**
 * Opt-in registration entry point for the 10 built-in providers.
 *
 * Importing this module (for its side effects) registers OpenAI, Gemini,
 * Grok, Groq, Perplexity, Ollama, Anthropic, DeepSeek, Mistral, and
 * OpenRouter with the shared `ProviderRegistry`. Without importing this
 * (or registering providers yourself via `LLMProvider.register`),
 * `getProviderInstance` will throw a "not registered" error.
 *
 * Usage:
 * ```ts
 * import "@pranavraut033/llm-core/providers/register-builtins";
 * import { getProviderInstance } from "@pranavraut033/llm-core/providers";
 * ```
 *
 * Importing this module never requires any of the optional peer-dependency
 * SDKs (`openai`, `@anthropic-ai/sdk`, `@google/genai`) to be installed —
 * only registration/metadata code runs at import time. Each SDK is resolved
 * lazily, per provider, the first time a method is actually called on an
 * instance of that provider (e.g. `runLLM`, `fetchModels`); if the required
 * SDK isn't installed at that point, the call throws
 * `ProviderSDKNotInstalledError` with a clear message instead of a raw
 * "Cannot find package" error. Use `isProviderSDKAvailable(providerId)` to
 * check ahead of time whether a given provider's SDK is installed.
 */

import "./anthropic";
import "./deepseek";
import "./gemini";
import "./grok";
import "./groq";
import "./mistral";
import "./ollama";
import "./openai";
import "./openrouter";
import "./perplexity";
