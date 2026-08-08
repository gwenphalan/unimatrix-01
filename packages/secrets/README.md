# @unimatrix/secrets

Pure, I/O-free AES-256-GCM value sealing under a versioned key ring, plus redaction. See `AGENTS.md` for the package's behaviors and boundaries.

## `SECRETS_KEKS` format

One comma-separated string of `<version>:<base64key>` entries. Generate a key with:

```sh
openssl rand -base64 32
```

Each key must decode to exactly 32 bytes. **The first entry is the active (writing) key; every entry can open.** The active version must be the highest version present — `1:...,2:...` fails to load with `KEK_NOT_NEWEST`, because a lower version listed first would silently seal every new write under the older key.

```
SECRETS_KEKS=2:Zm9v...,1:YmFy...
```
