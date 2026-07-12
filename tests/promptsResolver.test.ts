import { describe, expect, it, vi } from "vitest";

import {
  estimateTokens,
  resolveTemplate,
  shapeContext,
  validateTemplate,
} from "../src/prompts/resolver";
import { PromptTemplate } from "../src/prompts/types";

describe("shapeContext", () => {
  it("extracts only the requested paths and reports found/missing", () => {
    const full = {
      resume: {
        name: "Ada",
        experience: [{ role: "Engineer" }, { role: "Manager" }],
      },
    };

    const shaped = shapeContext(full, [
      "resume.name",
      "resume.experience[0].role",
      "resume.missingField",
    ] as never[]);

    expect(shaped.data).toEqual({
      resume: { name: "Ada", experience: [{ role: "Engineer" }] },
    });
    expect(shaped.paths).toEqual(["resume.name", "resume.experience[0].role"]);
    expect(shaped.unused).toEqual(["resume.missingField"]);
  });

  it("returns empty data when no paths are found", () => {
    const shaped = shapeContext({}, ["a.b.c"] as never[]);
    expect(shaped.data).toEqual({});
    expect(shaped.paths).toEqual([]);
    expect(shaped.unused).toEqual(["a.b.c"]);
  });
});

describe("estimateTokens", () => {
  it("approximates token count as ceil(length / 4)", () => {
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("abcde")).toBe(2);
  });
});

interface FieldContext {
  value: string;
}

const fieldTemplate: PromptTemplate<FieldContext, "edit_field"> = {
  id: "field.edit",
  purpose: "edit_field",
  requiredContext: ["value"],
  fieldType: "summary",
  intent: "Improve clarity",
  guidelines: ["Be concise", "Use active voice"],
  systemPrompt: "You edit resume fields.",
  userPrompt: "Current value: {{value}}",
};

describe("resolveTemplate", () => {
  it("wraps userPrompt with intent and guidelines for field templates", () => {
    const resolved = resolveTemplate(fieldTemplate, { value: "Did stuff" });

    expect(resolved.userPrompt).toContain("**Intent:** Improve clarity");
    expect(resolved.userPrompt).toContain("- Be concise");
    expect(resolved.userPrompt).toContain("- Use active voice");
    expect(resolved.userPrompt).toContain("**Your content:**");
    expect(resolved.userPrompt).toContain("Current value: Did stuff");
  });

  it("warns when the resolved prompt exceeds maxTokens and warnLarge is set", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const longTemplate: PromptTemplate<FieldContext, "edit_field"> = {
      id: "field.long",
      purpose: "edit_field",
      requiredContext: ["value"],
      systemPrompt: "sys",
      userPrompt: "x".repeat(100),
    };

    resolveTemplate(
      longTemplate,
      { value: "ignored" },
      {
        warnLarge: true,
        maxTokens: 5,
      }
    );

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Large prompt detected for "field.long"')
    );
    warnSpy.mockRestore();
  });

  it("does not warn when warnLarge is false (default)", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    resolveTemplate(fieldTemplate, { value: "x".repeat(1000) });

    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("does not HTML-escape interpolated context (noEscape)", () => {
    const plainTemplate: PromptTemplate<FieldContext, "edit_field"> = {
      id: "field.plain",
      purpose: "edit_field",
      requiredContext: ["value"],
      systemPrompt: "sys",
      userPrompt: "Company: {{value}}",
    };

    const resolved = resolveTemplate(plainTemplate, {
      value: `AT&T <Corp> "quoted" 'it's'`,
    });

    expect(resolved.userPrompt).toBe(`Company: AT&T <Corp> "quoted" 'it's'`);
    expect(resolved.userPrompt).not.toContain("&amp;");
    expect(resolved.userPrompt).not.toContain("&lt;");
  });
});

describe("validateTemplate", () => {
  it("passes templates that compile cleanly, with no errors", () => {
    const result = validateTemplate<FieldContext, "edit_field">(fieldTemplate);

    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("returns a compile error when the template has malformed Handlebars syntax", () => {
    const result = validateTemplate<FieldContext, "edit_field">({
      ...fieldTemplate,
      userPrompt: "{{value",
    });

    expect(result.valid).toBe(false);
    expect(result.errors[0]).toMatch(/Template compilation failed/);
  });

  it("skips Handlebars helper/path/data-variable tokens when checking coverage", () => {
    const result = validateTemplate<FieldContext, "edit_field">({
      ...fieldTemplate,
      userPrompt:
        "{{#each items}}{{@index}}: {{this}}{{/each}} value is {{value}}",
      requiredContext: ["value"],
    });

    expect(result.warnings.some((w) => w.includes("#each items"))).toBe(false);
    expect(result.warnings.some((w) => w.includes("@index"))).toBe(false);
    expect(result.warnings.some((w) => w.includes("/each"))).toBe(false);
  });

  it("warns about variables not covered by requiredContext", () => {
    const result = validateTemplate<FieldContext, "edit_field">({
      ...fieldTemplate,
      userPrompt: "{{value}} and {{unknownVar}}",
    });

    expect(result.valid).toBe(true);
    expect(result.warnings.some((w) => w.includes("unknownVar"))).toBe(true);
  });
});
