#!/usr/bin/env node
//
// Every `runs-on:` label in `.github/workflows/` must be on the allowlist below.
//
// This repo is public, so a runner on the owner's own hardware would execute
// fork-PR code on the home lab. A runner is targeted by *label*, not by the
// string `self-hosted` — `runs-on: my-homelab` reaches a machine registered
// under that custom label and the word never appears — so this is an allowlist,
// and anything it cannot resolve is an error rather than a skip.
//
// Two ceilings, both real:
//
//   - It enforces label *naming* and cannot see what hardware a label routes
//     to. A runner registered under an already-allowlisted label defeats it
//     entirely. That is a repository-settings question, not a file question.
//   - A *remote* reusable workflow (`owner/repo/.github/workflows/x.yml@sha`)
//     carries its own `runs-on:` in a file this check can never read. Zero
//     job-level `uses:` exist today. A *local* reusable workflow is covered,
//     because it is a file in the directory globbed below.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const workflowsDir = join(repoRoot, ".github", "workflows");

/**
 * GitHub-hosted runner image labels: an OS name, then `latest` or a version
 * number, then any suffix (`-arm`, `-large`, `-xlarge`).
 *
 * The trailing segment must start with `latest` or a digit. A bare prefix match
 * would accept `ubuntu-` and `ubuntu-private`, and a self-hosted runner is
 * targeted by whatever label it was registered with — so a custom label shaped
 * like a hosted one would pass the gate this file exists to close. Matching the
 * shape rather than an exact list keeps a future hosted image (`ubuntu-26.04`)
 * from reddening CI for no reason.
 */
const HOSTED_LABEL = /^(?:ubuntu|windows|macos)-(?:latest|\d)[\w.-]*$/u;

// GitHub-hosted labels are the whole allowlist. A third-party managed runner is
// not the hazard this file exists for — it is not the owner's hardware — but
// admitting one is a vendor decision, so it takes an edit here rather than a
// label nobody reviews. Standard runners are free and unmetered on a public
// repository, which is what this repo is.
const isAllowed = (label) => HOSTED_LABEL.test(label);

let failures = 0;
const fail = (msg) => {
  console.log(`  FAIL  ${msg}`);
  failures += 1;
};

const stripQuotes = (value) => {
  const trimmed = value.trim();
  if (trimmed.length >= 2 && /^(".*"|'.*')$/su.test(trimmed)) return trimmed.slice(1, -1);
  return trimmed;
};

const indentOf = (line) => line.length - line.trimStart().length;
const isSkippable = (line) => line.trim().length === 0 || line.trim().startsWith("#");

const reject = (location, value) =>
  fail(
    `${location} — runs-on: ${value} is not an allowed runner label. ` +
      `Resolve the expression or add the label to the allowlist in ` +
      `infra/scripts/check-runner-labels.mjs.`,
  );

// Files only, resolved through symlinks. A directory named `x.yml` would
// otherwise reach `readFileSync` and throw EISDIR — a crash rather than a
// reported failure. `statSync` rather than the `Dirent` predicate because
// `readdirSync` reports the entry itself: a symlinked workflow has
// `isFile() === false` and would be skipped, which GitHub would still run.
const workflowFiles = readdirSync(workflowsDir)
  .filter((name) => /\.ya?ml$/u.test(name) && statSync(join(workflowsDir, name)).isFile())
  .sort();

// Zero files overall is the error, not zero of either extension — everything is
// `.yml` today and the `.yaml` glob legitimately matches nothing.
if (workflowFiles.length === 0) {
  fail(`.github/workflows/ contains no *.yml or *.yaml files.`);
}

for (const file of workflowFiles) {
  const relPath = `.github/workflows/${file}`;
  const lines = readFileSync(join(workflowsDir, file), "utf8").split("\n");

  for (let i = 0; i < lines.length; i += 1) {
    const match = /^(\s*)runs-on:\s*(.*)$/u.exec(lines[i]);
    if (match === null) continue;

    const keyIndent = match[1].length;
    const location = `${relPath}:${i + 1}`;
    const value = match[2].trim();

    if (value.length > 0) {
      // Scalar or flow list. An expression is unresolvable from the file alone,
      // so it fails closed here rather than being read as a literal label.
      if (value.includes("${{")) {
        reject(location, value);
        continue;
      }

      const labels = value.startsWith("[") ? value.replace(/^\[|\]$/gu, "").split(",") : [value];

      for (const label of labels) {
        const resolved = stripQuotes(label);
        if (resolved.length === 0 || !isAllowed(resolved)) reject(location, resolved || value);
      }
      continue;
    }

    // Empty value: either a block list of labels, or the `group:`/`labels:`
    // mapping form, which this check does not resolve and so refuses.
    let sawEntry = false;
    for (let j = i + 1; j < lines.length; j += 1) {
      if (isSkippable(lines[j])) continue;
      if (indentOf(lines[j]) <= keyIndent) break;

      const entry = lines[j].trim();
      if (!entry.startsWith("- ")) {
        reject(`${relPath}:${j + 1}`, entry);
        sawEntry = true;
        break;
      }

      sawEntry = true;
      const resolved = stripQuotes(entry.slice(2));
      if (resolved.includes("${{") || !isAllowed(resolved)) {
        reject(`${relPath}:${j + 1}`, resolved);
      }
    }

    if (!sawEntry) reject(location, "(empty)");
  }
}

if (failures > 0) {
  console.log(`\ncheck-runner-labels: ${failures} failure(s).`);
  process.exit(1);
}

console.log(`check-runner-labels: OK (${workflowFiles.length} workflow files).`);
