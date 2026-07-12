/**
 * Per-model capability/limits catalog.
 *
 * Lets hosts build model pickers ("does this model support vision? tool
 * calling? how big is its context window?") without hard-coding per-model
 * knowledge themselves. Data is indicative and sourced from each
 * provider's public docs — it will drift as providers ship new models;
 * update this table as needed. Unknown models simply aren't in the table
 * and `getModelInfo` returns `undefined` rather than guessing.
 */

import { ProviderId } from "../providerType";
import { normalizeModelId } from "../tokens/pricing";

export interface ModelCapabilities {
  vision: boolean;
  tools: boolean;
  structuredOutput: boolean;
  reasoning: boolean;
}

export interface ModelInfo {
  contextWindow: number;
  maxOutput?: number;
  capabilities: ModelCapabilities;
}

/**
 * Model metadata keyed by (normalized) model id. Grouped/commented by
 * provider — see `pricing.ts` for the matching cost table and
 * `normalizeModelId` for how ids are matched.
 */
export const MODEL_CATALOG: Record<string, ModelInfo> = {
  // ── OpenAI ─────────────────────────────────────────────────────────────
  "gpt-4o": {
    contextWindow: 128_000,
    maxOutput: 16_384,
    capabilities: {
      vision: true,
      tools: true,
      structuredOutput: true,
      reasoning: false,
    },
  },
  "gpt-4o-mini": {
    contextWindow: 128_000,
    maxOutput: 16_384,
    capabilities: {
      vision: true,
      tools: true,
      structuredOutput: true,
      reasoning: false,
    },
  },
  "gpt-4-turbo": {
    contextWindow: 128_000,
    maxOutput: 4_096,
    capabilities: {
      vision: true,
      tools: true,
      structuredOutput: true,
      reasoning: false,
    },
  },
  "gpt-4.1": {
    contextWindow: 1_047_576,
    maxOutput: 32_768,
    capabilities: {
      vision: true,
      tools: true,
      structuredOutput: true,
      reasoning: false,
    },
  },
  "gpt-4.1-mini": {
    contextWindow: 1_047_576,
    maxOutput: 32_768,
    capabilities: {
      vision: true,
      tools: true,
      structuredOutput: true,
      reasoning: false,
    },
  },
  "gpt-4.1-nano": {
    contextWindow: 1_047_576,
    maxOutput: 32_768,
    capabilities: {
      vision: true,
      tools: true,
      structuredOutput: true,
      reasoning: false,
    },
  },
  "gpt-5": {
    contextWindow: 400_000,
    maxOutput: 128_000,
    capabilities: {
      vision: true,
      tools: true,
      structuredOutput: true,
      reasoning: true,
    },
  },
  "gpt-5-mini": {
    contextWindow: 400_000,
    maxOutput: 128_000,
    capabilities: {
      vision: true,
      tools: true,
      structuredOutput: true,
      reasoning: true,
    },
  },
  "gpt-5-nano": {
    contextWindow: 400_000,
    maxOutput: 128_000,
    capabilities: {
      vision: true,
      tools: true,
      structuredOutput: true,
      reasoning: true,
    },
  },
  "gpt-5-chat-latest": {
    contextWindow: 400_000,
    maxOutput: 128_000,
    capabilities: {
      vision: true,
      tools: true,
      structuredOutput: true,
      reasoning: false,
    },
  },
  o1: {
    contextWindow: 200_000,
    maxOutput: 100_000,
    capabilities: {
      vision: true,
      tools: true,
      structuredOutput: true,
      reasoning: true,
    },
  },
  "o1-mini": {
    contextWindow: 128_000,
    maxOutput: 65_536,
    capabilities: {
      vision: false,
      tools: false,
      structuredOutput: false,
      reasoning: true,
    },
  },
  "o1-preview": {
    contextWindow: 128_000,
    maxOutput: 32_768,
    capabilities: {
      vision: false,
      tools: false,
      structuredOutput: false,
      reasoning: true,
    },
  },
  o3: {
    contextWindow: 200_000,
    maxOutput: 100_000,
    capabilities: {
      vision: true,
      tools: true,
      structuredOutput: true,
      reasoning: true,
    },
  },
  "o3-mini": {
    contextWindow: 200_000,
    maxOutput: 100_000,
    capabilities: {
      vision: false,
      tools: true,
      structuredOutput: true,
      reasoning: true,
    },
  },
  "o4-mini": {
    contextWindow: 200_000,
    maxOutput: 100_000,
    capabilities: {
      vision: true,
      tools: true,
      structuredOutput: true,
      reasoning: true,
    },
  },

  // ── Anthropic ──────────────────────────────────────────────────────────
  "claude-opus-4-5": {
    contextWindow: 200_000,
    maxOutput: 32_000,
    capabilities: {
      vision: true,
      tools: true,
      structuredOutput: true,
      reasoning: true,
    },
  },
  "claude-opus-4-1": {
    contextWindow: 200_000,
    maxOutput: 32_000,
    capabilities: {
      vision: true,
      tools: true,
      structuredOutput: true,
      reasoning: true,
    },
  },
  "claude-opus-4": {
    contextWindow: 200_000,
    maxOutput: 32_000,
    capabilities: {
      vision: true,
      tools: true,
      structuredOutput: true,
      reasoning: true,
    },
  },
  "claude-sonnet-4-5": {
    contextWindow: 200_000,
    maxOutput: 64_000,
    capabilities: {
      vision: true,
      tools: true,
      structuredOutput: true,
      reasoning: true,
    },
  },
  "claude-sonnet-4": {
    contextWindow: 200_000,
    maxOutput: 64_000,
    capabilities: {
      vision: true,
      tools: true,
      structuredOutput: true,
      reasoning: true,
    },
  },
  "claude-haiku-4-5": {
    contextWindow: 200_000,
    maxOutput: 64_000,
    capabilities: {
      vision: true,
      tools: true,
      structuredOutput: true,
      reasoning: true,
    },
  },
  "claude-3-5-sonnet": {
    contextWindow: 200_000,
    maxOutput: 8_192,
    capabilities: {
      vision: true,
      tools: true,
      structuredOutput: true,
      reasoning: false,
    },
  },
  "claude-3-5-haiku": {
    contextWindow: 200_000,
    maxOutput: 8_192,
    capabilities: {
      vision: false,
      tools: true,
      structuredOutput: true,
      reasoning: false,
    },
  },
  "claude-3-opus": {
    contextWindow: 200_000,
    maxOutput: 4_096,
    capabilities: {
      vision: true,
      tools: true,
      structuredOutput: true,
      reasoning: false,
    },
  },

  // ── Google Gemini ──────────────────────────────────────────────────────
  "gemini-2.5-pro": {
    contextWindow: 1_048_576,
    maxOutput: 65_536,
    capabilities: {
      vision: true,
      tools: true,
      structuredOutput: true,
      reasoning: true,
    },
  },
  "gemini-2.5-flash": {
    contextWindow: 1_048_576,
    maxOutput: 65_536,
    capabilities: {
      vision: true,
      tools: true,
      structuredOutput: true,
      reasoning: true,
    },
  },
  "gemini-2.5-flash-lite": {
    contextWindow: 1_048_576,
    maxOutput: 65_536,
    capabilities: {
      vision: true,
      tools: true,
      structuredOutput: true,
      reasoning: true,
    },
  },
  "gemini-2.0-flash": {
    contextWindow: 1_048_576,
    maxOutput: 8_192,
    capabilities: {
      vision: true,
      tools: true,
      structuredOutput: true,
      reasoning: false,
    },
  },
  "gemini-2.0-flash-lite": {
    contextWindow: 1_048_576,
    maxOutput: 8_192,
    capabilities: {
      vision: true,
      tools: true,
      structuredOutput: true,
      reasoning: false,
    },
  },

  // ── xAI Grok ───────────────────────────────────────────────────────────
  "grok-4": {
    contextWindow: 256_000,
    maxOutput: 64_000,
    capabilities: {
      vision: true,
      tools: true,
      structuredOutput: true,
      reasoning: true,
    },
  },
  "grok-3": {
    contextWindow: 131_072,
    maxOutput: 64_000,
    capabilities: {
      vision: false,
      tools: true,
      structuredOutput: true,
      reasoning: false,
    },
  },
  "grok-3-mini": {
    contextWindow: 131_072,
    maxOutput: 64_000,
    capabilities: {
      vision: false,
      tools: true,
      structuredOutput: true,
      reasoning: true,
    },
  },
  "grok-code-fast-1": {
    contextWindow: 256_000,
    maxOutput: 64_000,
    capabilities: {
      vision: false,
      tools: true,
      structuredOutput: true,
      reasoning: true,
    },
  },

  // ── Perplexity ─────────────────────────────────────────────────────────
  sonar: {
    contextWindow: 128_000,
    capabilities: {
      vision: false,
      tools: false,
      structuredOutput: true,
      reasoning: false,
    },
  },
  "sonar-pro": {
    contextWindow: 200_000,
    capabilities: {
      vision: false,
      tools: false,
      structuredOutput: true,
      reasoning: false,
    },
  },
  "sonar-reasoning": {
    contextWindow: 128_000,
    capabilities: {
      vision: false,
      tools: false,
      structuredOutput: true,
      reasoning: true,
    },
  },
  "sonar-reasoning-pro": {
    contextWindow: 128_000,
    capabilities: {
      vision: false,
      tools: false,
      structuredOutput: true,
      reasoning: true,
    },
  },
  "sonar-deep-research": {
    contextWindow: 128_000,
    capabilities: {
      vision: false,
      tools: false,
      structuredOutput: true,
      reasoning: true,
    },
  },

  // ── Ollama / local models (limits vary by quantization/host config;
  //    figures below are common defaults, not hard guarantees) ───────────
  llama3: {
    contextWindow: 8_192,
    capabilities: {
      vision: false,
      tools: true,
      structuredOutput: true,
      reasoning: false,
    },
  },
  "llama3.1": {
    contextWindow: 128_000,
    capabilities: {
      vision: false,
      tools: true,
      structuredOutput: true,
      reasoning: false,
    },
  },
  "llama3.2": {
    contextWindow: 128_000,
    capabilities: {
      vision: true,
      tools: true,
      structuredOutput: true,
      reasoning: false,
    },
  },
  "llama3.3": {
    contextWindow: 128_000,
    capabilities: {
      vision: false,
      tools: true,
      structuredOutput: true,
      reasoning: false,
    },
  },
  mistral: {
    contextWindow: 32_768,
    capabilities: {
      vision: false,
      tools: true,
      structuredOutput: true,
      reasoning: false,
    },
  },
  mixtral: {
    contextWindow: 32_768,
    capabilities: {
      vision: false,
      tools: true,
      structuredOutput: true,
      reasoning: false,
    },
  },
  qwen: {
    contextWindow: 32_768,
    capabilities: {
      vision: false,
      tools: true,
      structuredOutput: true,
      reasoning: false,
    },
  },
  "qwen2.5": {
    contextWindow: 128_000,
    capabilities: {
      vision: false,
      tools: true,
      structuredOutput: true,
      reasoning: false,
    },
  },
  gemma: {
    contextWindow: 8_192,
    capabilities: {
      vision: false,
      tools: false,
      structuredOutput: true,
      reasoning: false,
    },
  },
  gemma2: {
    contextWindow: 8_192,
    capabilities: {
      vision: false,
      tools: false,
      structuredOutput: true,
      reasoning: false,
    },
  },
  phi3: {
    contextWindow: 128_000,
    capabilities: {
      vision: false,
      tools: false,
      structuredOutput: true,
      reasoning: false,
    },
  },
  "deepseek-r1": {
    contextWindow: 128_000,
    capabilities: {
      vision: false,
      tools: false,
      structuredOutput: true,
      reasoning: true,
    },
  },
};

/**
 * Look up capability/limits metadata for a model id. Case-insensitive and
 * tolerant of provider-prefixed ids (e.g. `models/gemini-2.5-pro`,
 * `openai/gpt-4o`) via the shared `normalizeModelId` helper. Returns
 * `undefined` for models not in the catalog rather than guessing.
 *
 * `provider` is accepted for forward-compatibility (disambiguating a model
 * id that collides across providers) but is currently unused since none of
 * the built-in providers' model ids collide.
 */
export function getModelInfo(
  model: string,
  // Accepted for forward-compatibility / API symmetry with future
  // provider-scoped lookups; unused since no built-in provider's model ids
  // currently collide with another provider's.
  provider?: ProviderId
): ModelInfo | undefined {
  void provider;
  return MODEL_CATALOG[normalizeModelId(model)];
}
