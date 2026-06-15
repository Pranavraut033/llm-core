import { describe, expect, it } from "vitest";
import { z } from "zod";

import { LLMCoreConfig } from "../src/config";
import { DUMMY_RESULT_TEXT, DummyProvider } from "./helpers/dummyProvider";
import { resolveTemplate } from "../src/prompts/resolver";
import { PromptTemplate } from "../src/prompts/types";
import { getProviderInstance } from "../src/providers/factory";
import { LLMProvider } from "../src/providers/LLMProvider";
import { getRegistry } from "../src/providers/registry";

const CUSTOM_PROVIDER_ID = "integration-dummy";

interface GreetingContext {
  name: string;
}

const greetingTemplate: PromptTemplate<GreetingContext, "greet"> = {
  id: "greeting",
  purpose: "greet",
  requiredContext: ["name"],
  outputSchema: z.object({
    greeting: z.string().default("hello"),
  }),
  systemPrompt: "You are a friendly greeter.",
  userPrompt: "Say hello to {{name}}.",
};

describe("end-to-end: register -> getProviderInstance -> runLLM/runStructuredLLM", () => {
  it("registers a custom provider and runs a plain LLM call", async () => {
    LLMProvider.register(
      CUSTOM_PROVIDER_ID,
      { name: "Integration Dummy", requiresAuth: false },
      (apiKey?: string) => new DummyProvider(CUSTOM_PROVIDER_ID, apiKey)
    );

    const config: LLMCoreConfig = {
      keyResolver: () => undefined,
    };

    const provider = await getProviderInstance(CUSTOM_PROVIDER_ID, config);
    expect(getRegistry().getAvailableTypes()).toContain(CUSTOM_PROVIDER_ID);

    const result = await provider.runLLM(
      [{ role: "user", content: "Hello there" }],
      { model: "dummy-model" }
    );

    expect(result.result).toBe(DUMMY_RESULT_TEXT);
    expect(result.usage.provider).toBe(CUSTOM_PROVIDER_ID);
    expect(result.usage.model).toBe("dummy-model");
    expect(result.usage.promptTokens).toBeGreaterThan(0);
  });

  it("runs runStructuredLLM against a Zod schema and returns { result, usage }", async () => {
    const config: LLMCoreConfig = {
      keyResolver: () => undefined,
    };

    const provider = await getProviderInstance(CUSTOM_PROVIDER_ID, config);

    const resolved = resolveTemplate(greetingTemplate, { name: "World" });
    const schema = greetingTemplate.outputSchema as z.ZodObject<{
      greeting: z.ZodDefault<z.ZodString>;
    }>;

    const { result, usage } = await provider.runStructuredLLM(
      resolved,
      { model: "dummy-model" },
      schema,
      "Greeting"
    );

    expect(result).toEqual({ greeting: "hello" });
    expect(usage.provider).toBe(CUSTOM_PROVIDER_ID);
    expect(usage.purpose).toBe("greet");
  });
});
