import { ProviderRuntimeConfig } from "../config";
import { createConsoleLogger } from "../logger";
import { BUILTIN_PROVIDERS } from "../providerType";
import { LLMProvider } from "./LLMProvider";
import { OpenAICompatibleProvider } from "./openaiCompatibleProvider";

export class GroqProvider extends OpenAICompatibleProvider {
  public readonly providerType = BUILTIN_PROVIDERS.GROQ;

  constructor(apiKey: string, runtimeConfig?: ProviderRuntimeConfig) {
    super(
      { apiKey, baseURL: "https://api.groq.com/openai/v1" },
      runtimeConfig,
      createConsoleLogger("Groq")
    );
  }

  async fetchModels(): Promise<string[]> {
    try {
      const response = await this.client.models.list();
      return response.data.map((model) => model.id);
    } catch (error) {
      this.logger.error("Error fetching models", { error });
      return ["llama-3.3-70b-versatile", "llama-3.1-8b-instant"];
    }
  }

  protected getProviderName(): string {
    return "Groq";
  }
}

/**
 * Register Groq provider
 */
LLMProvider.register(
  BUILTIN_PROVIDERS.GROQ,
  {
    name: "Groq",
    requiresAuth: true,
    description:
      "Runs open models (Llama, Mixtral, Gemma) on custom LPU hardware for extremely fast inference — often the fastest time-to-first-token of any provider.",
  },
  (apiKey?: string, runtimeConfig?: ProviderRuntimeConfig) => {
    if (!apiKey) {
      throw new Error("Groq API key is required");
    }
    return new GroqProvider(apiKey, runtimeConfig);
  }
);
