/**
 * The only data surface a prototype may use.
 *
 * Everything here is in-memory, typed against the real contracts, and reachable
 * with no Clerk keys, no API running and no database. Nothing here performs a
 * network request. See `lab/AGENTS.md` for why that is a hard rule rather than
 * a convenience.
 */

export { assertLocalhostUrl, LAB_API_BASE_URL } from "./api-base-url.js";

export type { CreateLabApiClientOptions, LabApiClient } from "./api.js";
export { createLabApiClient, LabApiError } from "./api.js";

export type { CreateLabAssetUploaderOptions, LabAssetUploader } from "./asset-upload.js";
export { createLabAssetUploader, LAB_ASSET_ACCEPT, LabAssetUploadError } from "./asset-upload.js";

export { mockAssets, mockDocuments, mockFiles, mockPosts } from "./fixtures.js";

export type { LabSession, MockAccountControlProps } from "./session.js";
export {
  labAdminSession,
  labSessionHasPermission,
  labSignedOutSession,
  labViewerSession,
  MockAccountControl,
} from "./session.js";

export type {
  CreateLabUserStoreOptions,
  LabUserSettingsEntry,
  LabUserFilesStore,
  LabUserFilesUploadOptions,
  LabUserSettingsStore,
  LabUserStore,
} from "./user-data.js";
export { createLabUserStore } from "./user-data.js";
