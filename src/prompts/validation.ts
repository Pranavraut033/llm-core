/**
 * Template Schema Validation
 * Validates LLM responses against a resolved template's output schema.
 */

import { ResolvedPrompt } from "./types";

/**
 * Validation result with detailed error information.
 */
export interface ValidationResult<T = unknown> {
  valid: boolean;
  data?: T;
  errors: ValidationError[];
  warnings: string[];
}

/**
 * Detailed validation error.
 */
export interface ValidationError {
  path: string;
  message: string;
  code: string;
}

/**
 * Validate an LLM response against a resolved prompt's output schema.
 * Returns parsed data if valid, or detailed errors if invalid.
 */
export async function validateTemplateResponse<T = unknown>(
  response: unknown,
  resolvedPrompt: ResolvedPrompt
): Promise<ValidationResult<T>> {
  const errors: ValidationError[] = [];
  const warnings: string[] = [];

  // No schema defined - pass through
  if (!resolvedPrompt.outputSchema) {
    return {
      valid: true,
      data: response as T,
      errors,
      warnings: ["No schema defined for template - validation skipped"],
    };
  }

  try {
    // Parse and validate using Zod schema
    const parsed = await resolvedPrompt.outputSchema.parseAsync(response);

    return {
      valid: true,
      data: parsed as T,
      errors,
      warnings,
    };
  } catch (error: unknown) {
    // Handle Zod validation errors
    const zodError = error as Record<string, unknown> | undefined;
    if (zodError?.name === "ZodError" && Array.isArray(zodError.errors)) {
      const zodErrors = zodError.errors as Array<Record<string, unknown>>;
      zodErrors.forEach((err) => {
        errors.push({
          path:
            (Array.isArray(err.path) ? err.path.join(".") : "root") || "root",
          message: (err.message as string) || "Unknown error",
          code: (err.code as string) || "unknown",
        });
      });
    } else if (error instanceof Error) {
      errors.push({
        path: "root",
        message: error.message,
        code: "parse_error",
      });
    } else {
      errors.push({
        path: "root",
        message: "Unknown error during validation",
        code: "unknown_error",
      });
    }

    return {
      valid: false,
      errors,
      warnings,
    };
  }
}

/**
 * Safe validation wrapper with fallback.
 * Returns data if valid, throws with a detailed message if invalid.
 */
export async function validateOrThrow<T = unknown>(
  response: unknown,
  resolvedPrompt: ResolvedPrompt,
  context?: string
): Promise<T> {
  const result = await validateTemplateResponse<T>(response, resolvedPrompt);

  if (!result.valid) {
    const errorMessages = result.errors.map(
      (err) => `  ${err.path}: ${err.message} (${err.code})`
    );

    const contextStr = context ? ` for ${context}` : "";
    throw new Error(
      `Template validation failed${contextStr}:\n${errorMessages.join("\n")}`
    );
  }

  return result.data as T;
}

/**
 * Get a human-readable validation summary.
 */
export function getValidationSummary(result: ValidationResult): string {
  if (result.valid) {
    const warningMsg = result.warnings.length
      ? `\nWarnings: ${result.warnings.join(", ")}`
      : "";
    return `Valid${warningMsg}`;
  }

  const errorSummary = result.errors
    .slice(0, 3)
    .map((e) => `${e.path}: ${e.message}`)
    .join("\n");

  const moreErrors =
    result.errors.length > 3
      ? `\n... and ${result.errors.length - 3} more errors`
      : "";

  return `Invalid:\n${errorSummary}${moreErrors}`;
}
