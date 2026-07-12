/**
 * A minimal, network-free `LLMProvider` implementation used across tests.
 * Returns canned data so providers/registry/factory plumbing can be
 * exercised without hitting any real LLM API.
 */
import { z, ZodTypeAny } from "zod";

import { ProviderRuntimeConfig } from "../../src/config";
import { Logger } from "../../src/logger";
import { ResolvedPrompt } from "../../src/prompts/types";
import { LLMProvider, StructureResult } from "../../src/providers/LLMProvider";
import { ProviderId } from "../../src/providerType";
import { LLMUsageInfo } from "../../src/tokens/usageTypes";
import {
  LLMGenerationOptions,
  LLMResult,
  LLMStreamEvent,
  PromptMessage,
} from "../../src/types";

export const DUMMY_RESULT_TEXT = "dummy response";

export class DummyProvider extends LLMProvider {
  constructor(
    private readonly id: ProviderId,
    private readonly apiKey?: string,
    runtimeConfig?: ProviderRuntimeConfig
  ) {
    super(runtimeConfig);
  }

  /** Test-only escape hatches for the protected base-class plumbing. */
  public callNotifyUsage(
    usage: LLMUsageInfo,
    explicitSink?: (usage: LLMUsageInfo) => void
  ): void {
    this.notifyUsage(usage, explicitSink);
  }

  public getLogger(): Logger {
    return this.logger;
  }

  get providerType(): ProviderId {
    return this.id;
  }

  get streamSupported(): boolean {
    return false;
  }

  getApiKey(): string | undefined {
    return this.apiKey;
  }

  async fetchModels(): Promise<string[]> {
    return ["dummy-model"];
  }

  async validateConnection(): Promise<{ success: boolean; message: string }> {
    return { success: true, message: "ok" };
  }

  runLLM(
    messages: PromptMessage[],
    options: LLMGenerationOptions & { stream: true }
  ): AsyncGenerator<LLMStreamEvent>;
  runLLM(
    messages: PromptMessage[],
    options: LLMGenerationOptions & { stream?: false; onUsage?: never }
  ): Promise<LLMResult<string>>;
  runLLM(
    messages: PromptMessage[],
    options: LLMGenerationOptions
  ): Promise<LLMResult<string>> | AsyncGenerator<LLMStreamEvent> {
    const usage = this.estimateTokenUsage({
      inputPrompt: this.combinePromptText({
        systemPrompt: "",
        userPrompt: messages.map((m) => m.content).join("\n"),
        purpose: "generate_text",
        estimatedTokens: 0,
      }),
      outputText: DUMMY_RESULT_TEXT,
      model: options.model,
      purpose: "generate_text",
      provider: this.providerType,
    });

    return Promise.resolve({ result: DUMMY_RESULT_TEXT, usage });
  }

  async runStructuredLLM<TSchema extends ZodTypeAny>(
    template: ResolvedPrompt,
    options: LLMGenerationOptions,
    zodSchema: TSchema,
    _schemaName: string
  ): Promise<StructureResult<TSchema>> {
    // "Canned" structured response. Callers pass a schema with defaults
    // (or optional fields) so an empty object parses successfully.
    const result = zodSchema.parse({}) as z.infer<TSchema>;
    const usage: LLMUsageInfo = this.estimateTokenUsage({
      inputPrompt: this.combinePromptText(template),
      outputText: JSON.stringify(result),
      model: options.model,
      purpose: template.purpose,
      provider: this.providerType,
    });

    return { result, usage };
  }
}
