import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function readSiteContentSource(): string {
  return readFileSync(join(process.cwd(), "src", "features", "content", "site-content.ts"), "utf8");
}

/**
 * This file used to assert that every authored markdown file under
 * `content/blog` and `content/projects` was registered in `site-content.ts`,
 * because a file that was not listed simply never appeared on the site.
 *
 * Those two collections now live in the content database behind the API and
 * are fetched at runtime, so there is no registry left to drift. What remains
 * is the inverse property: the home singleton stays bundled, and no blog or
 * project markdown may creep back into the bundle. A `?raw` import of one
 * would be a second, silently stale source of truth alongside the database.
 */
describe("site content registry", () => {
  it("registers the home singleton", () => {
    expect(readSiteContentSource()).toMatch(/content\/home\/index\.md/u);
  });

  it("does not bundle blog or project markdown", () => {
    const siteContentSource = readSiteContentSource();

    expect(siteContentSource).not.toMatch(/content\/blog\//u);
    expect(siteContentSource).not.toMatch(/content\/projects\//u);
    expect(siteContentSource).not.toMatch(/parseBlogContentFile/u);
    expect(siteContentSource).not.toMatch(/parseProjectContentFile/u);
  });

  it("renders authored copy directly without runtime text normalization", () => {
    const siteContentSource = readSiteContentSource();

    expect(siteContentSource).not.toMatch(/normalizePortfolioCopy/u);
    expect(siteContentSource).not.toMatch(/features\/public-site\/copy/u);
  });
});
