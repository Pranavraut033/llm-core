import z from "zod";

import { createConsoleLogger } from "../logger";
import { ResolvedPrompt } from "../prompts/types";
import { BUILTIN_PROVIDERS } from "../providerType";
import { LLMGenerationOptions, LLMResult, PromptMessage } from "../types";
import { LLMProvider, StructureResult } from "./LLMProvider";

const logger = createConsoleLogger("Ollama");

interface OllamaResponse {
  response: string;
}

interface OllamaModel {
  name: string;
}

export class OllamaProvider extends LLMProvider {
  private baseUrl: string;
  public readonly providerType = BUILTIN_PROVIDERS.OLLAMA;

  constructor(baseUrl: string = "http://localhost:11434") {
    super();
    this.baseUrl = baseUrl;
  }

  /**
   * Inject JSON schema into prompt for better structured output
   * Ollama's format:"json" only encourages JSON, doesn't validate structure
   */
  private injectSchemaIntoPrompt(prompt: string, schemaObject: object): string {
    return `${prompt}

You must return a valid JSON object that conforms to this JSON Schema:

${JSON.stringify(schemaObject, null, 2)}

Rules:
- Output ONLY a raw JSON object
- Do NOT wrap in markdown
- Do NOT explain anything
- Do NOT repeat the schema
- Every field must match the required type
- Include all required fields
- If a string field is unknown, return an empty string
- If an array field is unknown, return []
- If an object field is unknown, return {}

Begin your response with { and end with }`;
  }

  private async callOllama(
    prompt: string,
    model: string,
    jsonFormat: boolean = false
  ): Promise<string> {
    const response = await fetch(`${this.baseUrl}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        prompt,
        stream: false,
        format: jsonFormat ? "json" : undefined,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Ollama API error: ${error}`);
    }

    const data: OllamaResponse = await response.json();
    return data.response;
  }

  get streamSupported(): boolean {
    return false; // Ollama's streaming API is not stable, so we disable it for now
  }

  runLLM(
    messages: PromptMessage[],
    options: LLMGenerationOptions & { stream: true }
  ): AsyncGenerator<string>;

  runLLM(
    messages: PromptMessage[],
    options: LLMGenerationOptions & { stream?: false; onUsage?: never }
  ): Promise<LLMResult<string>>;

  runLLM(
    messages: PromptMessage[],
    options: LLMGenerationOptions
  ): Promise<LLMResult<string>> | AsyncGenerator<string> {
    // Ollama doesn't have separate system messages, combine them
    const promptText = messages.map((m) => m.content).join("\n\n");

    return this.callOllama(promptText, options.model)
      .then((content) => {
        if (!content) throw new Error("No response from Ollama");

        const usage = this.estimateTokenUsage({
          inputPrompt: promptText,
          outputText: content,
          model: options.model,
          purpose: "generate_text",
          provider: this.providerType,
        });

        return { result: content, usage };
      })
      .catch((err) => {
        const error = err as Record<string, unknown>;
        logger.error("runLLM failed", {
          error: err,
          message: error?.message,
        });
        throw new Error(
          `Ollama runLLM failed: ${String(error?.message) || err}`
        );
      });
  }

  async runStructuredLLM<TSchema extends z.ZodTypeAny>(
    template: ResolvedPrompt,
    options: LLMGenerationOptions,
    zodSchema: TSchema
  ): Promise<StructureResult<TSchema>> {
    let promptText = this.combinePromptText(template);

    const schemaJson = z.toJSONSchema(zodSchema);

    promptText = this.injectSchemaIntoPrompt(promptText, schemaJson);

    try {
      const content = await this.callOllama(promptText, options.model, true);

      if (!content) throw new Error("No response from Ollama");

      const result = zodSchema.parse(JSON.parse(content));
      const usage = this.estimateTokenUsage({
        inputPrompt: promptText,
        outputText: content,
        model: options.model,
        purpose: template.purpose,
        provider: this.providerType,
      });

      return { result, usage };
    } catch (err: unknown) {
      const error = err as Record<string, unknown>;
      logger.error("runStructuredLLM failed", {
        error: err,
        message: error?.message,
      });
      throw new Error(
        `Ollama runStructuredLLM failed: ${String(error?.message) || err}`
      );
    }
  }

  async fetchModels(): Promise<string[]> {
    try {
      logger.debug("Fetching models from Ollama API");
      const response = await fetch(`${this.baseUrl}/api/tags`);
      if (!response.ok) throw new Error("Ollama API error");
      const data = await response.json();
      return data.models.map((model: OllamaModel) => model.name);
    } catch (error) {
      logger.warn("Ollama not available, falling back to default models", {
        error,
      });
      return ["llama2", "llama3", "mistral", "neural-chat"];
    }
  }

  protected getProviderName(): string {
    return "Ollama";
  }

  async validateConnection(): Promise<{ success: boolean; message: string }> {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      const data = await response.json();
      const modelCount = data.models?.length ?? 0;
      return {
        success: true,
        message: `Connected to Ollama successfully. Found ${modelCount} available models.`,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      return {
        success: false,
        message: `Connection failed: ${errorMessage}`,
      };
    }
  }
}
/**
 * Register Ollama provider
 */
LLMProvider.register(
  BUILTIN_PROVIDERS.OLLAMA,
  {
    name: "Ollama",
    requiresAuth: false,
    isLocal: true,
    description:
      "Open-source tool for running LLMs locally on your own machine — no cloud, no data sharing, no API costs. Supports models like Llama 3, Mistral, Gemma, and many others via a simple CLI.",
  },
  (baseUrl) => new OllamaProvider(baseUrl)
);
