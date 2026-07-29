import type { DatabaseInstance } from "@unimatrix/db";
import { userDocumentsTable, userFilesTable } from "@unimatrix/db";
import { and, eq, ne, or, sql } from "drizzle-orm";

import { ApiError } from "../../lib/http/errors.js";

export type UserDataDb = DatabaseInstance["db"];

/**
 * The transaction handle drizzle hands the callback. Structurally the same
 * query surface as {@link UserDataDb}, narrowed to what the quota check and
 * the guarded writes actually use.
 */
type UserDataTx = Parameters<Parameters<UserDataDb["transaction"]>[0]>[0];

/** Identifies the row a pending write will replace, if one exists. */
interface ReplacedRow {
  namespace: string;
  key: string;
}

/**
 * Bytes this user already stores in `user_documents`, excluding the row the
 * pending write is about to replace.
 *
 * `length()` on a TEXT column counts **characters**, not bytes — the exact
 * mistake the shared document-value schema avoids in TypeScript, one layer
 * down. `cast(... as blob)` makes `length()` count the stored UTF-8 octets,
 * so a document of three-byte characters is charged what it actually costs.
 *
 * Excluding the replaced row is not an optimisation: an upsert *replaces*
 * that row rather than adding to it, so counting it would leave a user at
 * the cap unable to overwrite a large document with a smaller one — wedged
 * with no way out but delete-then-write.
 */
function sumDocumentBytes(tx: UserDataTx, userId: string, replaced: ReplacedRow): number {
  const rows = tx
    .select({
      total: sql<number>`coalesce(sum(length(cast(${userDocumentsTable.value} as blob))), 0)`,
    })
    .from(userDocumentsTable)
    .where(
      and(
        eq(userDocumentsTable.userId, userId),
        // De Morgan rather than `not(...)`. SQLite binds `NOT` tighter than
        // `AND`, and drizzle emits the operand unparenthesized, so
        // `not(namespace = ? and key = ?)` becomes
        // `(NOT namespace = ?) AND key = ?` — which matched nothing and made
        // this sum a constant 0, i.e. a quota that never triggered. `or()`
        // emits its own parentheses. Both columns are NOT NULL, so there is
        // no three-valued-logic hole in the `<>` form.
        or(
          ne(userDocumentsTable.namespace, replaced.namespace),
          ne(userDocumentsTable.key, replaced.key),
        ),
      ),
    )
    .all();

  return Number(rows[0]?.total ?? 0);
}

/**
 * Bytes this user already stores in `user_files`, excluding the row the
 * pending write is about to replace. `size` is written from the uploaded
 * buffer's `length`, so it is already a byte count.
 */
function sumFileBytes(tx: UserDataTx, userId: string, replaced: ReplacedRow): number {
  const rows = tx
    .select({ total: sql<number>`coalesce(sum(${userFilesTable.size}), 0)` })
    .from(userFilesTable)
    .where(
      and(
        eq(userFilesTable.userId, userId),
        or(ne(userFilesTable.namespace, replaced.namespace), ne(userFilesTable.key, replaced.key)),
      ),
    )
    .all();

  return Number(rows[0]?.total ?? 0);
}

/**
 * Rejects a write that would take the user past
 * `ApiRuntimeConfig.maxUserStorageBytes`, counting documents and files
 * together.
 *
 * 413 rather than 507: the request is refused because of *this caller's*
 * quota, not because the server is out of room, and the task called for a
 * 4xx — 507 is a 5xx and would additionally be logged at `error` by
 * `getLogLevelForStatusCode`, which is wrong for a client-caused condition.
 *
 * Must be called inside the same transaction as the write it guards. See
 * the note on {@link runGuardedWrite}.
 */
function assertWithinStorageQuota(
  tx: UserDataTx,
  userId: string,
  replaced: ReplacedRow,
  pendingBytes: number,
  maxUserStorageBytes: number,
): void {
  const existingBytes = sumDocumentBytes(tx, userId, replaced) + sumFileBytes(tx, userId, replaced);
  const totalBytes = existingBytes + pendingBytes;

  if (totalBytes > maxUserStorageBytes) {
    throw new ApiError({
      statusCode: 413,
      code: "QUOTA_EXCEEDED",
      message: `Storage quota exceeded: this write would bring stored data to ${totalBytes} bytes, over the ${maxUserStorageBytes} byte limit. Delete existing documents or files and retry.`,
    });
  }
}

/**
 * Runs the quota check and the write it guards inside one SQLite
 * transaction, so two writes cannot both read a passing total and jointly
 * exceed the cap.
 *
 * The callback is **synchronous on purpose**. `better-sqlite3` is a
 * synchronous driver, so drizzle's `transaction()` takes a sync callback and
 * the query builders are driven with `.all()`/`.get()` rather than `await`.
 * That is what makes this airtight in-process: no other JavaScript can
 * interleave between the read and the write on Node's single thread. Making
 * the callback `async` would hand control back to the event loop mid-
 * transaction and quietly reintroduce the race.
 *
 * `behavior: "immediate"` takes the write lock up front, so the guarantee
 * also holds across processes: a second API instance on the same file blocks
 * rather than reading a stale total.
 *
 * Returns a promise even though the work is already done, so the store keeps
 * the async contract the rest of this module and its callers use — and so a
 * quota rejection surfaces as a rejected promise rather than a synchronous
 * throw. A `throw` from inside `db.transaction` still propagates out of the
 * awaiting `async` caller as a rejection.
 */
function runGuardedWrite<T>(db: UserDataDb, write: (tx: UserDataTx) => T): Promise<T> {
  return Promise.resolve(db.transaction(write, { behavior: "immediate" }));
}

export interface StoredDocument {
  namespace: string;
  key: string;
  value: unknown;
  updatedAt: string;
}

export interface StoredFileMetadata {
  namespace: string;
  key: string;
  contentType: string;
  size: number;
  updatedAt: string;
}

export interface StoredFile extends StoredFileMetadata {
  data: Buffer;
}

function toStoredDocument(row: typeof userDocumentsTable.$inferSelect): StoredDocument {
  return {
    namespace: row.namespace,
    key: row.key,
    value: JSON.parse(row.value) as unknown,
    updatedAt: row.updatedAt,
  };
}

type FileMetadataRow = Pick<
  typeof userFilesTable.$inferSelect,
  "namespace" | "key" | "contentType" | "size" | "updatedAt"
>;

function toStoredFileMetadata(row: FileMetadataRow): StoredFileMetadata {
  return {
    namespace: row.namespace,
    key: row.key,
    contentType: row.contentType,
    size: row.size,
    updatedAt: row.updatedAt,
  };
}

export async function getDocument(
  db: UserDataDb,
  userId: string,
  namespace: string,
  key: string,
): Promise<StoredDocument | undefined> {
  const rows = await db
    .select()
    .from(userDocumentsTable)
    .where(
      and(
        eq(userDocumentsTable.userId, userId),
        eq(userDocumentsTable.namespace, namespace),
        eq(userDocumentsTable.key, key),
      ),
    )
    .limit(1);

  const row = rows[0];

  return row === undefined ? undefined : toStoredDocument(row);
}

export async function putDocument(
  db: UserDataDb,
  userId: string,
  namespace: string,
  key: string,
  value: unknown,
  maxUserStorageBytes: number,
): Promise<StoredDocument> {
  const serializedValue = JSON.stringify(value);
  // Node-side, so `Buffer.byteLength` is the direct measurement. It has to
  // agree with what `sumDocumentBytes` charges the row later, which reads
  // the column's UTF-8 octets.
  const pendingBytes = Buffer.byteLength(serializedValue, "utf8");

  const row = await runGuardedWrite(db, (tx) => {
    assertWithinStorageQuota(tx, userId, { namespace, key }, pendingBytes, maxUserStorageBytes);

    return tx
      .insert(userDocumentsTable)
      .values({
        userId,
        namespace,
        key,
        value: serializedValue,
      })
      .onConflictDoUpdate({
        target: [userDocumentsTable.userId, userDocumentsTable.namespace, userDocumentsTable.key],
        set: {
          value: serializedValue,
          updatedAt: sql`CURRENT_TIMESTAMP`,
        },
      })
      .returning()
      .all()[0];
  });

  if (row === undefined) {
    throw new Error("putDocument: upsert did not return a row.");
  }

  return toStoredDocument(row);
}

export async function deleteDocument(
  db: UserDataDb,
  userId: string,
  namespace: string,
  key: string,
): Promise<boolean> {
  const rows = await db
    .delete(userDocumentsTable)
    .where(
      and(
        eq(userDocumentsTable.userId, userId),
        eq(userDocumentsTable.namespace, namespace),
        eq(userDocumentsTable.key, key),
      ),
    )
    .returning();

  return rows.length > 0;
}

export async function listDocuments(
  db: UserDataDb,
  userId: string,
  namespace: string,
): Promise<StoredDocument[]> {
  const rows = await db
    .select()
    .from(userDocumentsTable)
    .where(and(eq(userDocumentsTable.userId, userId), eq(userDocumentsTable.namespace, namespace)));

  return rows.map(toStoredDocument);
}

export async function putFile(
  db: UserDataDb,
  userId: string,
  namespace: string,
  key: string,
  contentType: string,
  size: number,
  data: Buffer,
  maxUserStorageBytes: number,
): Promise<StoredFileMetadata> {
  const row = await runGuardedWrite(db, (tx) => {
    assertWithinStorageQuota(tx, userId, { namespace, key }, size, maxUserStorageBytes);

    return tx
      .insert(userFilesTable)
      .values({
        userId,
        namespace,
        key,
        contentType,
        size,
        data,
      })
      .onConflictDoUpdate({
        target: [userFilesTable.userId, userFilesTable.namespace, userFilesTable.key],
        set: {
          contentType,
          size,
          data,
          updatedAt: sql`CURRENT_TIMESTAMP`,
        },
      })
      .returning({
        namespace: userFilesTable.namespace,
        key: userFilesTable.key,
        contentType: userFilesTable.contentType,
        size: userFilesTable.size,
        updatedAt: userFilesTable.updatedAt,
      })
      .all()[0];
  });

  if (row === undefined) {
    throw new Error("putFile: upsert did not return a row.");
  }

  return toStoredFileMetadata(row);
}

export async function getFile(
  db: UserDataDb,
  userId: string,
  namespace: string,
  key: string,
): Promise<StoredFile | undefined> {
  const rows = await db
    .select()
    .from(userFilesTable)
    .where(
      and(
        eq(userFilesTable.userId, userId),
        eq(userFilesTable.namespace, namespace),
        eq(userFilesTable.key, key),
      ),
    )
    .limit(1);

  const row = rows[0];

  if (row === undefined) {
    return undefined;
  }

  return {
    ...toStoredFileMetadata(row),
    data: row.data,
  };
}

/** Metadata only — never selects the `data` blob column. */
export async function listFiles(
  db: UserDataDb,
  userId: string,
  namespace: string,
): Promise<StoredFileMetadata[]> {
  const rows = await db
    .select({
      namespace: userFilesTable.namespace,
      key: userFilesTable.key,
      contentType: userFilesTable.contentType,
      size: userFilesTable.size,
      updatedAt: userFilesTable.updatedAt,
    })
    .from(userFilesTable)
    .where(and(eq(userFilesTable.userId, userId), eq(userFilesTable.namespace, namespace)));

  return rows.map(toStoredFileMetadata);
}

export async function deleteFile(
  db: UserDataDb,
  userId: string,
  namespace: string,
  key: string,
): Promise<boolean> {
  const rows = await db
    .delete(userFilesTable)
    .where(
      and(
        eq(userFilesTable.userId, userId),
        eq(userFilesTable.namespace, namespace),
        eq(userFilesTable.key, key),
      ),
    )
    .returning();

  return rows.length > 0;
}
