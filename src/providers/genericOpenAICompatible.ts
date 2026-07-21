import { ProviderRuntimeConfig } from "../config";
import { createConsoleLogger } from "../logger";
import { ProviderId } from "../providerType";
import { OpenAICompatibleProvider } from "./openaiCompatibleProvider";

export interface GenericOpenAICompatibleConfig {
  /** Must already be declared in `ProviderIdRegistry` via module augmentation — see providerType.ts. */
  id: ProviderId;
  name: string;
  apiKey: string;
  baseURL: string;
}

/**
 * Concrete, runtime-configurable `OpenAICompatibleProvider` for any host
 * speaking the OpenAI chat-completions dialect that doesn't have (or
 * doesn't need) a named subclass — Together, Fireworks, LM Studio, vLLM,
 * LiteLLM, etc. Not registered via `LLMProvider.register`/the factory
 * singleton (that model assumes one fixed id/baseURL per provider, known at
 * module-load time); instantiate it directly instead:
 *
 * ```ts
 * declare module "@resume-builder/llm-core" {
 *   interface ProviderIdRegistry { together: true }
 * }
 * const together = new GenericOpenAICompatibleProvider({
 *   id: "together" as ProviderId,
 *   name: "Together AI",
 *   apiKey,
 *   baseURL: "https://api.together.xyz/v1",
 * });
 * ```
 *
 * `fetchModels()` returns whatever `/models` reports, unfiltered — there's
 * no fixed model-id pattern to regex-match for an arbitrary host.
 */
export class GenericOpenAICompatibleProvider extends OpenAICompatibleProvider {
  private readonly id: ProviderId;
  private readonly name: string;

  constructor(
    config: GenericOpenAICompatibleConfig,
    runtimeConfig?: ProviderRuntimeConfig
  ) {
    super(
      { apiKey: config.apiKey, baseURL: config.baseURL },
      runtimeConfig,
      createConsoleLogger(config.name)
    );
    this.id = config.id;
    this.name = config.name;
  }

  get providerType(): ProviderId {
    return this.id;
  }

  async fetchModels(): Promise<string[]> {
    try {
      const client = await this.getClient();
      const response = await client.models.list();
      return response.data.map((model) => model.id);
    } catch (error) {
      this.logger.error("Error fetching models", { error });
      return [];
    }
  }

  protected getProviderName(): string {
    return this.name;
  }
}
