import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";

/**
 * WCAG 2.1 A and AA. Any violation here fails the build outright — no app has
 * one today, so this is a hard floor rather than a backlog.
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
 *
 * `knownBestPracticeViolations` is a **per-app** parameter rather than a constant
 * shared by every caller, and that is the point. Both apps pass an empty list
 * today, and a single shared baseline would mean one app suppressing a rule it
 * has decided to live with silently lowers the floor for the other — the exact
 * quiet build-greening the callers' own comments warn against. Each app owns and
 * annotates its own list; this function only enforces whatever it is handed.
 */
export async function expectNoAccessibilityViolations(
  page: Page,
  routeLabel: string,
  knownBestPracticeViolations: readonly string[] = [],
) {
  const wcag = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();

  expect(summarize(wcag.violations), `WCAG 2.1 A/AA violations on ${routeLabel}`).toEqual([]);

  const bestPractice = await new AxeBuilder({ page }).withTags(BEST_PRACTICE_TAGS).analyze();
  const unexpected = summarize(bestPractice.violations).filter(
    (violation) => !knownBestPracticeViolations.includes(violation.id),
  );

  expect(
    unexpected,
    `New axe best-practice violations on ${routeLabel} (known: ${knownBestPracticeViolations.join(", ")})`,
  ).toEqual([]);
}
