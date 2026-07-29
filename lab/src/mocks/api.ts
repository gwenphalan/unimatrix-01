import type {
  AdminListPostsQuery,
  BulkResult,
  ContentPost,
  ContentPostSummary,
  CreatePostBody,
  DeletePostsBody,
  GetPostQuery,
  HealthResponse,
  ListPostsQuery,
  ListPostsResponse,
  SetPostsStateBody,
  UpdatePostBody,
} from "@unimatrix/shared";

import { mockPosts } from "./fixtures.js";

/**
 * A stand-in for `@unimatrix/api-client`'s content surface.
 *
 * Every signature is written in terms of the request/response types
 * `@unimatrix/shared` exports, so a contract change breaks this file at
 * typecheck. That is the point of the mock existing at all: a prototype
 * designed against a shape the API never returns is worse than no prototype.
 *
 * It is a *structural* copy of the real client's method set rather than an
 * implementation of its `ApiClient` interface, and deliberately so —
 * `@unimatrix/api-client` is not a dependency of this workspace and is banned
 * by name in `eslint.config.mjs`. Importing the interface would put a working,
 * credential-taking transport one import away from every prototype.
 *
 * The surface is narrower than the real client's on purpose: no `request()`
 * escape hatch, no auth-token provider, no base URL. There is nothing to
 * configure because there is nothing to reach.
 */
export interface LabApiClient {
  getHealth(): Promise<HealthResponse>;
  listPosts(query: ListPostsQuery): Promise<ListPostsResponse>;
  getPost(query: GetPostQuery): Promise<ContentPost>;
  adminListPosts(query: AdminListPostsQuery): Promise<ListPostsResponse>;
  adminGetPost(query: GetPostQuery): Promise<ContentPost>;
  createPost(body: CreatePostBody): Promise<ContentPost>;
  updatePost(body: UpdatePostBody): Promise<ContentPost>;
  setPostsState(body: SetPostsStateBody): Promise<BulkResult>;
  deletePosts(body: DeletePostsBody): Promise<BulkResult>;
}

export interface CreateLabApiClientOptions {
  /**
   * Artificial delay on every call, in milliseconds. Defaults to 200 — enough
   * that a loading state is visible while designing one, which is the reason
   * the option exists. Set it to 0 for instant responses.
   */
  latencyMs?: number;
  /** Seed rows. Defaults to `mockPosts`; pass your own to design an empty state. */
  posts?: ContentPost[];
}

/** Thrown where the real client would throw `ApiClientError`. */
export class LabApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "LabApiError";
    this.status = status;
  }
}

/**
 * Written out field by field rather than as a rest-spread that drops `body`.
 * Spelling it out means a field added to `contentPostSummarySchema` fails here
 * at typecheck, which is the property this whole file exists for; a spread
 * would silently keep compiling and quietly stop matching the contract.
 */
function toSummary(post: ContentPost): ContentPostSummary {
  return {
    id: post.id,
    type: post.type,
    slug: post.slug,
    title: post.title,
    summary: post.summary,
    description: post.description,
    publicationState: post.publicationState,
    publishedAt: post.publishedAt,
    featured: post.featured,
    projectStatus: post.projectStatus,
    repoUrl: post.repoUrl,
    liveUrl: post.liveUrl,
    updatedAt: post.updatedAt,
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * In-memory, mutable, and reset by a page reload. Writes are visible to
 * subsequent reads within a session so a publish/unpublish flow can actually be
 * walked through, and nothing is persisted so every reload is a clean slate.
 */
export function createLabApiClient(options: CreateLabApiClientOptions = {}): LabApiClient {
  const latencyMs = options.latencyMs ?? 200;
  // Cloned on ingress, not just spread. A shallow array copy still shares the
  // POST OBJECTS with `mockPosts`, so one client mutating a returned post would
  // rewrite the exported fixture and every later client's starting state.
  const posts: ContentPost[] = (options.posts ?? mockPosts).map((post) => ({ ...post }));

  function findById(id: string): ContentPost {
    const post = posts.find((candidate) => candidate.id === id);

    if (post === undefined) {
      throw new LabApiError(404, `No mock post with id ${id}.`);
    }

    return post;
  }

  function findBySlug(query: GetPostQuery): ContentPost {
    const post = posts.find(
      (candidate) => candidate.type === query.type && candidate.slug === query.slug,
    );

    if (post === undefined) {
      throw new LabApiError(404, `No mock ${query.type} post with slug ${query.slug}.`);
    }

    return post;
  }

  function stamp(): string {
    return new Date().toISOString();
  }

  return {
    async getHealth() {
      await delay(latencyMs);

      const response: HealthResponse = { service: "api", status: "ok" };

      return response;
    },

    async listPosts(query) {
      await delay(latencyMs);

      const published = posts.filter(
        (post) => post.type === query.type && post.publicationState === "published",
      );
      const response: ListPostsResponse = { posts: published.map(toSummary) };

      return response;
    },

    async getPost(query) {
      await delay(latencyMs);

      const post = findBySlug(query);

      if (post.publicationState !== "published") {
        throw new LabApiError(404, `Mock post ${query.slug} is not published.`);
      }

      // A copy: callers must not be able to edit the store by mutating a read.
      return { ...post };
    },

    async adminListPosts(query) {
      await delay(latencyMs);

      const matching = posts.filter(
        (post) =>
          (query.type === undefined || post.type === query.type) &&
          (query.publicationState === undefined ||
            post.publicationState === query.publicationState),
      );
      const response: ListPostsResponse = { posts: matching.map(toSummary) };

      return response;
    },

    async adminGetPost(query) {
      await delay(latencyMs);

      return findBySlug(query);
    },

    async createPost(body) {
      await delay(latencyMs);

      const created: ContentPost = {
        id: crypto.randomUUID(),
        type: body.type,
        slug: body.slug,
        title: body.title,
        summary: body.summary,
        description: body.description ?? null,
        publicationState: body.publicationState,
        publishedAt: body.publicationState === "published" ? stamp() : null,
        featured: body.featured,
        projectStatus: body.projectStatus ?? null,
        repoUrl: body.repoUrl ?? null,
        liveUrl: body.liveUrl ?? null,
        updatedAt: stamp(),
        body: body.body,
      };

      posts.push(created);

      return created;
    },

    async updatePost(body) {
      await delay(latencyMs);

      const existing = findById(body.id);
      const updated: ContentPost = {
        ...existing,
        ...(body.slug === undefined ? {} : { slug: body.slug }),
        ...(body.title === undefined ? {} : { title: body.title }),
        ...(body.summary === undefined ? {} : { summary: body.summary }),
        ...(body.description === undefined ? {} : { description: body.description ?? null }),
        ...(body.body === undefined ? {} : { body: body.body }),
        ...(body.publicationState === undefined ? {} : { publicationState: body.publicationState }),
        ...(body.featured === undefined ? {} : { featured: body.featured }),
        ...(body.projectStatus === undefined ? {} : { projectStatus: body.projectStatus ?? null }),
        ...(body.repoUrl === undefined ? {} : { repoUrl: body.repoUrl ?? null }),
        ...(body.liveUrl === undefined ? {} : { liveUrl: body.liveUrl ?? null }),
        updatedAt: stamp(),
      };

      posts.splice(posts.indexOf(existing), 1, updated);

      return updated;
    },

    async setPostsState(body) {
      await delay(latencyMs);

      let affected = 0;

      // Unknown ids are SKIPPED, not a 404. The real route filters with
      // `inArray(...)` and reports `rows.length`, so a bulk call naming one
      // stale id succeeds partially. Throwing here would invent a status the
      // API never returns *and* abandon the loop after earlier ids had already
      // been mutated — a prototype designed against a failure mode that does
      // not exist, on a half-applied store.
      // Deduplicated: the real route's `IN (...)` matches a row once, so a repeated
      // id must not increment `affected` twice.
      for (const id of new Set(body.ids)) {
        const existing = posts.find((candidate) => candidate.id === id);

        if (existing === undefined) {
          continue;
        }

        posts.splice(posts.indexOf(existing), 1, {
          ...existing,
          publicationState: body.publicationState,
          updatedAt: stamp(),
        });
        affected += 1;
      }

      const result: BulkResult = { affected };

      return result;
    },

    async deletePosts(body) {
      await delay(latencyMs);

      let affected = 0;

      // Same partial-success contract as `setPostsState` above.
      // Deduplicated: the real route's `IN (...)` matches a row once, so a repeated
      // id must not increment `affected` twice.
      for (const id of new Set(body.ids)) {
        const existing = posts.find((candidate) => candidate.id === id);

        if (existing === undefined) {
          continue;
        }

        posts.splice(posts.indexOf(existing), 1);
        affected += 1;
      }

      const result: BulkResult = { affected };

      return result;
    },
  };
}
