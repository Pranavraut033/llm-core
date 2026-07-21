import { ProviderRuntimeConfig } from "../config";
import { createConsoleLogger } from "../logger";
import { BUILTIN_PROVIDERS } from "../providerType";
import { LLMProvider } from "./LLMProvider";
import { OpenAICompatibleProvider } from "./openaiCompatibleProvider";

export class OpenRouterProvider extends OpenAICompatibleProvider {
  public readonly providerType = BUILTIN_PROVIDERS.OPENROUTER;

  constructor(apiKey: string, runtimeConfig?: ProviderRuntimeConfig) {
    super(
      { apiKey, baseURL: "https://openrouter.ai/api/v1" },
      runtimeConfig,
      createConsoleLogger("OpenRouter")
    );
  }

  async fetchModels(): Promise<string[]> {
    try {
      const client = await this.getClient();
      const response = await client.models.list();
      return response.data.map((model) => model.id);
    } catch (error) {
      this.logger.error("Error fetching models", { error });
      return ["openai/gpt-4o", "anthropic/claude-3.5-sonnet"];
    }
  }

  protected getProviderName(): string {
    return "OpenRouter";
  }
}

/**
 * Register OpenRouter provider
 */
LLMProvider.register(
  BUILTIN_PROVIDERS.OPENROUTER,
  {
    name: "OpenRouter",
    requiresAuth: true,
    description:
      "A unified API/marketplace that proxies to dozens of providers and models (OpenAI, Anthropic, Google, Meta, and more) behind one key and one billing relationship.",
    requiredPeerDependency: "openai",
  },
  (apiKey?: string, runtimeConfig?: ProviderRuntimeConfig) => {
    if (!apiKey) {
      throw new Error("OpenRouter API key is required");
    }
    return new OpenRouterProvider(apiKey, runtimeConfig);
  }
);
