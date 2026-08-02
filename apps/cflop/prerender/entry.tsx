/**
 * Writes one HTML file per route, each carrying that route's real `<head>`.
 *
 * Heads only: `<div id="app"></div>` is left empty in every file, exactly as the
 * client shell ships it, so nothing about what paints or when changes. What
 * changes is that a crawler — and nginx, which can now `try_files $uri.html` —
 * sees a per-route document instead of one home shell answering every URL.
 *
 * Runs from `apps/cflop` after `vite build`, over that build's `dist/`.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { HeadContent, RouterContextProvider, createMemoryHistory } from "@tanstack/react-router";
import { renderToStaticMarkup } from "react-dom/server";

import { createAppRouter } from "@/app/router";
import { CANONICAL_ORIGIN, ROBOTS_EXCLUDED, ROBOTS_INDEXABLE, isIndexable } from "@/lib/route-head";

/** Matches no route, so it renders the not-found head into `404.html`. */
const NOT_FOUND_PATH = "/__prerender-not-found";

const distDir = path.join(process.cwd(), "dist");

function fileNameFor(routePath: string): string {
  if (routePath === NOT_FOUND_PATH) return "404.html";
  if (routePath === "/") return "index.html";
  return `${routePath.replace(/^\//, "")}.html`;
}

/**
 * The head this app actually serves is checked here and nowhere else:
 * Lighthouse audits the rendered DOM and Playwright runs JavaScript, so both
 * stay green against a document whose head is empty until React mounts.
 *
 * Attribute-order tolerant on purpose — it asserts against rendered markup, and
 * a fixed-order pattern turns a harmless reordering into a red build.
 */
function assertRouteHead(routePath: string, headHtml: string, indexable: boolean): void {
  const fail = (reason: string): never => {
    throw new Error(`Prerendered head for ${routePath} ${reason}`);
  };

  const titles = [...headHtml.matchAll(/<title[^>]*>([^<]*)<\/title>/g)];
  if (titles.length !== 1 || titles[0]![1]!.trim() === "") {
    fail(`must have exactly one non-empty <title> (found ${titles.length})`);
  }

  const contentOf = (tag: string) => /content="([^"]*)"/.exec(tag)?.[1] ?? "";

  const descriptions = [...headHtml.matchAll(/<meta[^>]*\bname="description"[^>]*>/g)];
  if (descriptions.length !== 1 || contentOf(descriptions[0]![0]).trim() === "") {
    fail(`must have exactly one non-empty meta description (found ${descriptions.length})`);
  }

  const robots = [...headHtml.matchAll(/<meta[^>]*\bname="robots"[^>]*>/g)];
  if (robots.length !== 1) {
    fail(`must have exactly one meta robots (found ${robots.length})`);
  }
  const directive = contentOf(robots[0]![0]);
  if (directive !== ROBOTS_INDEXABLE && directive !== ROBOTS_EXCLUDED) {
    fail(`has robots "${directive}", which is neither of the two allowed directives`);
  }
  if ((directive === ROBOTS_INDEXABLE) !== indexable) {
    fail(`declares indexable=${String(indexable)} but renders robots "${directive}"`);
  }

  const canonicals = [...headHtml.matchAll(/<link[^>]*\brel="canonical"[^>]*>/g)];
  if (!indexable) {
    if (canonicals.length !== 0) fail(`is excluded from search but has a canonical link`);
    return;
  }
  if (canonicals.length !== 1) {
    fail(`must have exactly one canonical link (found ${canonicals.length})`);
  }
  const href = /href="([^"]*)"/.exec(canonicals[0]![0])?.[1] ?? "";
  if (href !== `${CANONICAL_ORIGIN}${routePath}`) {
    fail(`has canonical "${href}", expected "${CANONICAL_ORIGIN}${routePath}"`);
  }
}

async function renderHead(routePath: string): Promise<{ headHtml: string; indexable: boolean }> {
  const router = createAppRouter({
    history: createMemoryHistory({ initialEntries: [routePath] }),
  });
  await router.load();

  const matches = router.stores.matches.get();
  const indexable = isIndexable(matches.at(-1)?.meta);
  const headHtml = renderToStaticMarkup(
    <RouterContextProvider router={router}>
      <HeadContent />
    </RouterContextProvider>,
  );

  assertRouteHead(routePath, headHtml, indexable);
  return { headHtml, indexable };
}

async function main(): Promise<void> {
  // Read once, before anything is written: `/`'s output overwrites this file.
  const shellPath = path.join(distDir, "index.html");
  const shell = await readFile(shellPath, "utf8");

  if (!shell.includes("</head>") || !shell.includes('<div id="app"></div>')) {
    throw new Error(`${shellPath} is not the expected app shell — nothing was written.`);
  }

  // Without this every prerendered document reads `CFLOP`, because the shell's
  // static title wins over the one React inserts after it.
  const strippedShell = shell.replace(/[ \t]*<title>[^<]*<\/title>\n?/, "");

  const routePaths = Object.keys(createAppRouter().routesByPath);
  const indexablePaths: Array<string> = [];

  for (const routePath of [...routePaths, NOT_FOUND_PATH]) {
    const { headHtml, indexable } = await renderHead(routePath);
    if (indexable) indexablePaths.push(routePath);

    // Applied to the rendered fragment only, never the document: the shell
    // carries its own module script, modulepreload, stylesheet and icon links,
    // and tagging those makes `main.tsx` delete the app's own bundle.
    //
    // `title` is deliberately absent from the alternation. React inserts its
    // own title ahead of a static one, so `document.title` stays correct
    // without it — and removing the static one blanks the tab title until React
    // mounts.
    const tagged = headHtml.replace(/<(meta|link|script)\b/g, "<$1 data-prerendered-head");
    const document = strippedShell.replace("</head>", `${tagged}</head>`);

    const fileName = fileNameFor(routePath);
    const filePath = path.join(distDir, fileName);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, document, "utf8");
    console.log(`  prerendered ${routePath} -> dist/${fileName}`);
  }

  // No `<lastmod>`: a build timestamp asserts a content change that did not
  // happen, and a sitemap that claims every page changed on every deploy is a
  // sitemap crawlers learn to distrust.
  const sitemap = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...indexablePaths.map((routePath) => `  <url><loc>${CANONICAL_ORIGIN}${routePath}</loc></url>`),
    "</urlset>",
    "",
  ].join("\n");

  await writeFile(path.join(distDir, "sitemap.xml"), sitemap, "utf8");
  console.log(`  prerendered sitemap -> dist/sitemap.xml (${indexablePaths.length} url(s))`);
}

await main();
