#!/usr/bin/env node
//
// A coverage floor must stay near what the workspace measures.
//
// The floors are a ratchet: each is the measured figure rounded down, raised when
// a gap is genuinely closed. Nothing keeps them there. Coverage rises as tests are
// added, the floor does not follow, and the gap becomes slack that a real
// regression can hide inside — silently, because the gate is still green.
//
// It happened: `apps/api` gated at 85 line / 84 functions while measuring
// 94.54 / 91.98 over 121 tests. Deleting the whole of the user-data module's
// function coverage would still have cleared 85.
//
// The slack allowance is not zero, deliberately. V8 re-attributes functions
// between Node majors — `packages/db/AGENTS.md` and `apps/api/AGENTS.md` both
// record the 22 to 24 bump moving figures by under a point over an identical
// tree — so a floor pinned to the exact measurement turns the next runtime bump
// into a red required check for a reason that is not a regression.
//
// Reads `coverage/coverage-summary.json`, which exists because
// `packages/config-vitest` requests the `json-summary` reporter. Run it after the
// tests; it asserts on their artifacts rather than re-running them.
//
// `apps/api` is not covered here. It runs the Node test runner rather than vitest
// and emits no such summary, so its floors are asserted by the
// `--test-coverage-lines`/`--test-coverage-functions` flags in its own
// `package.json` and read from its test output.
import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

// How far a floor may sit below the measurement before it is slack rather than a
// ratchet. Wider than any V8 re-attribution observed in this repo.
const ALLOWED_SLACK = 5;

const configs = execFileSync("git", ["ls-files", "*/vitest.config.ts"], {
  cwd: repoRoot,
  encoding: "utf8",
})
  .split("\n")
  .filter(Boolean);

let failures = 0;
let compared = 0;
const skipped = [];

const fail = (msg) => {
  console.log(`  FAIL  ${msg}`);
  failures += 1;
};

console.log(
  `check-coverage-drift: floors must sit within ${ALLOWED_SLACK} points of the measurement\n`,
);

for (const config of configs) {
  const workspace = dirname(config);
  const source = readFileSync(join(repoRoot, config), "utf8");

  // Only the `thresholds: { ... }` object, so a commented-out number nearby
  // cannot be read as the live one.
  const block = source.match(/thresholds:\s*\{([^}]*)\}/);
  if (!block) {
    skipped.push(`${workspace} (declares no thresholds)`);
    continue;
  }

  const declared = {};
  for (const [, key, value] of block[1].matchAll(/(statements|functions)\s*:\s*(\d+(?:\.\d+)?)/g)) {
    declared[key] = Number(value);
  }

  const summaryPath = join(repoRoot, workspace, "coverage", "coverage-summary.json");
  if (!existsSync(summaryPath)) {
    skipped.push(`${workspace} (no coverage/coverage-summary.json — run its tests first)`);
    continue;
  }

  const { total } = JSON.parse(readFileSync(summaryPath, "utf8"));

  for (const metric of ["statements", "functions"]) {
    if (declared[metric] === undefined) continue;
    const measured = total?.[metric]?.pct;
    if (typeof measured !== "number") {
      fail(`${workspace}: coverage summary has no ${metric} percentage`);
      continue;
    }
    compared += 1;
    const slack = measured - declared[metric];
    if (slack > ALLOWED_SLACK) {
      fail(
        `${workspace}: ${metric} floor is ${declared[metric]} but measures ${measured.toFixed(2)} ` +
          `(${slack.toFixed(2)} points of slack) — ratchet it to ~${Math.floor(measured) - 3} ` +
          `in ${workspace}/vitest.config.ts`,
      );
    } else if (slack < 0) {
      // The gate itself would already be red; say why rather than letting this
      // check look like the cause.
      fail(
        `${workspace}: ${metric} measures ${measured.toFixed(2)}, below its own floor of ${declared[metric]}`,
      );
    } else {
      console.log(`  ok    ${workspace}: ${metric} ${declared[metric]} vs ${measured.toFixed(2)}`);
    }
  }
}

for (const entry of skipped) console.log(`  skip  ${entry}`);

if (compared === 0) {
  fail("no workspace coverage was compared — the check cannot pass vacuously");
}

console.log("");

if (failures > 0) {
  console.log(`check-coverage-drift: ${failures} failure(s)`);
  process.exit(1);
}

console.log(
  `check-coverage-drift: ${compared} floor(s) within ${ALLOWED_SLACK} points of the measurement`,
);
