import { describe, expect, it } from "vitest";

import { contentToText } from "../src/types";

describe("contentToText", () => {
  it("returns plain string content unchanged", () => {
    expect(contentToText("hello world")).toBe("hello world");
  });

  it("joins text parts with newlines", () => {
    expect(
      contentToText([
        { type: "text", text: "first" },
        { type: "text", text: "second" },
      ])
    ).toBe("first\nsecond");
  });

  it("replaces image parts with a [image] placeholder", () => {
    expect(
      contentToText([
        { type: "text", text: "look at this:" },
        { type: "image", image: { data: "abc123", mediaType: "image/png" } },
      ])
    ).toBe("look at this:\n[image]");
  });

  it("replaces document parts with a [document] placeholder", () => {
    expect(
      contentToText([
        { type: "text", text: "see attached:" },
        {
          type: "document",
          document: { data: "abc123", mediaType: "application/pdf" },
        },
      ])
    ).toBe("see attached:\n[document]");
  });

  it("handles URL-form image/document parts the same as base64 (placeholder, no crash)", () => {
    expect(
      contentToText([
        { type: "image", image: { url: "https://example.com/cat.png" } },
        { type: "document", document: { url: "https://example.com/a.pdf" } },
      ])
    ).toBe("[image]\n[document]");
  });

  it("returns an empty string for an empty parts array", () => {
    expect(contentToText([])).toBe("");
  });
});
