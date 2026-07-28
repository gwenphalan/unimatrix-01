/**
 * One-way migration of the repository's authored markdown into the content
 * database.
 *
 * Blog and project entries used to be compiled into the `apps/web` bundle at
 * build time; they are now served from the API. This script is what moves the
 * existing files across, and it stays in the tree so a fresh database (a new
 * worktree, a new volume) can be brought to the same starting point.
 *
 * Idempotent: entries are matched on `(type, slug)`, so re-running updates the
 * stored copy rather than creating duplicates. It never deletes anything, and
 * it never touches a post whose stored body has diverged unless `--force` is
 * passed — a seeded row that someone has since edited in the CMS is the newer
 * copy, and silently overwriting it would lose that edit.
 *
 * Usage:
 *   pnpm --filter @unimatrix/api seed:content [--force] [--user <clerk-user-id>]
 */
import { fileURLToPath } from "node:url";

import { loadBlogEntries, loadProjectEntries } from "@unimatrix/content/node";
import { createDatabase, migrateDatabase } from "@unimatrix/db";
import type { BlogEntry, ProjectEntry } from "@unimatrix/content";
import type { ContentPostType, CreatePostBody } from "@unimatrix/shared";

import { createPost, getPostForAdmin, updatePost } from "../src/modules/content/store.js";

const REPOSITORY_ROOT = fileURLToPath(new URL("../../../", import.meta.url));

/**
 * Author recorded for seeded rows. These posts predate the CMS, so there is no
 * real Clerk session behind them; `--user` overrides it when the repository
 * owner wants their own id on the audit columns.
 */
const DEFAULT_SEED_USER_ID = "seed:repository";

interface SeedOptions {
  force: boolean;
  userId: string;
}

function parseArguments(argv: readonly string[]): SeedOptions {
  const userIndex = argv.indexOf("--user");

  return {
    force: argv.includes("--force"),
    userId: userIndex === -1 ? DEFAULT_SEED_USER_ID : (argv[userIndex + 1] ?? DEFAULT_SEED_USER_ID),
  };
}

function toCreateBody(entry: BlogEntry | ProjectEntry, type: ContentPostType): CreatePostBody {
  const { frontmatter } = entry;

  // Everything in the repository is already public, so it seeds as published.
  const base: CreatePostBody = {
    type,
    slug: entry.slug,
    title: frontmatter.title,
    summary: frontmatter.summary,
    body: entry.body,
    publicationState: "published",
    featured: false,
  };

  if (type === "project") {
    const projectFrontmatter = frontmatter as ProjectEntry["frontmatter"];

    return {
      ...base,
      featured: projectFrontmatter.featured,
      projectStatus: projectFrontmatter.status,
      repoUrl: projectFrontmatter.repoUrl ?? null,
      liveUrl: projectFrontmatter.liveUrl ?? null,
    };
  }

  const blogFrontmatter = frontmatter as BlogEntry["frontmatter"];

  return {
    ...base,
    description: blogFrontmatter.description ?? null,
  };
}

async function seed(): Promise<void> {
  const options = parseArguments(process.argv.slice(2));
  const instance = createDatabase();

  // A fresh worktree runs `pnpm setup:worktree`, but a fresh volume may not
  // have migrations applied yet, and seeding an unmigrated database fails with
  // an unhelpful "no such table".
  migrateDatabase(instance);

  const entries: { entry: BlogEntry | ProjectEntry; type: ContentPostType }[] = [
    ...loadBlogEntries({ rootDir: REPOSITORY_ROOT }).map((entry) => ({
      entry,
      type: "blog" as const,
    })),
    ...loadProjectEntries({ rootDir: REPOSITORY_ROOT }).map((entry) => ({
      entry,
      type: "project" as const,
    })),
  ];

  let created = 0;
  let updated = 0;
  let skipped = 0;

  try {
    for (const { entry, type } of entries) {
      const body = toCreateBody(entry, type);
      const existing = await getPostForAdmin(instance.db, type, entry.slug);

      if (existing === undefined) {
        // Keep the date the frontmatter declared: these entries were published
        // long before they were imported, and stamping the import time would
        // reorder the archive.
        await createPost(instance.db, options.userId, body, {
          publishedAt: entry.frontmatter.publishedAt,
        });
        created += 1;
        console.log(`created  ${type}/${entry.slug}`);
        continue;
      }

      // The "is it current?" test and the write are derived from this one
      // object deliberately. They were separate before, and the comparison
      // covered `title` and `body` while the write covered six more fields —
      // so editing only a post's `summary` in the markdown was reported
      // `current` and skipped forever, including under `--force`, which is
      // short-circuited by the branch below. Silent, and precisely the drift
      // this script exists to prevent. Keyed off `updates` they cannot
      // disagree again.
      const updates = {
        title: body.title,
        summary: body.summary,
        body: body.body,
        ...(body.description === undefined ? {} : { description: body.description }),
        featured: body.featured,
        ...(body.projectStatus === undefined ? {} : { projectStatus: body.projectStatus }),
        ...(body.repoUrl === undefined ? {} : { repoUrl: body.repoUrl }),
        ...(body.liveUrl === undefined ? {} : { liveUrl: body.liveUrl }),
      };

      const isCurrent = Object.entries(updates).every(
        ([field, value]) => existing[field as keyof typeof existing] === value,
      );

      if (isCurrent) {
        skipped += 1;
        console.log(`current  ${type}/${entry.slug}`);
        continue;
      }

      if (!options.force) {
        skipped += 1;
        console.log(
          `diverged ${type}/${entry.slug} — stored copy differs from the repository file; re-run with --force to overwrite`,
        );
        continue;
      }

      await updatePost(instance.db, options.userId, { id: existing.id, ...updates });
      updated += 1;
      console.log(`updated  ${type}/${entry.slug}`);
    }
  } finally {
    instance.client.close();
  }

  console.log(`\n${created} created, ${updated} updated, ${skipped} unchanged.`);
}

await seed();
