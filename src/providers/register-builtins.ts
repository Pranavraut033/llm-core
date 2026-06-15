/**
 * Opt-in registration entry point for the 6 built-in providers.
 *
 * Importing this module (for its side effects) registers OpenAI, Gemini,
 * Grok, Perplexity, Ollama, and Anthropic with the shared
 * `ProviderRegistry`. Without importing this (or registering providers
 * yourself via `LLMProvider.register`), `getProviderInstance` will throw
 * a "not registered" error.
 *
 * Usage:
 * ```ts
 * import "@resume-builder/llm-core/providers/register-builtins";
 * import { getProviderInstance } from "@resume-builder/llm-core/providers";
 * ```
 *
 * Each provider module pulls in its corresponding SDK (`openai`,
 * `@anthropic-ai/sdk`, `@google/genai`) — those are optional peer
 * dependencies, so only install the SDKs for the providers you actually
 * use, or register a custom subset manually instead of importing this
 * barrel.
 */

import "./anthropic";
import "./gemini";
import "./grok";
import "./ollama";
import "./openai";
import "./perplexity";
