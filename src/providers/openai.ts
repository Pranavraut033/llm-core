import { createConsoleLogger } from "../logger";
import { BUILTIN_PROVIDERS, ProviderId } from "../providerType";
import { LLMProvider } from "./LLMProvider";
import { OpenAICompatibleProvider } from "./openaiCompatibleProvider";

const logger = createConsoleLogger("OpenAI");

export class OpenAIProvider extends OpenAICompatibleProvider {
  constructor(apiKey: string) {
    super({ apiKey });
  }

  get providerType(): ProviderId {
    return BUILTIN_PROVIDERS.OPENAI;
  }

  textGenModelRegex = /^gpt-(3\.5|4(o)?(\.\d+)?|5(o)?(\.\d+)?)(-(mini|nano))?$/;

  protected resolveTokenParam(
    _model: string,
    maxTokens: number | undefined
  ): { max_completion_tokens?: number } {
    return { max_completion_tokens: maxTokens };
  }

  async fetchModels(): Promise<string[]> {
    try {
      logger.debug("Fetching models from OpenAI API");
      const response = await this.client.models.list();

      return response.data
        .map((model) => model.id)
        .filter(
          (id) =>
            this.textGenModelRegex.test(id) &&
            !id.includes("embedding") &&
            !id.includes("audio") &&
            !id.includes("vision") &&
            !id.includes("image")
        );
    } catch (error) {
      logger.error("Error fetching models", { error });
      return ["gpt-4o", "gpt-3.5-turbo"]; // fallback
    }
  }

  protected getProviderName(): string {
    return "OpenAI";
  }
}

/**
 * Register OpenAI provider
 */
LLMProvider.register(
  BUILTIN_PROVIDERS.OPENAI,
  {
    name: "OpenAI",
    requiresAuth: true,
    description:
      "Created ChatGPT and the GPT series, widely seen as the company that kicked off the modern AI boom. Offers the GPT-4o and o-series reasoning models for consumers and via API.",
  },
  (apiKey?: string) => {
    if (!apiKey) {
      throw new Error("OpenAI API key is required");
    }
    return new OpenAIProvider(apiKey);
  }
);
