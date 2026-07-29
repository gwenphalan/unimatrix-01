import type { DataKey, DataNamespace, UserDocument, UserFileMetadata } from "@unimatrix/shared";

import { mockDocuments, mockFiles } from "./fixtures.js";

/**
 * A stand-in for `@unimatrix/user-data`'s `UserStore`.
 *
 * The store *surface* is redeclared here rather than imported, which is the one
 * place this file deliberately diverges from "implement the real type".
 * `@unimatrix/user-data`'s barrel re-exports `createAccountUserStore`, which
 * imports and calls `createApiClient` — so depending on the package to borrow
 * an interface would put a working, credential-taking transport one import away
 * from every prototype. That is the exact risk the lab's local-only design
 * exists to remove, and an interface is not worth reintroducing it for.
 *
 * The *data* shapes are not redeclared. `UserDocument` and `UserFileMetadata`
 * come from `@unimatrix/shared`, so a contract change still breaks this file at
 * typecheck — which is where the fiction would otherwise creep in.
 *
 * Keep this in step with `packages/user-data/src/types.ts` by hand. It is a
 * small, stable interface; if it ever stops being either, the answer is a
 * types-only entry point on that package, not a dependency here.
 */
/** One entry as returned by {@link LabUserSettingsStore.list}. */
export interface LabUserSettingsEntry {
  key: DataKey;
  value: unknown;
}

export interface LabUserSettingsStore {
  /** Resolves `undefined` when no document exists for `key` (never throws for "missing"). */
  get<T = unknown>(key: DataKey): Promise<T | undefined>;
  set<T = unknown>(key: DataKey, value: T): Promise<void>;
  delete(key: DataKey): Promise<void>;
  list(): Promise<LabUserSettingsEntry[]>;
}

export interface LabUserFilesUploadOptions {
  /** Overrides the blob's own `type`; falls back to `file.type` when omitted. */
  contentType?: string;
}

export interface LabUserFilesStore {
  upload(key: DataKey, file: Blob, options?: LabUserFilesUploadOptions): Promise<UserFileMetadata>;
  /** Resolves `undefined` when no file exists for `key`. */
  getBlob(key: DataKey): Promise<Blob | undefined>;
  /** Resolves `undefined` when no file exists for `key`. */
  getObjectUrl(key: DataKey): Promise<string | undefined>;
  list(): Promise<UserFileMetadata[]>;
  delete(key: DataKey): Promise<void>;
}

export interface LabUserStore {
  /**
   * Always `"account"`. A guest store is IndexedDB-backed and works fine
   * locally, so the adapter worth mocking is the one that would otherwise need
   * a Clerk session and a running API.
   */
  readonly mode: "account" | "guest";
  settings: LabUserSettingsStore;
  files: LabUserFilesStore;
}

export interface CreateLabUserStoreOptions {
  /** Namespace every document and file is scoped to. Defaults to `"lab"`. */
  namespace?: DataNamespace;
  /** Seed documents. Defaults to `mockDocuments`; pass `[]` for an empty state. */
  documents?: UserDocument[];
  /** Seed file metadata. Defaults to `mockFiles`; pass `[]` for an empty state. */
  files?: UserFileMetadata[];
}

/**
 * In-memory and reset by a page reload.
 *
 * Seeded files have metadata but no bytes — `getBlob` resolves `undefined` for
 * them until something is uploaded over the same key. Fabricating plausible
 * bytes would make an empty-download bug invisible in a prototype, and a
 * prototype that needs real bytes can upload them.
 */
export function createLabUserStore(options: CreateLabUserStoreOptions = {}): LabUserStore {
  const namespace = options.namespace ?? "lab";

  // Seed fixtures belong to the default namespace. Asking for a different one
  // and being handed `lab`'s data would make a prototype look like it reads
  // across namespaces when the real store does not. Explicitly supplied
  // documents/files are always honoured — that is the caller's own data.
  const seedDocuments = options.documents ?? (namespace === "lab" ? mockDocuments : []);
  const seedFiles = options.files ?? (namespace === "lab" ? mockFiles : []);

  const documents = new Map<DataKey, unknown>(
    seedDocuments.map((document) => [document.key, document.value]),
  );
  const fileMetadata = new Map<DataKey, UserFileMetadata>(
    seedFiles.map((file) => [file.key, file]),
  );
  const fileBlobs = new Map<DataKey, Blob>();

  const settings: LabUserSettingsStore = {
    get<T>(key: DataKey) {
      return Promise.resolve(documents.get(key) as T | undefined);
    },

    set<T>(key: DataKey, value: T) {
      documents.set(key, value);

      return Promise.resolve();
    },

    delete(key: DataKey) {
      documents.delete(key);

      return Promise.resolve();
    },

    list() {
      return Promise.resolve(
        [...documents.entries()].map(([key, value]) => ({
          key,
          value,
        })),
      );
    },
  };

  const files: LabUserFilesStore = {
    upload(key: DataKey, file: Blob, uploadOptions?: LabUserFilesUploadOptions) {
      const metadata: UserFileMetadata = {
        namespace,
        key,
        contentType: uploadOptions?.contentType ?? file.type,
        size: file.size,
        updatedAt: new Date().toISOString(),
      };

      fileBlobs.set(key, file);
      fileMetadata.set(key, metadata);

      return Promise.resolve(metadata);
    },

    getBlob(key: DataKey) {
      return Promise.resolve(fileBlobs.get(key));
    },

    getObjectUrl(key: DataKey) {
      const blob = fileBlobs.get(key);

      return Promise.resolve(blob === undefined ? undefined : URL.createObjectURL(blob));
    },

    list() {
      return Promise.resolve([...fileMetadata.values()]);
    },

    delete(key: DataKey) {
      fileBlobs.delete(key);
      fileMetadata.delete(key);

      return Promise.resolve();
    },
  };

  return { mode: "account", settings, files };
}
