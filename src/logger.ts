/**
 * Minimal injectable logger interface.
 *
 * Providers and utilities in this package accept a `Logger` so host
 * applications can route log output through their own logging stack
 * (or silence it entirely). A console-backed default is provided.
 */

export interface Logger {
  debug(message: string, data?: unknown): void;
  info(message: string, data?: unknown): void;
  warn(message: string, data?: unknown): void;
  error(message: string, data?: unknown): void;
}

function toPlainError(err: Error): { name: string; message: string; stack?: string } {
  return { name: err.name, message: err.message, stack: err.stack };
}

/**
 * `Error` values serialize to unusable output ("[object Error]", "{}") once
 * they cross a JSON boundary — e.g. Next.js's browser-console-to-terminal
 * relay. Call sites log errors as `{ error }`, so a shallow pass is enough
 * to keep the actual message/stack intact wherever it's ultimately printed.
 */
function serializeData(data: unknown): unknown {
  if (data instanceof Error) return toPlainError(data);
  if (data && typeof data === "object" && !Array.isArray(data)) {
    return Object.fromEntries(
      Object.entries(data).map(([key, value]) => [
        key,
        value instanceof Error ? toPlainError(value) : value,
      ])
    );
  }
  return data;
}

/* eslint-disable no-console */
class ConsoleLogger implements Logger {
  constructor(private readonly tag: string) {}

  debug(message: string, data?: unknown): void {
    console.debug(`[${this.tag}] ${message}`, serializeData(data) ?? "");
  }

  info(message: string, data?: unknown): void {
    console.info(`[${this.tag}] ${message}`, serializeData(data) ?? "");
  }

  warn(message: string, data?: unknown): void {
    console.warn(`[${this.tag}] ${message}`, serializeData(data) ?? "");
  }

  error(message: string, data?: unknown): void {
    console.error(`[${this.tag}] ${message}`, serializeData(data) ?? "");
  }
}
/* eslint-enable no-console */

/**
 * No-op logger — useful for tests or hosts that want silence by default.
 */
export const noopLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

/**
 * Create a console-backed logger scoped with a tag, e.g. `[OpenAI] message`.
 */
export function createConsoleLogger(tag: string): Logger {
  return new ConsoleLogger(tag);
}
