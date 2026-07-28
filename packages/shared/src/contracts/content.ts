import {
  adminListPostsQuerySchema,
  bulkResultSchema,
  contentPostSchema,
  createPostBodySchema,
  deletePostsBodySchema,
  getPostQuerySchema,
  listAssetsResponseSchema,
  listPostsQuerySchema,
  listPostsResponseSchema,
  setPostsStateBodySchema,
  updatePostBodySchema,
} from "../schemas/content.js";
import { defineApiContract } from "./api-contract.js";

/**
 * Public content contracts. These return published, non-deleted rows only —
 * the filter lives in the API's store layer, not in a query parameter, so no
 * caller can widen it.
 */
export const listPostsContract = defineApiContract({
  method: "GET",
  path: "/content/posts",
  querySchema: listPostsQuerySchema,
  responseSchema: listPostsResponseSchema,
});

export type ListPostsContract = typeof listPostsContract;

export const getPostContract = defineApiContract({
  method: "GET",
  path: "/content/post",
  querySchema: getPostQuerySchema,
  responseSchema: contentPostSchema,
});

export type GetPostContract = typeof getPostContract;

/**
 * Admin contracts. Every one of these is gated server-side by
 * `requirePermission("auth", "admin")`; nothing here is safe to expose on a
 * public route. Ids travel in the query or body because `ApiContract` paths
 * stay static by repo convention.
 */
export const adminListPostsContract = defineApiContract({
  method: "GET",
  path: "/content/admin/posts",
  querySchema: adminListPostsQuerySchema,
  responseSchema: listPostsResponseSchema,
});

export type AdminListPostsContract = typeof adminListPostsContract;

export const adminGetPostContract = defineApiContract({
  method: "GET",
  path: "/content/admin/post",
  querySchema: getPostQuerySchema,
  responseSchema: contentPostSchema,
});

export type AdminGetPostContract = typeof adminGetPostContract;

export const createPostContract = defineApiContract({
  method: "POST",
  path: "/content/admin/posts",
  bodySchema: createPostBodySchema,
  responseSchema: contentPostSchema,
});

export type CreatePostContract = typeof createPostContract;

export const updatePostContract = defineApiContract({
  method: "PATCH",
  path: "/content/admin/posts",
  bodySchema: updatePostBodySchema,
  responseSchema: contentPostSchema,
});

export type UpdatePostContract = typeof updatePostContract;

export const setPostsStateContract = defineApiContract({
  method: "POST",
  path: "/content/admin/posts/state",
  bodySchema: setPostsStateBodySchema,
  responseSchema: bulkResultSchema,
});

export type SetPostsStateContract = typeof setPostsStateContract;

export const deletePostsContract = defineApiContract({
  method: "DELETE",
  path: "/content/admin/posts",
  bodySchema: deletePostsBodySchema,
  responseSchema: bulkResultSchema,
});

export type DeletePostsContract = typeof deletePostsContract;

export const listAssetsContract = defineApiContract({
  method: "GET",
  path: "/content/admin/assets",
  responseSchema: listAssetsResponseSchema,
});

export type ListAssetsContract = typeof listAssetsContract;
