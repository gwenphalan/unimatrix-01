import type { ContentAssetMetadata } from "@unimatrix/shared";

import { LAB_API_BASE_URL } from "./api-base-url.js";
import { mockAssets } from "./fixtures.js";

/**
 * A stand-in for `apps/admin/src/features/content/asset-upload.ts` — the
 * CMS's own module, not `LabApiClient` above. The real upload flow is two
 * non-JSON, multipart routes that `@unimatrix/api-client` does not carry
 * (that package is JSON-only by rule), so the admin app owns them directly,
 * and this mock structurally copies that module rather than the client for
 * the same reason `LabApiClient` and `LabUserStore` are structural copies:
 * no app is a dependency of any workspace here.
 *
 * Kept in step with the API's `isInlineSafeContentType` allowlist
 * (`apps/api/src/lib/http/content-types.ts`) by hand. This is the third
 * hand-kept copy of that list — admin's own `ASSET_ACCEPT` is already one —
 * and nothing reconciles the three.
 */
export const LAB_ASSET_ACCEPT = "image/png,image/jpeg,image/gif,image/webp,image/avif";

const LAB_ASSET_ACCEPT_TYPES = new Set(LAB_ASSET_ACCEPT.split(","));

export class LabAssetUploadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LabAssetUploadError";
  }
}

export interface CreateLabAssetUploaderOptions {
  /** Artificial delay on every call, in milliseconds. Same rationale as `CreateLabApiClientOptions.latencyMs` in `api.ts`. */
  latencyMs?: number;
  /** Seed rows. Defaults to `mockAssets`; pass your own to design an empty state. */
  assets?: ContentAssetMetadata[];
  /** Rejection threshold in bytes. Defaults to 5 MiB, matching the API's default `MAX_UPLOAD_BYTES`. */
  maxBytes?: number;
}

export interface LabAssetUploader {
  uploadAsset(file: File): Promise<ContentAssetMetadata>;
  /** The delivery URL an uploaded or seeded asset resolves to. See the module doc comment for the three branches. */
  assetUrl(hash: string): string;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function toHex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function hashFile(file: File): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());

  return toHex(digest);
}

function escapeSvgText(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

/**
 * A fixed 640×360 placeholder for a seeded row with no bytes behind it,
 * labelled with the filename so different seeded rows are distinguishable at
 * a glance. Deterministic — the same string every call for the same
 * filename, so it does not thrash an `<img>` on rerender.
 */
function seededPlaceholderUrl(originalFilename: string): string {
  const label = escapeSvgText(`seeded mock asset — ${originalFilename}`);
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360">` +
    `<rect width="640" height="360" fill="#27272a"/>` +
    `<text x="320" y="180" fill="#a1a1aa" font-family="monospace" font-size="16" ` +
    `text-anchor="middle" dominant-baseline="middle">${label}</text>` +
    `</svg>`;

  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

/**
 * In-memory, mutable, reset by a page reload — same lifetime as
 * `createLabApiClient`, but a **separate** store. The real API backs both
 * the upload route and the list route with one `contentAssetsTable`; this
 * mock and `LabApiClient.listAssets()` are two stores that never see each
 * other's writes. Correct for the editor-insert flow this mock exists for —
 * upload, get metadata, insert a markdown image reference — and wrong for a
 * picker or asset-library prototype: an upload here succeeds and the list a
 * `LabApiClient` returns does not change.
 *
 * Two more limits worth knowing before reaching for this in a prototype:
 *
 * - **`blob:` and `data:` URLs never render inside `PublicMarkdown`.**
 *   `sanitizeMarkdownImageSource`
 *   (`packages/ui/src/components/public-markdown.tsx`) accepts only
 *   root-relative or `https?:` sources; anything else renders as a muted
 *   `<span>` with the alt text and no `<img>` at all. So an `assetUrl()`
 *   result — uploaded blob, seeded placeholder, or unseeded fallback alike —
 *   is silently blank wherever a prototype renders a post body through that
 *   component. It renders fine in a plain `<img>` and in the editor's live
 *   preview, which assigns `image.src` unsanitized. This is a property of
 *   the mock, not a bug: the sanitizer exists to guard user-editable post
 *   bodies in production, and nothing here should route around it.
 * - **Uploaded blob URLs are never revoked.** Held until the page unloads,
 *   which is also what resets this store's state — there is deliberately no
 *   `revokeAll`/`dispose` method. One would exist only to be called by a
 *   prototype that then renders a broken image, a failure mode this mock
 *   would be inventing rather than mirroring.
 */
export function createLabAssetUploader(
  options: CreateLabAssetUploaderOptions = {},
): LabAssetUploader {
  const latencyMs = options.latencyMs ?? 200;
  const maxBytes = options.maxBytes ?? 5 * 1024 * 1024;
  // Cloned on ingress, not just spread, for the same reason `createLabApiClient`
  // clones `mockPosts` and `mockAssets`: a shallow array copy still shares the
  // row objects with the seed fixture, so a later mutation here must not reach
  // back and rewrite it.
  const seeded: ContentAssetMetadata[] = (options.assets ?? mockAssets).map((asset) => ({
    ...asset,
  }));
  const uploaded = new Map<string, { metadata: ContentAssetMetadata; url: string }>();

  return {
    async uploadAsset(file) {
      // The real flow shows an `isUploading` spinner while the request is in
      // flight, so a prototype needs a visible window to design one against.
      await delay(latencyMs);

      if (file.size > maxBytes) {
        throw new LabAssetUploadError("That image is too large to upload.");
      }

      // Lowercased once, up front, and reused everywhere below — the API's
      // `isInlineSafeContentType` lowercases before comparing, so checking
      // against the raw `file.type` here would reject an uppercase MIME the
      // API accepts, and writing the raw type into the stored metadata would
      // make the same asset compare unequal to itself on a second upload.
      const contentType = file.type.toLowerCase();

      if (!LAB_ASSET_ACCEPT_TYPES.has(contentType)) {
        throw new LabAssetUploadError(`Unsupported image type: ${file.type || "unknown"}.`);
      }

      const hash = await hashFile(file);
      const existing = uploaded.get(hash);

      if (existing !== undefined) {
        // Mirrors `putAsset`'s documented re-upload no-op
        // (`apps/api/src/modules/content/store.ts`): identical bytes return
        // the existing row rather than minting a second object URL, which is
        // what makes the delivery URL safe to treat as immutably cacheable.
        return { ...existing.metadata };
      }

      const metadata: ContentAssetMetadata = {
        hash,
        contentType,
        size: file.size,
        originalFilename: file.name,
        createdAt: new Date().toISOString(),
      };

      uploaded.set(hash, { metadata, url: URL.createObjectURL(file) });

      return { ...metadata };
    },

    assetUrl(hash) {
      const upload = uploaded.get(hash);

      if (upload !== undefined) {
        return upload.url;
      }

      const seededRow = seeded.find((asset) => asset.hash === hash);

      if (seededRow !== undefined && LAB_ASSET_ACCEPT_TYPES.has(seededRow.contentType)) {
        return seededPlaceholderUrl(seededRow.originalFilename);
      }

      // No bytes to serve — the seeded `application/pdf` row and any unknown
      // hash both land here. Nothing listens on this port in the lab, so this
      // renders broken, which is the honest signal for a hash the harness
      // holds no bytes for. Shape matches the real `assetUrl` exactly.
      return `${LAB_API_BASE_URL}/content/assets/${hash}`;
    },
  };
}
