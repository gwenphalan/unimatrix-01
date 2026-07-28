import type { HomePageContent } from "@unimatrix/content";
import { parseHomeContentFile } from "@unimatrix/content";

import homeSource from "../../../../../content/home/index.md?raw";

/**
 * The home/about singleton is the only content still compiled into the bundle.
 *
 * Blog and project entries moved into the content database behind the API and
 * are fetched at runtime (see `features/content/queries`), so publishing no
 * longer requires a commit and a rebuild. This one file stays repo-backed
 * deliberately: it is site copy rather than an archive of entries, it has no
 * listing or admin surface, and baking it in keeps the homepage's first paint
 * free of a network round-trip.
 */
export const homeContent: HomePageContent = parseHomeContentFile(
  homeSource,
  "content/home/index.md",
);
