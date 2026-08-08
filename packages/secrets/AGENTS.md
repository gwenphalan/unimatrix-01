# AGENTS.md

## 1. Overview
`packages/secrets` is pure, I/O-free AES-256-GCM value sealing under a versioned key ring, plus redaction. Node-only, zero runtime dependencies, no `@unimatrix/db`, no persistence. `apps/secrets` is its only consumer — that service owns storage and, once later items land, the routes that use it.

## 2. Folder Structure
- `src/errors.ts`: `SecretsError` and every `SecretsErrorCode` this package can raise.
- `src/secret-value.ts`: `SecretValue`, the plaintext wrapper that refuses to serialize itself.
- `src/keyring.ts`: `SecretsKeyring` and `loadSecretsKeyring`, the `SECRETS_KEKS` parser and validator.
- `src/envelope.ts`: the AES-256-GCM envelope format and its AAD.
- `src/index.ts`: barrel re-exporting every module.

## 3. Core Behaviors & Patterns
- **Never reads `process.env`.** `loadSecretsKeyring` takes the encoded key string as an argument, same rule `packages/auth` follows. This package never boots anything and never calls `process.exit`; a caller decides what a thrown `SecretsError` means for its own startup.
- **AAD and plaintext-release**: see `envelope.ts`'s `buildAad` and `openSecretEnvelope` for what the AAD binds and why decryption has to happen as one expression — both are load-bearing comments on the lines that matter. The one thing worth repeating here: the AAD's granularity (binding `versionId`, not just `name`) is fixed the moment the first row is sealed under it; changing it means re-encrypting the whole store.
- **Redaction bounds logs and serialization, not memory.** A JS string cannot be zeroized. `SecretValue`'s `toString`/`toJSON`/inspect override stop a value from leaking into a log line or a `JSON.stringify`; they say nothing about a value already scraped from process memory. Do not describe this package as protecting against the stronger property.
- **Contract shapes live in `@unimatrix/shared`**, not here — `secretMetadataSchema` and friends in `packages/shared/src/schemas/secrets.ts`. This package owns crypto and redaction only.

## 4. Scope
Platform secrets — `CLERK_SECRET_KEY`, `CLERK_JWT_KEY`, the database path, the Dokploy API token, and this package's own KEK — stay in compose env and never enter the store this package will back. Deployment-env materialization (pushing a value into Dokploy) and Dokploy-token handling are permanently out of scope for this package, not just for now: a separate trust level and a separate future spec. This package does not enforce that the KEK stays unreachable from any particular app — that is a property of the service and route design in later items, not of the crypto here.

## 5. Conventions
- **Naming**: `load*` for the one env-shaped entry point (`loadSecretsKeyring`); `seal*`/`open*` for envelope functions.
- **Errors**: every public entry point throws `SecretsError` with a `SecretsErrorCode`, never a bare `Error`. Messages never contain key material, plaintext, or ciphertext field contents.
