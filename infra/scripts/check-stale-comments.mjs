#!/usr/bin/env node
//
// A code comment must not name an identifier that no longer exists in the code.
//
// When a mechanism is deleted, the comments explaining it are what get left
// behind, and they are worse than no comment: they describe a system a reader
// cannot find, and they are often the only stated reason a wrapper element or a
// test shim is still there. An agent reading one either hunts for something that
// was removed, or deletes something load-bearing because the stated reason is
// gone.
//
// It happened at scale. An "occluder" mechanism was removed and five comments
// across four workspaces survived it, including `apps/admin/test/setup.ts`
// attributing its `ResizeObserver` shim to a `CircuitOccluderProvider` that does
// not exist — the real reason is `GraphBackground`. Validated against `86a814e`:
// this check flags exactly that one identifier, with no false positives on the
// tree as it stands.
//
// Deliberately narrow, because a noisy check gets ignored:
//   - only backticked `PascalCase` names, which in this repo means a component,
//     class, type or provider — not prose, not a field name
//   - only comment lines, compared against every non-comment line in the repo's
//     TypeScript
//   - a name that appears anywhere in code passes, including in another
//     workspace, so a cross-package reference is never a false positive
//
// Two other variants were measured and rejected for bad signal: doc-referenced
// paths (13 hits, 0 real) and doc-referenced identifiers (22 hits, 0 real — they
// were upstream API fields like `previewPort` and `redirectRegex`).
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const tracked = execFileSync("git", ["ls-files", "*.ts", "*.tsx"], {
  cwd: repoRoot,
  encoding: "utf8",
})
  .split("\n")
  .filter(Boolean);

const COMMENT_LINE = /^\s*(?:\/\/|\*|\/\*)/;
// Each repeated group starts with the one uppercase letter and then takes only
// non-uppercase characters. The obvious spelling of this — `[A-Z][A-Za-z0-9]*`
// repeated — lets a run like `AB` be split more than one way, and CodeQL's
// `js/redos` flags the exponential backtracking that follows on input like
// `` `A0AAAA...` ``. Matching is unchanged for PascalCase: the leading
// `[a-z0-9]+` already rejected all-caps names such as `HTML` either way.
const BACKTICKED_PASCAL = /`([A-Z][a-z0-9]+(?:[A-Z][a-z0-9]*)+)`/g;

const codeLines = [];
const commentLines = [];

for (const file of tracked) {
  const lines = readFileSync(join(repoRoot, file), "utf8").split("\n");
  lines.forEach((line, index) => {
    (COMMENT_LINE.test(line) ? commentLines : codeLines).push({
      file,
      line: index + 1,
      text: line,
    });
  });
}

// One blob rather than per-file: an identifier defined in another workspace is a
// legitimate reference, not a stale one.
const code = codeLines.map((entry) => entry.text).join("\n");

console.log("check-stale-comments: comments must not name identifiers the code no longer has\n");

let failures = 0;

if (tracked.length === 0) {
  console.log("  FAIL  no TypeScript files found — the check cannot pass vacuously");
  failures += 1;
}

for (const entry of commentLines) {
  for (const [, identifier] of entry.text.matchAll(BACKTICKED_PASCAL)) {
    if (code.includes(identifier)) continue;
    console.log(
      `  FAIL  ${entry.file}:${entry.line}: comment names \`${identifier}\`, which appears in no code — ` +
        `was the mechanism removed without its comment?`,
    );
    failures += 1;
  }
}

console.log("");

if (failures > 0) {
  console.log(`check-stale-comments: ${failures} failure(s)`);
  process.exit(1);
}

console.log(
  `check-stale-comments: ${commentLines.length} comment lines across ${tracked.length} files, no stale identifiers`,
);
