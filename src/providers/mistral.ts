import { ProviderRuntimeConfig } from "../config";
import { createConsoleLogger } from "../logger";
import { BUILTIN_PROVIDERS } from "../providerType";
import { LLMProvider } from "./LLMProvider";
import { OpenAICompatibleProvider } from "./openaiCompatibleProvider";

export class MistralProvider extends OpenAICompatibleProvider {
  public readonly providerType = BUILTIN_PROVIDERS.MISTRAL;

  constructor(apiKey: string, runtimeConfig?: ProviderRuntimeConfig) {
    super(
      { apiKey, baseURL: "https://api.mistral.ai/v1" },
      runtimeConfig,
      createConsoleLogger("Mistral")
    );
  }

  async fetchModels(): Promise<string[]> {
    try {
      const response = await this.client.models.list();
      return response.data.map((model) => model.id);
    } catch (error) {
      this.logger.error("Error fetching models", { error });
      return ["mistral-large-latest", "mistral-small-latest"];
    }
  }

  protected getProviderName(): string {
    return "Mistral AI";
  }
}

/**
 * Register Mistral provider
 */
LLMProvider.register(
  BUILTIN_PROVIDERS.MISTRAL,
  {
    name: "Mistral AI",
    requiresAuth: true,
    description:
      "French AI lab behind the Mistral and Codestral model families — open-weight-friendly, strong on efficiency and multilingual tasks.",
  },
  (apiKey?: string, runtimeConfig?: ProviderRuntimeConfig) => {
    if (!apiKey) {
      throw new Error("Mistral API key is required");
    }
    return new MistralProvider(apiKey, runtimeConfig);
  }
);
