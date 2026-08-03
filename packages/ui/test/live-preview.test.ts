import { describe, expect, it } from "vitest";

import { parseImage } from "../src/components/markdown-editor/live-preview.js";

/**
 * The widget itself is a real-browser check — jsdom reports no layout, so
 * CodeMirror builds no decorations and there is nothing to assert against.
 * What is testable here is the half that decides *whether* a node becomes an
 * image at all, and returning `null` is the load-bearing case: it leaves the
 * node to the ordinary link styling rather than rendering a widget with an
 * empty `src`.
 */
describe("parseImage", () => {
  it("splits an image into its alt text and source", () => {
    expect(parseImage("![Unimatrix-01-Logo.png](/api/content/assets/abc123)")).toEqual({
      alt: "Unimatrix-01-Logo.png",
      src: "/api/content/assets/abc123",
    });
  });

  it("accepts an empty alt", () => {
    expect(parseImage("![](https://example.test/a.png)")).toEqual({
      alt: "",
      src: "https://example.test/a.png",
    });
  });

  it.each([
    ["a link rather than an image", "[text](https://example.test)"],
    ["an unclosed source", "![alt](https://example.test"],
    ["no source at all", "![alt]"],
    ["a source containing whitespace", "![alt](not a url)"],
    ["trailing text outside the image", "![alt](a.png) and more"],
  ])("returns null for %s", (_label, source) => {
    expect(parseImage(source)).toBeNull();
  });
});
