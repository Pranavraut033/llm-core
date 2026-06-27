/**
 * Module-augmentable registry of known provider ids.
 *
 * The package seeds this with its 6 built-in providers. A consumer
 * registering a custom provider should augment this interface so
 * `ProviderId` includes their id at compile time — `register()`,
 * `getProviderInstance()`, `has()`, etc. will then accept (and
 * autocomplete) it like any built-in:
 *
 * ```ts
 * declare module "@resume-builder/llm-core" {
 *   interface ProviderIdRegistry {
 *     "my-company-llm": true;
 *   }
 * }
 * ```
 *
 * This is plain TypeScript declaration merging — it has no runtime effect.
 * You still call `LLMProvider.register("my-company-llm", ...)` to actually
 * register the provider; the augmentation only makes that id (and no
 * other arbitrary string) acceptable wherever `ProviderId` is expected.
 */
export interface ProviderIdRegistry {
  openai: true;
  gemini: true;
  grok: true;
  perplexity: true;
  ollama: true;
  anthropic: true;
}

/**
 * Provider identifier — a union of every key declared in
 * `ProviderIdRegistry` (the 6 built-ins, plus whatever consumers have
 * augmented in). Not a plain `string`: passing an arbitrary, undeclared
 * string where a `ProviderId` is expected is a type error by design.
 */
export type ProviderId = keyof ProviderIdRegistry;

/**
 * Identifiers for the providers implemented in `./providers`.
 * Use these constants instead of hard-coded strings for type safety
 * and to avoid typos.
 */
export const BUILTIN_PROVIDERS = {
  OPENAI: "openai",
  GEMINI: "gemini",
  GROK: "grok",
  PERPLEXITY: "perplexity",
  OLLAMA: "ollama",
  ANTHROPIC: "anthropic",
} as const satisfies Record<string, ProviderId>;

/**
 * The 6 built-in provider ids specifically — unlike `ProviderId`, this
 * union is fixed and unaffected by consumer augmentation.
 */
export type BuiltinProviderId =
  (typeof BUILTIN_PROVIDERS)[keyof typeof BUILTIN_PROVIDERS];
