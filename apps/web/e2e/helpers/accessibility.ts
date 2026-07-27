import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";

/**
 * WCAG 2.1 A and AA. Any violation here fails the build outright — the site
 * has none today, so this is a hard floor rather than a backlog.
 */
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

/**
 * axe's `best-practice` set. These are not WCAG failures; they are structural
 * recommendations, and the site currently violates three of them. Rather than
 * drop the whole tag set (which would stop reporting them) or fail the build on
 * day one, the *set of rule ids* is compared against a known baseline: existing
 * findings stay visible, and a new one fails.
 *
 * AGENTS.md claims ADHD-accessible UX. That claim is about design judgement
 * automated tooling cannot check, but landmark structure and heading order are
 * the substrate it rests on — a page whose headings skip levels is measurably
 * harder to scan.
 */
const BEST_PRACTICE_TAGS = ["best-practice"];

/**
 * Best-practice rules the public site violates today, as measured. Removing an
 * entry once it is genuinely fixed is the intended direction; adding one should
 * be a deliberate, explained edit.
 *
 * - `region`: some page content sits outside any landmark element.
 * - `heading-order`: at least one heading skips a level.
 * - `landmark-unique`: two landmarks share a role without distinguishing labels.
 */
const KNOWN_BEST_PRACTICE_VIOLATIONS = ["heading-order", "landmark-unique", "region"];

interface ViolationSummary {
  id: string;
  impact: string | null | undefined;
  help: string;
  nodes: string[];
}

function summarize(
  violations: Awaited<ReturnType<AxeBuilder["analyze"]>>["violations"],
): ViolationSummary[] {
  return violations.map((violation) => ({
    id: violation.id,
    impact: violation.impact,
    help: violation.help,
    nodes: violation.nodes.map((node) => node.target.join(" ")),
  }));
}

/**
 * Asserts the page currently rendered has no new accessibility violations.
 *
 * Called from inside the existing smoke tests rather than from a suite of its
 * own, so every route the smoke suite already visits is scanned and the two
 * cannot drift apart when a route is added to one and not the other.
 *
 * Failure messages carry rule id, impact, and the failing selectors: an axe
 * violation reported as a bare count is not actionable from a CI log.
 */
export async function expectNoAccessibilityViolations(page: Page, routeLabel: string) {
  const wcag = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();

  expect(summarize(wcag.violations), `WCAG 2.1 A/AA violations on ${routeLabel}`).toEqual([]);

  const bestPractice = await new AxeBuilder({ page }).withTags(BEST_PRACTICE_TAGS).analyze();
  const unexpected = summarize(bestPractice.violations).filter(
    (violation) => !KNOWN_BEST_PRACTICE_VIOLATIONS.includes(violation.id),
  );

  expect(
    unexpected,
    `New axe best-practice violations on ${routeLabel} (known: ${KNOWN_BEST_PRACTICE_VIOLATIONS.join(", ")})`,
  ).toEqual([]);
}
