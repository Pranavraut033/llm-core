import { ProviderRuntimeConfig } from "../config";
import { createConsoleLogger } from "../logger";
import { BUILTIN_PROVIDERS } from "../providerType";
import { OpenAICompatibleProvider } from "./openaiCompatibleProvider";
import fallbackModels from "./response/perplexity-fallback.json";

import type { LLMResult } from "../types";

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
  /**
   * Named distinctly from the base class's own private `apiKey` field
   * (used for lazy SDK client construction) — Perplexity additionally
   * needs the raw key here for its `fetch`-based `fetchModels` call,
   * which bypasses the OpenAI SDK client entirely.
   */
  private readonly perplexityApiKey: string;

  constructor(apiKey: string, runtimeConfig?: ProviderRuntimeConfig) {
    super(
      { apiKey, baseURL: "https://api.perplexity.ai" },
      runtimeConfig,
      createConsoleLogger("Perplexity")
    );
    this.perplexityApiKey = apiKey;
  }

  async fetchModels(): Promise<string[]> {
    this.logger.debug("Fetching models from Perplexity API");

    try {
      const response = await fetch("https://api.perplexity.ai/v1/models", {
        headers: { Authorization: `Bearer ${this.perplexityApiKey}` },
      });
      const data = await response.json();

      if (!response.ok)
        throw new Error(
          `HTTP ${response.status}: ${data.error?.message || response.statusText || "Failed to fetch models"}`
        );
      if (!data.data || !Array.isArray(data.data))
        throw new Error("Invalid response from Perplexity models API");

      return data.data.map((model: { id: string }) => model.id);
    } catch (error) {
      this.logger.warn("Perplexity model fetch failed, using fallback data", {
        error,
      });

      return PERPLEXITY_FALLBACK_MODELS;
    }
  }

  protected getProviderName(): string {
    return "Perplexity";
  }

  /**
   * Perplexity's chat-completion response carries `citations` (an array of
   * URL strings) and/or `search_results` (objects with `url`/`title`) —
   * Perplexity's whole value proposition over a plain chat model. The
   * OpenAI-compatible base only reads the standard `choices`/`usage`
   * shape, so surface these extra fields here via the protected hook.
   * Non-streaming only — streaming citation deltas are out of scope.
   */
  protected extractExtraResultFields(completion: unknown): Partial<LLMResult> {
    if (!completion || typeof completion !== "object") return {};
    const raw = completion as Record<string, unknown>;
    const citations: { url: string; title?: string }[] = [];

    if (Array.isArray(raw.citations)) {
      for (const entry of raw.citations) {
        if (typeof entry === "string") citations.push({ url: entry });
      }
    }

    if (Array.isArray(raw.search_results)) {
      for (const entry of raw.search_results) {
        if (!entry || typeof entry !== "object") continue;
        const result = entry as Record<string, unknown>;
        if (typeof result.url !== "string") continue;
        citations.push({
          url: result.url,
          ...(typeof result.title === "string" ? { title: result.title } : {}),
        });
      }
    }

    return citations.length > 0 ? { citations } : {};
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
    requiredPeerDependency: "openai",
  },
  (apiKey?: string, runtimeConfig?: ProviderRuntimeConfig) => {
    if (!apiKey) {
      throw new Error("Perplexity API key is required");
    }
    return new PerplexityProvider(apiKey, runtimeConfig);
  }
);
