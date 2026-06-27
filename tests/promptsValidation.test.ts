import { describe, expect, it } from "vitest";
import { z } from "zod";

import { resolveTemplate } from "../src/prompts/resolver";
import { PromptTemplate } from "../src/prompts/types";
import {
  getValidationSummary,
  validateOrThrow,
  ValidationResult,
} from "../src/prompts/validation";

interface Ctx {
  topic: string;
}

const template: PromptTemplate<Ctx, "generate"> = {
  id: "t",
  purpose: "generate",
  requiredContext: ["topic"],
  outputSchema: z.object({ title: z.string() }),
  systemPrompt: "sys",
  userPrompt: "Write about {{topic}}",
};

describe("validateOrThrow", () => {
  it("returns the parsed data when the response is valid", async () => {
    const resolved = resolveTemplate(template, { topic: "cats" });
    const data = await validateOrThrow<{ title: string }>(
      { title: "Cats are great" },
      resolved
    );

    expect(data).toEqual({ title: "Cats are great" });
  });

  it("throws a formatted error message when the response is invalid", async () => {
    const resolved = resolveTemplate(template, { topic: "cats" });

    await expect(
      validateOrThrow({ title: 123 }, resolved, "cat blog post")
    ).rejects.toThrow(/Template validation failed for cat blog post/);
  });
});

describe("getValidationSummary", () => {
  it("formats a valid result, including warnings", () => {
    const result: ValidationResult = {
      valid: true,
      errors: [],
      warnings: ["No schema defined for template - validation skipped"],
    };

    expect(getValidationSummary(result)).toBe(
      "Valid\nWarnings: No schema defined for template - validation skipped"
    );
  });

  it("formats a valid result with no warnings", () => {
    const result: ValidationResult = { valid: true, errors: [], warnings: [] };
    expect(getValidationSummary(result)).toBe("Valid");
  });

  it("formats an invalid result with up to 3 errors", () => {
    const result: ValidationResult = {
      valid: false,
      errors: [{ path: "title", message: "Required", code: "invalid_type" }],
      warnings: [],
    };

    expect(getValidationSummary(result)).toBe("Invalid:\ntitle: Required");
  });

  it("truncates and counts extra errors beyond the first 3", () => {
    const result: ValidationResult = {
      valid: false,
      errors: [
        { path: "a", message: "bad a", code: "x" },
        { path: "b", message: "bad b", code: "x" },
        { path: "c", message: "bad c", code: "x" },
        { path: "d", message: "bad d", code: "x" },
        { path: "e", message: "bad e", code: "x" },
      ],
      warnings: [],
    };

    const summary = getValidationSummary(result);
    expect(summary).toContain("a: bad a");
    expect(summary).toContain("c: bad c");
    expect(summary).not.toContain("d: bad d");
    expect(summary).toContain("... and 2 more errors");
  });
});
