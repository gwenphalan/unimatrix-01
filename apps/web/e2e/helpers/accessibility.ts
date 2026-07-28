import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";

/**
 * WCAG 2.1 A and AA. Any violation here fails the build outright — the site
 * has none today, so this is a hard floor rather than a backlog.
 */
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

/**
 * axe's `best-practice` set. These are not WCAG failures; they are structural
 * recommendations. The *set of rule ids* is compared against a baseline rather
 * than the violation count, so a new kind of problem fails even if an old one
 * is still present.
 *
 * AGENTS.md claims ADHD-accessible UX. That claim is about design judgement
 * automated tooling cannot check, but landmark structure and heading order are
 * the substrate it rests on — a page whose headings skip levels is measurably
 * harder to scan.
 */
const BEST_PRACTICE_TAGS = ["best-practice"];

/**
 * Empty, and meant to stay that way. This list held `region`, `heading-order`,
 * and `landmark-unique`; all three are fixed, so the baseline is now a hard
 * floor rather than a backlog.
 *
 * A fourth, `page-has-heading-one`, was never in the list and was failing
 * anyway — `/projects` and `/blog` were visited by the smoke flow but never
 * scanned. Both are scanned now.
 *
 * Adding an entry here should be a deliberate, explained edit. It means
 * shipping a known structural problem, and it is the kind of change that is
 * easy to make quietly to turn a build green.
 */
const KNOWN_BEST_PRACTICE_VIOLATIONS: string[] = [];

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
