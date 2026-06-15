/**
 * Template Registry
 *
 * Generic, purpose-keyed registry for `PromptTemplate`s. Hosts register
 * their own templates (typically as a side effect of importing template
 * modules) and look them up by `id` or `purpose`.
 */

import { PromptTemplate } from "./types";

class TemplateRegistry<TContext = unknown, TPurpose extends string = string> {
  private static instance: TemplateRegistry<unknown, string>;
  private templates: Map<string, PromptTemplate<TContext, TPurpose>> =
    new Map();

  private constructor() {}

  static getInstance<
    TContext = unknown,
    TPurpose extends string = string,
  >(): TemplateRegistry<TContext, TPurpose> {
    if (!TemplateRegistry.instance) {
      TemplateRegistry.instance = new TemplateRegistry();
    }
    return TemplateRegistry.instance as unknown as TemplateRegistry<
      TContext,
      TPurpose
    >;
  }

  /**
   * Register a prompt template. Re-registering the same `id` overwrites
   * the previous template and logs a warning.
   */
  register(template: PromptTemplate<TContext, TPurpose>): void {
    if (this.templates.has(template.id)) {
      console.warn(`[Template Registry] Overwriting template: ${template.id}`);
    }
    this.templates.set(template.id, template);
  }

  /**
   * Get template by ID.
   */
  get(id: string): PromptTemplate<TContext, TPurpose> | undefined {
    return this.templates.get(id);
  }

  /**
   * Get the first registered template matching a given purpose.
   */
  getByPurpose(
    purpose: TPurpose
  ): PromptTemplate<TContext, TPurpose> | undefined {
    for (const template of this.templates.values()) {
      if (template.purpose === purpose) {
        return template;
      }
    }
    return undefined;
  }

  /**
   * List all registered templates.
   */
  listAll(): PromptTemplate<TContext, TPurpose>[] {
    return Array.from(this.templates.values());
  }

  /**
   * Clear all templates (useful for testing).
   */
  clear(): void {
    this.templates.clear();
  }

  /**
   * Get registry statistics: total template count and, for each
   * `purpose` actually covered by a registered template, whether it has
   * one. Since purposes are open-ended strings, coverage is derived from
   * the registered templates themselves (not a fixed enum).
   */
  getStats(): {
    templateCount: number;
    purposeCoverage: Record<string, boolean>;
  } {
    const purposeCoverage: Record<string, boolean> = {};

    for (const template of this.templates.values()) {
      purposeCoverage[template.purpose] = true;
    }

    return {
      templateCount: this.templates.size,
      purposeCoverage,
    };
  }
}

export const templateRegistry = TemplateRegistry.getInstance();
export { TemplateRegistry };
