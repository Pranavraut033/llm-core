/**
 * Provider identifier.
 *
 * This is an *open* string type (not a closed enum) so consumers can
 * register custom providers (e.g. "my-company-llm") without needing to
 * fork or extend an enum defined by this package.
 *
 * The six built-in providers shipped by this package are listed in
 * `BUILTIN_PROVIDERS` below for convenience and type-safe references.
 */
export type ProviderId = string;

/**
 * Identifiers for the providers implemented in `./providers`.
 * Use these constants instead of hard-coded strings for type safety
 * and to avoid typos, but any string is a valid `ProviderId`.
 */
export const BUILTIN_PROVIDERS = {
  OPENAI: "openai",
  GEMINI: "gemini",
  GROK: "grok",
  PERPLEXITY: "perplexity",
  OLLAMA: "ollama",
  ANTHROPIC: "anthropic",
} as const satisfies Record<string, ProviderId>;

export type BuiltinProviderId =
  (typeof BUILTIN_PROVIDERS)[keyof typeof BUILTIN_PROVIDERS];
