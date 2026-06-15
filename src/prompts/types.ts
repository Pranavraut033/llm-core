import type { ZodSchema } from "zod";

/**
 * Dot/bracket path utility that produces autocompleteable paths through
 * nested objects and arrays.
 * - Objects use dot notation: foo.bar.baz
 * - Arrays use bracket index with number placeholder:
 *   items[0].name -> represented as items[${number}].name
 */
type DotPathForKey<K extends string, V> =
  // Arrays: allow K, K[${number}], and nested K[${number}].child
  V extends readonly (infer U)[]
    ? `${K}` | `${K}[${number}]` | `${K}[${number}].${DotPath<U>}`
    : V extends (infer U)[]
      ? `${K}` | `${K}[${number}]` | `${K}[${number}].${DotPath<U>}`
      : // Objects: allow K and K.child
        V extends object
        ? `${K}` | `${K}.${DotPath<V>}`
        : // Primitives: just K
          `${K}`;

/**
 * Generate dot/bracket paths for a given type T.
 * Example outputs include: "resume", "resume.summary", "resume.skills[${number}].name"
 */
export type DotPath<T> = {
  [K in Extract<keyof NonNullable<T>, string>]: DotPathForKey<
    K,
    NonNullable<T>[K]
  >;
}[Extract<keyof NonNullable<T>, string>];

/**
 * Context path in dot/bracket notation derived from a host-supplied
 * context type `TContext`.
 * Examples: "resume.summary", "jobData.requirements.education",
 * "resume.skills[${number}].name", "jobDescription"
 */
export type ContextPath<TContext = unknown> = DotPath<TContext>;

/**
 * Template definition with Handlebars syntax and an optional Zod schema
 * for structured output.
 *
 * `TContext` is the shape of the context object templates are resolved
 * against (host-defined). `TPurpose` is the host's purpose vocabulary —
 * any string works, but a union gives autocomplete/type-safety.
 */
export interface PromptTemplate<
  TContext = unknown,
  TPurpose extends string = string,
> {
  id: string; // Unique identifier
  description?: string;
  fieldType?: string; // Host-defined field-type label (used for field templates)
  guidelines?: string[]; // Field-specific guidelines
  intent?: string; // Field-specific intent
  outputSchema?: ZodSchema; // Optional Zod schema for structured JSON output validation
  purpose: TPurpose;
  requiredContext: ContextPath<TContext>[]; // Dot-notation paths
  systemPrompt: string; // Handlebars template for system prompt
  userPrompt: string; // Handlebars template for user prompt
}

/**
 * Resolved prompt ready for execution.
 */
export interface ResolvedPrompt<TPurpose extends string = string> {
  estimatedTokens: number;
  outputSchema?: ZodSchema; // Optional schema from template
  purpose: TPurpose;
  systemPrompt: string; // Fully resolved
  userPrompt: string; // Fully resolved
  /**
   * Optional pre-built message list. If present, `LLMProvider.toPromptMessages`
   * prefers this over `systemPrompt`/`userPrompt`.
   */
  messages?: { role: "system" | "user" | "assistant"; content: string }[];
}

/**
 * Context shaping result.
 */
export interface ShapedContext<TContext = unknown> {
  data: Record<string, unknown>; // Minimal shaped context
  paths: ContextPath<TContext>[]; // Paths that were extracted
  unused: ContextPath<TContext>[]; // Paths that were NOT found in input
}
