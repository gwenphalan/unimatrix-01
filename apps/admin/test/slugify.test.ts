import { describe, expect, it } from "vitest";

import { slugifyTitle } from "@/features/content/slugify";

const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]*$/u;

describe("slugifyTitle", () => {
  it("lowercases and joins words with hyphens", () => {
    expect(slugifyTitle("Editor Smoke Test")).toBe("editor-smoke-test");
  });

  it("collapses punctuation and runs of spaces into a single hyphen", () => {
    expect(slugifyTitle("What's  new -- in v2.0?")).toBe("what-s-new-in-v2-0");
  });

  /**
   * Accents fold to their base letter rather than being dropped, so a titled
   * post keeps a readable URL instead of a mangled one.
   */
  it("folds accents instead of deleting the letters under them", () => {
    expect(slugifyTitle("Café déjà vu")).toBe("cafe-deja-vu");
  });

  it("never leaves a leading or trailing hyphen", () => {
    expect(slugifyTitle("  -- Draft --  ")).toBe("draft");
  });

  /**
   * The form's `pattern` rejects anything else, so a title with nothing usable
   * in it has to produce an empty field rather than an invalid slug.
   */
  it("returns nothing at all when the title has no usable characters", () => {
    expect(slugifyTitle("🎉🎉")).toBe("");
    expect(slugifyTitle("")).toBe("");
  });

  it("produces something the slug field's own pattern accepts", () => {
    for (const title of ["Hello, World!", "2026 review", "Ünïcödé", "a"]) {
      expect(slugifyTitle(title)).toMatch(SLUG_PATTERN);
    }
  });
});
