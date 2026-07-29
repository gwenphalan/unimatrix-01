import type { ContentAssetMetadata } from "@unimatrix/shared";
import { contentAssetMetadataSchema } from "@unimatrix/shared";

import { loadWebRuntimeConfig } from "@/lib/config";

const runtimeConfig = loadWebRuntimeConfig({
  VITE_API_BASE_URL: import.meta.env.VITE_API_BASE_URL,
  VITE_AUTH_APP_URL: import.meta.env.VITE_AUTH_APP_URL,
  VITE_CLERK_PUBLISHABLE_KEY: import.meta.env.VITE_CLERK_PUBLISHABLE_KEY,
});

/**
 * Kept in step with the API's `isInlineSafeContentType` allowlist. Used only
 * to set the file picker's `accept` and to fail fast on an obvious mistake —
 * the API re-checks the real mimetype and is the decision that counts.
 */
export const ASSET_ACCEPT = "image/png,image/jpeg,image/gif,image/webp,image/avif";

export class AssetUploadError extends Error {}

/**
 * Uploads one image and returns its stored metadata.
 *
 * Done with `fetch` rather than through `@unimatrix/api-client` because that
 * package is JSON-only by rule — binary I/O belongs to the caller. The token
 * is passed in rather than read here so this stays a plain function, callable
 * outside a React render.
 */
export async function uploadAsset(file: File, token: string | null): Promise<ContentAssetMetadata> {
  if (token === null) {
    throw new AssetUploadError("Your session has expired. Sign in again to upload.");
  }

  const body = new FormData();

  body.append("file", file);

  // No `Content-Type` header: the browser has to set it itself so the
  // multipart boundary matches the body it generated.
  const response = await fetch(`${runtimeConfig.apiBaseUrl}/content/admin/assets`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
    body,
  });

  if (!response.ok) {
    throw new AssetUploadError(await describeUploadFailure(response));
  }

  // Parsed, not asserted: this is an external boundary, and a response that
  // does not match the contract has to fail here rather than reach the editor
  // as a metadata object with a missing hash and become a broken image link.
  const parsed = contentAssetMetadataSchema.safeParse(await response.json());

  if (!parsed.success) {
    throw new AssetUploadError("The upload succeeded but the server's reply could not be read.");
  }

  return parsed.data;
}

/**
 * The API's error envelope carries the useful text (which type was rejected,
 * how large the file may be), so it is preferred over a generic status line.
 * A non-JSON body is possible from a proxy rather than the API, hence the
 * catch.
 */
async function describeUploadFailure(response: Response): Promise<string> {
  try {
    const payload = (await response.json()) as { message?: unknown };

    if (typeof payload.message === "string" && payload.message.length > 0) {
      return payload.message;
    }
  } catch {
    // Fall through to the status-based message.
  }

  if (response.status === 413) {
    return "That image is too large to upload.";
  }

  return `The upload failed (${String(response.status)}).`;
}

/** The public URL an uploaded asset is served from, for embedding in markdown. */
export function assetUrl(hash: string): string {
  return `${runtimeConfig.apiBaseUrl}/content/assets/${hash}`;
}
