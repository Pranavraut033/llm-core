/**
 * `useModels` — fetches the model catalog for a provider, generalizing the
 * app's `clientLLM.fetchModels` + `modelStore` fetching pattern. Unlike the
 * other hooks in this module, there's no `../core` controller to bind to
 * (no `createModels`) — this hook drives `getProviderInstance` +
 * `provider.validateConnection()`/`fetchModels()` directly with plain
 * `useState`/`useEffect`, since there's no external store to sync via
 * `useSyncExternalStore`.
 */
import { useCallback, useEffect, useState } from "react";

import { LLMCoreConfig } from "../config";
import { classifyProviderError, LLMError } from "../errors";
import { getProviderInstance } from "../providers/factory";
import { LLMProvider } from "../providers/LLMProvider";
import { ProviderId } from "../providerType";

export interface UseModelsResult {
  models: string[];
  isLoading: boolean;
  error: LLMError | undefined;
  /** Re-runs connection validation + model fetch. */
  refetch(): void;
}

export function useModels(
  providerId: ProviderId,
  config: LLMCoreConfig
): UseModelsResult {
  const [models, setModels] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<LLMError | undefined>(undefined);
  const [refetchToken, setRefetchToken] = useState<number>(0);

  useEffect(() => {
    let cancelled = false;

    async function run(): Promise<void> {
      setIsLoading(true);
      setError(undefined);

      try {
        const provider: LLMProvider = await getProviderInstance(
          providerId,
          config
        );

        const validation = await provider.validateConnection();
        if (!validation.success) {
          throw new Error(validation.message);
        }

        const fetched = await provider.fetchModels();
        if (!cancelled) {
          setModels(fetched);
          setIsLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          setModels([]);
          setError(classifyProviderError(err, providerId));
          setIsLoading(false);
        }
      }
    }

    void run();

    return () => {
      cancelled = true;
    };
    // `config` is intentionally excluded — it's expected to be a stable
    // reference per the host's own memoization; re-fetching is driven by
    // `providerId` changing or an explicit `refetch()` call.
  }, [providerId, refetchToken]);

  const refetch = useCallback(() => {
    setRefetchToken((token) => token + 1);
  }, []);

  return { models, isLoading, error, refetch };
}
