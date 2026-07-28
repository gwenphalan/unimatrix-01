#!/usr/bin/env node
/**
 * Runs Lighthouse against a built app and fails when a category score drops
 * below its budget.
 *
 * Deliberately not `@lhci/cli`. That package reaches `brace-expansion@1.1.16`
 * through `tmp` -> `rimraf` -> `glob@7` -> `minimatch@3`, which reintroduces
 * GHSA-mh99-v99m-4gvg — the exact advisory removed from this repo's tree by the
 * ESLint 10 upgrade. `lighthouse` itself has no `minimatch` or
 * `brace-expansion` in its tree at all.
 *
 * Reports are written to disk and never uploaded anywhere.
 *
 * Usage: node infra/scripts/lighthouse.mjs <app-directory>
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import process from "node:process";

import { launch } from "chrome-launcher";
import lighthouse from "lighthouse";

/**
 * Budgets are today's measured scores minus a small margin, so they ratchet
 * against regression rather than demanding an improvement. Lighthouse scores
 * vary a few points run to run even on identical input — the margin absorbs
 * that, and anything larger is a real regression.
 *
 * `seo` is the exception and carries no margin, because it does not need one:
 * unlike performance it is a fixed set of pass/fail audits with no timing
 * component, so it does not drift between runs. Both apps score 1.00 on every
 * route, and any drop means an audit genuinely started failing — a page with no
 * meta description, a non-crawlable link, an image without alt text.
 */
const APPS = {
  // Measured 2026-07-27 against a build with no `VITE_CLERK_PUBLISHABLE_KEY`,
  // which is what CI produces: performance 0.90-0.94, accessibility 0.98-1.00,
  // best-practices 1.00, seo 1.00.
  //
  // Measure it the same way. A local `.env.local` carrying a Clerk key drops
  // best-practices to 0.73-0.77, because Clerk's telemetry call is blocked by
  // CORS (`errors-in-console`) and its `__cf_bm` / `_cfuvid` cookies trip
  // `third-party-cookies`. Budgets set from that build would be ~25 points too
  // loose for the site CI actually builds.
  "apps/web": {
    routes: ["/", "/about", "/projects", "/blog"],
    budgets: { performance: 0.85, accessibility: 0.95, "best-practices": 0.95, seo: 1 },
  },
  // Measured 2026-07-27: performance 0.95-0.97, accessibility 1.00,
  // best-practices 1.00, seo 1.00. No env of any kind, so local and CI builds
  // are identical.
  "apps/cube-trainer": {
    routes: ["/", "/learn", "/drill"],
    budgets: { performance: 0.9, accessibility: 0.95, "best-practices": 0.95, seo: 1 },
  },
};

const CATEGORIES = ["performance", "accessibility", "best-practices", "seo"];

/**
 * `chrome-launcher` looks for a system Chrome install, which neither CI nor a
 * dev machine running only Playwright's browsers necessarily has. Resolving
 * Playwright's full Chromium here keeps the script working in both places
 * without the workflow having to compute a path.
 *
 * Deliberately the `chrome-linux64/chrome` binary and not
 * `chromium_headless_shell`: Lighthouse needs full Chrome, and the headless
 * shell fails in ways that read like a broken page rather than a missing
 * browser.
 */
async function resolveChromePath() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;

  // `PLAYWRIGHT_BROWSERS_PATH` wins when set; otherwise Playwright's per-OS
  // default. Only the Linux default is spelled out because CI and the dev
  // machine are both Linux — on anything else, set CHROME_PATH.
  const roots = [
    process.env.PLAYWRIGHT_BROWSERS_PATH,
    path.join(os.homedir(), ".cache", "ms-playwright"),
  ].filter(Boolean);

  // Playwright has shipped both layouts; which one appears depends on the
  // browser build, not the platform.
  const layouts = [
    ["chrome-linux64", "chrome"],
    ["chrome-linux", "chrome"],
  ];
  const searched = [];

  for (const root of roots) {
    if (!existsSync(root)) {
      searched.push(`${root} (missing)`);
      continue;
    }

    const builds = (await readdir(root))
      .filter((name) => /^chromium-\d+$/u.test(name))
      .sort()
      .reverse();

    if (builds.length === 0) searched.push(`${root} (no chromium-* build)`);

    for (const build of builds) {
      for (const layout of layouts) {
        const candidate = path.join(root, build, ...layout);
        if (existsSync(candidate)) return candidate;
        searched.push(candidate);
      }
    }
  }

  // Deliberately fatal rather than falling through to `chrome-launcher`'s
  // system-Chrome search. That search fails with a launcher error that reads
  // like a broken page rather than a missing browser, which is exactly the
  // silent-failure shape this repo tries to avoid.
  throw new Error(
    [
      "Could not find Playwright's Chromium, and no CHROME_PATH was set.",
      "Lighthouse needs full Chrome (not chromium_headless_shell).",
      "Searched:",
      ...searched.map((entry) => `  ${entry}`),
      "Fix: `pnpm exec playwright install chromium`, or set CHROME_PATH.",
    ].join("\n"),
  );
}

function findFreePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => {
        resolve(port);
      });
    });
  });
}

async function waitForServer(url, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2_000) });
      if (response.ok) return;
    } catch {
      // Not up yet. Retrying is the whole point of the loop.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error(`Preview server at ${url} did not start within ${timeoutMs}ms`);
}

async function main() {
  const appDir = process.argv[2];
  const config = APPS[appDir];

  if (!config) {
    throw new Error(`Unknown app "${appDir}". Expected one of: ${Object.keys(APPS).join(", ")}`);
  }

  // Budgets are calibrated against the build CI produces. A local env file can
  // change what ships in the bundle — a Clerk key alone costs `apps/web` about
  // 25 points of best-practices — so say so up front rather than let it look
  // like a regression.
  for (const envFile of [".env.local", ".env.production.local"]) {
    if (existsSync(path.join(appDir, envFile))) {
      console.warn(
        `  note: ${appDir}/${envFile} exists. Budgets are measured against a CI build, ` +
          `which has no local env — scores here may differ. Move it aside to compare like for like.`,
      );
    }
  }

  const port = await findFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const preview = spawn(
    "pnpm",
    ["exec", "vite", "preview", "--host", "127.0.0.1", "--port", String(port), "--strictPort"],
    { cwd: appDir, stdio: "inherit" },
  );

  let chrome;
  const failures = [];
  const reportDir = path.join(appDir, ".lighthouse");

  try {
    await waitForServer(baseUrl);
    await mkdir(reportDir, { recursive: true });
    chrome = await launch({
      chromeFlags: ["--headless=new", "--no-sandbox"],
      chromePath: await resolveChromePath(),
    });

    for (const route of config.routes) {
      const result = await lighthouse(
        `${baseUrl}${route}`,
        { logLevel: "error", output: "json", port: chrome.port },
        undefined,
      );

      if (!result) throw new Error(`Lighthouse returned no result for ${route}`);

      const slug = route === "/" ? "index" : route.replaceAll("/", "-").replace(/^-/u, "");
      await writeFile(path.join(reportDir, `${slug}.json`), result.report, "utf8");

      for (const category of CATEGORIES) {
        const score = result.lhr.categories[category]?.score ?? 0;
        const budget = config.budgets[category];
        const status = score >= budget ? "ok  " : "FAIL";

        console.log(
          `  ${status} ${appDir}${route} ${category}: ${score.toFixed(2)} (budget ${budget.toFixed(2)})`,
        );

        if (score < budget) {
          failures.push(
            `${appDir}${route} ${category}: ${score.toFixed(2)} < ${budget.toFixed(2)}`,
          );
        }
      }
    }
  } finally {
    if (chrome) await chrome.kill();
    preview.kill("SIGTERM");
  }

  if (failures.length > 0) {
    console.error(`\nLighthouse budget failures:\n${failures.map((f) => `  - ${f}`).join("\n")}`);
    process.exitCode = 1;
    return;
  }

  console.log(`\nAll Lighthouse budgets met for ${appDir}. Reports in ${reportDir}.`);
}

await main();
