import type { ContentPost, UserDocument, UserFileMetadata } from "@unimatrix/shared";

/**
 * The seed data every mock starts from.
 *
 * Typed against `@unimatrix/shared` rather than written as free-form objects,
 * which is the whole point: when a contract gains a required field or narrows
 * one, `pnpm --filter @unimatrix/lab typecheck` goes red here instead of
 * letting a prototype be designed against a shape the API does not return.
 *
 * Deliberately small and boring. This is enough rows to lay out a table, an
 * empty state, and a long-title overflow case; it is not a content database.
 */

const NOW = "2026-07-29T12:00:00.000Z";

export const mockPosts: ContentPost[] = [
  {
    id: "1f0d7b2e-5a3c-4c1b-9d6a-0c2f8b41d7a1",
    type: "blog",
    slug: "designing-the-section-nav",
    title: "Designing the section nav",
    summary: "Three layouts for the tool shell's second level of navigation, and why one won.",
    description: null,
    publicationState: "published",
    publishedAt: "2026-07-20T09:30:00.000Z",
    featured: true,
    projectStatus: null,
    repoUrl: null,
    liveUrl: null,
    updatedAt: NOW,
    body: "# Designing the section nav\n\nA prototype body. Safe markdown only.",
  },
  {
    id: "2a4c9e18-6b7d-4f02-8e51-3d9a7c6b0e42",
    type: "blog",
    slug: "a-title-long-enough-to-wrap-in-a-narrow-admin-table-column",
    title: "A title long enough to wrap in a narrow admin table column and then keep going",
    summary: "Kept here so an overflow case exists without inventing one at design time.",
    description: null,
    publicationState: "draft",
    publishedAt: null,
    featured: false,
    projectStatus: null,
    repoUrl: null,
    liveUrl: null,
    updatedAt: NOW,
    body: "Draft body.",
  },
  {
    id: "3b6e1c07-8f24-4a93-b70c-5e18d2f9a3b6",
    type: "project",
    slug: "unimatrix-lab",
    title: "Unimatrix Lab",
    summary: "The local-dev UX prototyping harness this fixture is being read by.",
    description: "A personal design surface. Never built, never deployed.",
    publicationState: "archived",
    publishedAt: "2026-05-02T18:00:00.000Z",
    featured: false,
    projectStatus: "live",
    repoUrl: "https://github.com/example/unimatrix-01",
    liveUrl: null,
    updatedAt: NOW,
    body: "Project body.",
  },
];

export const mockDocuments: UserDocument[] = [
  {
    namespace: "lab",
    key: "editor-preferences",
    value: { fontSize: 14, theme: "dark", wrap: true },
    updatedAt: NOW,
  },
  {
    namespace: "lab",
    key: "recent-prototypes",
    value: ["section-nav", "admin-table"],
    updatedAt: NOW,
  },
];

export const mockFiles: UserFileMetadata[] = [
  {
    namespace: "lab",
    key: "avatar.png",
    contentType: "image/png",
    size: 20_480,
    updatedAt: NOW,
  },
  {
    namespace: "lab",
    key: "notes.txt",
    contentType: "text/plain",
    size: 512,
    updatedAt: NOW,
  },
];
