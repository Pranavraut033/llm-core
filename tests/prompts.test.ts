import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  getPromptByPurpose,
  resolveTemplate,
  TemplateRegistry,
  templateRegistry,
  validateTemplate,
  validateTemplateResponse,
} from "../src/prompts";
import { PromptTemplate } from "../src/prompts/types";

interface BlogContext {
  topic: string;
  audience: string;
  tags: string[];
}

type BlogPurpose = "generate_outline" | "generate_title";

const outlineSchema = z.object({
  sections: z.array(z.string()),
});

const outlineTemplate: PromptTemplate<BlogContext, BlogPurpose> = {
  id: "blog.outline",
  purpose: "generate_outline",
  requiredContext: ["topic", "audience", "tags"],
  outputSchema: outlineSchema,
  systemPrompt: "You are a writing assistant for {{audience}}.",
  userPrompt:
    "Write an outline for a blog post about {{topic}}. Tags: {{#each tags}}{{this}} {{/each}}",
};

describe("resolveTemplate", () => {
  it("resolves Handlebars system/user prompts against a generic context", () => {
    const resolved = resolveTemplate<BlogContext, BlogPurpose>(
      outlineTemplate,
      {
        topic: "TypeScript generics",
        audience: "intermediate developers",
        tags: ["typescript", "generics"],
      }
    );

    expect(resolved.systemPrompt).toBe(
      "You are a writing assistant for intermediate developers."
    );
    expect(resolved.userPrompt).toBe(
      "Write an outline for a blog post about TypeScript generics. Tags: typescript generics "
    );
    expect(resolved.purpose).toBe("generate_outline");
    expect(resolved.outputSchema).toBe(outlineSchema);
    expect(resolved.estimatedTokens).toBeGreaterThan(0);
  });
});

describe("validateTemplate", () => {
  it("flags template variables not covered by requiredContext", () => {
    const result = validateTemplate<BlogContext, BlogPurpose>({
      ...outlineTemplate,
      systemPrompt: "Write for {{audience}} about {{unknownField}}.",
    });

    expect(result.valid).toBe(true);
    expect(result.warnings.some((w) => w.includes("unknownField"))).toBe(true);
  });
});

describe("TemplateRegistry", () => {
  it("registers and retrieves templates by id and purpose", () => {
    const registry = TemplateRegistry.getInstance<BlogContext, BlogPurpose>();
    registry.clear();
    registry.register(outlineTemplate);

    expect(registry.get("blog.outline")).toBe(outlineTemplate);
    expect(registry.getByPurpose("generate_outline")).toBe(outlineTemplate);
    expect(registry.listAll()).toHaveLength(1);

    const stats = registry.getStats();
    expect(stats.templateCount).toBe(1);
    expect(stats.purposeCoverage).toEqual({ generate_outline: true });
  });

  it("is a singleton shared with the exported templateRegistry instance", () => {
    expect(TemplateRegistry.getInstance()).toBe(templateRegistry);
  });
});

describe("getPromptByPurpose", () => {
  it("looks up a registered template by purpose and resolves it", () => {
    const registry = TemplateRegistry.getInstance<BlogContext, BlogPurpose>();
    registry.clear();
    registry.register(outlineTemplate);

    const resolved = getPromptByPurpose<BlogContext, BlogPurpose>(
      "generate_outline",
      {
        topic: "Vitest",
        audience: "QA engineers",
        tags: ["testing"],
      }
    );

    expect(resolved.systemPrompt).toBe(
      "You are a writing assistant for QA engineers."
    );
    expect(resolved.purpose).toBe("generate_outline");
  });

  it("throws when no template is registered for the purpose", () => {
    templateRegistry.clear();

    expect(() =>
      getPromptByPurpose("generate_title", {
        topic: "x",
        audience: "y",
        tags: [],
      })
    ).toThrow(/No template found for purpose/);
  });
});

describe("validateTemplateResponse", () => {
  it("validates a response against the resolved prompt's Zod outputSchema", async () => {
    const resolved = resolveTemplate<BlogContext, BlogPurpose>(
      outlineTemplate,
      {
        topic: "Zod",
        audience: "developers",
        tags: ["zod"],
      }
    );

    const valid = await validateTemplateResponse<{ sections: string[] }>(
      { sections: ["Intro", "Body", "Conclusion"] },
      resolved
    );
    expect(valid.valid).toBe(true);
    expect(valid.data?.sections).toEqual(["Intro", "Body", "Conclusion"]);

    const invalid = await validateTemplateResponse(
      { sections: "not-an-array" },
      resolved
    );
    expect(invalid.valid).toBe(false);
    expect(invalid.errors.length).toBeGreaterThan(0);
  });

  it("passes through responses for templates with no outputSchema", async () => {
    const resolved = resolveTemplate<BlogContext, BlogPurpose>(
      { ...outlineTemplate, outputSchema: undefined },
      { topic: "x", audience: "y", tags: [] }
    );

    const result = await validateTemplateResponse("raw text", resolved);
    expect(result.valid).toBe(true);
    expect(result.data).toBe("raw text");
    expect(result.warnings[0]).toMatch(/validation skipped/);
  });
});
