import { ProviderRuntimeConfig } from "../config";
import { createConsoleLogger } from "../logger";
import { BUILTIN_PROVIDERS } from "../providerType";
import { LLMProvider } from "./LLMProvider";
import { OpenAICompatibleProvider } from "./openaiCompatibleProvider";

export class DeepSeekProvider extends OpenAICompatibleProvider {
  public readonly providerType = BUILTIN_PROVIDERS.DEEPSEEK;

  constructor(apiKey: string, runtimeConfig?: ProviderRuntimeConfig) {
    super(
      { apiKey, baseURL: "https://api.deepseek.com/v1" },
      runtimeConfig,
      createConsoleLogger("DeepSeek")
    );
  }

  async fetchModels(): Promise<string[]> {
    try {
      const client = await this.getClient();
      const response = await client.models.list();
      return response.data.map((model) => model.id);
    } catch (error) {
      this.logger.error("Error fetching models", { error });
      return ["deepseek-chat", "deepseek-reasoner"];
    }
  }

  protected getProviderName(): string {
    return "DeepSeek";
  }
}

/**
 * Register DeepSeek provider
 */
LLMProvider.register(
  BUILTIN_PROVIDERS.DEEPSEEK,
  {
    name: "DeepSeek",
    requiresAuth: true,
    description:
      "Chinese AI lab known for strong reasoning models (DeepSeek-R1) at a fraction of the cost of comparable Western frontier models.",
    requiredPeerDependency: "openai",
  },
  (apiKey?: string, runtimeConfig?: ProviderRuntimeConfig) => {
    if (!apiKey) {
      throw new Error("DeepSeek API key is required");
    }
    return new DeepSeekProvider(apiKey, runtimeConfig);
  }
);
