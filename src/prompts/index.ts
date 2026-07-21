/**
 * Prompt Template System Entry Point
 *
 * Generic Handlebars-based prompt template registry. Hosts define their
 * own context type (`TContext`) and purpose vocabulary (`TPurpose`),
 * register `PromptTemplate`s (typically as a side effect of importing
 * their template modules), and resolve/validate them via the helpers
 * exported here.
 *
 * Unlike the resume-builder app's internal prompt system, this package
 * does NOT ship any concrete templates, a `PromptContext` type, or a
 * `PromptPurpose` union — those are domain-specific and belong in the
 * host application.
 */

export * from "./types";
export * from "./resolver";
export * from "./registry";
export * from "./validation";

export { templateRegistry, TemplateRegistry } from "./registry";

import { templateRegistry } from "./registry";
import { resolveTemplate } from "./resolver";
import { PromptTemplate, ResolvedPrompt } from "./types";

/**
 * Look up a registered template by purpose and resolve it against the
 * given context. Throws if no template is registered for `purpose`.
 */
export function getPromptByPurpose<
  TContext = unknown,
  TPurpose extends string = string,
>(
  purpose: TPurpose,
  context: Record<string, unknown>,
  options?: Parameters<typeof resolveTemplate>[2]
): ResolvedPrompt<TPurpose> {
  const template = templateRegistry.get(purpose) as
    PromptTemplate<TContext, TPurpose> | undefined;

  const resolved =
    template ??
    (templateRegistry.getByPurpose(purpose) as
      PromptTemplate<TContext, TPurpose> | undefined);

  if (!resolved) {
    throw new Error(`No template found for purpose: ${purpose}`);
  }

  return resolveTemplate(resolved, context, options);
}

/**
 * Format a resolved prompt for display/debugging.
 */
export function formatPromptForDisplay(prompt: ResolvedPrompt): string {
  return `System Prompt:\n${prompt.systemPrompt}\n\nUser Prompt:\n${prompt.userPrompt}`;
}
