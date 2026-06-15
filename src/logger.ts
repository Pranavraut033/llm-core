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

/* eslint-disable no-console */
class ConsoleLogger implements Logger {
  constructor(private readonly tag: string) {}

  debug(message: string, data?: unknown): void {
    console.debug(`[${this.tag}] ${message}`, data ?? "");
  }

  info(message: string, data?: unknown): void {
    console.info(`[${this.tag}] ${message}`, data ?? "");
  }

  warn(message: string, data?: unknown): void {
    console.warn(`[${this.tag}] ${message}`, data ?? "");
  }

  error(message: string, data?: unknown): void {
    console.error(`[${this.tag}] ${message}`, data ?? "");
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
