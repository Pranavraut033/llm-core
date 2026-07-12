import { LLMStreamEvent } from "./types";

/**
 * Convenience view over a rich event stream for callers that only want the
 * text deltas — equivalent to the old `AsyncGenerator<string>` contract.
 */
export async function* textOnly(
  stream: AsyncGenerator<LLMStreamEvent>
): AsyncGenerator<string> {
  for await (const event of stream) {
    if (event.type === "text") yield event.delta;
  }
}
