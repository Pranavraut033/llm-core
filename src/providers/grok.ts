import { ProviderRuntimeConfig } from "../config";
import { createConsoleLogger } from "../logger";
import { BUILTIN_PROVIDERS } from "../providerType";
import { LLMProvider } from "./LLMProvider";
import { OpenAICompatibleProvider } from "./openaiCompatibleProvider";

export class GrokProvider extends OpenAICompatibleProvider {
  public readonly providerType = BUILTIN_PROVIDERS.GROK;

  constructor(apiKey: string, runtimeConfig?: ProviderRuntimeConfig) {
    super(
      { apiKey, baseURL: "https://api.x.ai/v1" },
      runtimeConfig,
      createConsoleLogger("Grok")
    );
  }

  private textGenModelRegex =
    /^grok-\d+((\-|\.)\d+)?(-fast|-mini)?((-non)?(-reasoning))?$/;

  async fetchModels(): Promise<string[]> {
    try {
      const client = await this.getClient();
      const response = await client.models.list();
      const models = response.data
        .map((model) => model.id)
        .filter((id) => this.textGenModelRegex.test(id));

      return models;
    } catch (error) {
      this.logger.error("Error fetching models", { error });
      return ["grok-4-1-fast-reasoning", "grok-3-mini"]; // fallback
    }
  }

  protected getProviderName(): string {
    return "Grok";
  }
}
/**
 * Register Grok provider
 */
LLMProvider.register(
  BUILTIN_PROVIDERS.GROK,
  {
    name: "xAI Grok",
    requiresAuth: true,
    description:
      "Elon Musk's AI lab xAI built Grok with real-time access to X (Twitter) data and a less filtered, more irreverent personality. Grok 3 competes directly with frontier models on coding and reasoning.",
    requiredPeerDependency: "openai",
  },
  (apiKey?: string, runtimeConfig?: ProviderRuntimeConfig) => {
    if (!apiKey) {
      throw new Error("Grok API key is required");
    }
    return new GrokProvider(apiKey, runtimeConfig);
  }
);
