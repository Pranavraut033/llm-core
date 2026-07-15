import { describe, expect, it, vi } from "vitest";

import { createConsoleLogger, noopLogger } from "../src/logger";

describe("noopLogger", () => {
  it.each(["debug", "info", "warn", "error"] as const)(
    "%s is a no-op that returns undefined",
    (level) => {
      expect(noopLogger[level]("message", { some: "data" })).toBeUndefined();
    }
  );
});

describe("createConsoleLogger", () => {
  it.each([
    ["debug", "debug"],
    ["info", "info"],
    ["warn", "warn"],
    ["error", "error"],
  ] as const)(
    "%s prefixes the message with the tag and forwards data",
    (level, consoleMethod) => {
      const spy = vi.spyOn(console, consoleMethod).mockImplementation(() => {});
      const logger = createConsoleLogger("MyTag");

      logger[level]("hello", { foo: "bar" });

      expect(spy).toHaveBeenCalledWith("[MyTag] hello", { foo: "bar" });
      spy.mockRestore();
    }
  );

  it("defaults data to an empty string when omitted", () => {
    const spy = vi.spyOn(console, "info").mockImplementation(() => {});
    createConsoleLogger("Tag").info("no data here");

    expect(spy).toHaveBeenCalledWith("[Tag] no data here", "");
    spy.mockRestore();
  });

  it("unwraps Error values so message/stack survive serialization", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const err = new Error("boom");

    createConsoleLogger("Tag").error("failed", { error: err });

    expect(spy).toHaveBeenCalledWith("[Tag] failed", {
      error: { name: "Error", message: "boom", stack: err.stack },
    });
    spy.mockRestore();
  });
});
