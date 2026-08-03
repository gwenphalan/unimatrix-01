import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ASSET_ACCEPT,
  AssetUploadError,
  assetUrl,
  uploadAsset,
} from "@/features/content/asset-upload";

const BASE_URL = "https://api.unimatrix-01.dev";

const METADATA = {
  hash: "a".repeat(64),
  contentType: "image/png",
  size: 12,
  originalFilename: "shot.png",
  createdAt: "2026-07-28T00:00:00.000Z",
};

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

function pngFile(): File {
  return new File([new Uint8Array([1, 2, 3])], "shot.png", { type: "image/png" });
}

describe("uploadAsset", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("posts multipart form data with the bearer token and no Content-Type header", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(METADATA, 201));

    await expect(uploadAsset(pngFile(), "token-123", BASE_URL)).resolves.toEqual(METADATA);

    const [url, init] = vi.mocked(fetch).mock.calls[0] ?? [];

    expect(url).toBe(`${BASE_URL}/content/admin/assets`);
    expect(init?.method).toBe("POST");
    expect(init?.body).toBeInstanceOf(FormData);
    // Setting Content-Type by hand would omit the multipart boundary the
    // browser generated for this body, and the API would fail to parse it.
    expect(init?.headers).toEqual({ authorization: "Bearer token-123" });
  });

  it("refuses to send anything without a token", async () => {
    await expect(uploadAsset(pngFile(), null, BASE_URL)).rejects.toBeInstanceOf(AssetUploadError);

    expect(fetch).not.toHaveBeenCalled();
  });

  it("surfaces the API's rejection message", async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({ message: "Only image uploads are allowed." }, 415),
    );

    await expect(uploadAsset(pngFile(), "token-123", BASE_URL)).rejects.toThrow(
      "Only image uploads are allowed.",
    );
  });

  it("describes a 413 without a JSON body in terms of the file, not the status", async () => {
    // A proxy can reject an oversized body before the API sees it, so the
    // response is not always the API's error envelope.
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 413,
      json: () => Promise.reject(new SyntaxError("Unexpected token <")),
    } as unknown as Response);

    await expect(uploadAsset(pngFile(), "token-123", BASE_URL)).rejects.toThrow(/too large/u);
  });

  it("falls back to the status for any other unparseable failure", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 502,
      json: () => Promise.reject(new SyntaxError("Unexpected token <")),
    } as unknown as Response);

    await expect(uploadAsset(pngFile(), "token-123", BASE_URL)).rejects.toThrow(
      "The upload failed (502).",
    );
  });
});

describe("assetUrl", () => {
  it("builds the content-addressed URL an editor embeds, on the API origin", () => {
    expect(assetUrl(METADATA.hash, BASE_URL)).toBe(`${BASE_URL}/content/assets/${METADATA.hash}`);
  });
});

describe("ASSET_ACCEPT", () => {
  it("lists only the raster types the API's inline allowlist accepts", () => {
    // Kept in step with `isInlineSafeContentType` on the API side; the API
    // re-checks the real mimetype, so this is a file-picker hint rather than
    // the decision.
    expect(ASSET_ACCEPT.split(",")).toEqual([
      "image/png",
      "image/jpeg",
      "image/gif",
      "image/webp",
      "image/avif",
    ]);
  });
});
