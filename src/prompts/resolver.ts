/**
 * Prompt Template Resolver
 * Handles context shaping, path extraction, and Handlebars template execution.
 */

import Handlebars from "handlebars";

import {
  ContextPath,
  PromptTemplate,
  ResolvedPrompt,
  ShapedContext,
} from "./types";

// Register Handlebars helpers
Handlebars.registerHelper("json", function (context) {
  return JSON.stringify(context, null, 2);
});

/**
 * Extract value from nested object using dot notation path.
 * Example: getByPath(obj, "resume.experience[0].role")
 */
function getByPath(obj: unknown, path: string): unknown {
  // Handle array indices: "resume.experience[0].role"
  const parts = path.split(/\.|\[|\]/).filter(Boolean);

  let current = obj;
  for (const part of parts) {
    if (current === null || current === undefined) return undefined;

    // Handle numeric indices for arrays
    const index = parseInt(part, 10);
    if (!isNaN(index) && Array.isArray(current)) {
      current = current[index];
    } else {
      current = (current as Record<string, unknown>)[part];
    }
  }

  return current;
}

/**
 * Set value in nested object using dot notation path.
 * Creates intermediate objects as needed.
 */
function setByPath(obj: unknown, path: string, value: unknown): void {
  const parts = path.split(/\.|\[|\]/).filter(Boolean);
  let current = obj as Record<string, unknown>;

  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    const nextPart = parts[i + 1];
    const nextIsIndex = !isNaN(parseInt(nextPart, 10));

    if (!current[part]) {
      current[part] = nextIsIndex ? [] : {};
    }

    current = current[part] as Record<string, unknown>;
  }

  const lastPart = parts[parts.length - 1];
  current[lastPart] = value;
}

/**
 * Shape context by extracting only the required paths.
 * This is the token-optimization core: callers can pass a full context
 * object and a list of `requiredContext` paths to get back a minimal
 * object containing only those paths.
 */
export function shapeContext<TContext = unknown>(
  fullContext: Record<string, unknown>,
  requiredPaths: ContextPath<TContext>[]
): ShapedContext<TContext> {
  const shaped: Record<string, unknown> = {};
  const found: ContextPath<TContext>[] = [];
  const missing: ContextPath<TContext>[] = [];

  for (const path of requiredPaths) {
    const value = getByPath(fullContext, path as string);

    if (value !== undefined) {
      setByPath(shaped, path as string, value);
      found.push(path);
    } else {
      missing.push(path);
    }
  }

  return {
    data: shaped,
    paths: found,
    unused: missing,
  };
}

/**
 * Estimate token count (chars ÷ 4 heuristic).
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Resolve template with context.
 * For field templates (with `fieldType`), wraps `userPrompt` with `intent`
 * and `guidelines`.
 */
export function resolveTemplate<
  TContext = unknown,
  TPurpose extends string = string,
>(
  template: PromptTemplate<TContext, TPurpose>,
  fullContext: Record<string, unknown>,
  options?: {
    warnUnused?: boolean; // Warn about unused context paths
    warnLarge?: boolean; // Warn about large prompts
    maxTokens?: number; // Token warning threshold
  }
): ResolvedPrompt<TPurpose> {
  const opts = {
    warnUnused: false,
    warnLarge: false,
    maxTokens: 1000,
    ...options,
  };

  // Compile and execute Handlebars templates
  const systemTemplate = Handlebars.compile(template.systemPrompt);
  const userTemplate = Handlebars.compile(template.userPrompt);

  const systemPrompt = systemTemplate(fullContext);
  let userPrompt = userTemplate(fullContext);

  // For field templates, wrap userPrompt with intent and guidelines
  if (template.fieldType && template.intent && template.guidelines) {
    userPrompt = `**Intent:** ${template.intent}

**Guidelines:**
${template.guidelines.map((g) => `- ${g}`).join("\n")}

**Your content:**
${userPrompt}`;
  }

  const combined = systemPrompt + "\n\n" + userPrompt;
  const tokens = estimateTokens(combined);

  // Warn about large prompts
  if (opts.warnLarge && tokens > opts.maxTokens) {
    console.warn(
      `[Prompt Template] Large prompt detected for "${template.id}": ${tokens} tokens (threshold: ${opts.maxTokens})`
    );
  }

  return {
    systemPrompt,
    userPrompt,
    purpose: template.purpose,
    estimatedTokens: tokens,
    outputSchema: template.outputSchema,
  };
}

/**
 * Validate template without executing.
 * Checks whether all Handlebars variables are covered by `requiredContext`.
 */
export function validateTemplate<
  TContext = unknown,
  TPurpose extends string = string,
>(
  template: PromptTemplate<TContext, TPurpose>
): {
  valid: boolean;
  errors: string[];
  warnings: string[];
} {
  const errors: string[] = [];
  const warnings: string[] = [];

  try {
    // Try to compile templates
    Handlebars.compile(template.systemPrompt);
    Handlebars.compile(template.userPrompt);
  } catch (error) {
    errors.push(`Template compilation failed: ${error}`);
    return { valid: false, errors, warnings };
  }

  // Extract Handlebars variables (simple regex, not perfect)
  const varRegex = /\{\{([^}]+)\}\}/g;
  const systemVars = [...template.systemPrompt.matchAll(varRegex)].map((m) =>
    m[1].trim()
  );
  const userVars = [...template.userPrompt.matchAll(varRegex)].map((m) =>
    m[1].trim()
  );
  const allVars = new Set([...systemVars, ...userVars]);

  // Check if requiredContext covers all variables
  for (const varPath of allVars) {
    // Skip Handlebars helpers (if, each, etc.)
    if (
      varPath.startsWith("#") ||
      varPath.startsWith("/") ||
      varPath.startsWith("@")
    ) {
      continue;
    }

    // Check if this variable path is covered by requiredContext
    const isCovered = template.requiredContext.some(
      (path) =>
        varPath.startsWith(path as string) ||
        (path as string).startsWith(varPath)
    );

    if (!isCovered) {
      warnings.push(`Variable "${varPath}" not covered by requiredContext`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}
