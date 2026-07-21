/**
 * `createObject` — an observable controller wrapping
 * `LLMProvider.runStructuredLLM` for schema-validated structured output.
 * Non-streaming (structured output is a single Promise, not an event
 * stream) — the snapshot transitions loading -> resolved in one step.
 */
import { ZodTypeAny, z } from "zod";

import { classifyProviderError, LLMError } from "../errors";
import { createProviderResolver } from "./providerResolution";
import { createEmitter } from "./store";
import { ControllerBaseOptions, Store } from "./types";
import { ResolvedPrompt } from "../prompts/types";
import { LLMProvider, StructureResult } from "../providers/LLMProvider";
import { ProviderId } from "../providerType";
import { LLMUsageInfo } from "../tokens/usageTypes";

export interface ObjectSnapshot<TSchema extends ZodTypeAny = ZodTypeAny> {
  object: z.infer<TSchema> | undefined;
  isLoading: boolean;
  error: LLMError | undefined;
  usage: LLMUsageInfo | undefined;
}

export type CreateObjectOptions = ControllerBaseOptions;

export interface ObjectController<
  TSchema extends ZodTypeAny = ZodTypeAny,
> extends Store<ObjectSnapshot<TSchema>> {
  /** Resolves `resolvedPrompt` against `zodSchema`, updating the snapshot. */
  generate(
    resolvedPrompt: ResolvedPrompt,
    zodSchema: TSchema,
    schemaName: string
  ): Promise<z.infer<TSchema> | undefined>;
  /** Resets the snapshot to its initial state. */
  reset(): void;
}

function initialSnapshot<
  TSchema extends ZodTypeAny,
>(): ObjectSnapshot<TSchema> {
  return {
    object: undefined,
    isLoading: false,
    error: undefined,
    usage: undefined,
  };
}

export function createObject<TSchema extends ZodTypeAny = ZodTypeAny>(
  opts: CreateObjectOptions
): ObjectController<TSchema> {
  const resolveProvider = createProviderResolver(opts.provider);
  const emitter = createEmitter();

  let snapshot: ObjectSnapshot<TSchema> = initialSnapshot<TSchema>();

  function setSnapshot(patch: Partial<ObjectSnapshot<TSchema>>): void {
    snapshot = { ...snapshot, ...patch };
    emitter.emit();
  }

  async function generate(
    resolvedPrompt: ResolvedPrompt,
    zodSchema: TSchema,
    schemaName: string
  ): Promise<z.infer<TSchema> | undefined> {
    setSnapshot({ isLoading: true, error: undefined });

    let providerId: ProviderId | undefined;

    try {
      const provider: LLMProvider = await resolveProvider();
      providerId = provider.providerType;

      const { result, usage }: StructureResult<TSchema> =
        await provider.runStructuredLLM(
          resolvedPrompt,
          { ...opts.generationOptions, model: opts.model },
          zodSchema,
          schemaName
        );

      if (opts.onUsage) await opts.onUsage(usage);
      setSnapshot({ object: result, usage, isLoading: false });
      return result;
    } catch (err) {
      setSnapshot({
        isLoading: false,
        error: classifyProviderError(err, providerId),
      });
      return undefined;
    }
  }

  function reset(): void {
    snapshot = initialSnapshot<TSchema>();
    emitter.emit();
  }

  return {
    getSnapshot: () => snapshot,
    subscribe: emitter.subscribe,
    generate,
    reset,
  };
}
