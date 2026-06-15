// Generic LLM types — provider-agnostic, domain-agnostic.

import { LLMUsageInfo } from "./tokens/usageTypes";

export interface PromptMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LLMResult<T = string> {
  result: T;
  toolCalls?: ToolCall[];
  usage: LLMUsageInfo;
}

export type TextGenerationResult = LLMResult<string>;

// ── Primitive schema types ──────────────────────────────────────────────────

export type JSONSchemaType =
  | "string"
  | "number"
  | "integer"
  | "boolean"
  | "array"
  | "object"
  | "null";

export interface JSONSchemaProperty {
  // core
  type?: JSONSchemaType | JSONSchemaType[]; // optional: not needed when using anyOf/oneOf/allOf
  title?: string;
  description?: string;
  const?: unknown;
  enum?: unknown[]; // any JSON value, not just strings
  default?: unknown;

  // composition
  anyOf?: JSONSchemaProperty[];
  oneOf?: JSONSchemaProperty[];
  allOf?: JSONSchemaProperty[];
  not?: JSONSchemaProperty;

  // conditionals
  if?: JSONSchemaProperty;
  then?: JSONSchemaProperty;
  else?: JSONSchemaProperty;

  // arrays
  items?: JSONSchemaProperty;
  minItems?: number;
  maxItems?: number;

  // objects
  properties?: Record<string, JSONSchemaProperty>;
  required?: string[];
  additionalProperties?: JSONSchemaProperty | boolean;

  // strings
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  format?: string;

  // numbers
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: number;
  exclusiveMaximum?: number;
  multipleOf?: number;

  // zod/ref support
  $ref?: string;
  $defs?: Record<string, JSONSchemaProperty>;
  [key: string]: unknown;
}

export interface ToolParameter extends JSONSchemaProperty {
  type?: "object";
  properties: Record<string, JSONSchemaProperty>;
  required?: string[];
  additionalProperties?: boolean;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: ToolParameter;
  strict?: boolean;
}

// ── Tool call result (what the model returns) ───────────────────────────────

export interface ToolCall {
  id: string;
  name: string;
  arguments: unknown;
}

// ── Tool choice control ─────────────────────────────────────────────────────

export type ToolChoice = "auto" | "none" | { type: "tool"; name: string };

// ── LLM response ───────────────────────────────────────────────────────────

export type LLMResponseType = "text" | "tool_call";

export interface LLMResponse {
  type: LLMResponseType;
  text?: string;
  toolCall?: ToolCall;
}

export interface LLMGenerationOptions {
  model: string;
  temperature?: number;
  maxTokens?: number;
  tools?: ToolDefinition[];
  toolChoice?: ToolChoice;
  stream?: boolean;
  onUsage?: (usage: LLMUsageInfo) => void;
}
