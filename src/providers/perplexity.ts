import { createConsoleLogger } from "../logger";
import { BUILTIN_PROVIDERS } from "../providerType";
import { OpenAICompatibleProvider } from "./openaiCompatibleProvider";
import fallbackModels from "./response/perplexity-fallback.json";

const logger = createConsoleLogger("Perplexity");

const PERPLEXITY_FALLBACK_MODELS = Array.isArray(fallbackModels?.data)
  ? fallbackModels.data
      .map((model) => (typeof model?.id === "string" ? model.id : undefined))
      .filter((id): id is string => Boolean(id))
  : [
      "perplexity/sonar",
      "perplexity/sonar-pro",
      "perplexity/sonar-reasoning-pro",
    ];

export class PerplexityProvider extends OpenAICompatibleProvider {
  public readonly providerType = BUILTIN_PROVIDERS.PERPLEXITY;
  private apiKey: string;

  constructor(apiKey: string) {
    super({ apiKey, baseURL: "https://api.perplexity.ai" });
    this.apiKey = apiKey;
  }

  async fetchModels(): Promise<string[]> {
    logger.debug("Fetching models from Perplexity API");

    try {
      const response = await fetch("https://api.perplexity.ai/v1/models");
      const data = await response.json();

      if (!response.ok)
        throw new Error(
          `HTTP ${response.status}: ${data.error?.message || response.statusText || "Failed to fetch models"}`
        );
      if (!data.data || !Array.isArray(data.data))
        throw new Error("Invalid response from Perplexity models API");

      return data.data.map((model: { id: string }) => model.id);
    } catch (error) {
      logger.warn("Perplexity model fetch failed, using fallback data", {
        error,
      });

      return ["fallback", ...PERPLEXITY_FALLBACK_MODELS];
    }
  }

  protected getProviderName(): string {
    return "Perplexity";
  }
}
/**
 * Register Perplexity provider
 */
OpenAICompatibleProvider.register(
  BUILTIN_PROVIDERS.PERPLEXITY,
  {
    name: "Perplexity",
    requiresAuth: true,
    description:
      "AI-powered answer engine that combines web search with LLM responses, citing sources in real time. Positioned as a search engine replacement rather than a pure chat assistant.",
    defaultModels: ["sonar-pro", "sonar-reasoning-pro", "sonar"],
  },
  (apiKey?: string) => {
    if (!apiKey) {
      throw new Error("Perplexity API key is required");
    }
    return new PerplexityProvider(apiKey);
  }
);
